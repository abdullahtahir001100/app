//! Linux platform implementation stubs for input, controls, and system info.

use std::process::Command;

pub fn read_system_volume() -> Option<u32> {
    let output = Command::new("pactl")
        .args(["get-sink-volume", "@DEFAULT_SINK@"])
        .output()
        .ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        for part in text.split('/') {
            let p = part.trim();
            if p.ends_with('%') {
                if let Ok(val) = p.trim_end_matches('%').parse::<u32>() {
                    return Some(val);
                }
            }
        }
    }
    None
}

pub fn set_system_volume(level: u32) -> Result<(), String> {
    let safe_level = level.min(100);
    Command::new("pactl")
        .args(["set-sink-volume", "@DEFAULT_SINK@", &format!("{}%", safe_level)])
        .status()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn read_display_brightness() -> Option<u32> {
    Some(80)
}

pub fn set_display_brightness(_level: u32) -> Result<(), String> {
    Ok(())
}

pub fn send_text_to_active_window(text: &str) -> Result<(), String> {
    let _ = Command::new("xdotool").args(["type", "--", text]).status();
    Ok(())
}

pub fn lock_screen() -> Result<(), String> {
    let _ = Command::new("loginctl").args(["lock-session"]).status();
    Ok(())
}

pub fn open_settings() -> Result<(), String> {
    let _ = Command::new("gnome-control-center").spawn();
    Ok(())
}

pub fn get_active_window_info() -> Option<(String, String)> {
    let output = Command::new("xdotool")
        .args(["getactivewindow", "getwindowname"])
        .output()
        .ok()?;
    if output.status.success() {
        let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !title.is_empty() {
            return Some((title.clone(), title));
        }
    }
    None
}

pub fn get_battery_percent() -> Option<u32> {
    for bat in ["BAT0", "BAT1"] {
        let path = format!("/sys/class/power_supply/{}/capacity", bat);
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(val) = content.trim().parse::<u32>() {
                return Some(val);
            }
        }
    }
    None
}

pub fn get_storage_used_percent() -> Option<u32> {
    let output = Command::new("df").args(["-h", "/"]).output().ok()?;
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

pub fn inject_mouse_move(x: i32, y: i32) -> Result<(), String> {
    let _ = Command::new("xdotool")
        .args(["mousemove", &x.to_string(), &y.to_string()])
        .output();
    Ok(())
}

pub fn inject_mouse_button(_x: i32, _y: i32, button: &str, down: bool) -> Result<(), String> {
    let btn_num = match button {
        "right" => "3",
        "middle" => "2",
        _ => "1",
    };
    let action = if down { "mousedown" } else { "mouseup" };
    let _ = Command::new("xdotool")
        .args([action, btn_num])
        .output();
    Ok(())
}

pub fn inject_mouse_wheel(delta: i32) -> Result<(), String> {
    let btn_num = if delta > 0 { "4" } else { "5" };
    let clicks = (delta.abs() / 120).max(1);
    let _ = Command::new("xdotool")
        .args(["click", "--repeat", &clicks.to_string(), btn_num])
        .output();
    Ok(())
}

pub fn inject_key(key: &str, down: bool) -> Result<(), String> {
    let action = if down { "keydown" } else { "keyup" };
    let _ = Command::new("xdotool")
        .args([action, key])
        .output();
    Ok(())
}
