use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use nokhwa::utils::{ControlValueSetter, KnownCameraControl};
use serde_json::{json, Value};

use crate::camera_worker::CameraWorker;

pub struct CameraState {
    pub active_camera_index: usize,
    pub brightness: u32,
    pub contrast: u32,
    pub zoom: f32,
    pub flash_enabled: bool,
    pub recording_active: bool,
    pub streaming_active: bool,
    worker: CameraWorker,
    pub detected_devices: Vec<nokhwa::utils::CameraInfo>,
    pub capture_in_flight: Arc<AtomicBool>,
    pub capture_fail_streak: u32,
    pub blocked_by_external_app: bool,
    pub status_message: Option<String>,
    release_pending: bool,
    camera_open: AtomicBool,
}

#[derive(Debug, Clone)]
pub enum SwitchResult {
    Success,
    AlreadyActive,
    NoDevices,
    InvalidIndex { requested: usize, available: usize },
    #[allow(dead_code)]
    OpenFailed { index: usize },
    OpenFailedRestored { requested: usize },
    InUseByOtherApp { index: usize },
}

impl SwitchResult {
    pub fn is_success(&self) -> bool {
        matches!(self, SwitchResult::Success | SwitchResult::AlreadyActive)
    }
}

impl CameraState {
    pub fn new() -> Self {
        Self {
            active_camera_index: 0,
            brightness: 50,
            contrast: 50,
            zoom: 1.0,
            flash_enabled: false,
            recording_active: false,
            streaming_active: false,
            worker: CameraWorker::spawn(),
            detected_devices: Vec::new(),
            capture_in_flight: Arc::new(AtomicBool::new(false)),
            capture_fail_streak: 0,
            blocked_by_external_app: false,
            status_message: None,
            release_pending: false,
            camera_open: AtomicBool::new(false),
        }
    }

    pub fn camera_is_open(&self) -> bool {
        self.camera_open.load(Ordering::Acquire)
    }

    pub fn clone_worker(&self) -> CameraWorker {
        self.worker.clone()
    }

    pub fn set_brightness_control(&self, value: u32) {
        self.worker.set_control(
            KnownCameraControl::Brightness,
            ControlValueSetter::Integer(value as i64),
        );
    }

    pub fn set_contrast_control(&self, value: u32) {
        self.worker.set_control(
            KnownCameraControl::Contrast,
            ControlValueSetter::Integer(value as i64),
        );
    }

    pub fn request_stop_and_release(&mut self) {
        self.streaming_active = false;
        self.recording_active = false;
        self.blocked_by_external_app = false;
        self.release_pending = false;
        self.wait_capture_idle();
        self.worker.close();
        self.camera_open.store(false, Ordering::Release);
        self.status_message = Some("Camera turned off.".into());
        println!("[RUST AGENT] Camera released — hardware off.");
    }

    pub fn try_complete_release(&mut self) -> bool {
        if !self.release_pending || self.streaming_active {
            return false;
        }
        if self.capture_in_flight.load(Ordering::Acquire) {
            return false;
        }
        self.worker.close();
        self.camera_open.store(false, Ordering::Release);
        self.release_pending = false;
        println!("[RUST AGENT] Camera released — hardware off.");
        true
    }

    pub fn mark_blocked_by_external_app(&mut self) {
        self.streaming_active = false;
        self.recording_active = false;
        self.blocked_by_external_app = true;
        self.capture_fail_streak = 0;
        self.status_message = Some(
            "Camera is in use by another app on this PC. Close Camera app and try again.".into(),
        );
        self.release_pending = true;
        println!("[RUST AGENT] Camera blocked — releasing hardware for other app.");
    }

    /// Transient capture misses (motion / driver lag) must NOT kill the stream.
    /// Only skip the frame; external-app blocking comes from open failures only.
    pub fn handle_capture_failure(&mut self) -> bool {
        if !self.streaming_active {
            return false;
        }
        self.capture_fail_streak = self.capture_fail_streak.saturating_add(1);
        // Soft warning only — never auto STOP / STREAM_LOST from dropped frames.
        if self.capture_fail_streak == 60 || self.capture_fail_streak % 300 == 0 {
            println!(
                "[RUST AGENT] Camera frame miss streak={} (keeping stream alive)",
                self.capture_fail_streak
            );
        }
        false
    }

    pub fn resume_camera_stream(&mut self) -> bool {
        if !self.camera_is_open() {
            return false;
        }
        self.wait_capture_idle();
        let resumed = self.worker.open_stream();
        if resumed {
            self.streaming_active = true;
            self.blocked_by_external_app = false;
            self.capture_fail_streak = 0;
        }
        resumed
    }

    fn wait_capture_idle(&self) {
        for _ in 0..500 {
            if !self.capture_in_flight.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn probe_hardware_capabilities(&mut self) {
        println!("--> [HARDWARE] Scanning system for connected cameras...");

        match self.worker.probe() {
            Ok(devices) => {
                self.detected_devices = devices;
                for (i, dev) in self.detected_devices.iter().enumerate() {
                    println!(
                        "--> [FOUND] Camera {}: {} ({:?})",
                        i,
                        dev.human_name(),
                        dev.index()
                    );
                }
            }
            Err(err) => {
                eprintln!("[ERROR] Failed to query camera devices: {}", err);
                self.detected_devices.clear();
                self.status_message = Some(format!("Camera scan failed: {}", err));
            }
        }
    }

    pub fn available_camera_count(&self) -> usize {
        self.detected_devices.len()
    }

    pub fn build_camera_manifest(&self) -> Vec<Value> {
        let device_open = self.camera_is_open();
        self.detected_devices
            .iter()
            .enumerate()
            .map(|(index, device)| {
                let is_active = index == self.active_camera_index && device_open;

                json!({
                    "id": format!("cam-{}", index),
                    "index": index,
                    "label": device.human_name(),
                    "status": if is_active { "ACTIVE" } else { "AVAILABLE" },
                    "resolution": if is_active {
                        self.active_resolution_label()
                    } else {
                        String::from("Ready")
                    },
                    "fps": if is_active {
                        self.active_fps_label()
                    } else {
                        String::from("---")
                    }
                })
            })
            .collect()
    }

    pub fn switch_camera_by_index(&mut self, index: usize) -> SwitchResult {
        if self.detected_devices.is_empty() {
            return SwitchResult::NoDevices;
        }

        if index >= self.detected_devices.len() {
            return SwitchResult::InvalidIndex {
                requested: index,
                available: self.detected_devices.len(),
            };
        }

        if index == self.active_camera_index && self.camera_is_open() {
            return SwitchResult::AlreadyActive;
        }

        let previous_index = self.active_camera_index;
        let target_index = self.detected_devices[index].index().clone();
        let device_label = self.detected_devices[index].human_name().to_string();

        match self.open_camera_at(target_index, index) {
            SwitchResult::Success => {
                println!(
                    "--> [HARDWARE] Switched to camera {} ({})",
                    index, device_label
                );
                self.blocked_by_external_app = false;
                SwitchResult::Success
            }
            failed @ (SwitchResult::InUseByOtherApp { .. } | SwitchResult::OpenFailed { .. }) => {
                if previous_index < self.detected_devices.len() {
                    let restore_index = self.detected_devices[previous_index].index().clone();
                    if self.open_camera_at(restore_index, previous_index).is_success() {
                        eprintln!(
                            "[HARDWARE-WARN] Camera {} unavailable. Restored previous camera {}.",
                            index, previous_index
                        );
                        SwitchResult::OpenFailedRestored { requested: index }
                    } else {
                        failed
                    }
                } else {
                    failed
                }
            }
            other => other,
        }
    }

    pub fn release_camera_hardware(&mut self) {
        self.wait_capture_idle();
        self.worker.close();
        self.camera_open.store(false, Ordering::Release);
        self.release_pending = false;
    }

    fn open_camera_at(
        &mut self,
        device_index: nokhwa::utils::CameraIndex,
        logical_index: usize,
    ) -> SwitchResult {
        match self.worker.open(device_index) {
            Ok(_) => {
                self.active_camera_index = logical_index;
                self.blocked_by_external_app = false;
                self.release_pending = false;
                self.status_message = None;
                self.camera_open.store(true, Ordering::Release);
                SwitchResult::Success
            }
            Err(err) => {
                eprintln!("[ERROR] Could not open camera device: {}", err);
                self.blocked_by_external_app = true;
                self.camera_open.store(false, Ordering::Release);
                self.status_message = Some(
                    "Camera is in use by another app on this PC. Close Camera app and try again."
                        .into(),
                );
                SwitchResult::InUseByOtherApp { index: logical_index }
            }
        }
    }

    pub fn capture_rgb_frame(&self) -> Option<crate::camera_worker::CapturedRgb> {
        self.worker.capture_rgb()
    }

    pub fn active_resolution_label(&self) -> String {
        self.worker
            .format_info()
            .map(|info| format!("{}x{}", info.width, info.height))
            .unwrap_or_else(|| "N/A".to_string())
    }

    pub fn active_fps_label(&self) -> String {
        self.worker
            .format_info()
            .map(|info| format!("{} FPS", info.frame_rate))
            .unwrap_or_else(|| "---".to_string())
    }

    pub fn driver_status(&self) -> String {
        self.worker
            .format_info()
            .map(|info| info.format_string)
            .unwrap_or_else(|| "OFFLINE_OR_UNAVAILABLE".to_string())
    }
}
