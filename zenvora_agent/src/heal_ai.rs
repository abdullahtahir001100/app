//! On-device heal / environment analyzer for the Windows agent.
//! Dashboard can dispatch HEAL_ANALYZE, HEAL_FIX, HEAL_RUN without waiting for a live LLM.

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn run_capture(program: &str, args: &[&str]) -> (bool, String) {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.output() {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stdout).to_string();
            if !out.stderr.is_empty() {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(&String::from_utf8_lossy(&out.stderr));
            }
            (out.status.success(), text.trim().to_string())
        }
        Err(e) => (false, e.to_string()),
    }
}

fn browser_profile_dirs() -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if local.is_empty() {
        return out;
    }
    let candidates = [
        ("Chrome", format!(r"{}\Google\Chrome\User Data", local)),
        ("Edge", format!(r"{}\Microsoft\Edge\User Data", local)),
        ("Brave", format!(r"{}\BraveSoftware\Brave-Browser\User Data", local)),
    ];
    for (name, path) in candidates {
        let p = PathBuf::from(&path);
        if p.is_dir() {
            out.push((name.to_string(), p));
        }
    }
    out
}

fn count_history_rows() -> usize {
    crate::browser_history::BrowserHistoryCollector::collect_all_history().len()
}

fn count_app_rows() -> usize {
    crate::app_history::AppHistoryCollector::collect_all_app_history().len()
}

fn count_notifications() -> usize {
    crate::notifications::global_notifier().get_recent(50).len()
}

fn service_running() -> bool {
    let (ok, out) = run_capture(
        "sc.exe",
        &["query", "ZenvoraAgent"],
    );
    ok && out.to_uppercase().contains("RUNNING")
}

fn analyze_environment() -> Value {
    let profiles = browser_profile_dirs();
    let browser_count = count_history_rows();
    let app_count = count_app_rows();
    let notif_count = count_notifications();
    let service_ok = service_running();

    let mut issues = Vec::new();
    let mut recommendations = Vec::new();

    if profiles.is_empty() {
        issues.push("No Chrome/Edge/Brave profile folders found under LOCALAPPDATA.".to_string());
        recommendations.push("Install a browser or open it once so history DBs exist.".to_string());
    } else if browser_count == 0 {
        issues.push("Browser profiles exist but collector returned 0 history rows.".to_string());
        recommendations.push("Close Chrome/Edge fully then run HEAL_FIX topic=browser, or open a few sites and FETCH_BROWSER_HISTORY.".to_string());
    }

    if app_count == 0 {
        issues.push("App history collector returned 0 rows.".to_string());
        recommendations.push("Use a few apps in the foreground, then FETCH_APP_HISTORY / HEAL_FIX topic=apps.".to_string());
    }

    if notif_count == 0 {
        issues.push("No recent system notifications in the agent buffer.".to_string());
        recommendations.push("Trigger a toast notification, ensure agent runs in interactive session (not Session 0), then HEAL_FIX topic=notifications.".to_string());
    }

    if !service_ok {
        issues.push("ZenvoraAgent Windows service is not RUNNING (or not installed).".to_string());
        recommendations.push("HEAL_FIX topic=service will attempt sc start / reinstall path.".to_string());
    }

    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    let username = whoami::username();

    json!({
        "hostname": hostname,
        "username": username,
        "localAppData": std::env::var("LOCALAPPDATA").unwrap_or_default(),
        "browserProfiles": profiles.iter().map(|(n, p)| json!({
            "browser": n,
            "path": p.to_string_lossy(),
            "exists": true
        })).collect::<Vec<_>>(),
        "counts": {
            "browserHistory": browser_count,
            "appHistory": app_count,
            "notifications": notif_count
        },
        "serviceRunning": service_ok,
        "issues": issues,
        "recommendations": recommendations,
        "healthy": issues.is_empty()
    })
}

fn fix_browser() -> Value {
    let data = crate::history_commands::HistoryCommand::execute_fetch_browser_history();
    let entries = data.get("entries").and_then(|v| v.as_u64()).unwrap_or(0);
    json!({
        "topic": "browser",
        "actions": ["FETCH_BROWSER_HISTORY"],
        "entries": entries,
        "ok": entries > 0,
        "message": if entries > 0 {
            format!("Browser history refreshed ({} rows).", entries)
        } else {
            "Browser history still empty after refresh.".to_string()
        },
        "payload": data
    })
}

fn fix_apps() -> Value {
    let data = crate::history_commands::HistoryCommand::execute_fetch_app_history();
    let entries = data.get("entries").and_then(|v| v.as_u64()).unwrap_or(0);
    json!({
        "topic": "apps",
        "actions": ["FETCH_APP_HISTORY"],
        "entries": entries,
        "ok": entries > 0,
        "message": if entries > 0 {
            format!("App history refreshed ({} rows).", entries)
        } else {
            "App history still empty after refresh.".to_string()
        },
        "payload": data
    })
}

fn fix_notifications() -> Value {
    // Ensure listener is alive, then dump buffer.
    crate::notifications::global_notifier().start_listening();
    let data = crate::history_commands::HistoryCommand::execute_fetch_notifications();
    let entries = data.get("entries").and_then(|v| v.as_u64()).unwrap_or(0);
    json!({
        "topic": "notifications",
        "actions": ["START_NOTIFICATION_LISTENER", "FETCH_SYSTEM_NOTIFICATIONS"],
        "entries": entries,
        "ok": true,
        "message": format!("Notification listener pulsed; buffer has {} items.", entries),
        "payload": data
    })
}

fn fix_service() -> Value {
    let (query_ok, query_out) = run_capture("sc.exe", &["query", "ZenvoraAgent"]);
    if query_ok && query_out.to_uppercase().contains("RUNNING") {
        return json!({
            "topic": "service",
            "ok": true,
            "message": "Service already RUNNING.",
            "detail": query_out
        });
    }
    let (start_ok, start_out) = run_capture("sc.exe", &["start", "ZenvoraAgent"]);
    json!({
        "topic": "service",
        "ok": start_ok || start_out.to_uppercase().contains("RUNNING"),
        "message": if start_ok { "Service start issued." } else { "Service start attempted." },
        "detail": format!("{}\n{}", query_out, start_out)
    })
}

fn fix_environment() -> Value {
    // Best-effort: ensure agent data dir exists and preference file is writable.
    let mut steps = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let dir = PathBuf::from(local).join("Zenvora");
        match fs::create_dir_all(&dir) {
            Ok(()) => steps.push(json!({ "step": "ensure_data_dir", "ok": true, "path": dir })),
            Err(e) => steps.push(json!({ "step": "ensure_data_dir", "ok": false, "error": e.to_string() })),
        }
    }
    steps.push(json!({ "step": "notification_listener", "result": fix_notifications() }));
    steps.push(json!({ "step": "browser_history", "result": fix_browser() }));
    steps.push(json!({ "step": "app_history", "result": fix_apps() }));
    steps.push(json!({ "step": "service", "result": fix_service() }));
    json!({
        "topic": "environment",
        "ok": true,
        "message": "Environment heal pass completed.",
        "steps": steps
    })
}

fn run_raw_command(command: &str) -> Value {
    let cmd = command.trim();
    if cmd.is_empty() {
        return json!({ "ok": false, "message": "Empty command." });
    }
    #[cfg(windows)]
    {
        let mut c = Command::new("cmd.exe");
        c.args(["/C", cmd]);
        c.creation_flags(CREATE_NO_WINDOW);
        match c.output() {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                json!({
                    "ok": out.status.success(),
                    "command": cmd,
                    "stdout": stdout,
                    "stderr": stderr,
                    "exitCode": out.status.code()
                })
            }
            Err(e) => json!({ "ok": false, "command": cmd, "error": e.to_string() }),
        }
    }
    #[cfg(not(windows))]
    {
        match Command::new("sh").args(["-c", cmd]).output() {
            Ok(out) => json!({
                "ok": out.status.success(),
                "command": cmd,
                "stdout": String::from_utf8_lossy(&out.stdout),
                "stderr": String::from_utf8_lossy(&out.stderr),
                "exitCode": out.status.code()
            }),
            Err(e) => json!({ "ok": false, "command": cmd, "error": e.to_string() }),
        }
    }
}

pub fn is_heal_action(action: &str) -> bool {
    matches!(
        action,
        "HEAL_ANALYZE" | "HEAL_FIX" | "HEAL_RUN" | "AGENT_AI_STATUS"
    )
}

pub fn handle_heal_command(action: &str, payload: &Value) -> Option<crate::commands::CommandResponse> {
    if !is_heal_action(action) {
        return None;
    }

    let body = match action {
        "HEAL_ANALYZE" | "AGENT_AI_STATUS" => {
            let analysis = analyze_environment();
            json!({
                "type": "heal_result",
                "action": action,
                "success": true,
                "analysis": analysis
            })
        }
        "HEAL_FIX" => {
            let mut topic = payload
                .get("topic")
                .or_else(|| payload.get("target"))
                .and_then(|v| v.as_str())
                .unwrap_or("environment")
                .to_lowercase();
            if matches!(topic.as_str(), "all" | "env") {
                topic = "environment".to_string();
            }
            let result = match topic.as_str() {
                "browser" | "browser_history" | "history" => fix_browser(),
                "apps" | "app" | "app_history" | "usage" => fix_apps(),
                "notifications" | "notif" | "toast" => fix_notifications(),
                "service" => fix_service(),
                _ => fix_environment(),
            };
            json!({
                "type": "heal_result",
                "action": "HEAL_FIX",
                "success": result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
                "topic": topic,
                "result": result,
                "analysis": analyze_environment()
            })
        }
        "HEAL_RUN" => {
            let command = payload
                .get("command")
                .or_else(|| payload.get("cmd"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let result = run_raw_command(command);
            json!({
                "type": "heal_result",
                "action": "HEAL_RUN",
                "success": result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
                "result": result
            })
        }
        _ => return None,
    };

    Some(crate::commands::CommandResponse {
        json: body,
        frame: None,
        frame_kind: 0,
    })
}
