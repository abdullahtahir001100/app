use std::collections::HashSet;
use std::ffi::OsStr;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use serde_json::json;
use tokio::time::{sleep, Duration};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard};
use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows::Win32::System::Memory::GlobalSize;
use windows::Win32::System::Ole::CF_TEXT;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
use windows::Win32::System::WindowsProgramming::DRIVE_REMOVABLE;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId};
use windows::Win32::Storage::FileSystem::GetDriveTypeW;

use crate::activity::ActivityLogger;
use crate::browser_history::BrowserHistoryCollector;
use crate::notifications;
use crate::sync_cursor::SyncCursors;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static MONITOR_STARTED: AtomicBool = AtomicBool::new(false);
static ACTIVE_LOGGER: RwLock<Option<Arc<ActivityLogger>>> = RwLock::new(None);

fn current_logger() -> Option<Arc<ActivityLogger>> {
    ACTIVE_LOGGER.read().ok()?.clone()
}

pub fn start_activity_monitor(logger: Arc<ActivityLogger>) {
    // Always refresh the live sink so reconnects keep working.
    if let Ok(mut slot) = ACTIVE_LOGGER.write() {
        *slot = Some(logger);
    }

    // Spawn OS watchers only once — never duplicate on WS reconnect.
    if MONITOR_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    tokio::spawn(foreground_window_monitor());
    tokio::spawn(usb_monitor());
    tokio::spawn(browser_monitor());
    tokio::spawn(notification_monitor());
    tokio::spawn(session_monitor());
    tokio::spawn(idle_monitor());
    tokio::spawn(clipboard_monitor());
    tokio::spawn(power_monitor());
    tokio::spawn(network_monitor());
    tokio::spawn(bluetooth_monitor());
    tokio::spawn(camera_monitor());
    tokio::spawn(microphone_monitor());
    tokio::spawn(printer_monitor());
    tokio::spawn(screenshot_monitor());
}

async fn foreground_window_monitor() {
    let mut last_window = String::new();
    let mut last_process = String::new();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        if let Some((window_title, process_path)) = get_active_window_info() {
            if window_title != last_window {
                logger.log_window_changed(
                    "Windows",
                    &window_title,
                    json!({"process": process_path.clone()}),
                );
                last_window = window_title.clone();
            }

            if process_path != last_process {
                logger.log_app_opened(
                    "Windows",
                    &process_path,
                    json!({"windowTitle": window_title.clone()}),
                );
                last_process = process_path;
            }
        }

        sleep(Duration::from_millis(2500)).await;
    }
}

async fn usb_monitor() {
    let mut connected = current_removable_drives();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current = current_removable_drives();

        for drive in current.difference(&connected) {
            logger.log_usb_connected(
                "Windows",
                drive,
                json!({"drive": drive}),
            );
        }

        for drive in connected.difference(&current) {
            logger.log_usb_disconnected(
                "Windows",
                drive,
                json!({"drive": drive}),
            );
        }

        connected = current;
        sleep(Duration::from_secs(3)).await;
    }
}

async fn browser_monitor() {
    let mut cursors = SyncCursors::load();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let (entries, new_chrome, new_ff) = BrowserHistoryCollector::collect_since(
            cursors.browser_chromium_time,
            cursors.browser_firefox_time,
        );

        if new_chrome > cursors.browser_chromium_time {
            cursors.browser_chromium_time = new_chrome;
        }
        if new_ff > cursors.browser_firefox_time {
            cursors.browser_firefox_time = new_ff;
        }
        cursors.save();

        // Only emit truly new visits — never re-scan/full-dump.
        for entry in entries.iter().take(40) {
            logger.log_website(
                &entry.browser,
                &entry.url,
                json!({
                    "title": entry.title,
                    "visitTime": entry.visit_time,
                    "visitCount": entry.visit_count,
                    "windowsUser": entry.windows_user,
                    "browserProfile": entry.browser_profile,
                }),
            );
        }

        sleep(Duration::from_secs(12)).await;
    }
}

async fn notification_monitor() {
    let notifier = notifications::global_notifier();
    let mut seen = HashSet::new();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let recent = notifier.get_recent(30);
        for notification in recent {
            let unique = format!("{}|{}|{}", notification.app, notification.title, notification.timestamp);
            if seen.contains(&unique) {
                continue;
            }
            seen.insert(unique.clone());
            if seen.len() > 2000 {
                seen.clear();
            }
            logger.log_notification_received(
                "Windows",
                &notification.title,
                json!({
                    "app": notification.app,
                    "message": notification.message,
                    "category": notification.category,
                    "timestamp": notification.timestamp,
                }),
            );
        }

        sleep(Duration::from_secs(8)).await;
    }
}

async fn session_monitor() {
    let mut last_logged_in = get_current_session_active();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current = get_current_session_active();
        if current && !last_logged_in {
            logger.log_login("Windows", "User session active", json!({}));
        } else if !current && last_logged_in {
            logger.log_logout("Windows", "User session disconnected", json!({}));
        }
        last_logged_in = current;
        sleep(Duration::from_secs(4)).await;
    }
}

async fn idle_monitor() {
    let mut idle_reported = false;

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let idle_secs = get_idle_seconds();
        if idle_secs >= 60 && !idle_reported {
            logger.log_system_idle(
                "Windows",
                &format!("Idle for {} seconds", idle_secs),
                json!({"idleSeconds": idle_secs}),
            );
            idle_reported = true;
        } else if idle_secs < 5 && idle_reported {
            logger.log_system_active(
                "Windows",
                "User returned from idle",
                json!({"idleSeconds": idle_secs}),
            );
            idle_reported = false;
        }
        sleep(Duration::from_secs(2)).await;
    }
}

async fn clipboard_monitor() {
    let mut last_sequence = get_clipboard_sequence_number();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current_sequence = get_clipboard_sequence_number();
        if current_sequence != 0 && current_sequence != last_sequence {
            if let Some((format, size)) = get_clipboard_content_summary() {
                logger.log_clipboard_changed(
                    "Windows",
                    &format!("{} bytes {}", size, format),
                    json!({"format": format, "size": size}),
                );
            } else {
                logger.log_clipboard_changed("Windows", "Clipboard changed", json!({}));
            }
            last_sequence = current_sequence;
        }
        sleep(Duration::from_secs(2)).await;
    }
}

async fn power_monitor() {
    let mut last_ac = get_ac_power_status();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current_ac = get_ac_power_status();
        if current_ac && !last_ac {
            logger.log_power_connected("Windows", "AC power connected", json!({}));
        } else if !current_ac && last_ac {
            logger.log_power_disconnected("Windows", "AC power disconnected", json!({}));
        }
        last_ac = current_ac;
        sleep(Duration::from_secs(5)).await;
    }
}

async fn network_monitor() {
    let mut last_wifi = is_wifi_connected();
    let mut last_vpn = is_vpn_connected();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current_wifi = is_wifi_connected();
        if current_wifi && !last_wifi {
            logger.log_wifi_connected("Windows", "Wi-Fi connected", json!({}));
        } else if !current_wifi && last_wifi {
            logger.log_wifi_disconnected("Windows", "Wi-Fi disconnected", json!({}));
        }
        last_wifi = current_wifi;

        let current_vpn = is_vpn_connected();
        if current_vpn && !last_vpn {
            logger.log_vpn_connected("Windows", "VPN connected", json!({}));
        } else if !current_vpn && last_vpn {
            logger.log_vpn_disconnected("Windows", "VPN disconnected", json!({}));
        }
        last_vpn = current_vpn;

        sleep(Duration::from_secs(5)).await;
    }
}

async fn bluetooth_monitor() {
    let mut last_devices = get_bluetooth_devices();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current_devices = get_bluetooth_devices();
        for device in current_devices.difference(&last_devices) {
            logger.log_bluetooth_connected("Windows", device, json!({"device": device}));
        }
        for device in last_devices.difference(&current_devices) {
            logger.log_bluetooth_disconnected("Windows", device, json!({"device": device}));
        }
        last_devices = current_devices;
        sleep(Duration::from_secs(6)).await;
    }
}

async fn camera_monitor() {
    let mut seen_camera = get_camera_processes();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current_camera = get_camera_processes();
        for proc in current_camera.difference(&seen_camera) {
            logger.log_camera_started("Windows", proc, json!({"source": "process-scan"}));
        }
        for proc in seen_camera.difference(&current_camera) {
            logger.log_camera_stopped("Windows", proc, json!({"source": "process-scan"}));
        }
        seen_camera = current_camera;
        sleep(Duration::from_secs(5)).await;
    }
}

async fn microphone_monitor() {
    let mut seen_microphone = get_microphone_processes();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current_mic = get_microphone_processes();
        for proc in current_mic.difference(&seen_microphone) {
            logger.log_microphone_started("Windows", proc, json!({"source": "process-scan"}));
        }
        for proc in seen_microphone.difference(&current_mic) {
            logger.log_microphone_stopped("Windows", proc, json!({"source": "process-scan"}));
        }
        seen_microphone = current_mic;
        sleep(Duration::from_secs(5)).await;
    }
}

async fn printer_monitor() {
    let mut seen_jobs = get_print_jobs();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current_jobs = get_print_jobs();
        for job in current_jobs.difference(&seen_jobs) {
            logger.log_printer_used("Windows", job, json!({"job": job}));
        }
        seen_jobs = current_jobs;
        sleep(Duration::from_secs(10)).await;
    }
}

async fn screenshot_monitor() {
    let mut seen = get_screenshot_files();

    loop {
        let Some(logger) = current_logger() else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let current = get_screenshot_files();
        for path in current.difference(&seen) {
            logger.log_screenshot_taken(
                "Windows",
                path,
                json!({"path": path}),
            );
        }
        seen = current;
        sleep(Duration::from_secs(6)).await;
    }
}

fn get_active_window_info() -> Option<(String, String)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == std::ptr::null_mut() {
            return None;
        }
        let length = GetWindowTextLengthW(hwnd);
        let mut buffer = vec![0u16; (length + 1) as usize];
        let text_len = GetWindowTextW(hwnd, &mut buffer) as usize;
        let window_title = String::from_utf16_lossy(&buffer[..text_len]).trim().to_string();

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let process_name = if pid != 0 {
            get_process_image_name(pid).unwrap_or_else(|| "unknown_process".to_string())
        } else {
            "unknown_process".to_string()
        };

        Some((window_title, process_name))
    }
}

fn get_process_image_name(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        if process.is_invalid() {
            return None;
        }
        let mut buffer = [0u16; 260];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size);
        let _ = CloseHandle(process);
        if result.is_ok() {
            Some(String::from_utf16_lossy(&buffer[..size as usize]).trim().to_string())
        } else {
            None
        }
    }
}

fn current_removable_drives() -> HashSet<String> {
    let mut drives = HashSet::new();
    for letter in b'A'..=b'Z' {
        let path: Vec<u16> = OsStr::new(&format!("{}:\\", letter as char))
            .encode_wide()
            .chain(Some(0))
            .collect();
        let drive_type = unsafe { GetDriveTypeW(PCWSTR(path.as_ptr())) };
        if drive_type == DRIVE_REMOVABLE {
            drives.insert(format!("{}:\\", letter as char));
        }
    }
    drives
}

fn get_current_session_active() -> bool {
    let mut cmd = Command::new("query");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    if let Ok(output) = cmd.arg("session").output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.contains("Active")
    } else {
        false
    }
}

fn get_idle_seconds() -> u32 {
    unsafe {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if GetLastInputInfo(&mut info).as_bool() {
            let tick_count = GetTickCount();
            if tick_count >= info.dwTime {
                return (tick_count - info.dwTime) / 1000;
            }
        }
        0
    }
}

fn get_clipboard_sequence_number() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

fn get_clipboard_content_summary() -> Option<(String, usize)> {
    unsafe {
        if OpenClipboard(HWND(std::ptr::null_mut())).is_ok() {
            let data = GetClipboardData(CF_TEXT.0.into()).ok()?;
            let size = GlobalSize(HGLOBAL(data.0));
            let _ = CloseClipboard();
            if size > 0 {
                return Some(("text".to_string(), size));
            }
        }
    }
    None
}

fn get_ac_power_status() -> bool {
    unsafe {
        let mut status = SYSTEM_POWER_STATUS::default();
        if GetSystemPowerStatus(&mut status).is_ok() {
            status.ACLineStatus == 1
        } else {
            false
        }
    }
}

fn is_wifi_connected() -> bool {
    let mut cmd = Command::new("netsh");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    if let Ok(output) = cmd.args(["wlan", "show", "interfaces"]).output() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
        stdout.contains("state") && stdout.contains("connected")
    } else {
        false
    }
}

fn is_vpn_connected() -> bool {
    let mut cmd = Command::new("rasdial");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    if let Ok(output) = cmd.output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.contains("No connections") == false && !stdout.trim().is_empty()
    } else {
        false
    }
}

fn get_bluetooth_devices() -> HashSet<String> {
    let mut devices = HashSet::new();
    if let Ok(output) = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            "Get-PnpDevice -Class Bluetooth | Where-Object {$_.Status -eq 'OK'} | Select-Object -ExpandProperty FriendlyName",
        ])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().map(str::trim).filter(|l| !l.is_empty()) {
            devices.insert(line.to_string());
        }
    }
    devices
}

fn get_camera_processes() -> HashSet<String> {
    let candidates = ["camera", "webcam", "zoom", "teams", "skype", "obs", "webex", "meet"];
    enumerate_process_names()
        .into_iter()
        .filter(|name| {
            let lower = name.to_lowercase();
            candidates.iter().any(|candidate| lower.contains(candidate))
        })
        .collect()
}

fn get_microphone_processes() -> HashSet<String> {
    let candidates = ["zoom", "teams", "skype", "discord", "obs", "audacity", "voicemeeter"];
    enumerate_process_names()
        .into_iter()
        .filter(|name| {
            let lower = name.to_lowercase();
            candidates.iter().any(|candidate| lower.contains(candidate))
        })
        .collect()
}

fn get_print_jobs() -> HashSet<String> {
    let mut jobs = HashSet::new();
    if let Ok(output) = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            "Get-PrintJob | Select-Object -ExpandProperty Document",
        ])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().map(str::trim).filter(|l| !l.is_empty()) {
            jobs.insert(line.to_string());
        }
    }
    jobs
}

fn get_screenshot_files() -> HashSet<String> {
    let mut files = HashSet::new();
    let candidates = [
        dirs::home_dir().map(|h| h.join(r"Pictures\Screenshots")),
        dirs::home_dir().map(|h| h.join("Desktop")),
        dirs::home_dir().map(|h| h.join("Pictures")),
    ];
    for path in candidates.into_iter().flatten() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        if let Some(name) = entry.file_name().to_str() {
                            let lower = name.to_lowercase();
                            if lower.contains("screenshot") || lower.contains("screen") || lower.contains("print") {
                                if let Some(path_str) = entry.path().to_str() {
                                    files.insert(path_str.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    files
}

fn enumerate_process_names() -> Vec<String> {
    let mut names = Vec::new();
    unsafe {
        if let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            let mut entry = PROCESSENTRY32W::default();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let name = String::from_utf16_lossy(&entry.szExeFile)
                        .trim_end_matches('\0')
                        .to_string();
                    if !name.is_empty() {
                        names.push(name);
                    }
                    if !Process32NextW(snapshot, &mut entry).is_ok() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
    }
    names
}
