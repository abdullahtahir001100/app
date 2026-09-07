use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};

use chrono::Local;

#[cfg(windows)]
use windows::UI::Notifications::NotificationKinds;
#[cfg(windows)]
use windows::UI::Notifications::Management::{
    UserNotificationListener,
    UserNotificationListenerAccessStatus,
};

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
    last_notification_id: Mutex<u32>,
    pub rx_channel: broadcast::Sender<SystemNotification>,
}

impl NotificationCapture {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(16);
        Self {
            notifications: Mutex::new(VecDeque::new()),
            max_notifications: 500,
            last_notification_id: Mutex::new(0),
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
    pub fn sync_notifications(&self) {
        let listener = match UserNotificationListener::Current() {
            Ok(v) => v,
            Err(_) => return,
        };

        let notifications = match listener.GetNotificationsAsync(NotificationKinds::Toast) {
            Ok(op) => match op.get() {
                Ok(v) => v,
                Err(_) => return,
            },
            Err(_) => return,
        };

     for notif in notifications {

     // Duplicate notification filter
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
     let mut message = "No Content".to_string();

     if let Ok(notification) = notif.Notification() {
        if let Ok(visual) = notification.Visual() {

            let binding_name =
                windows::UI::Notifications::KnownNotificationBindings::ToastGeneric()
                    .unwrap();

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

                            message = parts.join(" ");
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
        timestamp: Local::now()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
        icon: String::new(),
        category: "toast".to_string(),
    });
}
    }

    #[cfg(not(windows))]
    pub fn sync_notifications(&self) {
        // macOS / Linux: notification center capture or fallback
    }

    #[cfg(windows)]
    pub fn start_listening(self: Arc<Self>) {
        let capture = self.clone();

        std::thread::spawn(move || {
            let listener = match UserNotificationListener::Current() {
                Ok(v) => v,
                Err(_) => return,
            };

            let access = listener
                .RequestAccessAsync()
                .and_then(|op| op.get());

            if access.is_err()
                || access.unwrap()
                    != UserNotificationListenerAccessStatus::Allowed
            {
                return;
            }

            loop {
                capture.sync_notifications();
                std::thread::sleep(std::time::Duration::from_secs(5));
            }
        });
    }

    #[cfg(not(windows))]
    pub fn start_listening(self: Arc<Self>) {
        // Broadcast channel is live for on-demand notifications
    }
}