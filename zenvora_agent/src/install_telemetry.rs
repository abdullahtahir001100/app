//! Live install/provision logs → dashboard (HTTP + optional WSS).

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde_json::json;
use tokio::runtime::Runtime;
use tokio::sync::mpsc;

#[derive(Clone, Debug)]
struct InstallCreds {
    api_base: String,
    #[allow(dead_code)]
    gateway_url: String,
    pair_token: String,
    pair_user_id: String,
    session_id: String,
    hostname: String,
}

#[derive(Clone, Debug)]
struct LogEvent {
    step: u32,
    total: u32,
    state: String,
    message: String,
    final_event: bool,
}

static CREDS: Mutex<Option<InstallCreds>> = Mutex::new(None);
static TX: Mutex<Option<mpsc::UnboundedSender<LogEvent>>> = Mutex::new(None);

fn hostname_now() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "PC".into())
}

pub fn configure(api_base: &str, gateway_url: &str, pair_token: &str, pair_user_id: &str, session_id: &str) {
    if pair_token.is_empty() || pair_user_id.is_empty() {
        return;
    }

    let creds = InstallCreds {
        api_base: api_base.trim_end_matches('/').to_string(),
        gateway_url: gateway_url.to_string(),
        pair_token: pair_token.to_string(),
        pair_user_id: pair_user_id.to_string(),
        session_id: if session_id.is_empty() {
            format!("sess-{}", chrono::Local::now().format("%Y%m%d%H%M%S"))
        } else {
            session_id.to_string()
        },
        hostname: hostname_now(),
    };

    if let Ok(mut slot) = CREDS.lock() {
        *slot = Some(creds.clone());
    }

    ensure_worker();
    emit(0, 8, "ok", "Install telemetry linked to dashboard");
}

fn ensure_worker() {
    let mut tx_guard = match TX.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if tx_guard.is_some() {
        return;
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<LogEvent>();
    *tx_guard = Some(tx);
    drop(tx_guard);

    thread::spawn(move || {
        let rt = match Runtime::new() {
            Ok(rt) => rt,
            Err(_) => return,
        };
        rt.block_on(async move {
            while let Some(event) = rx.recv().await {
                let mut batch = vec![event];
                while batch.len() < 8 {
                    match rx.try_recv() {
                        Ok(e) => batch.push(e),
                        Err(_) => break,
                    }
                }
                let creds = CREDS.lock().ok().and_then(|g| g.clone());
                let Some(creds) = creds else { continue };
                for event in batch {
                    let _ = post_http(&creds, &event).await;
                }
            }
        });
    });
}

fn emit(step: u32, total: u32, state: &str, message: &str) {
    emit_final(step, total, state, message, false);
}

fn emit_final(step: u32, total: u32, state: &str, message: &str, final_event: bool) {
    ensure_worker();
    let event = LogEvent {
        step,
        total,
        state: state.to_string(),
        message: message.to_string(),
        final_event,
    };
    if let Ok(guard) = TX.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(event);
        }
    }
}

pub fn step(index: u32, total: u32, message: &str, state: &str) {
    emit(index, total, state, message);
}

pub fn finish_success(message: &str) {
    emit_final(8, 8, "ok", message, true);
}

pub fn finish_failed(message: &str) {
    emit_final(8, 8, "fail", message, true);
}

pub fn finish_warning(message: &str) {
    emit_final(8, 8, "warn", message, true);
}

async fn post_http(creds: &InstallCreds, event: &LogEvent) -> Result<(), String> {
    let url = format!("{}/api/install-logs", creds.api_base);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let body = json!({
        "pairingToken": creds.pair_token,
        "pairingUserId": creds.pair_user_id,
        "sessionId": creds.session_id,
        "step": event.step,
        "total": event.total,
        "state": event.state,
        "message": event.message,
        "hostname": creds.hostname,
        "final": event.final_event,
    });

    let resp = client
        .post(&url)
        .header("User-Agent", "Zenvora-Agent-Install/1.0")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(())
}

/// Parse CLI/env for telemetry bootstrap.
pub fn configure_from_args(args: &[String]) {
    let get_flag = |name: &str| -> Option<String> {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1).cloned())
            .filter(|v| !v.trim().is_empty())
    };

    let token = get_flag("--pair-token")
        .or_else(|| std::env::var("ZENVORA_PAIR_TOKEN").ok())
        .unwrap_or_default();
    let user_id = get_flag("--pair-user-id")
        .or_else(|| std::env::var("ZENVORA_PAIR_USER_ID").ok())
        .unwrap_or_default();
    if token.is_empty() || user_id.is_empty() {
        return;
    }

    let api = get_flag("--api-url")
        .or_else(|| std::env::var("ZENVORA_API_URL").ok())
        .unwrap_or_else(|| "http://localhost:3000".into());
    let gw = get_flag("--gateway-url")
        .or_else(|| std::env::var("ZENVORA_GATEWAY_URL").ok())
        .unwrap_or_else(|| format!("{}/ws/gateway", api.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1)));
    let session = get_flag("--install-session").unwrap_or_default();

    configure(&api, &gw, &token, &user_id, &session);
}
