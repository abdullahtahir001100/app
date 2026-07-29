use serde_json::{json, Value};
use xcap::Monitor;

#[derive(Clone, Debug)]
pub struct DisplayInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

pub struct ScreenState {
    pub active_display_index: usize,
    pub brightness: u32,
    pub volume: u32,
    pub streaming_active: bool,
    pub detected_displays: Vec<DisplayInfo>,
    pub target_fps: u32,
    pub last_sent_text: String,
    pub stream_max_width: u32,
    pub stream_jpeg_quality: u8,
    pub stream_quality: String,
}

pub fn quality_preset(name: &str) -> (u32, u8, u32) {
    // (max_width, jpeg_quality, target_fps)
    match name.to_lowercase().as_str() {
        "low" => (854, 52, 24),
        "high" => (1280, 70, 18),
        "ultra" => (1600, 78, 15),
        _ => (1024, 62, 20), // medium — balanced for remote control
    }
}

pub fn invalidate_monitor_cache() {}

impl ScreenState {
    pub fn new() -> Self {
        Self {
            active_display_index: 0,
            brightness: 100,
            volume: 100,
            streaming_active: false,
            detected_displays: Vec::new(),
            target_fps: 15,
            last_sent_text: String::new(),
            stream_max_width: 1280,
            stream_jpeg_quality: 72,
            stream_quality: "medium".to_string(),
        }
    }

    pub fn set_stream_quality(&mut self, quality: &str) {
        let (max_width, jpeg_quality, target_fps) = quality_preset(quality);
        self.stream_quality = quality.to_lowercase();
        self.stream_max_width = max_width;
        self.stream_jpeg_quality = jpeg_quality;
        self.target_fps = target_fps;
        println!(
            "--> [SCREEN] Quality set to {} ({}px, q{})",
            self.stream_quality, max_width, jpeg_quality
        );
    }

    pub fn apply_quality_from_payload(&mut self, payload: &Value) {
        if let Some(quality) = payload.get("quality").and_then(|v| v.as_str()) {
            self.set_stream_quality(quality);
            return;
        }
        if let Some(level) = payload.get("quality_level").and_then(|v| v.as_u64()) {
            let name = match level {
                1 => "low",
                3 => "high",
                4 => "ultra",
                _ => "medium",
            };
            self.set_stream_quality(name);
        }
    }

    pub fn probe_displays(&mut self) {
        println!("--> [SCREEN] Scanning connected displays...");

        match Monitor::all() {
            Ok(monitors) => {
                self.detected_displays = monitors
                    .into_iter()
                    .enumerate()
                    .map(|(index, monitor)| {
                        let info = DisplayInfo {
                            id: monitor.id(),
                            name: if monitor.name().is_empty() {
                                format!("Display {}", index + 1)
                            } else {
                                monitor.name().to_string()
                            },
                            width: monitor.width(),
                            height: monitor.height(),
                            is_primary: monitor.is_primary(),
                        };
                        println!(
                            "--> [FOUND] Display {}: {} ({}x{}){}",
                            index,
                            info.name,
                            info.width,
                            info.height,
                            if info.is_primary { " [PRIMARY]" } else { "" }
                        );
                        info
                    })
                    .collect();
            }
            Err(err) => {
                eprintln!("[SCREEN] Failed to query displays: {}", err);
                self.detected_displays.clear();
            }
        }
    }

    pub fn display_count(&self) -> usize {
        self.detected_displays.len()
    }

    pub fn build_display_manifest(&self) -> Vec<Value> {
        self.detected_displays
            .iter()
            .enumerate()
            .map(|(index, display)| {
                let is_active = index == self.active_display_index && self.streaming_active;
                json!({
                    "id": format!("display-{}", index),
                    "index": index,
                    "label": display.name,
                    "status": if is_active { "ACTIVE" } else { "AVAILABLE" },
                    "resolution": format!("{}x{}", display.width, display.height),
                    "is_primary": display.is_primary,
                    "monitor_id": display.id
                })
            })
            .collect()
    }

    pub fn switch_display(&mut self, index: usize) -> Result<(), String> {
        if self.detected_displays.is_empty() {
            return Err("No displays detected. Run PROBE_DISPLAYS first.".into());
        }
        if index >= self.detected_displays.len() {
            return Err(format!(
                "Display {} is not available. This device has {} display(s).",
                index,
                self.detected_displays.len()
            ));
        }
        self.active_display_index = index;
        Ok(())
    }

    pub fn active_resolution_label(&self) -> String {
        self.detected_displays
            .get(self.active_display_index)
            .map(|d| format!("{}x{}", d.width, d.height))
            .unwrap_or_else(|| "N/A".to_string())
    }

    pub fn active_display_label(&self) -> String {
        self.detected_displays
            .get(self.active_display_index)
            .map(|d| d.name.clone())
            .unwrap_or_else(|| "No display".to_string())
    }

    pub fn active_screen_dimensions(&self) -> (u32, u32) {
        self.detected_displays
            .get(self.active_display_index)
            .map(|d| (d.width, d.height))
            .unwrap_or((1920, 1080))
    }
}
