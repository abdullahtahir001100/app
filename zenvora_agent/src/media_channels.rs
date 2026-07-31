use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, broadcast};
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;

use crate::config::AgentConfig;
use crate::connection_status;
use crate::protocol::{
    control_addr_from_gateway, encode_frame, encode_json_frame, FrameParser, MsgType,
};

const DEFAULT_CONTROL_PORT: u16 = 9443;
const MAX_BACKOFF_SECS: u64 = 20;

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
    if base.contains("/ws/gateway") {
        return Some(base.replace("/ws/gateway", "/ws/media"));
    }
    if base.ends_with('/') {
        return Some(format!("{base}ws/media"));
    }
    Some(format!("{base}/ws/media"))
}

pub struct MediaChannel {
    pub tx: mpsc::UnboundedSender<Vec<u8>>,
    pub ack_rx: broadcast::Receiver<Value>,
}

pub fn spawn_media_channel(
    config: Arc<AgentConfig>,
    channel_name: String,
    stop_flag: Option<Arc<AtomicBool>>,
) -> MediaChannel {
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (ack_tx, ack_rx) = broadcast::channel::<Value>(16);
    
    let channel_name_clone = channel_name.clone();
    
    tokio::spawn(async move {
        let mut backoff = 1u64;
        let mut seq_out: u64 = 1;

        loop {
            if stop_flag.as_ref().is_some_and(|f| f.load(Ordering::SeqCst)) {
                break;
            }

            let mut connected = false;
            
            if let Some((host, port)) = resolve_tcp_addr(&config) {
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
                                            MsgType::AuthOk => {
                                                authed = true;
                                            }
                                            MsgType::AuthFail => {
                                                break;
                                            }
                                            MsgType::MediaAck => {
                                                if let Ok(body) = serde_json::from_slice::<Value>(&frame.payload) {
                                                    let _ = ack_tx.send(body);
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                                payload = rx.recv(), if authed => {
                                    let Some(payload) = payload else { break; };
                                    seq_out += 1;
                                    let frame = encode_frame(MsgType::MediaFrame, seq_out, &payload, 0);
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

            // Fallback WS... omitted for brevity if TCP works, but you could implement similarly
            
            sleep(Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(MAX_BACKOFF_SECS);
        }
    });

    MediaChannel { tx, ack_rx }
}
