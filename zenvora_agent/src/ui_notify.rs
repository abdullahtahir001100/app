#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn escape_ps(s: &str) -> String {
    s.replace('\'', "''")
}

#[cfg(windows)]
fn run_message_box(title: &str, message: &str, icon: &str, blocking: bool) {
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         [System.Windows.Forms.MessageBox]::Show('{}','{}','OK','{}') | Out-Null",
        escape_ps(message),
        escape_ps(title),
        icon
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.creation_flags(CREATE_NO_WINDOW).args([
        "-NoProfile",
        "-STA",
        "-WindowStyle",
        "Hidden",
        "-Command",
        &script,
    ]);

    if blocking {
        let _ = cmd.output();
    } else {
        let _ = cmd.spawn();
    }
}

#[cfg(target_os = "macos")]
fn run_message_box(title: &str, message: &str, _icon: &str, blocking: bool) {
    let logo_path = crate::paths::ensure_logo_file();
    let logo_str = logo_path.to_string_lossy();
    let script = format!(
        r#"display dialog "{}" with title "{}" with icon POSIX file "{}" buttons {{"OK"}} default button "OK""#,
        message.replace('"', "\\\""),
        title.replace('"', "\\\""),
        logo_str.replace('"', "\\\"")
    );
    let mut cmd = std::process::Command::new("osascript");
    cmd.arg("-e").arg(&script);
    if blocking {
        let _ = cmd.output();
    } else {
        let _ = cmd.spawn();
    }
}

#[cfg(target_os = "linux")]
fn run_message_box(title: &str, message: &str, icon: &str, blocking: bool) {
    let logo_path = crate::paths::ensure_logo_file();
    let logo_str = logo_path.to_string_lossy();
    let flag = match icon {
        "Error" => "--error",
        "Warning" => "--warning",
        _ => "--info",
    };
    let mut cmd = std::process::Command::new("zenity");
    cmd.args([
        flag,
        &format!("--title={}", title),
        &format!("--text={}", message),
        &format!("--window-icon={}", logo_str),
    ]);
    if blocking {
        let _ = cmd.output();
    } else {
        let _ = cmd.spawn();
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn run_message_box(title: &str, message: &str, _icon: &str, _blocking: bool) {
    println!("[{}] {}", title, message);
}

pub fn show_blocking_info(title: &str, message: &str) {
    println!("--> [{}] {}", title, message);
    run_message_box(title, message, "Information", true);
}

pub fn show_blocking_error(title: &str, message: &str) {
    eprintln!("--> [{}] {}", title, message);
    run_message_box(title, message, "Error", true);
}

#[allow(dead_code)]
pub fn show_blocking_warning(title: &str, message: &str) {
    eprintln!("--> [{}] {}", title, message);
    run_message_box(title, message, "Warning", true);
}

pub fn show_blocking_msg(msg: crate::messages::Msg) {
    let text = msg.display();
    match msg.kind {
        crate::messages::MsgKind::Error => show_blocking_error("Zenvora", &text),
        crate::messages::MsgKind::Warn => show_blocking_warning("Zenvora", &text),
        _ => show_blocking_info("Zenvora", &text),
    }
}

/// Background agent — never block the socket loop.
pub fn show_info(title: &str, message: &str) {
    println!("--> [{}] {}", title, message);
    run_message_box(title, message, "Information", false);
}

pub fn show_error(title: &str, message: &str) {
    eprintln!("--> [{}] {}", title, message);
    run_message_box(title, message, "Error", false);
}

pub fn show_warning(title: &str, message: &str) {
    eprintln!("--> [{}] {}", title, message);
    run_message_box(title, message, "Warning", false);
}
