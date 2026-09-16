//! OpenClaw Activity & Context Database for Zenvora Agent
//!
//! Provides a persistent, high-performance SQLite storage layer that records:
//! 1. All monitored OS activity (window focus, app switches, file operations, system states)
//! 2. Clipboard event history
//! 3. Active window audit trail
//! 4. Agent execution audit log (tasks, commands, status, timing)
//!
//! The autonomous agent (OpenClaw / Microsoft UFO) uses this database to inspect
//! past user actions and contextualize automated decisions.

use chrono::Utc;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::paths;

static DB_MUTEX: OnceLock<Mutex<Connection>> = OnceLock::new();

fn db_path() -> PathBuf {
    paths::data_dir().join("zenvora_activity.db")
}

/// Initialize the database and ensure all tables and indexes exist.
pub fn init_db() -> SqliteResult<()> {
    let path = db_path();
    let conn = Connection::open(&path)?;

    // Enable WAL mode for high concurrent throughput & reliability
    let _ = conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -8000;",
    );

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tracked_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            category TEXT NOT NULL,
            status TEXT NOT NULL,
            device TEXT NOT NULL,
            details TEXT NOT NULL,
            metadata TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tracked_events_time ON tracked_events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_tracked_events_cat ON tracked_events(category);
        CREATE INDEX IF NOT EXISTS idx_tracked_events_act ON tracked_events(action);

        CREATE TABLE IF NOT EXISTS clipboard_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            content_snippet TEXT NOT NULL,
            char_length INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_clipboard_time ON clipboard_audit(timestamp DESC);

        CREATE TABLE IF NOT EXISTS window_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT NOT NULL,
            pid INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_window_time ON window_audit(timestamp DESC);

        CREATE TABLE IF NOT EXISTS agent_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            task_id TEXT NOT NULL,
            action_type TEXT NOT NULL,
            command TEXT NOT NULL,
            status TEXT NOT NULL,
            execution_ms INTEGER NOT NULL,
            result_summary TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_audit_time ON agent_audit(timestamp DESC);",
    )?;

    let _ = DB_MUTEX.set(Mutex::new(conn));
    Ok(())
}

fn with_conn<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&Connection) -> SqliteResult<R>,
{
    if DB_MUTEX.get().is_none() {
        let _ = init_db();
    }
    let mutex = DB_MUTEX.get()?;
    let conn = mutex.lock().ok()?;
    f(&conn).ok()
}

fn with_conn_mut<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut Connection) -> SqliteResult<R>,
{
    if DB_MUTEX.get().is_none() {
        let _ = init_db();
    }
    let mutex = DB_MUTEX.get()?;
    let mut conn = mutex.lock().ok()?;
    f(&mut conn).ok()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedDbEvent {
    pub id: i64,
    pub timestamp: String,
    pub action: String,
    pub category: String,
    pub status: String,
    pub device: String,
    pub details: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardDbRecord {
    pub id: i64,
    pub timestamp: String,
    pub content_snippet: String,
    pub char_length: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowDbRecord {
    pub id: i64,
    pub timestamp: String,
    pub app_name: String,
    pub window_title: String,
    pub pid: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAuditDbRecord {
    pub id: i64,
    pub timestamp: String,
    pub task_id: String,
    pub action_type: String,
    pub command: String,
    pub status: String,
    pub execution_ms: i64,
    pub result_summary: String,
}

/// Record a tracked event into SQLite
pub fn record_event(
    action: &str,
    category: &str,
    status: &str,
    device: &str,
    details: &str,
    metadata: &Value,
) {
    let now = Utc::now().to_rfc3339();
    let meta_str = metadata.to_string();
    let action_owned = action.to_string();
    let category_owned = category.to_string();
    let status_owned = status.to_string();
    let device_owned = device.to_string();
    let details_owned = details.to_string();

    with_conn_mut(|conn| {
        conn.execute(
            "INSERT INTO tracked_events (timestamp, action, category, status, device, details, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                now,
                action_owned,
                category_owned,
                status_owned,
                device_owned,
                details_owned,
                meta_str
            ],
        )?;

        // Auto-prune if row count exceeds 100,000 to keep queries instantaneous
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tracked_events",
            [],
            |row| row.get(0),
        )?;
        if count > 100_000 {
            let _ = conn.execute(
                "DELETE FROM tracked_events WHERE id IN (SELECT id FROM tracked_events ORDER BY id ASC LIMIT 10000)",
                [],
            );
        }
        Ok(())
    });
}

/// Record clipboard copy/change event
pub fn record_clipboard(content: &str) {
    if content.trim().is_empty() {
        return;
    }
    let now = Utc::now().to_rfc3339();
    let len = content.chars().count() as i64;
    let snippet: String = content.chars().take(250).collect();

    with_conn_mut(|conn| {
        conn.execute(
            "INSERT INTO clipboard_audit (timestamp, content_snippet, char_length) VALUES (?1, ?2, ?3)",
            params![now, snippet, len],
        )?;
        Ok(())
    });
}

/// Record window focus change event
pub fn record_window(app_name: &str, window_title: &str, pid: u32) {
    if window_title.trim().is_empty() && app_name.trim().is_empty() {
        return;
    }
    let now = Utc::now().to_rfc3339();
    let app = app_name.to_string();
    let title = window_title.to_string();
    let pid_i64 = pid as i64;

    with_conn_mut(|conn| {
        conn.execute(
            "INSERT INTO window_audit (timestamp, app_name, window_title, pid) VALUES (?1, ?2, ?3, ?4)",
            params![now, app, title, pid_i64],
        )?;
        Ok(())
    });
}

/// Record an autonomous agent action into the audit trail
pub fn record_agent_action(
    task_id: &str,
    action_type: &str,
    command: &str,
    status: &str,
    execution_ms: u64,
    result_summary: &str,
) {
    let now = Utc::now().to_rfc3339();
    let task = task_id.to_string();
    let act = action_type.to_string();
    let cmd = command.chars().take(500).collect::<String>();
    let stat = status.to_string();
    let ms = execution_ms as i64;
    let res = result_summary.chars().take(500).collect::<String>();

    with_conn_mut(|conn| {
        conn.execute(
            "INSERT INTO agent_audit (timestamp, task_id, action_type, command, status, execution_ms, result_summary)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![now, task, act, cmd, stat, ms, res],
        )?;
        Ok(())
    });
}

/// Query recent tracked events with optional category and search filters
pub fn query_events(
    limit: usize,
    category: Option<&str>,
    search_query: Option<&str>,
) -> Vec<TrackedDbEvent> {
    with_conn(|conn| {
        let mut sql = "SELECT id, timestamp, action, category, status, device, details, metadata FROM tracked_events".to_string();
        let mut clauses = Vec::new();

        if let Some(cat) = category {
            if !cat.trim().is_empty() && cat != "all" {
                clauses.push(format!("category = '{}'", cat.replace('\'', "''")));
            }
        }
        if let Some(q) = search_query {
            if !q.trim().is_empty() {
                let escaped = q.replace('\'', "''");
                clauses.push(format!("(details LIKE '%{0}%' OR action LIKE '%{0}%' OR metadata LIKE '%{0}%')", escaped));
            }
        }

        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(&format!(" ORDER BY timestamp DESC LIMIT {}", limit.max(1).min(500)));

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let meta_str: String = row.get(7)?;
            let metadata = serde_json::from_str(&meta_str).unwrap_or(Value::Null);
            Ok(TrackedDbEvent {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                action: row.get(2)?,
                category: row.get(3)?,
                status: row.get(4)?,
                device: row.get(5)?,
                details: row.get(6)?,
                metadata,
            })
        })?;

        let mut result = Vec::new();
        for r in rows.flatten() {
            result.push(r);
        }
        Ok(result)
    })
    .unwrap_or_default()
}

/// Query recent clipboard snippets
pub fn query_clipboard(limit: usize) -> Vec<ClipboardDbRecord> {
    with_conn(|conn| {
        let sql = format!(
            "SELECT id, timestamp, content_snippet, char_length FROM clipboard_audit ORDER BY timestamp DESC LIMIT {}",
            limit.max(1).min(100)
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(ClipboardDbRecord {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                content_snippet: row.get(2)?,
                char_length: row.get(3)?,
            })
        })?;

        let mut result = Vec::new();
        for r in rows.flatten() {
            result.push(r);
        }
        Ok(result)
    })
    .unwrap_or_default()
}

/// Query recent active window history
pub fn query_window_history(limit: usize) -> Vec<WindowDbRecord> {
    with_conn(|conn| {
        let sql = format!(
            "SELECT id, timestamp, app_name, window_title, pid FROM window_audit ORDER BY timestamp DESC LIMIT {}",
            limit.max(1).min(100)
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(WindowDbRecord {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                app_name: row.get(2)?,
                window_title: row.get(3)?,
                pid: row.get(4)?,
            })
        })?;

        let mut result = Vec::new();
        for r in rows.flatten() {
            result.push(r);
        }
        Ok(result)
    })
    .unwrap_or_default()
}

/// Produce a dense, intelligent context summary of tracked user activity
/// for the OpenClaw / UFO autonomous agent.
pub fn synthesize_user_context() -> Value {
    let recent_windows = query_window_history(15);
    let recent_clipboard = query_clipboard(10);
    let recent_actions = query_events(20, None, None);

    // Get current/latest active window
    let current_window = recent_windows.first().cloned();

    // Get unique recent apps
    let mut recent_apps = Vec::new();
    for w in &recent_windows {
        if !w.app_name.is_empty() && !recent_apps.contains(&w.app_name) {
            recent_apps.push(w.app_name.clone());
        }
    }

    // Recent clipboard snippet
    let latest_clipboard = recent_clipboard.first().map(|c| c.content_snippet.clone());

    json!({
        "currentActiveWindow": current_window,
        "recentApps": recent_apps,
        "recentWindows": recent_windows,
        "latestClipboard": latest_clipboard,
        "recentClipboardCount": recent_clipboard.len(),
        "recentEventsCount": recent_actions.len(),
        "recentEventsPreview": recent_actions.iter().take(5).map(|e| {
            json!({
                "time": e.timestamp,
                "action": e.action,
                "category": e.category,
                "details": e.details
            })
        }).collect::<Vec<_>>(),
        "dbPath": db_path().to_string_lossy().to_string(),
        "timestamp": Utc::now().to_rfc3339()
    })
}
