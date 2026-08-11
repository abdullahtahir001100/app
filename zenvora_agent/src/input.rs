#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEINPUT, VIRTUAL_KEY,
};

#[derive(Debug)]
pub enum InputError {
    #[allow(dead_code)]
    UnsupportedPlatform,
    SendFailed,
    InvalidPayload(String),
}

impl std::fmt::Display for InputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InputError::UnsupportedPlatform => write!(f, "Remote input is only supported on Windows"),
            InputError::SendFailed => write!(f, "SendInput failed"),
            InputError::InvalidPayload(msg) => write!(f, "{}", msg),
        }
    }
}

pub fn handle_remote_input(action: &str, payload: &serde_json::Value) -> Result<(), InputError> {
    match action {
        "REMOTE_MOUSE_MOVE" => remote_mouse_move(payload),
        "REMOTE_MOUSE_DOWN" => remote_mouse_button(payload, true),
        "REMOTE_MOUSE_UP" => remote_mouse_button(payload, false),
        "REMOTE_MOUSE_WHEEL" => remote_mouse_wheel(payload),
        "REMOTE_KEY_DOWN" => remote_key(payload, false),
        "REMOTE_KEY_UP" => remote_key(payload, true),
        _ => Err(InputError::InvalidPayload(format!("Unknown input action: {}", action))),
    }
}

fn parse_xy(payload: &serde_json::Value) -> Result<(i32, i32, u32, u32), InputError> {
    let x = payload
        .get("x")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| InputError::InvalidPayload("Missing x coordinate".into()))? as i32;
    let y = payload
        .get("y")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| InputError::InvalidPayload("Missing y coordinate".into()))? as i32;
    let screen_w = payload
        .get("screen_width")
        .and_then(|v| v.as_u64())
        .unwrap_or(1920)
        .max(1) as u32;
    let screen_h = payload
        .get("screen_height")
        .and_then(|v| v.as_u64())
        .unwrap_or(1080)
        .max(1) as u32;
    Ok((x, y, screen_w, screen_h))
}

fn parse_button(payload: &serde_json::Value) -> String {
    payload
        .get("button")
        .and_then(|v| v.as_str())
        .unwrap_or("left")
        .to_string()
}

#[cfg(windows)]
fn to_absolute_coords(x: i32, y: i32, screen_w: u32, screen_h: u32) -> (i32, i32) {
    let nx = ((x as i64).clamp(0, screen_w as i64) * 65535 / screen_w as i64) as i32;
    let ny = ((y as i64).clamp(0, screen_h as i64) * 65535 / screen_h as i64) as i32;
    (nx, ny)
}

#[cfg(windows)]
fn send_inputs(inputs: &[INPUT]) -> Result<(), InputError> {
    let sent = unsafe {
        SendInput(
            inputs,
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(InputError::SendFailed)
    }
}

#[cfg(windows)]
fn remote_mouse_move(payload: &serde_json::Value) -> Result<(), InputError> {
    let (x, y, screen_w, screen_h) = parse_xy(payload)?;
    let (nx, ny) = to_absolute_coords(x, y, screen_w, screen_h);
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: nx,
                dy: ny,
                mouseData: 0,
                dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    send_inputs(&[input])
}

#[cfg(not(windows))]
fn remote_mouse_move(_payload: &serde_json::Value) -> Result<(), InputError> {
    Err(InputError::UnsupportedPlatform)
}

#[cfg(windows)]
fn remote_mouse_button(payload: &serde_json::Value, down: bool) -> Result<(), InputError> {
    let (x, y, screen_w, screen_h) = parse_xy(payload)?;
    let (nx, ny) = to_absolute_coords(x, y, screen_w, screen_h);
    let button = parse_button(payload);

    let flags = match (button.as_str(), down) {
        ("right", true) => MOUSEEVENTF_RIGHTDOWN,
        ("right", false) => MOUSEEVENTF_RIGHTUP,
        ("middle", true) => MOUSEEVENTF_MIDDLEDOWN,
        ("middle", false) => MOUSEEVENTF_MIDDLEUP,
        (_, true) => MOUSEEVENTF_LEFTDOWN,
        (_, false) => MOUSEEVENTF_LEFTUP,
    };

    let move_input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: nx,
                dy: ny,
                mouseData: 0,
                dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let click_input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    send_inputs(&[move_input, click_input])
}

#[cfg(not(windows))]
fn remote_mouse_button(_payload: &serde_json::Value, _down: bool) -> Result<(), InputError> {
    Err(InputError::UnsupportedPlatform)
}

#[cfg(windows)]
fn remote_mouse_wheel(payload: &serde_json::Value) -> Result<(), InputError> {
    let (x, y, screen_w, screen_h) = parse_xy(payload)?;
    let (nx, ny) = to_absolute_coords(x, y, screen_w, screen_h);
    let delta = payload
        .get("delta")
        .and_then(|v| v.as_i64())
        .unwrap_or(120) as i32;

    let move_input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: nx,
                dy: ny,
                mouseData: 0,
                dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let wheel_input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: delta as u32,
                dwFlags: MOUSEEVENTF_WHEEL,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    send_inputs(&[move_input, wheel_input])
}

#[cfg(not(windows))]
fn remote_mouse_wheel(_payload: &serde_json::Value) -> Result<(), InputError> {
    Err(InputError::UnsupportedPlatform)
}

#[cfg(windows)]
fn map_browser_key(code: &str) -> Option<VIRTUAL_KEY> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_LEFT, VK_MENU,
        VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
    };

    if let Some(ch) = code.strip_prefix("Key") {
        if ch.len() == 1 {
            let c = ch.chars().next()? as u16;
            if c >= b'A' as u16 && c <= b'Z' as u16 {
                return Some(VIRTUAL_KEY(c));
            }
        }
    }
    if let Some(d) = code.strip_prefix("Digit") {
        if d.len() == 1 {
            let c = d.chars().next()? as u16;
            if c >= b'0' as u16 && c <= b'9' as u16 {
                return Some(VIRTUAL_KEY(c));
            }
        }
    }

    Some(match code {
        "Enter" => VK_RETURN,
        "Backspace" => VK_BACK,
        "Tab" => VK_TAB,
        "Escape" => VK_ESCAPE,
        "Space" => VK_SPACE,
        "Delete" => VK_DELETE,
        "ArrowUp" => VK_UP,
        "ArrowDown" => VK_DOWN,
        "ArrowLeft" => VK_LEFT,
        "ArrowRight" => VK_RIGHT,
        "Home" => VK_HOME,
        "End" => VK_END,
        "ShiftLeft" | "ShiftRight" => VK_SHIFT,
        "ControlLeft" | "ControlRight" => VK_CONTROL,
        "AltLeft" | "AltRight" => VK_MENU,
        _ => return None,
    })
}

#[cfg(windows)]
fn remote_key(payload: &serde_json::Value, key_up: bool) -> Result<(), InputError> {
    if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
        if !text.is_empty() {
            let ch = text.chars().next().unwrap_or_default();
            let mut flags = KEYEVENTF_UNICODE;
            if key_up {
                flags |= KEYEVENTF_KEYUP;
            }
            let input = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: ch as u16,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            return send_inputs(&[input]);
        }
    }

    let code = payload
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| InputError::InvalidPayload("Missing key code".into()))?;

    let vk = map_browser_key(code).ok_or_else(|| {
        InputError::InvalidPayload(format!("Unsupported key code: {}", code))
    })?;

    let mut flags = windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0);
    if key_up {
        flags = KEYEVENTF_KEYUP;
    }

    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    send_inputs(&[input])
}

#[cfg(not(windows))]
fn remote_key(_payload: &serde_json::Value, _key_up: bool) -> Result<(), InputError> {
    Err(InputError::UnsupportedPlatform)
}

pub fn is_remote_input_action(action: &str) -> bool {
    matches!(
        action,
        "REMOTE_MOUSE_MOVE"
            | "REMOTE_MOUSE_DOWN"
            | "REMOTE_MOUSE_UP"
            | "REMOTE_MOUSE_WHEEL"
            | "REMOTE_KEY_DOWN"
            | "REMOTE_KEY_UP"
    )
}
