use chrono::Utc;
use hostname;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio_tungstenite::tungstenite::protocol::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub action: String,
    pub category: String,
    pub status: String,
    pub device: String,
    pub details: String,
    pub metadata: Value,
}

#[derive(Clone)]
pub struct ActivityLogger {
    sender: UnboundedSender<ActivityEvent>,
    device_id: String,
    hostname: String,
}

#[allow(dead_code)]
impl ActivityLogger {
    pub fn init_activity_logger(
        write_tx: UnboundedSender<Message>,
        device_id: String,
    ) -> Arc<Self> {
        let hostname = hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "UNKNOWN_HOST".to_string());

        let (sender, mut receiver) = mpsc::unbounded_channel::<ActivityEvent>();
        let logger = Arc::new(Self {
            sender,
            device_id: device_id.clone(),
            hostname: hostname.clone(),
        });

        let writer = write_tx.clone();
        let worker_logger = logger.clone();
        tokio::spawn(async move {
            while let Some(activity) = receiver.recv().await {
                let payload = json!({
                    "type": "activity_log",
                    "deviceId": worker_logger.device_id,
                    "hostname": worker_logger.hostname,
                    "action": activity.action,
                    "category": activity.category,
                    "status": activity.status,
                    "device": activity.device,
                    "details": activity.details,
                    "metadata": activity.metadata,
                    "createdAt": Utc::now().to_rfc3339(),
                });

                let _ = writer.send(Message::Text(payload.to_string()));
            }
        });

        logger
    }

    pub fn log(
        &self,
        action: &str,
        category: &str,
        status: &str,
        device: &str,
        details: &str,
        metadata: Value,
    ) {
        let event = ActivityEvent {
            action: action.to_string(),
            category: category.to_string(),
            status: status.to_string(),
            device: device.to_string(),
            details: details.to_string(),
            metadata,
        };
        let _ = self.sender.send(event);
    }

    pub fn log_app_opened(&self, device: &str, details: &str, metadata: Value) {
        self.log("app_opened", "application", "success", device, details, metadata);
    }

    pub fn log_app_closed(&self, device: &str, details: &str, metadata: Value) {
        self.log("app_closed", "application", "success", device, details, metadata);
    }

    pub fn log_browser_opened(&self, device: &str, details: &str, metadata: Value) {
        self.log("browser_opened", "browser", "success", device, details, metadata);
    }

    pub fn log_website(&self, device: &str, details: &str, metadata: Value) {
        self.log("website", "browser", "success", device, details, metadata);
    }

    pub fn log_window_changed(&self, device: &str, details: &str, metadata: Value) {
        self.log("window_changed", "application", "success", device, details, metadata);
    }

    pub fn log_video_playback(&self, device: &str, details: &str, metadata: Value) {
        self.log("video_playback", "media", "success", device, details, metadata);
    }

    pub fn log_file_opened(&self, device: &str, details: &str, metadata: Value) {
        self.log("file_opened", "file", "success", device, details, metadata);
    }

    pub fn log_file_downloaded(&self, device: &str, details: &str, metadata: Value) {
        self.log("file_downloaded", "file", "success", device, details, metadata);
    }

    pub fn log_file_uploaded(&self, device: &str, details: &str, metadata: Value) {
        self.log("file_uploaded", "file", "success", device, details, metadata);
    }

    pub fn log_file_deleted(&self, device: &str, details: &str, metadata: Value) {
        self.log("file_deleted", "file", "success", device, details, metadata);
    }

    pub fn log_usb_connected(&self, device: &str, details: &str, metadata: Value) {
        self.log("usb_connected", "hardware", "success", device, details, metadata);
    }

    pub fn log_usb_disconnected(&self, device: &str, details: &str, metadata: Value) {
        self.log("usb_disconnected", "hardware", "success", device, details, metadata);
    }

    pub fn log_screen_locked(&self, device: &str, details: &str, metadata: Value) {
        self.log("screen_locked", "session", "success", device, details, metadata);
    }

    pub fn log_screen_unlocked(&self, device: &str, details: &str, metadata: Value) {
        self.log("screen_unlocked", "session", "success", device, details, metadata);
    }

    pub fn log_system_idle(&self, device: &str, details: &str, metadata: Value) {
        self.log("system_idle", "system", "success", device, details, metadata);
    }

    pub fn log_system_active(&self, device: &str, details: &str, metadata: Value) {
        self.log("system_active", "system", "success", device, details, metadata);
    }

    pub fn log_process_started(&self, device: &str, details: &str, metadata: Value) {
        self.log("process_started", "process", "success", device, details, metadata);
    }

    pub fn log_process_stopped(&self, device: &str, details: &str, metadata: Value) {
        self.log("process_stopped", "process", "success", device, details, metadata);
    }

    pub fn log_clipboard_changed(&self, device: &str, details: &str, metadata: Value) {
        self.log("clipboard_changed", "clipboard", "success", device, details, metadata);
    }

    pub fn log_microphone_started(&self, device: &str, details: &str, metadata: Value) {
        self.log("microphone_started", "audio", "success", device, details, metadata);
    }

    pub fn log_microphone_stopped(&self, device: &str, details: &str, metadata: Value) {
        self.log("microphone_stopped", "audio", "success", device, details, metadata);
    }

    pub fn log_camera_started(&self, device: &str, details: &str, metadata: Value) {
        self.log("camera_started", "video", "success", device, details, metadata);
    }

    pub fn log_camera_stopped(&self, device: &str, details: &str, metadata: Value) {
        self.log("camera_stopped", "video", "success", device, details, metadata);
    }

    pub fn log_wifi_connected(&self, device: &str, details: &str, metadata: Value) {
        self.log("wifi_connected", "network", "success", device, details, metadata);
    }

    pub fn log_wifi_disconnected(&self, device: &str, details: &str, metadata: Value) {
        self.log("wifi_disconnected", "network", "success", device, details, metadata);
    }

    pub fn log_vpn_connected(&self, device: &str, details: &str, metadata: Value) {
        self.log("vpn_connected", "network", "success", device, details, metadata);
    }

    pub fn log_vpn_disconnected(&self, device: &str, details: &str, metadata: Value) {
        self.log("vpn_disconnected", "network", "success", device, details, metadata);
    }

    pub fn log_bluetooth_connected(&self, device: &str, details: &str, metadata: Value) {
        self.log("bluetooth_connected", "network", "success", device, details, metadata);
    }

    pub fn log_bluetooth_disconnected(&self, device: &str, details: &str, metadata: Value) {
        self.log("bluetooth_disconnected", "network", "success", device, details, metadata);
    }

    pub fn log_printer_used(&self, device: &str, details: &str, metadata: Value) {
        self.log("printer_used", "hardware", "success", device, details, metadata);
    }

    pub fn log_screenshot_taken(&self, device: &str, details: &str, metadata: Value) {
        self.log("screenshot_taken", "screen", "success", device, details, metadata);
    }

    pub fn log_notification_received(&self, device: &str, details: &str, metadata: Value) {
        self.log("notification_received", "notification", "success", device, details, metadata);
    }

    pub fn log_power_connected(&self, device: &str, details: &str, metadata: Value) {
        self.log("power_connected", "power", "success", device, details, metadata);
    }

    pub fn log_power_disconnected(&self, device: &str, details: &str, metadata: Value) {
        self.log("power_disconnected", "power", "success", device, details, metadata);
    }

    pub fn log_shutdown(&self, device: &str, details: &str, metadata: Value) {
        self.log("shutdown", "system", "success", device, details, metadata);
    }

    pub fn log_restart(&self, device: &str, details: &str, metadata: Value) {
        self.log("restart", "system", "success", device, details, metadata);
    }

    pub fn log_sleep(&self, device: &str, details: &str, metadata: Value) {
        self.log("sleep", "system", "success", device, details, metadata);
    }

    pub fn log_wakeup(&self, device: &str, details: &str, metadata: Value) {
        self.log("wakeup", "system", "success", device, details, metadata);
    }

    pub fn log_login(&self, device: &str, details: &str, metadata: Value) {
        self.log("login", "session", "success", device, details, metadata);
    }

    pub fn log_logout(&self, device: &str, details: &str, metadata: Value) {
        self.log("logout", "session", "success", device, details, metadata);
    }

    pub fn log_rdp_connected(&self, device: &str, details: &str, metadata: Value) {
        self.log("rdp_connected", "network", "success", device, details, metadata);
    }

    pub fn log_rdp_disconnected(&self, device: &str, details: &str, metadata: Value) {
        self.log("rdp_disconnected", "network", "success", device, details, metadata);
    }
}
