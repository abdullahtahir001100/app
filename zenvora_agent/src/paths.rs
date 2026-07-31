//! Agent install / data directories.
//! Avoid System32 and fake "WIN_32" names — those patterns trigger Defender ML (Bearfoos).

use std::fs;
use std::path::PathBuf;

pub const AGENT_DIR_NAME: &str = "Zenvora";
pub const AGENT_EXE_NAME: &str = "ZenvoraAgent.exe";
/// Legacy folder from older builds (migrate agent.dat from here).
pub const LEGACY_DIR_NAME: &str = "WIN_32";

pub fn program_data_root() -> PathBuf {
    std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
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
