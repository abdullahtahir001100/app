#[cfg(windows)]
use std::os::windows::process::CommandExt;

use image::{codecs::jpeg::JpegEncoder, imageops, ExtendedColorType, ImageBuffer, ImageEncoder, Rgb};
use serde_json::{json, Value};
use xcap::Monitor;

use crate::commands::{CommandResponse, IncomingPacket, StreamFrame};
use crate::input::{handle_remote_input, is_remote_input_action};
use crate::screen::{invalidate_monitor_cache, ScreenState};
use crate::windows_controls::{
    read_display_brightness, read_system_volume, send_text_to_active_window, set_display_brightness,
    set_system_volume,
};

pub const FRAME_SCREEN_STREAM: u8 = 0x04;
pub const FRAME_SCREEN_SNAPSHOT: u8 = 0x05;

const SNAPSHOT_MAX_WIDTH: u32 = 1920;
const SNAPSHOT_JPEG_QUALITY: u8 = 94;

pub struct StreamCaptureSettings {
    pub max_width: u32,
    pub jpeg_quality: u8,
}

pub fn is_screen_action(action: &str) -> bool {
    is_remote_input_action(action)
        || matches!(
            action,
            "PROBE_DISPLAYS"
                | "LIST_DISPLAYS"
                | "SWITCH_DISPLAY"
                | "START_SCREEN_STREAM"
                | "STOP_SCREEN_STREAM"
                | "CAPTURE_SCREENSHOT"
                | "FETCH_SCREEN_TELEMETRY"
                | "SET_DISPLAY_BRIGHTNESS"
                | "SET_SYSTEM_VOLUME"
                | "SEND_TEXT_INPUT"
                | "LOCK_SCREEN"
                | "OPEN_SETTINGS"
                | "SET_SCREEN_QUALITY"
        )
}

pub fn handle_screen_command(
    packet: IncomingPacket,
    state: &mut ScreenState,
) -> Option<CommandResponse> {
    if !is_remote_input_action(&packet.action) {
        println!("[RUST AGENT] Screen action: {}", packet.action);
    }

    let include_frame = should_include_screen_frame(&packet.action, &packet.payload);
    let mut action_message: Option<String> = None;

    match packet.action.as_str() {
        "PROBE_DISPLAYS" => {
            state.probe_displays();
            if let Some(level) = read_display_brightness() {
                state.brightness = level;
            }
            if let Some(level) = read_system_volume() {
                state.volume = level;
            }
        }
        "LIST_DISPLAYS" => {}
        "SWITCH_DISPLAY" => {
            invalidate_monitor_cache();
            if let Some(index) = parse_display_index(&packet.payload) {
                if let Err(err) = state.switch_display(index) {
                    action_message = Some(err);
                }
            } else {
                action_message = Some("Invalid display selection payload.".into());
            }
        }
        "START_SCREEN_STREAM" => {
            state.apply_quality_from_payload(&packet.payload);
            if state.detected_displays.is_empty() {
                state.probe_displays();
            }
            if !state.detected_displays.is_empty() {
                state.active_display_index = state
                    .active_display_index
                    .min(state.detected_displays.len().saturating_sub(1));
                state.streaming_active = true;
                println!(
                    "[RUST AGENT] Screen stream activated on display {}.",
                    state.active_display_index
                );
            } else {
                action_message = Some("No displays available to stream.".into());
            }
        }
        "STOP_SCREEN_STREAM" => {
            state.streaming_active = false;
            println!("[RUST AGENT] Screen stream stopped.");
        }
        "SET_SCREEN_QUALITY" => {
            state.apply_quality_from_payload(&packet.payload);
            action_message = Some(format!(
                "Stream quality set to {} ({}px).",
                state.stream_quality, state.stream_max_width
            ));
        }
        "SET_DISPLAY_BRIGHTNESS" => {
            if let Some(val) = packet.payload.get("degree_value").and_then(|v| v.as_u64()) {
                let level = val.min(100) as u32;
                match set_display_brightness(level) {
                    Ok(()) => {
                        state.brightness = level;
                        println!("[RUST AGENT] Brightness set to {}%", level);
                        action_message = Some(format!("Display brightness set to {}%.", level));
                    }
                    Err(err) => {
                        action_message = Some(format!(
                            "Brightness control unavailable on this display: {}",
                            err
                        ));
                    }
                }
            }
        }
        "SET_SYSTEM_VOLUME" => {
            if let Some(val) = packet.payload.get("degree_value").and_then(|v| v.as_u64()) {
                let level = val.min(100) as u32;
                match set_system_volume(level) {
                    Ok(()) => {
                        state.volume = level;
                        println!("[RUST AGENT] Volume set to {}%", level);
                        action_message = Some(format!("System volume set to {}%.", level));
                    }
                    Err(err) => {
                        action_message = Some(format!("Volume control failed: {}", err));
                    }
                }
            }
        }
        "SEND_TEXT_INPUT" => {
            let text = packet
                .payload
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if text.is_empty() {
                action_message = Some("No text provided.".into());
            } else {
                match send_text_to_active_window(text) {
                    Ok(()) => {
                        state.last_sent_text = text.to_string();
                        action_message = Some(format!("Sent to active window: {}", text));
                        println!("[RUST AGENT] Text input sent: {}", text);
                    }
                    Err(err) => action_message = Some(format!("Text input failed: {}", err)),
                }
            }
        }
        "LOCK_SCREEN" => {
            match std::process::Command::new("rundll32.exe")
                .creation_flags(0x08000000)
                .args(["user32.dll,LockWorkStation"])
                .spawn()
            {
                Ok(_) => action_message = Some("Workstation locked.".into()),
                Err(err) => action_message = Some(format!("Lock screen failed: {}", err)),
            }
        }
        "OPEN_SETTINGS" => {
            match std::process::Command::new("explorer.exe")
                .creation_flags(0x08000000)
                .args(["ms-settings:"])
                .spawn()
            {
                Ok(_) => action_message = Some("Opened Windows Settings.".into()),
                Err(err) => action_message = Some(format!("Open settings failed: {}", err)),
            }
        }
        "CAPTURE_SCREENSHOT" | "FETCH_SCREEN_TELEMETRY" => {}
        action if is_remote_input_action(action) => {
            let (screen_w, screen_h) = state.active_screen_dimensions();
            let mut payload = packet.payload.clone();
            if let Some(obj) = payload.as_object_mut() {
                // Always use native display size — never trust JPEG/stream dimensions.
                obj.insert("screen_width".to_string(), json!(screen_w));
                obj.insert("screen_height".to_string(), json!(screen_h));
            }
            let _ = handle_remote_input(action, &payload);
            // No ack / telemetry — keeps mouse moves from flooding the gateway.
            return None;
        }
        _ => return None,
    }

    let frame_result = if include_frame {
        match capture_screen_jpeg(state, packet.action == "CAPTURE_SCREENSHOT") {
            Some(jpeg) => {
                println!(
                    "[SCREEN] Captured frame for {} ({} bytes)",
                    packet.action,
                    jpeg.len()
                );
                Some(StreamFrame {
                    payload: jpeg,
                    kind: if packet.action == "CAPTURE_SCREENSHOT" {
                        FRAME_SCREEN_SNAPSHOT
                    } else {
                        FRAME_SCREEN_STREAM
                    },
                })
            }
            None => {
                eprintln!("[SCREEN] Capture failed for action {}", packet.action);
                if action_message.is_none() {
                    action_message = Some(if crate::session_launch::is_session_zero() {
                        "Screen capture unavailable: agent is in Session 0. Reinstall/restart the agent while a user is logged in so it can run in the interactive session.".into()
                    } else {
                        "Screen capture failed on this display.".into()
                    });
                }
                None
            }
        }
    } else {
        None
    };

    let frame_kind = frame_result
        .as_ref()
        .map(|f| f.kind)
        .unwrap_or(FRAME_SCREEN_STREAM);

    Some(CommandResponse {
        json: build_screen_telemetry_json(state, &packet.action, frame_result.as_ref(), action_message),
        frame: frame_result.map(|f| f.payload),
        frame_kind,
    })
}

pub fn capture_display_jpeg(
    active_display_index: usize,
    high_quality: bool,
    settings: StreamCaptureSettings,
) -> Option<Vec<u8>> {
    let monitors = match Monitor::all() {
        Ok(list) => list,
        Err(err) => {
            eprintln!("[SCREEN] Monitor::all failed: {}", err);
            return None;
        }
    };

    if monitors.is_empty() {
        eprintln!("[SCREEN] No monitors returned by xcap");
        return None;
    }

    let monitor = monitors
        .get(active_display_index)
        .or_else(|| monitors.first())?;

    let rgba = match monitor.capture_image() {
        Ok(image) => image,
        Err(err) => {
            eprintln!("[SCREEN] capture_image failed: {}", err);
            return None;
        }
    };

    let (width, height) = rgba.dimensions();
    if width == 0 || height == 0 {
        eprintln!("[SCREEN] capture_image returned empty dimensions");
        return None;
    }

    if high_quality {
        let rgb = rgba_to_rgb8_fast(&rgba);
        return encode_rgb_jpeg(
            &rgb,
            SNAPSHOT_MAX_WIDTH,
            SNAPSHOT_JPEG_QUALITY,
            imageops::FilterType::CatmullRom,
        );
    }

    capture_stream_jpeg_fast(&rgba, settings.max_width, settings.jpeg_quality)
}

fn capture_stream_jpeg_fast(
    rgba: &ImageBuffer<image::Rgba<u8>, Vec<u8>>,
    max_width: u32,
    quality: u8,
) -> Option<Vec<u8>> {
    let (src_w, src_h) = rgba.dimensions();
    let scale = if src_w > max_width {
        max_width as f32 / src_w as f32
    } else {
        1.0
    };

    let dst_w = ((src_w as f32 * scale).round() as u32).max(1);
    let dst_h = ((src_h as f32 * scale).round() as u32).max(1);
    let raw = rgba.as_raw();
    let mut rgb = Vec::with_capacity((dst_w as usize).saturating_mul(dst_h as usize).saturating_mul(3));

    let mut x_map = Vec::with_capacity(dst_w as usize);
    for x in 0..dst_w {
        let src_x = ((x as f32 / scale).floor() as u32).min(src_w.saturating_sub(1));
        x_map.push(src_x as usize);
    }
    let mut y_map = Vec::with_capacity(dst_h as usize);
    for y in 0..dst_h {
        let src_y = ((y as f32 / scale).floor() as u32).min(src_h.saturating_sub(1));
        y_map.push(src_y as usize);
    }

    for y in 0..dst_h {
        let src_y = y_map[y as usize];
        let row_base = src_y.saturating_mul(src_w as usize).saturating_mul(4);
        for x in 0..dst_w {
            let src_x = x_map[x as usize];
            let idx = row_base + src_x.saturating_mul(4);
            rgb.push(raw[idx]);
            rgb.push(raw[idx + 1]);
            rgb.push(raw[idx + 2]);
        }
    }

    let img = ImageBuffer::<Rgb<u8>, Vec<u8>>::from_raw(dst_w, dst_h, rgb)?;
    encode_rgb_jpeg(&img, dst_w, quality, imageops::FilterType::Nearest)
}

fn capture_screen_jpeg(state: &ScreenState, high_quality: bool) -> Option<Vec<u8>> {
    capture_display_jpeg(
        state.active_display_index,
        high_quality,
        StreamCaptureSettings {
            max_width: state.stream_max_width,
            jpeg_quality: state.stream_jpeg_quality,
        },
    )
}

fn rgba_to_rgb8_fast(rgba: &ImageBuffer<image::Rgba<u8>, Vec<u8>>) -> ImageBuffer<Rgb<u8>, Vec<u8>> {
    let (width, height) = rgba.dimensions();
    let raw = rgba.as_raw();
    let mut rgb = Vec::with_capacity((width as usize).saturating_mul(height as usize).saturating_mul(3));
    for chunk in raw.chunks_exact(4) {
        rgb.extend_from_slice(&chunk[0..3]);
    }
    ImageBuffer::from_raw(width, height, rgb).unwrap_or_else(|| ImageBuffer::new(width, height))
}

fn encode_rgb_jpeg(
    img: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    max_width: u32,
    quality: u8,
    filter: imageops::FilterType,
) -> Option<Vec<u8>> {
    let target = resize_rgb(img, max_width, filter);
    let (width, height) = target.dimensions();
    let mut jpeg_bytes = Vec::with_capacity((width as usize).saturating_mul(height as usize) / 8);
    let encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, quality);
    if encoder
        .write_image(
            target.as_raw(),
            width,
            height,
            ExtendedColorType::Rgb8,
        )
        .is_ok()
        && !jpeg_bytes.is_empty()
    {
        Some(jpeg_bytes)
    } else {
        None
    }
}

fn resize_rgb(
    img: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    max_width: u32,
    filter: imageops::FilterType,
) -> ImageBuffer<Rgb<u8>, Vec<u8>> {
    let (width, height) = img.dimensions();
    if width <= max_width {
        return img.clone();
    }

    let new_width = max_width;
    let new_height = ((height as f32) * (max_width as f32 / width as f32)).max(1.0) as u32;
    imageops::resize(img, new_width, new_height, filter)
}

fn should_include_screen_frame(action: &str, payload: &Value) -> bool {
    match action {
        // Stream frames come from the binary pump — don't encode a JPEG here too.
        "CAPTURE_SCREENSHOT" | "SWITCH_DISPLAY" => true,
        "START_SCREEN_STREAM" => false,
        "FETCH_SCREEN_TELEMETRY" => payload
            .get("include_frame")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        _ => false,
    }
}

fn parse_display_index(payload: &Value) -> Option<usize> {
    if let Some(index) = payload.get("display_index").and_then(|v| v.as_u64()) {
        return Some(index as usize);
    }

    if let Some(raw) = payload.get("display").and_then(|v| v.as_str()) {
        if let Some(stripped) = raw.strip_prefix("display-") {
            if let Ok(index) = stripped.parse::<usize>() {
                return Some(index);
            }
        }
        if let Ok(index) = raw.parse::<usize>() {
            return Some(index);
        }
    }

    None
}

fn build_screen_telemetry_json(
    state: &ScreenState,
    action: &str,
    frame_result: Option<&StreamFrame>,
    action_message: Option<String>,
) -> Value {
    let frame_bytes = frame_result.map(|f| f.payload.len());
    // Never embed base64 frames in telemetry — binary WS frames are enough.
    let live_frame_b64: Option<String> = None;

    let status = if state.streaming_active {
        "ACTIVE_STREAMING"
    } else if state.display_count() == 0 {
        "NO_DISPLAYS"
    } else {
        "STANDBY"
    };

    json!({
        "type": "sys_ack",
        "channel": "screen",
        "status": status,
        "message": action_message,
        "last_action": action,
        "has_binary_frame": frame_bytes.is_some(),
        "frame_bytes": frame_bytes.unwrap_or(0),
        "hardware_metrics": {
            "active_display_index": state.active_display_index,
            "display_active": format!("display-{}", state.active_display_index),
            "available_displays": state.build_display_manifest(),
            "display_count": state.display_count(),
            "resolution": state.active_resolution_label(),
            "display_name": state.active_display_label(),
            "fps": format!("{} FPS", state.target_fps),
            "stream_quality": state.stream_quality,
            "stream_max_width": state.stream_max_width,
            "stream_jpeg_quality": state.stream_jpeg_quality,
            "bitrate": frame_bytes
                .map(|size| format!("{:.1} KB/frame", size as f64 / 1024.0))
                .unwrap_or_else(|| "Metrics only".to_string()),
            "brightness": state.brightness,
            "volume": state.volume,
            "streaming_active": state.streaming_active,
            "last_sent_text": state.last_sent_text,
            "latency_ms": if frame_bytes.is_some() { 12 } else { 3 },
            "live_frame_b64": live_frame_b64
        }
    })
}
