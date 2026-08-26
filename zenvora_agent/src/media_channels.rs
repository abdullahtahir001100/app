//! Dedicated media channels (screen / camera) over WebSocket `/ws/media`.
//! Manual transport preference only (`PREFERRED_MEDIA_TRANSPORT` / SET_PREFERRED_MEDIA_TRANSPORT).
//! No auto-failover between WSS and TCP.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{broadcast, mpsc};
use tokio::time::{interval, sleep, MissedTickBehavior};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message, MaybeTlsStream};
use url::Url;

use crate::config::AgentConfig;
use crate::connection_status;
use crate::protocol::{
    control_addr_from_gateway, encode_frame, encode_json_frame, FrameParser, MsgType,
};

const DEFAULT_CONTROL_PORT: u16 = 9443;
const MAX_BACKOFF_SECS: u64 = 30;
const HEARTBEAT_SECS: u64 = 25;

/// 0 = wss (default), 1 = tcp
static MEDIA_TRANSPORT_PREF: AtomicU8 = AtomicU8::new(0);

pub fn init_media_transport_from_env() {
    let v = std::env::var("PREFERRED_MEDIA_TRANSPORT").unwrap_or_else(|_| "wss".into());
    set_preferred_media_transport(&v);
}

pub fn set_preferred_media_transport(value: &str) {
    let next = match value.trim().to_lowercase().as_str() {
        "tcp" => 1u8,
        _ => 0u8,
    };
    MEDIA_TRANSPORT_PREF.store(next, Ordering::SeqCst);
    connection_status::log(format!(
        "Media transport preference set to {}",
        if next == 1 { "tcp" } else { "wss" }
    ));
}

pub fn preferred_media_transport() -> &'static str {
    if MEDIA_TRANSPORT_PREF.load(Ordering::SeqCst) == 1 {
        "tcp"
    } else {
        "wss"
    }
}

fn prefer_tcp() -> bool {
    MEDIA_TRANSPORT_PREF.load(Ordering::SeqCst) == 1
}

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
    control_addr_from_gateway(&config.gateway_url, DEFAULT_CONTROL_PORT)
}

fn resolve_ws_media_url(config: &AgentConfig) -> Option<String> {
    let base = config.gateway_url.trim();
    if base.is_empty() {
        return None;
    }
    let mut media = if base.contains("/ws/gateway") {
        base.replace("/ws/gateway", "/ws/media")
    } else if base.ends_with('/') {
        format!("{base}ws/media")
    } else {
        format!("{base}/ws/media")
    };
    // Local plain HTTP gateways cannot speak TLS — never use wss://localhost.
    if media.contains("://localhost") || media.contains("://127.0.0.1") {
        media = media.replacen("wss://", "ws://", 1);
    }
    Some(media)
}

pub struct MediaChannel {
    pub tx: mpsc::Sender<Vec<u8>>,
    pub ack_rx: broadcast::Receiver<Value>,
}

pub fn spawn_media_channel(
    config: Arc<AgentConfig>,
    channel_name: String,
    stop_flag: Option<Arc<AtomicBool>>,
) -> MediaChannel {
    // Small buffer: with the latest-frame-wins drain in the media loop, a deep
    // queue only adds latency. Keep just enough slack to absorb scheduling jitter.
    let (tx, rx) = mpsc::channel::<Vec<u8>>(6);
    let (ack_tx, ack_rx) = broadcast::channel::<Value>(16);
    let outbound_tx = tx.clone();

    tokio::spawn(async move {
        run_media_loop(config, channel_name, stop_flag, rx, ack_tx).await;
    });

    // Keep a clone of tx alive via MediaChannel; drop of unused outbound_tx is fine
    let _ = outbound_tx;
    MediaChannel { tx, ack_rx }
}

async fn run_media_loop(
    config: Arc<AgentConfig>,
    channel_name: String,
    stop_flag: Option<Arc<AtomicBool>>,
    mut payload_rx: mpsc::Receiver<Vec<u8>>,
    ack_tx: broadcast::Sender<Value>,
) {
    let mut backoff = 1u64;
    let mut seq_out: u64 = 1;

    loop {
        if stop_flag.as_ref().is_some_and(|f| f.load(Ordering::SeqCst)) {
            break;
        }

        let mut connected = false;
        let use_tcp = prefer_tcp();

        // Manual preference only — never auto-flip to the other transport.
        if !use_tcp {
        if let Some(ws_url) = resolve_ws_media_url(&config) {
            connection_status::log(format!(
                "Media WS ({channel_name}) connecting {ws_url}"
            ));
            if let Ok(url) = Url::parse(&ws_url) {
                if let Ok((ws_stream, _)) = connect_async(url).await {
                    // Low-latency: kill Nagle on the underlying TCP socket so small
                    // JPEG frames flush the instant they're written (plain ws:// only;
                    // a TLS-wrapped socket is left untouched). Removes tens of ms of
                    // coalescing delay on every frame.
                    if let MaybeTlsStream::Plain(tcp) = ws_stream.get_ref() {
                        let _ = tcp.set_nodelay(true);
                    }

                    let (mut write_pipe, mut read_pipe) = ws_stream.split();
                    // Server → agent traffic (auth-ok / acks) and inbound pings are
                    // rare, so unbounded channels for THEM are fine. Media frames are
                    // deliberately NOT queued here — they are written straight to the
                    // socket with backpressure (below), so the agent can never fall
                    // several seconds behind the live screen.
                    let (read_tx, mut read_rx) = mpsc::unbounded_channel::<Vec<u8>>();
                    let (ping_tx, mut ping_rx) = mpsc::unbounded_channel::<Vec<u8>>();

                    seq_out += 1;
                    let auth = json!({
                        "deviceId": config.device_id,
                        "token": config.agent_token,
                        "channel": channel_name,
                    });
                    let auth_frame = encode_json_frame(MsgType::Auth, seq_out, &auth);
                    if write_pipe.send(Message::Binary(auth_frame)).await.is_err() {
                        sleep(Duration::from_secs(backoff)).await;
                        backoff = next_backoff(backoff);
                        continue;
                    }

                    let reader_task = tokio::spawn(async move {
                        while let Some(msg) = read_pipe.next().await {
                            match msg {
                                Ok(Message::Binary(bin)) => {
                                    if read_tx.send(bin).is_err() {
                                        break;
                                    }
                                }
                                Ok(Message::Ping(payload)) => {
                                    // Forward to the main loop (it owns write_pipe and
                                    // replies with a Pong — a missing pong makes the
                                    // server terminate us with closeCode 1006).
                                    if ping_tx.send(payload).is_err() {
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
                    let mut parser = FrameParser::new();
                    let mut authed = false;
                    let mut heartbeat = interval(Duration::from_secs(HEARTBEAT_SECS));
                    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);

                    loop {
                        if stop_flag.as_ref().is_some_and(|f| f.load(Ordering::SeqCst)) {
                            break;
                        }

                        tokio::select! {
                            chunk = read_rx.recv() => {
                                let Some(chunk) = chunk else { break; };
                                let frames = parser.push(&chunk);
                                for frame in frames {
                                    match frame.msg_type {
                                        MsgType::AuthOk => {
                                            authed = true;
                                            connection_status::log(format!(
                                                "Media WS AUTH_OK ({channel_name})"
                                            ));
                                        }
                                        MsgType::AuthFail => {
                                            connection_status::log(format!(
                                                "Media WS AUTH_FAIL ({channel_name})"
                                            ));
                                            break;
                                        }
                                        MsgType::MediaAck => {
                                            if let Ok(body) =
                                                serde_json::from_slice::<Value>(&frame.payload)
                                            {
                                                let _ = ack_tx.send(body);
                                            }
                                        }
                                        MsgType::HeartbeatAck => {}
                                        _ => {}
                                    }
                                }
                            }
                            payload = payload_rx.recv(), if authed => {
                                let Some(mut payload) = payload else { break; };
                                // Latest-frame-wins: if the encoder ran ahead of the
                                // socket, jump straight to the newest queued frame and
                                // discard the stale ones — the viewer always sees "now",
                                // never a growing backlog.
                                while let Ok(newer) = payload_rx.try_recv() {
                                    payload = newer;
                                }
                                seq_out += 1;
                                let frame = encode_frame(MsgType::MediaFrame, seq_out, &payload, 0);
                                // Direct, backpressured write: if the socket is slow
                                // this awaits, payload_rx fills, and the capture side
                                // drops frames — bounded latency instead of a runaway
                                // unbounded queue.
                                if write_pipe.send(Message::Binary(frame)).await.is_err() {
                                    break;
                                }
                            }
                            ping = ping_rx.recv() => {
                                let Some(ping) = ping else { break; };
                                if write_pipe.send(Message::Pong(ping)).await.is_err() {
                                    break;
                                }
                            }
                            _ = heartbeat.tick(), if authed => {
                                seq_out += 1;
                                if write_pipe
                                    .send(Message::Binary(encode_frame(
                                        MsgType::Heartbeat,
                                        seq_out,
                                        &[],
                                        0,
                                    )))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    }

                    reader_task.abort();
                    connection_status::log(format!(
                        "Media WS disconnected ({channel_name})"
                    ));
                }
            }
        }
        } else if tcp_enabled() {
            // TCP preference: only attempt TCP (requires ENABLE_CONTROL_TCP=1).
            if let Some((host, port)) = resolve_tcp_addr(&config) {
                connection_status::log(format!(
                    "Media TCP ({channel_name}) connecting {host}:{port}"
                ));
                if let Ok(stream) = TcpStream::connect((host.as_str(), port)).await {
                    let _ = stream.set_nodelay(true);
                    let (mut reader, mut writer) = stream.into_split();

                    seq_out += 1;
                    let auth = json!({
                        "deviceId": config.device_id,
                        "token": config.agent_token,
                        "channel": channel_name,
                    });
                    let auth_frame = encode_json_frame(MsgType::Auth, seq_out, &auth);

                    if writer.write_all(&auth_frame).await.is_ok() {
                        let (read_tx, mut read_rx) = mpsc::unbounded_channel::<Vec<u8>>();
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
                        let mut parser = FrameParser::new();
                        let mut authed = false;

                        loop {
                            if stop_flag.as_ref().is_some_and(|f| f.load(Ordering::SeqCst)) {
                                break;
                            }

                            tokio::select! {
                                chunk = read_rx.recv() => {
                                    let Some(chunk) = chunk else { break; };
                                    let frames = parser.push(&chunk);
                                    for frame in frames {
                                        match frame.msg_type {
                                            MsgType::AuthOk => authed = true,
                                            MsgType::AuthFail => break,
                                            MsgType::MediaAck => {
                                                if let Ok(body) =
                                                    serde_json::from_slice::<Value>(&frame.payload)
                                                {
                                                    let _ = ack_tx.send(body);
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                                payload = payload_rx.recv(), if authed => {
                                    let Some(payload) = payload else { break; };
                                    seq_out += 1;
                                    let frame =
                                        encode_frame(MsgType::MediaFrame, seq_out, &payload, 0);
                                    if writer.write_all(&frame).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }

                        reader_task.abort();
                    }
                }
            }
        } else {
            connection_status::log(format!(
                "Media TCP preferred ({channel_name}) but ENABLE_CONTROL_TCP is off — not auto-switching to WSS"
            ));
        }

        if !connected {
            connection_status::log(format!(
                "Media {} connect failed ({channel_name}) — waiting before retry (no auto-failover)",
                if use_tcp { "TCP" } else { "WSS" }
            ));
        }

        sleep(Duration::from_secs(backoff)).await;
        backoff = next_backoff(backoff);
    }
}
