use serde::Deserialize;
use serde_json::{json, Value};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, ExtendedColorType, ImageBuffer, ImageEncoder,
    Rgb,
};

use crate::system::{CameraState, SwitchResult};

pub const FRAME_STREAM: u8 = 0x01;
pub const FRAME_SNAPSHOT: u8 = 0x02;
pub const FRAME_RAW_RGB: u8 = 0x03;

const JPEG_QUALITY: u8 = 72;
const STREAM_MAX_WIDTH: u32 = 480;

#[derive(Debug, Deserialize)]
pub struct IncomingPacket {
    pub action: String,
    pub payload: Value,
}

pub struct CommandResponse {
    pub json: Value,
    pub frame: Option<Vec<u8>>,
    pub frame_kind: u8,
}

pub struct StreamFrame {
    pub payload: Vec<u8>,
    pub kind: u8,
}


pub fn handle_command(packet: IncomingPacket, state: &mut CameraState) -> Option<CommandResponse> {
    println!("[RUST AGENT] Intercepted Action: {}", packet.action);

    let include_frame = should_include_frame(&packet.action, &packet.payload);
    let mut switch_message: Option<String> = None;

    match packet.action.as_str() {
        "SWITCH_CAMERA" | "LIST_CAMERAS" | "PROBE_HARDWARE" => {
            if packet.action == "PROBE_HARDWARE" {
                state.probe_hardware_capabilities();
            } else if packet.action == "LIST_CAMERAS" {
                // Return cached manifest only — no hardware scan, no camera open.
            } else if let Some(index) = parse_camera_index(&packet.payload) {
                match state.switch_camera_by_index(index) {
                    SwitchResult::Success | SwitchResult::AlreadyActive => {}
                    SwitchResult::InUseByOtherApp { index } => {
                        switch_message = Some(format!(
                            "Camera {} is in use by another app on this PC. Close Camera app and try again.",
                            index
                        ));
                    }
                    SwitchResult::NoDevices => {
                        switch_message =
                            Some("No camera hardware detected on this machine.".to_string());
                    }
                    SwitchResult::InvalidIndex { requested, available } => {
                        switch_message = Some(format!(
                            "Camera {} is not available. This device has {} camera(s).",
                            requested, available
                        ));
                    }
                    SwitchResult::OpenFailed { index } => {
                        switch_message = Some(format!("Failed to open camera {}.", index));
                    }
                    SwitchResult::OpenFailedRestored { requested } => {
                        switch_message = Some(format!(
                            "Camera {} is unavailable. Restored the previous active camera.",
                            requested
                        ));
                    }
                }
            } else if packet.action == "SWITCH_CAMERA" {
                switch_message = Some("Invalid camera selection payload.".to_string());
            }
        }
        "SET_HARDWARE_PARAMETER" => {
            let param = packet
                .payload
                .get("param")
                .and_then(|v| v.as_str())
                .unwrap_or("BRIGHTNESS");
            let val = packet
                .payload
                .get("degree_value")
                .and_then(|v| v.as_u64())
                .unwrap_or(50) as u32;

            match param {
                "BRIGHTNESS" => {
                    state.brightness = val;
                    state.set_brightness_control(val);
                }
                "CONTRAST" => {
                    state.contrast = val;
                    state.set_contrast_control(val);
                }
                "ZOOM" => {
                    state.zoom = packet
                        .payload
                        .get("degree_value")
                        .and_then(|v| v.as_f64())
                        .map(|v| v as f32)
                        .unwrap_or(val as f32);
                }
                _ => {}
            }
        }
        "SET_FLASH_STATE" => {
            if let Some(flag) = packet.payload.get("enabled").and_then(|v| v.as_bool()) {
                state.flash_enabled = flag;
            }
        }
        "START_STREAM" => {
            if state.detected_devices.is_empty() {
                state.probe_hardware_capabilities();
            }

            if state.streaming_active && state.camera_is_open() {
                switch_message = Some("Camera is already streaming.".into());
                state.blocked_by_external_app = false;
            } else if state.camera_is_open() {
                if state.resume_camera_stream() {
                    state.blocked_by_external_app = false;
                    switch_message = Some("Camera stream resumed.".into());
                } else {
                    state.release_camera_hardware();
                }
            }

            if !state.streaming_active && !state.detected_devices.is_empty() {
                let idx = state
                    .active_camera_index
                    .min(state.detected_devices.len().saturating_sub(1));
                match state.switch_camera_by_index(idx) {
                    SwitchResult::Success => {
                        state.streaming_active = true;
                        state.blocked_by_external_app = false;
                        if switch_message.is_none() {
                            switch_message = Some("Camera stream started.".into());
                        }
                    }
                    SwitchResult::AlreadyActive => {
                        state.streaming_active = true;
                        state.blocked_by_external_app = false;
                        switch_message = Some("Camera is already streaming.".into());
                    }
                    SwitchResult::InUseByOtherApp { .. } => {
                        state.streaming_active = false;
                        state.blocked_by_external_app = true;
                        switch_message = state.status_message.clone().or_else(|| {
                            Some("Camera is in use by another app on this PC.".into())
                        });
                    }
                    other => {
                        state.streaming_active = false;
                        eprintln!("[RUST AGENT] Camera open result: {:?}", other);
                        if switch_message.is_none() {
                            switch_message = state.status_message.clone().or_else(|| {
                                Some("Could not open camera on this PC.".into())
                            });
                        }
                    }
                }
            } else if state.detected_devices.is_empty() && switch_message.is_none() {
                switch_message = Some("No camera hardware detected on this machine.".into());
            }

            if let Some(msg) = switch_message.clone() {
                state.status_message = Some(msg);
            }

            if state.streaming_active {
                println!("[RUST AGENT] Stream activated by client.");
            } else if let Some(ref msg) = state.status_message {
                println!("[RUST AGENT] Stream not started: {}", msg);
            }
        }
        "STOP_STREAM" => {
            state.request_stop_and_release();
        }
        "START_RECORDING" => state.recording_active = true,
        "STOP_RECORDING" => state.recording_active = false,
        "FETCH_TELEMETRY" | "CAPTURE_SNAPSHOT" | "FETCH_LATEST_MEDIA" => {}
        _ => {
            println!("[WARN] Unknown packet token bypassed parsing router hierarchy.");
            return None;
        }
    }

    let frame_result = if include_frame {
        capture_stream_frame(state)
    } else {
        None
    };

    let frame_kind = if packet.action == "CAPTURE_SNAPSHOT" {
        FRAME_SNAPSHOT
    } else {
        frame_result.as_ref().map(|f| f.kind).unwrap_or(FRAME_STREAM)
    };

    Some(CommandResponse {
        json: build_telemetry_json(
            state,
            &packet.action,
            frame_result.as_ref(),
            switch_message,
        ),
        frame: frame_result.map(|f| f.payload),
        frame_kind,
    })
}

pub fn build_binary_frame(bytes: Vec<u8>, kind: u8) -> Vec<u8> {
    let mut packet = Vec::with_capacity(1 + bytes.len());
    packet.push(kind);
    packet.extend(bytes);
    packet
}

fn should_include_frame(action: &str, payload: &Value) -> bool {
    match action {
        "CAPTURE_SNAPSHOT" | "FETCH_LATEST_MEDIA" | "SWITCH_CAMERA" => true,
        "FETCH_TELEMETRY" => payload
            .get("include_frame")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        _ => false,
    }
}

fn parse_camera_index(payload: &Value) -> Option<usize> {
    if let Some(index) = payload.get("camera_index").and_then(|v| v.as_u64()) {
        return Some(index as usize);
    }

    for key in ["camera", "target_lens", "targetLens"] {
        if let Some(raw) = payload.get(key).and_then(|v| v.as_str()) {
            if let Some(stripped) = raw.strip_prefix("cam-") {
                if let Ok(index) = stripped.parse::<usize>() {
                    return Some(index);
                }
            }
            if let Ok(index) = raw.parse::<usize>() {
                return Some(index);
            }
            return match raw {
                "front" => Some(0),
                "rear" | "back" => Some(1),
                _ => None,
            };
        }
    }

    None
}

pub fn build_camera_blocked_notice(state: &CameraState) -> Value {
    build_telemetry_json(state, "STREAM_LOST", None, state.status_message.clone())
}

fn build_telemetry_json(
    state: &CameraState,
    action: &str,
    frame_result: Option<&StreamFrame>,
    switch_message: Option<String>,
) -> Value {
    let has_stream = state.camera_is_open();
    let frame_bytes = frame_result.map(|f| f.payload.len());
    let live_frame_b64 = if action == "CAPTURE_SNAPSHOT"
        || (action == "FETCH_TELEMETRY"
            && frame_result.is_some())
    {
        frame_result.and_then(encode_frame_preview_b64)
    } else {
        None
    };
    let status = if state.blocked_by_external_app {
        "CAMERA_BLOCKED"
    } else if state.streaming_active && has_stream {
        "ACTIVE_STREAMING"
    } else if has_stream {
        "READY"
    } else if state.available_camera_count() == 0 {
        "NO_CAMERA_HARDWARE"
    } else {
        "STANDBY"
    };

    let user_message = switch_message
        .or(state.status_message.clone());

    json!({
        "type": "sys_ack",
        "channel": "camera",
        "status": status,
        "message": user_message,
        "last_action": action,
        "has_binary_frame": frame_bytes.is_some(),
        "frame_bytes": frame_bytes.unwrap_or(0),
        "hardware_metrics": {
            "active_camera_index": state.active_camera_index,
            "lens_active": format!("cam-{}", state.active_camera_index),
            "available_cameras": state.build_camera_manifest(),
            "camera_count": state.available_camera_count(),
            "resolution": state.active_resolution_label(),
            "fps": state.active_fps_label(),
            "bitrate": frame_bytes.map(|size| format!("{:.1} KB/frame", size as f64 / 1024.0)).unwrap_or_else(|| String::from("Metrics only")),
            "brightness": state.brightness,
            "contrast": state.contrast,
            "zoom": state.zoom,
            "gpio_flash_pin": if state.flash_enabled { "HIGH" } else { "LOW" },
            "recording_active": state.recording_active,
            "streaming_active": state.streaming_active,
            "camera_open": has_stream,
            "latency_ms": if frame_bytes.is_some() { 8 } else { 2 },
            "driver_status": state.driver_status(),
            "camera_blocked": state.blocked_by_external_app,
            "camera_status_message": state.status_message,
            "live_frame_b64": live_frame_b64
        }
    })
}

fn encode_frame_preview_b64(frame: &StreamFrame) -> Option<String> {
    frame_to_jpeg_bytes(frame).map(|jpeg| STANDARD.encode(jpeg))
}

fn frame_to_jpeg_bytes(frame: &StreamFrame) -> Option<Vec<u8>> {
    match frame.kind {
        FRAME_STREAM | FRAME_SNAPSHOT => {
            if frame.payload.len() > 100 {
                Some(frame.payload.clone())
            } else {
                None
            }
        }
        FRAME_RAW_RGB => raw_rgb_payload_to_jpeg(&frame.payload),
        _ => None,
    }
}

fn raw_rgb_payload_to_jpeg(payload: &[u8]) -> Option<Vec<u8>> {
    if payload.len() < 4 {
        return None;
    }

    let width = u32::from((payload[0] as u32) << 8 | payload[1] as u32);
    let height = u32::from((payload[2] as u32) << 8 | payload[3] as u32);
    let expected = (width as usize).saturating_mul(height as usize).saturating_mul(3);
    if width < 16 || height < 16 || payload.len() < 4 + expected {
        return None;
    }

    let img_buf = ImageBuffer::<Rgb<u8>, Vec<u8>>::from_raw(width, height, payload[4..4 + expected].to_vec())?;
    Some(resize_and_encode_jpeg(&img_buf, STREAM_MAX_WIDTH))
}

pub fn capture_stream_frame(state: &CameraState) -> Option<StreamFrame> {
    let jpeg = capture_jpeg_bytes(state)?;
    Some(StreamFrame {
        payload: jpeg,
        kind: FRAME_STREAM,
    })
}

pub fn capture_jpeg_bytes(state: &CameraState) -> Option<Vec<u8>> {
    capture_jpeg_from_worker(&state.clone_worker())
}

pub fn capture_jpeg_from_worker(worker: &crate::camera_worker::CameraWorker) -> Option<Vec<u8>> {
    let captured = worker.capture_rgb()?;

    let img_buf = ImageBuffer::<Rgb<u8>, Vec<u8>>::from_raw(
        captured.width,
        captured.height,
        captured.data,
    )?;

    let encoded = resize_and_encode_jpeg(&img_buf, STREAM_MAX_WIDTH);
    if encoded.is_empty() {
        None
    } else {
        Some(encoded)
    }
}

fn resize_rgb_buffer(img_buf: &ImageBuffer<Rgb<u8>, Vec<u8>>, max_width: u32) -> ImageBuffer<Rgb<u8>, Vec<u8>> {
    let (width, height) = img_buf.dimensions();
    if width <= max_width {
        return img_buf.clone();
    }

    let new_width = max_width;
    let new_height = ((height as f32) * (max_width as f32 / width as f32)).max(1.0) as u32;
    // Native resize — the old per-pixel loop stalled the agent after a few hundred frames.
    image::imageops::resize(img_buf, new_width, new_height, FilterType::Triangle)
}

fn resize_and_encode_jpeg(img_buf: &ImageBuffer<Rgb<u8>, Vec<u8>>, max_width: u32) -> Vec<u8> {
    let target = resize_rgb_buffer(img_buf, max_width);
    let (width, height) = target.dimensions();
    let mut jpeg_bytes = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, JPEG_QUALITY);
    if encoder
        .write_image(
            target.as_raw(),
            width,
            height,
            ExtendedColorType::Rgb8,
        )
        .is_ok()
    {
        jpeg_bytes
    } else {
        Vec::new()
    }
}
