//! Silent remote agent update — download latest binary, swap, restart service.
//! Progress/success/error are reported to the dashboard over the gateway WS.

use crate::paths::{agent_dir, agent_exe_path, AGENT_EXE_NAME};
use crate::service;
use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

static REPORT_TX: Mutex<Option<mpsc::UnboundedSender<Message>>> = Mutex::new(None);
static DEVICE_ID: Mutex<Option<String>> = Mutex::new(None);

pub fn set_gateway_reporter(tx: mpsc::UnboundedSender<Message>, device_id: &str) {
    if let Ok(mut g) = REPORT_TX.lock() {
        *g = Some(tx);
    }
    if let Ok(mut g) = DEVICE_ID.lock() {
        *g = Some(device_id.to_string());
    }
}

pub fn clear_gateway_reporter() {
    if let Ok(mut g) = REPORT_TX.lock() {
        *g = None;
    }
}

fn hostname_now() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "PC".into())
}

fn report(step: u32, total: u32, state: &str, message: &str, final_event: bool) {
    let device_id = DEVICE_ID
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_default();
    let packet = json!({
        "type": "update_log",
        "deviceId": device_id,
        "hostname": hostname_now(),
        "step": step,
        "total": total,
        "state": state,
        "message": message,
        "final": final_event,
        "kind": "agent_update",
        "at": chrono::Local::now().to_rfc3339(),
    });
    if let Ok(guard) = REPORT_TX.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(Message::Text(packet.to_string()));
        }
    }
    println!("[UPDATE] [{}] {}", state, message);
}

fn default_download_url() -> String {
    std::env::var("ZENVORA_AGENT_DOWNLOAD_URL")
        .or_else(|_| std::env::var("NEXT_PUBLIC_AGENT_DOWNLOAD_URL"))
        .unwrap_or_else(|_| String::new())
}

/// Download latest agent binary and schedule a silent replace + service restart.
pub fn schedule_silent_update(download_url: Option<&str>) -> Result<(), String> {
    let url = download_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(default_download_url);

    if url.is_empty() {
        report(1, 5, "fail", "download_url required for UPDATE_AGENT", true);
        return Err("download_url required for UPDATE_AGENT".into());
    }

    report(1, 5, "ok", "Update queued — downloading new agent…", false);

    let url_clone = url.clone();
    thread::spawn(move || {
        match run_silent_update(&url_clone) {
            Ok(()) => {
                report(
                    5,
                    5,
                    "ok",
                    "Update staged — swapping binary and restarting service",
                    true,
                );
            }
            Err(err) => {
                report(5, 5, "fail", &format!("Update failed: {}", err), true);
                eprintln!("[UPDATE] Silent update failed: {}", err);
            }
        }
    });

    Ok(())
}

fn run_silent_update(url: &str) -> Result<(), String> {
    let dir = agent_dir();
    let dest = agent_exe_path();
    let part = dir.join(format!("{}.part", AGENT_EXE_NAME));
    let staged = dir.join(format!("{}.new", AGENT_EXE_NAME));

    report(2, 5, "running", &format!("Downloading from {}", url), false);

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = client
        .get(url)
        .header("User-Agent", "ZenvoraAgent-Update/1.0")
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("download HTTP {}", response.status()));
    }

    let mut file = fs::File::create(&part).map_err(|e| e.to_string())?;
    response
        .copy_to(&mut file)
        .map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    let meta = fs::metadata(&part).map_err(|e| e.to_string())?;
    if meta.len() < 500_000 {
        let _ = fs::remove_file(&part);
        return Err("downloaded binary too small".into());
    }

    report(
        3,
        5,
        "ok",
        &format!("Download complete ({:.1} MB)", meta.len() as f64 / 1_000_000.0),
        false,
    );

    let _ = fs::remove_file(&staged);
    fs::rename(&part, &staged).map_err(|e| e.to_string())?;

    report(4, 5, "running", "Writing swap script and restarting…", false);

    let bat = dir.join("zenvora-update.cmd");
    let bat_body = format!(
        "@echo off\r\nping -n 3 127.0.0.1 >nul\r\ncopy /Y \"{staged}\" \"{dest}\" >nul\r\ndel /F /Q \"{staged}\" >nul 2>nul\r\nsc stop ZenvoraAgent >nul 2>nul\r\nping -n 2 127.0.0.1 >nul\r\nsc start ZenvoraAgent >nul 2>nul\r\nif errorlevel 1 start \"\" \"{dest}\" --run-agent\r\ndel /F /Q \"%~f0\"\r\n",
        staged = staged.display(),
        dest = dest.display()
    );
    fs::write(&bat, bat_body).map_err(|e| e.to_string())?;

    let _ = Command::new("cmd.exe")
        .args(["/C", "start", "", "/MIN", &bat.display().to_string()])
        .spawn();

    thread::spawn(|| {
        thread::sleep(Duration::from_secs(4));
        let _ = service::restart_service();
    });

    Ok(())
}

#[allow(dead_code)]
pub fn staged_path() -> PathBuf {
    agent_dir().join(format!("{}.new", AGENT_EXE_NAME))
}
