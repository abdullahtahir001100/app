//! Agent install / data directories.
//! Cross-platform: macOS, Linux, and Windows.

use std::fs;
use std::path::PathBuf;

pub const AGENT_DIR_NAME: &str = "Zenvora";

#[cfg(windows)]
pub const AGENT_EXE_NAME: &str = "ZenvoraAgent.exe";
#[cfg(not(windows))]
pub const AGENT_EXE_NAME: &str = "ZenvoraAgent";

/// Legacy folder from older builds (migrate agent.dat from here).
pub const LEGACY_DIR_NAME: &str = "WIN_32";

#[cfg(windows)]
pub fn program_data_root() -> PathBuf {
    std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
}

#[cfg(target_os = "macos")]
pub fn program_data_root() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join("Library").join("Application Support")
    } else {
        PathBuf::from("/Library/Application Support")
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
pub fn program_data_root() -> PathBuf {
    if let Some(config) = dirs::config_dir() {
        config
    } else {
        PathBuf::from("/etc")
    }
}

pub fn agent_dir() -> PathBuf {
    let dir = program_data_root().join(AGENT_DIR_NAME);
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn agent_exe_path() -> PathBuf {
    agent_dir().join(AGENT_EXE_NAME)
}

pub fn legacy_agent_dir() -> PathBuf {
    program_data_root().join(LEGACY_DIR_NAME)
}

/// Prefer Zenvora; fall back to legacy WIN_32 for existing installs.
pub fn data_dir() -> PathBuf {
    let modern = agent_dir();
    let legacy = legacy_agent_dir();
    if modern.exists() {
        return modern;
    }
    if legacy.exists() {
        // Soft-migrate: ensure modern dir exists so new writes go there.
        let _ = fs::create_dir_all(&modern);
        return modern;
    }
    modern
}

pub fn migrate_legacy_file(file_name: &str) {
    let modern = agent_dir().join(file_name);
    if modern.exists() {
        return;
    }
    let legacy = legacy_agent_dir().join(file_name);
    if legacy.is_file() {
        let _ = fs::copy(&legacy, &modern);
    }
}

pub const ZENVORA_LOGO_PNG: &[u8] = include_bytes!("../assets/logo.png");

/// Ensures that the official Zenvora logo is available locally for native GUI dialogs and notifications.
pub fn ensure_logo_file() -> PathBuf {
    let logo_path = agent_dir().join("logo.png");
    if !logo_path.exists() {
        let _ = fs::write(&logo_path, ZENVORA_LOGO_PNG);
    }
    #[cfg(unix)]
    {
        let tmp_logo = PathBuf::from("/tmp/zenvora_logo.png");
        if !tmp_logo.exists() {
            let _ = fs::write(&tmp_logo, ZENVORA_LOGO_PNG);
        }
    }
    logo_path
}
