//! Silent remote agent update — download latest binary, swap, restart service.

use crate::paths::{agent_dir, agent_exe_path, AGENT_EXE_NAME};
use crate::service;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::Duration;

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
        return Err("download_url required for UPDATE_AGENT".into());
    }

    let url_clone = url.clone();
    thread::spawn(move || {
        if let Err(err) = run_silent_update(&url_clone) {
            eprintln!("[UPDATE] Silent update failed: {}", err);
        }
    });

    Ok(())
}

fn run_silent_update(url: &str) -> Result<(), String> {
    let dir = agent_dir();
    let dest = agent_exe_path();
    let part = dir.join(format!("{}.part", AGENT_EXE_NAME));
    let staged = dir.join(format!("{}.new", AGENT_EXE_NAME));

    println!("[UPDATE] Downloading agent from {}", url);

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

    let _ = fs::remove_file(&staged);
    fs::rename(&part, &staged).map_err(|e| e.to_string())?;

    // Swap while this process is still running via delayed cmd, then restart service.
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

    // Soft restart shortly so SCM/service path picks up new binary when swap completes.
    thread::spawn(|| {
        thread::sleep(Duration::from_secs(4));
        let _ = service::restart_service();
    });

    println!("[UPDATE] Silent update scheduled for {}", dest.display());
    Ok(())
}

#[allow(dead_code)]
pub fn staged_path() -> PathBuf {
    agent_dir().join(format!("{}.new", AGENT_EXE_NAME))
}
