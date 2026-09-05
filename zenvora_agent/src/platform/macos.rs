//! macOS Platform implementation: CoreGraphics input, AppleScript controls, launchd, and permissions.

use std::process::Command;

#[cfg(target_os = "macos")]
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode, CGMouseButton,
};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
#[cfg(target_os = "macos")]
use core_graphics::geometry::CGPoint;

pub fn read_system_volume() -> Option<u32> {
    let output = Command::new("osascript")
        .args(["-e", "output volume of (get volume settings)"])
        .output()
        .ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        text.parse::<u32>().ok()
    } else {
        None
    }
}

pub fn set_system_volume(level: u32) -> Result<(), String> {
    let safe_level = level.min(100);
    let script = format!("set volume output volume {}", safe_level);
    let status = Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|e| format!("osascript failed: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to set volume to {}", safe_level))
    }
}

pub fn read_display_brightness() -> Option<u32> {
    // Try brightness CLI if installed, or fallback to default
    let output = Command::new("brightness").arg("-l").output().ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if line.contains("brightness") {
                if let Some(val_str) = line.split(':').nth(1) {
                    if let Ok(val) = val_str.trim().parse::<f32>() {
                        return Some((val * 100.0).round() as u32);
                    }
                }
            }
        }
    }
    Some(80)
}

pub fn set_display_brightness(level: u32) -> Result<(), String> {
    let safe_val = (level.min(100) as f32) / 100.0;
    let _ = Command::new("brightness")
        .args(["-s", &format!("{:.2}", safe_val)])
        .output();
    Ok(())
}

pub fn send_text_to_active_window(text: &str) -> Result<(), String> {
    let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "tell application \"System Events\" to keystroke \"{}\"",
        escaped
    );
    let status = Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|e| format!("Failed to keystroke: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err("Keystroke injection failed. Ensure Accessibility permission is granted.".into())
    }
}

pub fn lock_screen() -> Result<(), String> {
    let status = Command::new("pmset")
        .arg("displaysleepnow")
        .status()
        .map_err(|e| format!("pmset failed: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        let _ = Command::new("/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession")
            .arg("-suspend")
            .status();
        Ok(())
    }
}

pub fn open_settings() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:")
        .status()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn get_active_window_info() -> Option<(String, String)> {
    let script = r#"
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set appName to name of frontApp
            try
                set windowTitle to name of first window of frontApp
            on error
                set windowTitle to appName
            end try
            return appName & "|||" & windowTitle
        end tell
    "#;
    let output = Command::new("osascript").args(["-e", script]).output().ok()?;
    if output.status.success() {
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parts: Vec<&str> = raw.split("|||").collect();
        if parts.len() == 2 {
            return Some((parts[1].to_string(), parts[0].to_string()));
        }
    }
    None
}

pub fn get_battery_status() -> Option<(u32, bool)> {
    let output = Command::new("pmset")
        .args(["-g", "batt"])
        .output()
        .ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        let on_ac = text.contains("AC Power") || !text.contains("discharging");
        for word in text.split_whitespace() {
            if word.ends_with("%;") || word.ends_with('%') {
                let clean = word.trim_matches(['%', ';', ',']);
                if let Ok(val) = clean.parse::<u32>() {
                    return Some((val, on_ac));
                }
            }
        }
    }
    None
}

pub fn request_screen_capture_permission() {
    let _ = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get every window"])
        .output();
}

pub fn request_accessibility_permission() {
    let _ = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to return true"])
        .output();
}

pub fn get_battery_percent() -> Option<u32> {
    get_battery_status().map(|(pct, _)| pct)
}

pub fn get_storage_used_percent() -> Option<u32> {
    let output = Command::new("df")
        .args(["-h", "/"])
        .output()
        .ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        if let Some(line) = text.lines().nth(1) {
            for col in line.split_whitespace() {
                if col.ends_with('%') {
                    if let Ok(val) = col.trim_end_matches('%').parse::<u32>() {
                        return Some(val);
                    }
                }
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
pub fn inject_mouse_move(x: i32, y: i32) -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Failed to create event source".to_string())?;
    let point = CGPoint::new(x as f64, y as f64);
    let event = CGEvent::new_mouse_event(
        source,
        core_graphics::event::CGEventType::MouseMoved,
        point,
        CGMouseButton::Left,
    )
    .map_err(|_| "Failed to create mouse move event".to_string())?;
    event.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn inject_mouse_button(x: i32, y: i32, button: &str, down: bool) -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Failed to create event source".to_string())?;
    let point = CGPoint::new(x as f64, y as f64);

    let (btn, event_type) = match (button, down) {
        ("right", true) => (CGMouseButton::Right, core_graphics::event::CGEventType::RightMouseDown),
        ("right", false) => (CGMouseButton::Right, core_graphics::event::CGEventType::RightMouseUp),
        ("middle", true) => (CGMouseButton::Center, core_graphics::event::CGEventType::OtherMouseDown),
        ("middle", false) => (CGMouseButton::Center, core_graphics::event::CGEventType::OtherMouseUp),
        (_, true) => (CGMouseButton::Left, core_graphics::event::CGEventType::LeftMouseDown),
        (_, false) => (CGMouseButton::Left, core_graphics::event::CGEventType::LeftMouseUp),
    };

    let event = CGEvent::new_mouse_event(source, event_type, point, btn)
        .map_err(|_| "Failed to create mouse click event".to_string())?;
    event.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn inject_mouse_wheel(delta: i32) -> Result<(), String> {
    extern "C" {
        fn CGEventCreateScrollWheelEvent(
            source: *const std::ffi::c_void,
            units: u32,
            wheelCount: u32,
            wheel1: i32,
        ) -> *mut std::ffi::c_void;
        fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
        fn CFRelease(cf: *mut std::ffi::c_void);
    }
    unsafe {
        let ev = CGEventCreateScrollWheelEvent(std::ptr::null(), 0, 1, delta);
        if !ev.is_null() {
            CGEventPost(0, ev); // 0 = kCGHIDEventTap
            CFRelease(ev);
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn inject_key(key: &str, down: bool) -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Failed to create event source".to_string())?;
    let key_code: CGKeyCode = match key.to_uppercase().as_str() {
        "ENTER" | "RETURN" => 0x24,
        "SPACE" => 0x31,
        "BACKSPACE" => 0x33,
        "TAB" => 0x30,
        "ESCAPE" | "ESC" => 0x35,
        "UP" | "ARROWUP" => 0x7E,
        "DOWN" | "ARROWDOWN" => 0x7D,
        "LEFT" | "ARROWLEFT" => 0x7B,
        "RIGHT" | "ARROWRIGHT" => 0x7C,
        "A" => 0x00,
        "C" => 0x08,
        "V" => 0x09,
        _ => return send_text_to_active_window(key),
    };

    let event = CGEvent::new_keyboard_event(source, key_code, down)
        .map_err(|_| "Failed to create keyboard event".to_string())?;
    event.post(CGEventTapLocation::HID);
    Ok(())
}

pub fn check_permissions() -> (bool, bool, bool) {
    // Accessibility, Screen Recording, Full Disk Access status
    let accessibility = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to return true"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let screen_record = true; // xcap will fail and report if missing
    let full_disk = dirs::home_dir()
        .map(|h| h.join("Library/Safari/History.db").exists())
        .unwrap_or(false);

    (accessibility, screen_record, full_disk)
}
