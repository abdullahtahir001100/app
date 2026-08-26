#[cfg(windows)]
use std::os::windows::process::CommandExt;

use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
use std::sync::atomic::AtomicIsize;
#[cfg(windows)]
use std::sync::Mutex;

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

/// FNV-1a signature of the last stream frame we encoded (cursor included).
/// Lets the pump skip byte-identical frames so a static desktop costs ~0
/// bandwidth/CPU and the link stays clear for real motion (AnyDesk-style).
static LAST_STREAM_HASH: AtomicU64 = AtomicU64::new(0);

/// Result of a single live-stream capture.
pub enum StreamOutcome {
    /// A freshly-encoded JPEG frame ready to send.
    Frame(Vec<u8>),
    /// Screen + cursor are byte-identical to the previous frame — skip sending.
    Unchanged,
    /// Capture/encode failed.
    Failed,
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
            if crate::session_launch::is_session_zero() {
                state.streaming_active = false;
                action_message = Some(
                    "Screen capture unavailable: agent is in Windows Session 0. Restart Zenvora service while a user is logged in.".into(),
                );
            } else {
                state.apply_quality_from_payload(&packet.payload);
                if state.detected_displays.is_empty() {
                    state.probe_displays();
                }
                if !state.detected_displays.is_empty() {
                    state.active_display_index = state
                        .active_display_index
                        .min(state.detected_displays.len().saturating_sub(1));

                    // Smoke-test one frame before claiming stream is live — otherwise UI
                    // shows ACTIVE_STREAMING with zero binary frames forever.
                    let settings = StreamCaptureSettings {
                        max_width: state.stream_max_width,
                        jpeg_quality: state.stream_jpeg_quality,
                    };
                    match capture_display_jpeg(state.active_display_index, false, settings) {
                        Some(jpeg) => {
                            state.streaming_active = true;
                            println!(
                                "[RUST AGENT] Screen stream activated on display {} (probe {} bytes).",
                                state.active_display_index,
                                jpeg.len()
                            );
                            action_message = Some(format!(
                                "Screen stream started on {}.",
                                state.active_display_label()
                            ));
                            // Probe only validates capture; live frames go via /ws/media pump.
                            let _ = jpeg;
                        }
                        None => {
                            state.streaming_active = false;
                            action_message = Some(
                                "Screen capture failed on this display. Check Windows display permissions / RDP / locked screen.".into(),
                            );
                            eprintln!(
                                "[RUST AGENT] Screen stream NOT started — capture_display_jpeg returned None"
                            );
                        }
                    }
                } else {
                    action_message = Some("No displays available to stream.".into());
                }
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
    if !high_quality {
        // Live-stream path (probe / display switch / telemetry snapshot): always
        // produce a frame here — cursor baked in, change-detection bypassed.
        return match capture_stream_frame(active_display_index, settings, true) {
            StreamOutcome::Frame(jpeg) => Some(jpeg),
            _ => None,
        };
    }

    // High-quality snapshot path (CAPTURE_SCREENSHOT): full-res, best filter.
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

    let rgb = rgba_to_rgb8_fast(&rgba);
    encode_rgb_jpeg(
        &rgb,
        SNAPSHOT_MAX_WIDTH,
        SNAPSHOT_JPEG_QUALITY,
        imageops::FilterType::CatmullRom,
    )
}

/// Capture the active display for the live stream: bakes the OS cursor into the
/// frame, then skips encoding when nothing changed since the previous frame.
///
/// `force_keyframe` bypasses change-detection so callers can guarantee a frame
/// (first frame after START, periodic keepalive for late subscribers, display
/// switch). Cursor is baked in the agent because xcap's framebuffer never
/// includes it — this is also what makes AI/automation-driven pointer moves
/// visible on the viewer.
pub fn capture_stream_frame(
    active_display_index: usize,
    settings: StreamCaptureSettings,
    force_keyframe: bool,
) -> StreamOutcome {
    let monitors = match Monitor::all() {
        Ok(list) => list,
        Err(err) => {
            eprintln!("[SCREEN] Monitor::all failed: {}", err);
            return StreamOutcome::Failed;
        }
    };
    if monitors.is_empty() {
        eprintln!("[SCREEN] No monitors returned by xcap");
        return StreamOutcome::Failed;
    }
    let monitor = match monitors
        .get(active_display_index)
        .or_else(|| monitors.first())
    {
        Some(m) => m,
        None => return StreamOutcome::Failed,
    };

    let rgba = match monitor.capture_image() {
        Ok(image) => image,
        Err(err) => {
            eprintln!("[SCREEN] capture_image failed: {}", err);
            return StreamOutcome::Failed;
        }
    };
    let (width, height) = rgba.dimensions();
    if width == 0 || height == 0 {
        eprintln!("[SCREEN] capture_image returned empty dimensions");
        return StreamOutcome::Failed;
    }

    // Pack to tight RGB8 and downscale with a real reconstruction filter.
    let rgb = rgba_to_rgb8_fast(&rgba);
    let (src_w, _src_h) = rgb.dimensions();
    let mut target = if src_w > settings.max_width {
        resize_rgb(&rgb, settings.max_width, imageops::FilterType::Triangle)
    } else {
        rgb
    };

    // Composite the REAL OS cursor (the actual Windows cursor bitmap — not a
    // drawn shape) onto the downscaled frame, scaled to match so it lands
    // pixel-exact on the pointer. xcap's framebuffer never includes the cursor,
    // so we overlay it here; this also makes AI/automation pointer moves visible.
    let (dst_w, dst_h) = target.dimensions();
    overlay_real_cursor(&mut target, monitor, dst_w, dst_h);

    // Change-detection: signature over the final RGB (cursor included) so a
    // cursor move counts as a change and re-streams. Skip identical frames
    // unless a keyframe was explicitly requested.
    let signature = frame_signature(target.as_raw());
    if !force_keyframe && signature == LAST_STREAM_HASH.load(Ordering::Relaxed) {
        return StreamOutcome::Unchanged;
    }

    let (dst_w, dst_h) = target.dimensions();
    let mut jpeg_bytes = Vec::with_capacity((dst_w as usize).saturating_mul(dst_h as usize) / 8);
    let encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, settings.jpeg_quality);
    if encoder
        .write_image(target.as_raw(), dst_w, dst_h, ExtendedColorType::Rgb8)
        .is_ok()
        && !jpeg_bytes.is_empty()
    {
        LAST_STREAM_HASH.store(signature, Ordering::Relaxed);
        StreamOutcome::Frame(jpeg_bytes)
    } else {
        StreamOutcome::Failed
    }
}

/// FNV-1a over the red channel of every pixel (every 3rd byte). Cheap enough to
/// run on every capture tick, yet catches cursor moves and any real UI change
/// (white/black cursor + typical UI edits always alter the red/luma channel).
#[inline]
fn frame_signature(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut i = 0;
    while i < bytes.len() {
        hash ^= bytes[i] as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
        i += 3;
    }
    hash
}

/// A rasterized snapshot of the real OS cursor: straight-alpha RGBA pixels plus
/// the hotspot offset (the pixel that sits exactly on the pointer position).
#[cfg(windows)]
#[derive(Clone)]
struct CursorSprite {
    width: i32,
    height: i32,
    x_hotspot: i32,
    y_hotspot: i32,
    rgba: Vec<u8>, // width*height*4, top-down, straight alpha
}

// The cursor shape changes rarely (arrow -> I-beam -> hand ...) but its position
// moves constantly, so we rasterize only when the HCURSOR handle changes and
// reuse the cached pixels otherwise.
#[cfg(windows)]
static LAST_CURSOR_HANDLE: AtomicIsize = AtomicIsize::new(0);
#[cfg(windows)]
static CURSOR_SPRITE: Mutex<Option<CursorSprite>> = Mutex::new(None);

/// Overlay the real OS cursor onto the (already downscaled) RGB frame. `dst_w`/
/// `dst_h` are the frame dimensions; the cursor is scaled from the monitor's
/// physical size down to the frame size so it lands pixel-exact on the pointer
/// and stays correctly sized regardless of source resolution. Fail-safe: any
/// GDI hiccup just leaves the frame cursor-less rather than breaking the stream.
#[cfg(windows)]
fn overlay_real_cursor(
    img: &mut ImageBuffer<Rgb<u8>, Vec<u8>>,
    monitor: &Monitor,
    dst_w: u32,
    dst_h: u32,
) {
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorInfo, CURSORINFO, CURSOR_SHOWING};

    if dst_w == 0 || dst_h == 0 {
        return;
    }

    // 1. Where is the cursor, and which shape is it?
    let mut ci = CURSORINFO::default();
    ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
    unsafe {
        if GetCursorInfo(&mut ci).is_err() {
            return;
        }
    }
    // Pointer hidden (e.g. full-screen video / blank cursor).
    if (ci.flags.0 & CURSOR_SHOWING.0) == 0 {
        return;
    }
    let handle = ci.hCursor.0 as isize;
    if handle == 0 {
        return;
    }

    // 2. Cursor position relative to THIS monitor, in physical pixels. We're
    //    per-monitor-DPI-aware, so this matches xcap's capture coordinate space.
    let mx = monitor.x();
    let my = monitor.y();
    let mw = monitor.width() as i32;
    let mh = monitor.height() as i32;
    if mw <= 0 || mh <= 0 {
        return;
    }
    let lx = ci.ptScreenPos.x - mx;
    let ly = ci.ptScreenPos.y - my;
    // Pointer is on another display - don't draw it on this frame.
    if lx < 0 || ly < 0 || lx >= mw || ly >= mh {
        return;
    }

    // 3. Fetch (or refresh) the rasterized sprite for this cursor shape.
    let sprite = {
        let cached_handle = LAST_CURSOR_HANDLE.load(Ordering::Relaxed);
        let mut guard = match CURSOR_SPRITE.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if cached_handle != handle || guard.is_none() {
            match unsafe { rasterize_cursor(handle) } {
                Some(s) => {
                    *guard = Some(s);
                    LAST_CURSOR_HANDLE.store(handle, Ordering::Relaxed);
                }
                None => return,
            }
        }
        match guard.as_ref() {
            Some(s) => s.clone(),
            None => return,
        }
    };

    // 4. Blit the sprite, scaled by the same factor the frame was downscaled by.
    let sx = dst_w as f32 / mw as f32;
    let sy = dst_h as f32 / mh as f32;
    // Top-left of the cursor image (monitor-local physical px) -> frame px.
    let base_x = (((lx - sprite.x_hotspot) as f32) * sx).round() as i32;
    let base_y = (((ly - sprite.y_hotspot) as f32) * sy).round() as i32;
    let draw_w = ((sprite.width as f32) * sx).round().max(1.0) as i32;
    let draw_h = ((sprite.height as f32) * sy).round().max(1.0) as i32;

    let iw = img.width() as i32;
    let ih = img.height() as i32;

    for dy in 0..draw_h {
        let py = base_y + dy;
        if py < 0 || py >= ih {
            continue;
        }
        let syi = (((dy as f32) / sy) as i32).clamp(0, sprite.height - 1);
        for dx in 0..draw_w {
            let px = base_x + dx;
            if px < 0 || px >= iw {
                continue;
            }
            let sxi = (((dx as f32) / sx) as i32).clamp(0, sprite.width - 1);
            let si = ((syi * sprite.width + sxi) * 4) as usize;
            let a = sprite.rgba[si + 3] as u32;
            if a == 0 {
                continue;
            }
            let sr = sprite.rgba[si] as u32;
            let sg = sprite.rgba[si + 1] as u32;
            let sb = sprite.rgba[si + 2] as u32;
            let pixel = img.get_pixel_mut(px as u32, py as u32);
            let [br, bg, bb] = pixel.0;
            // Straight-alpha "over": out = src*a + dst*(1-a).
            let inv = 255 - a;
            pixel.0 = [
                ((sr * a + br as u32 * inv) / 255) as u8,
                ((sg * a + bg as u32 * inv) / 255) as u8,
                ((sb * a + bb as u32 * inv) / 255) as u8,
            ];
        }
    }
}

#[cfg(not(windows))]
fn overlay_real_cursor(
    _img: &mut ImageBuffer<Rgb<u8>, Vec<u8>>,
    _monitor: &Monitor,
    _dst_w: u32,
    _dst_h: u32,
) {
}

/// Read a GDI bitmap as top-down 32bpp BGRA via `GetDIBits`.
#[cfg(windows)]
unsafe fn read_bitmap_bgra(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    hbm: windows::Win32::Graphics::Gdi::HBITMAP,
    width: i32,
    height: i32,
) -> Option<Vec<u8>> {
    use std::ffi::c_void;
    use windows::Win32::Graphics::Gdi::{GetDIBits, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS};

    if hbm.0.is_null() || width <= 0 || height <= 0 {
        return None;
    }
    let mut bi = BITMAPINFO::default();
    bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bi.bmiHeader.biWidth = width;
    bi.bmiHeader.biHeight = -height; // negative -> top-down rows
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = 0; // BI_RGB
    let mut buf = vec![0u8; (width * height) as usize * 4];
    let lines = GetDIBits(
        hdc,
        hbm,
        0,
        height as u32,
        Some(buf.as_mut_ptr() as *mut c_void),
        &mut bi,
        DIB_RGB_COLORS,
    );
    if lines == 0 {
        None
    } else {
        Some(buf)
    }
}

/// Rasterize the real OS cursor identified by `handle` (an `HCURSOR` value) into
/// straight-alpha RGBA. Handles modern 32bpp alpha cursors and legacy color /
/// monochrome (AND+XOR mask) cursors. Returns `None` on any failure.
#[cfg(windows)]
unsafe fn rasterize_cursor(handle: isize) -> Option<CursorSprite> {
    use std::ffi::c_void;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetObjectW, ReleaseDC, BITMAP, HGDIOBJ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, HICON, ICONINFO};

    let hicon = HICON(handle as *mut c_void);
    let mut info = ICONINFO::default();
    if GetIconInfo(hicon, &mut info).is_err() {
        return None;
    }
    let color_bmp = info.hbmColor;
    let mask_bmp = info.hbmMask;
    let has_color = !color_bmp.0.is_null();

    let mut result: Option<CursorSprite> = None;

    // Geometry from whichever bitmap exists.
    let dims_src = if has_color { color_bmp } else { mask_bmp };
    let mut bmp = BITMAP::default();
    let got = GetObjectW(
        HGDIOBJ(dims_src.0),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bmp as *mut _ as *mut c_void),
    );
    if got != 0 {
        let width = bmp.bmWidth;
        let mut height = bmp.bmHeight;
        if !has_color {
            // Monochrome cursor: mask stacks AND over XOR -> double height.
            height /= 2;
        }
        if width > 0 && height > 0 && width <= 256 && height <= 256 {
            let hdc = GetDC(None);
            if !hdc.0.is_null() {
                let px_count = (width * height) as usize;
                if has_color {
                    if let Some(color) = read_bitmap_bgra(hdc, color_bmp, width, height) {
                        // Does the color bitmap carry a real alpha channel?
                        let mut alpha_present = false;
                        for i in 0..px_count {
                            if color[i * 4 + 3] != 0 {
                                alpha_present = true;
                                break;
                            }
                        }
                        let mask = read_bitmap_bgra(hdc, mask_bmp, width, height);
                        let mut rgba = vec![0u8; px_count * 4];
                        for i in 0..px_count {
                            let b = color[i * 4];
                            let g = color[i * 4 + 1];
                            let r = color[i * 4 + 2];
                            let a = if alpha_present {
                                color[i * 4 + 3]
                            } else if let Some(m) = mask.as_ref() {
                                // AND mask: 0 = opaque, 255 = transparent.
                                if m[i * 4] >= 128 {
                                    0
                                } else {
                                    255
                                }
                            } else {
                                255
                            };
                            rgba[i * 4] = r;
                            rgba[i * 4 + 1] = g;
                            rgba[i * 4 + 2] = b;
                            rgba[i * 4 + 3] = a;
                        }
                        result = Some(CursorSprite {
                            width,
                            height,
                            x_hotspot: info.xHotspot as i32,
                            y_hotspot: info.yHotspot as i32,
                            rgba,
                        });
                    }
                } else if let Some(full) = read_bitmap_bgra(hdc, mask_bmp, width, height * 2) {
                    // Monochrome: top half = AND mask, bottom half = XOR mask.
                    let mut rgba = vec![0u8; px_count * 4];
                    for i in 0..px_count {
                        let and1 = full[i * 4] >= 128;
                        let xor1 = full[(px_count + i) * 4] >= 128;
                        let (r, g, b, a) = if !and1 {
                            let c = if xor1 { 255 } else { 0 };
                            (c, c, c, 255u8)
                        } else if xor1 {
                            // "Invert screen" pixels - approximate as opaque black.
                            (0u8, 0u8, 0u8, 255u8)
                        } else {
                            (0u8, 0u8, 0u8, 0u8)
                        };
                        rgba[i * 4] = r;
                        rgba[i * 4 + 1] = g;
                        rgba[i * 4 + 2] = b;
                        rgba[i * 4 + 3] = a;
                    }
                    result = Some(CursorSprite {
                        width,
                        height,
                        x_hotspot: info.xHotspot as i32,
                        y_hotspot: info.yHotspot as i32,
                        rgba,
                    });
                }
                let _ = ReleaseDC(None, hdc);
            }
        }
    }

    if !color_bmp.0.is_null() {
        let _ = DeleteObject(HGDIOBJ(color_bmp.0));
    }
    if !mask_bmp.0.is_null() {
        let _ = DeleteObject(HGDIOBJ(mask_bmp.0));
    }

    result
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
            "session_zero": crate::session_launch::is_session_zero(),
            "last_sent_text": state.last_sent_text,
            "latency_ms": if frame_bytes.is_some() { 12 } else { 3 },
            "live_frame_b64": live_frame_b64
        }
    })
}
