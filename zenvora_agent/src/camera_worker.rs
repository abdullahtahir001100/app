use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::thread;
use std::time::Duration;

use nokhwa::{
    pixel_format::RgbFormat,
    utils::{
        ApiBackend, CameraFormat, CameraIndex, CameraInfo, ControlValueSetter, FrameFormat,
        KnownCameraControl, RequestedFormat, RequestedFormatType, Resolution,
    },
    query, Camera,
};

use crate::com_runtime;

#[derive(Clone, Debug)]
pub struct CameraFormatInfo {
    pub width: u32,
    pub height: u32,
    pub frame_rate: u32,
    pub format_string: String,
}

pub struct CapturedRgb {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

enum WorkerMsg {
    Probe {
        reply: SyncSender<Result<Vec<CameraInfo>, String>>,
    },
    Open {
        index: CameraIndex,
        reply: SyncSender<Result<CameraFormatInfo, String>>,
    },
    Close {
        reply: SyncSender<()>,
    },
    CaptureRgb {
        reply: SyncSender<Option<CapturedRgb>>,
    },
    OpenStream {
        reply: SyncSender<bool>,
    },
    #[allow(dead_code)]
    StopStream {
        reply: SyncSender<()>,
    },
    SetControl {
        control: KnownCameraControl,
        value: ControlValueSetter,
        reply: SyncSender<()>,
    },
    Format {
        reply: SyncSender<Option<CameraFormatInfo>>,
    },
    #[allow(dead_code)]
    IsOpen {
        reply: SyncSender<bool>,
    },
}

#[derive(Clone)]
pub struct CameraWorker {
    tx: Sender<WorkerMsg>,
}

impl CameraWorker {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        thread::Builder::new()
            .name("zenvora-camera".into())
            .spawn(move || worker_main(rx))
            .expect("failed to spawn camera worker thread");
        Self { tx }
    }

    fn call<T, F>(&self, build: F) -> Option<T>
    where
        F: FnOnce(SyncSender<T>) -> WorkerMsg,
    {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        if self.tx.send(build(reply_tx)).is_err() {
            return None;
        }
        reply_rx.recv().ok()
    }

    pub fn probe(&self) -> Result<Vec<CameraInfo>, String> {
        self.call(|reply| WorkerMsg::Probe { reply })
            .unwrap_or(Err(String::from("camera worker offline")))
    }

    pub fn open(&self, index: CameraIndex) -> Result<CameraFormatInfo, String> {
        self.call(|reply| WorkerMsg::Open { index, reply })
            .unwrap_or(Err(String::from("camera worker offline")))
    }

    pub fn close(&self) {
        let _ = self.call(|reply| WorkerMsg::Close { reply });
    }

    pub fn capture_rgb(&self) -> Option<CapturedRgb> {
        self.call(|reply| WorkerMsg::CaptureRgb { reply }).flatten()
    }

    pub fn open_stream(&self) -> bool {
        self.call(|reply| WorkerMsg::OpenStream { reply })
            .unwrap_or(false)
    }

    #[allow(dead_code)]
    pub fn stop_stream(&self) {
        let _ = self.call(|reply| WorkerMsg::StopStream { reply });
    }

    pub fn set_control(&self, control: KnownCameraControl, value: ControlValueSetter) {
        let _ = self.call(|reply| WorkerMsg::SetControl {
            control,
            value,
            reply,
        });
    }

    pub fn format_info(&self) -> Option<CameraFormatInfo> {
        self.call(|reply| WorkerMsg::Format { reply }).flatten()
    }

    #[allow(dead_code)]
    pub fn is_open(&self) -> bool {
        self.call(|reply| WorkerMsg::IsOpen { reply })
            .unwrap_or(false)
    }
}

struct WorkerInner {
    camera: Option<Camera>,
}

fn worker_main(rx: Receiver<WorkerMsg>) {
    com_runtime::init_process_com();
    let mut inner = WorkerInner { camera: None };

    for msg in rx {
        match msg {
            WorkerMsg::Probe { reply } => {
                let _ = reply.send(query(ApiBackend::Auto).map_err(|err| err.to_string()));
            }
            WorkerMsg::Open { index, reply } => {
                let _ = reply.send(open_camera(&mut inner, index));
            }
            WorkerMsg::Close { reply } => {
                release_camera(&mut inner);
                let _ = reply.send(());
            }
            WorkerMsg::CaptureRgb { reply } => {
                let _ = reply.send(capture_rgb(&mut inner));
            }
            WorkerMsg::OpenStream { reply } => {
                let ok = inner
                    .camera
                    .as_mut()
                    .map(|cam| cam.open_stream().is_ok())
                    .unwrap_or(false);
                let _ = reply.send(ok);
            }
            WorkerMsg::StopStream { reply } => {
                if let Some(cam) = inner.camera.as_mut() {
                    let _ = cam.stop_stream();
                }
                let _ = reply.send(());
            }
            WorkerMsg::SetControl {
                control,
                value,
                reply,
            } => {
                if let Some(cam) = inner.camera.as_mut() {
                    let _ = cam.set_camera_control(control, value);
                }
                let _ = reply.send(());
            }
            WorkerMsg::Format { reply } => {
                let info = inner.camera.as_ref().map(format_from_camera);
                let _ = reply.send(info);
            }
            WorkerMsg::IsOpen { reply } => {
                let _ = reply.send(inner.camera.is_some());
            }
        }
    }
}

fn format_from_camera(cam: &Camera) -> CameraFormatInfo {
    let fmt = cam.camera_format();
    CameraFormatInfo {
        width: fmt.width(),
        height: fmt.height(),
        frame_rate: fmt.frame_rate(),
        format_string: fmt.to_string(),
    }
}

fn open_camera(inner: &mut WorkerInner, device_index: CameraIndex) -> Result<CameraFormatInfo, String> {
    release_camera(inner);
    // Give Windows time to fully release exclusive camera handles after drop.
    thread::sleep(Duration::from_millis(250));

    // Try several formats — Integrated Webcam often rejects a hard MJPEG 640x480 request
    // even when the device is free (was previously reported as "in use by another app").
    let attempts: Vec<RequestedFormatType> = vec![
        RequestedFormatType::Closest(CameraFormat::new(
            Resolution::new(640, 480),
            FrameFormat::MJPEG,
            15,
        )),
        RequestedFormatType::Closest(CameraFormat::new(
            Resolution::new(640, 480),
            FrameFormat::YUYV,
            15,
        )),
        RequestedFormatType::Closest(CameraFormat::new(
            Resolution::new(1280, 720),
            FrameFormat::MJPEG,
            10,
        )),
        RequestedFormatType::AbsoluteHighestFrameRate,
    ];

    let mut last_err = String::from("unknown camera open error");
    for (i, fmt_type) in attempts.into_iter().enumerate() {
        let requested = RequestedFormat::new::<RgbFormat>(fmt_type);
        match Camera::new(device_index.clone(), requested) {
            Ok(mut cam) => match cam.open_stream() {
                Ok(()) => {
                    let info = format_from_camera(&cam);
                    println!(
                        "[RUST AGENT] Camera opened attempt={} {}x{} @ {} ({})",
                        i + 1,
                        info.width,
                        info.height,
                        info.frame_rate,
                        info.format_string
                    );
                    inner.camera = Some(cam);
                    return Ok(info);
                }
                Err(err) => {
                    last_err = format!("open_stream: {}", err);
                    eprintln!(
                        "[RUST AGENT] Camera open_stream failed attempt={}: {}",
                        i + 1,
                        err
                    );
                    drop(cam);
                    thread::sleep(Duration::from_millis(150));
                }
            },
            Err(err) => {
                last_err = format!("Camera::new: {}", err);
                eprintln!(
                    "[RUST AGENT] Camera::new failed attempt={}: {}",
                    i + 1,
                    err
                );
                thread::sleep(Duration::from_millis(100));
            }
        }
    }

    Err(last_err)
}

fn release_camera(inner: &mut WorkerInner) {
    if let Some(mut cam) = inner.camera.take() {
        let _ = cam.stop_stream();
        thread::sleep(Duration::from_millis(200));
        let _ = cam.stop_stream();
        thread::sleep(Duration::from_millis(200));
        drop(cam);
    }
}

fn capture_rgb(inner: &mut WorkerInner) -> Option<CapturedRgb> {
    let cam = inner.camera.as_mut()?;

    for _ in 0..3 {
        let frame = match cam.frame() {
            Ok(frame) => frame,
            Err(_) => continue,
        };

        let rgb = match frame.decode_image::<RgbFormat>() {
            Ok(rgb) => rgb,
            Err(_) => continue,
        };

        let width = rgb.width();
        let height = rgb.height();
        if width == 0 || height == 0 {
            continue;
        }

        return Some(CapturedRgb {
            width,
            height,
            data: rgb.into_raw(),
        });
    }

    None
}
