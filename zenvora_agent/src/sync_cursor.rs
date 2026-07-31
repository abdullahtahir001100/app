//! Persistent incremental sync cursors (never full-resync after ack).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::config::AgentConfig;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncCursors {
    /// Chromium last_visit_time (µs since 1601) high-water mark.
    pub browser_chromium_time: i64,
    /// Firefox last_visit_date (µs since epoch) high-water mark.
    pub browser_firefox_time: i64,
    /// App history last_opened ISO string (lexicographic).
    pub app_last_opened: String,
    /// Notification sequence / timestamp.
    pub notification_seq: u64,
    /// Activity / general event sequence.
    pub event_seq: u64,
}

fn cursor_path() -> PathBuf {
    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        let dir = PathBuf::from(program_data).join(crate::paths::AGENT_DIR_NAME);
        let _ = fs::create_dir_all(&dir);
        return dir.join("sync_cursors.dat");
    }
    PathBuf::from("sync_cursors.dat")
}

impl SyncCursors {
    pub fn load() -> Self {
        let path = cursor_path();
        match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) {
        let path = cursor_path();
        if let Ok(bytes) = serde_json::to_vec(self) {
            let _ = fs::write(path, bytes);
        }
    }

    pub fn bump_event_seq(&mut self) -> u64 {
        self.event_seq = self.event_seq.saturating_add(1);
        self.event_seq
    }
}

/// Optional override for tests / pairing.
#[allow(dead_code)]
pub fn bind_to_config(_config: &AgentConfig) {}
