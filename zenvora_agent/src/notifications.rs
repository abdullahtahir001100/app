use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};

use chrono::Local;

#[cfg(windows)]
use windows::UI::Notifications::NotificationKinds;
#[cfg(windows)]
use windows::UI::Notifications::Management::UserNotificationListener;

pub static GLOBAL_NOTIFIER: OnceLock<Arc<NotificationCapture>> = OnceLock::new();

pub fn global_notifier() -> Arc<NotificationCapture> {
    GLOBAL_NOTIFIER
        .get_or_init(|| Arc::new(NotificationCapture::new()))
        .clone()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemNotification {
    pub app: String,
    pub title: String,
    pub message: String,
    pub timestamp: String,
    pub icon: String,
    pub category: String,
}

use tokio::sync::broadcast;

pub struct NotificationCapture {
    notifications: Mutex<VecDeque<SystemNotification>>,
    max_notifications: usize,
    #[allow(dead_code)]
    last_notification_id: Mutex<u32>,
    #[allow(dead_code)]
    last_wpn_id: Mutex<i64>,
    #[allow(dead_code)]
    last_wpn_mtime: Mutex<Option<std::time::SystemTime>>,
    pub rx_channel: broadcast::Sender<SystemNotification>,
}

#[cfg(windows)]
fn get_wpn_database_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = std::path::PathBuf::from(local).join(r"Microsoft\Windows\Notifications\wpndatabase.db");
        if p.exists() {
            paths.push(p);
        }
    }
    if let Ok(entries) = std::fs::read_dir(r"C:\Users") {
        for entry in entries.flatten() {
            let p = entry.path().join(r"AppData\Local\Microsoft\Windows\Notifications\wpndatabase.db");
            if p.exists() && !paths.contains(&p) {
                paths.push(p);
            }
        }
    }
    paths
}

#[allow(dead_code)]
fn parse_toast_xml(xml: &str) -> (String, String) {
    if xml.is_empty() {
        return (String::new(), String::new());
    }
    let mut texts = Vec::new();
    let mut cursor = xml;
    while let Some(start_tag) = cursor.find("<text") {
        let after_tag = &cursor[start_tag..];
        if let Some(tag_close) = after_tag.find('>') {
            let content_start = &after_tag[tag_close + 1..];
            if let Some(end_tag) = content_start.find("</text>") {
                let text_val = &content_start[..end_tag];
                let cleaned = text_val
                    .replace("&amp;", "&")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&quot;", "\"")
                    .replace("&apos;", "'")
                    .trim()
                    .to_string();
                if !cleaned.is_empty() {
                    texts.push(cleaned);
                }
                cursor = &content_start[end_tag + 7..];
            } else {
                break;
            }
        } else {
            break;
        }
    }

    if texts.is_empty() {
        let plain = xml
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace() || ",.-:!?@#/()_".contains(*c))
            .collect::<String>();
        let trimmed = plain.trim();
        if !trimmed.is_empty() {
            return (trimmed.to_string(), String::new());
        }
        return (String::new(), String::new());
    }

    let title = texts[0].clone();
    let message = if texts.len() > 1 {
        texts[1..].join(" — ")
    } else {
        String::new()
    };
    (title, message)
}

#[allow(dead_code)]
fn clean_app_name(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("chrome") {
        "Google Chrome".to_string()
    } else if lower.contains("edge") {
        "Microsoft Edge".to_string()
    } else if lower.contains("whatsapp") {
        "WhatsApp".to_string()
    } else if lower.contains("telegram") {
        "Telegram".to_string()
    } else if lower.contains("slack") {
        "Slack".to_string()
    } else if lower.contains("discord") {
        "Discord".to_string()
    } else if lower.contains("outlook") {
        "Microsoft Outlook".to_string()
    } else if lower.contains("skype") {
        "Skype".to_string()
    } else if lower.contains("teams") {
        "Microsoft Teams".to_string()
    } else if lower.contains("spotify") {
        "Spotify".to_string()
    } else if lower.contains("firefox") {
        "Mozilla Firefox".to_string()
    } else {
        let parts: Vec<&str> = raw.split(['.', '!', '\\', '/']).collect();
        for part in parts.iter().rev() {
            let p = part.trim();
            if !p.is_empty() && !p.eq_ignore_ascii_case("exe") && !p.eq_ignore_ascii_case("app") {
                return p.to_string();
            }
        }
        "System".to_string()
    }
}

impl NotificationCapture {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(64);
        Self {
            notifications: Mutex::new(VecDeque::new()),
            max_notifications: 500,
            last_notification_id: Mutex::new(0),
            last_wpn_id: Mutex::new(0),
            last_wpn_mtime: Mutex::new(None),
            rx_channel: tx,
        }
    }

    pub fn add_notification(&self, notification: SystemNotification) {
        if let Ok(mut notifs) = self.notifications.lock() {
            notifs.push_back(notification.clone());

            if notifs.len() > self.max_notifications {
                notifs.pop_front();
            }
        }
        let _ = self.rx_channel.send(notification);
    }

    pub fn get_recent(&self, limit: usize) -> Vec<SystemNotification> {
        if let Ok(notifs) = self.notifications.lock() {
            notifs.iter().rev().take(limit).cloned().collect()
        } else {
            Vec::new()
        }
    }

    #[cfg(windows)]
    pub fn sync_wpn_database(&self) {
        let db_paths = get_wpn_database_paths();
        for db_path in db_paths {
            if !db_path.exists() {
                continue;
            }

            // Zero-overhead check: only copy and read if the file was modified since last check
            if let Ok(meta) = db_path.metadata() {
                if let Ok(mtime) = meta.modified() {
                    let mut last = self.last_wpn_mtime.lock().unwrap();
                    if *last == Some(mtime) {
                        continue;
                    }
                    *last = Some(mtime);
                }
            }

            let temp_db = std::env::temp_dir().join(format!(
                "zenvora_tmp_wpn_{}_{}.db",
                std::process::id(),
                chrono::Utc::now().timestamp_millis() % 100000
            ));
            if std::fs::copy(&db_path, &temp_db).is_err() {
                continue;
            }
            let wal_src = std::path::PathBuf::from(format!("{}-wal", db_path.display()));
            if wal_src.exists() {
                let wal_dst = std::path::PathBuf::from(format!("{}-wal", temp_db.display()));
                let _ = std::fs::copy(&wal_src, &wal_dst);
            }

            let conn = match rusqlite::Connection::open(&temp_db) {
                Ok(c) => c,
                Err(_) => {
                    let _ = std::fs::remove_file(&temp_db);
                    continue;
                }
            };

            let mut last_id = self.last_wpn_id.lock().unwrap();

            let query_res = conn.prepare(
                "SELECT n.Id, COALESCE(h.PrimaryId, 'System') as app_id, n.Payload \
                 FROM Notification n \
                 LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId \
                 WHERE n.Id > ?1 ORDER BY n.Id ASC LIMIT 50",
            );

            let notifications: Vec<(i64, String, String, String)> = match query_res {
                Ok(mut stmt) => {
                    let rows = stmt.query_map([*last_id], |row| {
                        let id: i64 = row.get(0)?;
                        let app_id: String = row.get(1).unwrap_or_else(|_| "System".to_string());
                        let payload: rusqlite::types::Value = row.get(2)?;
                        let raw_xml = match payload {
                            rusqlite::types::Value::Text(s) => s,
                            rusqlite::types::Value::Blob(b) => String::from_utf8_lossy(&b).to_string(),
                            _ => String::new(),
                        };
                        Ok((id, app_id, raw_xml))
                    });
                    if let Ok(rows) = rows {
                        rows.filter_map(|r| r.ok())
                            .filter_map(|(id, app_id, xml)| {
                                let (title, msg) = parse_toast_xml(&xml);
                                if !title.is_empty() || !msg.is_empty() {
                                    let app = clean_app_name(&app_id);
                                    Some((id, app, title, msg))
                                } else {
                                    None
                                }
                            })
                            .collect()
                    } else {
                        Vec::new()
                    }
                }
                Err(_) => {
                    if let Ok(mut stmt) = conn.prepare("SELECT Id, Payload FROM Notification WHERE Id > ?1 ORDER BY Id ASC LIMIT 50") {
                        let rows = stmt.query_map([*last_id], |row| {
                            let id: i64 = row.get(0)?;
                            let payload: rusqlite::types::Value = row.get(1)?;
                            let raw_xml = match payload {
                                rusqlite::types::Value::Text(s) => s,
                                rusqlite::types::Value::Blob(b) => String::from_utf8_lossy(&b).to_string(),
                                _ => String::new(),
                            };
                            Ok((id, "System".to_string(), raw_xml))
                        });
                        if let Ok(rows) = rows {
                            rows.filter_map(|r| r.ok())
                                .filter_map(|(id, app_id, xml)| {
                                    let (title, msg) = parse_toast_xml(&xml);
                                    if !title.is_empty() || !msg.is_empty() {
                                        Some((id, app_id, title, msg))
                                    } else {
                                        None
                                    }
                                })
                                .collect()
                        } else {
                            Vec::new()
                        }
                    } else {
                        Vec::new()
                    }
                }
            };

            for (id, app, title, message) in notifications {
                if id > *last_id {
                    *last_id = id;
                }
                self.add_notification(SystemNotification {
                    app,
                    title,
                    message,
                    timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                    icon: String::new(),
                    category: "toast".to_string(),
                });
            }

            drop(conn);
            let _ = std::fs::remove_file(&temp_db);
            let wal_temp = std::path::PathBuf::from(format!("{}-wal", temp_db.display()));
            let _ = std::fs::remove_file(wal_temp);
        }
    }

    #[cfg(windows)]
    pub fn sync_notifications(&self) {
        if let Ok(listener) = UserNotificationListener::Current() {
            if let Ok(op) = listener.GetNotificationsAsync(NotificationKinds::Toast) {
                if let Ok(notifications) = op.get() {
                    for notif in notifications {
                        let notif_id = notif.Id().unwrap_or(0);
                        {
                            let mut last_id = self.last_notification_id.lock().unwrap();
                            if notif_id <= *last_id {
                                continue;
                            }
                            *last_id = notif_id;
                        }

                        let app_name = notif
                            .AppInfo()
                            .ok()
                            .and_then(|app| {
                                app.DisplayInfo()
                                    .ok()
                                    .and_then(|d| d.DisplayName().ok())
                            })
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "Unknown App".to_string());

                        let mut title = "Notification".to_string();
                        let mut message = String::new();

                        if let Ok(notification) = notif.Notification() {
                            if let Ok(visual) = notification.Visual() {
                                if let Ok(binding_name) = windows::UI::Notifications::KnownNotificationBindings::ToastGeneric() {
                                    if let Ok(binding) = visual.GetBinding(&binding_name) {
                                        if let Ok(text_elements) = binding.GetTextElements() {
                                            if let Ok(count) = text_elements.Size() {
                                                if count > 0 {
                                                    if let Ok(element) = text_elements.GetAt(0) {
                                                        if let Ok(text) = element.Text() {
                                                            title = text.to_string();
                                                        }
                                                    }
                                                }
                                                if count > 1 {
                                                    let mut parts = Vec::new();
                                                    for i in 1..count {
                                                        if let Ok(element) = text_elements.GetAt(i) {
                                                            if let Ok(text) = element.Text() {
                                                                parts.push(text.to_string());
                                                            }
                                                        }
                                                    }
                                                    message = parts.join(" — ");
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        self.add_notification(SystemNotification {
                            app: app_name,
                            title,
                            message,
                            timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                            icon: String::new(),
                            category: "toast".to_string(),
                        });
                    }
                }
            }
        }

        self.sync_wpn_database();
    }

    #[cfg(not(windows))]
    pub fn sync_notifications(&self) {
        // Ready for system notifications
    }

    #[cfg(windows)]
    pub fn start_listening(self: Arc<Self>) {
        let capture = self.clone();

        std::thread::spawn(move || {
            if let Ok(listener) = UserNotificationListener::Current() {
                let _ = listener.RequestAccessAsync();
            }

            loop {
                capture.sync_notifications();
                std::thread::sleep(std::time::Duration::from_millis(3500));
            }
        });
    }

    #[cfg(not(windows))]
    pub fn start_listening(self: Arc<Self>) {
        let capture = self.clone();
        std::thread::spawn(move || {
            loop {
                capture.sync_notifications();
                std::thread::sleep(std::time::Duration::from_millis(3000));
            }
        });
    }
}