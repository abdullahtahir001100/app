use std::sync::Arc;
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::{RTCIceCandidate, RTCIceCandidateInit};
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

use crate::input::handle_remote_input;

pub struct WebRtcSessionManager {
    pc: Arc<Mutex<Option<Arc<RTCPeerConnection>>>>,
    active_media_channel: Arc<Mutex<Option<Arc<RTCDataChannel>>>>,
    signal_tx: mpsc::Sender<Value>,
}

impl WebRtcSessionManager {
    pub fn new(signal_tx: mpsc::Sender<Value>) -> Self {
        Self {
            pc: Arc::new(Mutex::new(None)),
            active_media_channel: Arc::new(Mutex::new(None)),
            signal_tx,
        }
    }

    pub async fn handle_signal(&self, payload: &Value) {
        let signal_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match signal_type {
            "offer" => {
                if let Some(sdp) = payload.get("sdp").and_then(|v| v.as_str()) {
                    self.handle_offer(sdp.to_string()).await;
                }
            }
            "ice_candidate" => {
                if let Some(cand_obj) = payload.get("candidate") {
                    self.handle_ice_candidate(cand_obj).await;
                }
            }
            "close" => {
                self.close().await;
            }
            _ => {}
        }
    }

    async fn handle_offer(&self, sdp: String) {
        // Clean up previous peer connection if any
        self.close().await;

        let mut m = MediaEngine::default();
        let _ = m.register_default_codecs();
        let registry = register_default_interceptors(Registry::new(), &mut m).unwrap_or_else(|_| Registry::new());

        let api = APIBuilder::new()
            .with_media_engine(m)
            .with_interceptor_registry(registry)
            .build();

        let config = RTCConfiguration {
            ice_servers: vec![
                RTCIceServer {
                    urls: vec![
                        "stun:stun.l.google.com:19302".to_string(),
                        "stun:stun1.l.google.com:19302".to_string(),
                    ],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let pc = match api.new_peer_connection(config).await {
            Ok(p) => Arc::new(p),
            Err(e) => {
                eprintln!("[WEBRTC] Failed to create PeerConnection: {}", e);
                return;
            }
        };

        let media_ch_holder = Arc::clone(&self.active_media_channel);
        let signal_sender = self.signal_tx.clone();

        // Handle incoming data channels created by browser
        let media_ch_slot = Arc::clone(&media_ch_holder);
        pc.on_data_channel(Box::new(move |d: Arc<RTCDataChannel>| {
            let label = d.label().to_string();
            let d_clone = Arc::clone(&d);
            let media_ch_slot = Arc::clone(&media_ch_slot);

            Box::pin(async move {
                if label == "control" {
                    println!("[WEBRTC] Control DataChannel established via UDP!");
                    d_clone.on_message(Box::new(move |msg: DataChannelMessage| {
                        Box::pin(async move {
                            if let Ok(text) = std::str::from_utf8(&msg.data) {
                                if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                                    let action = parsed.get("action").and_then(|v| v.as_str()).unwrap_or("");
                                    let empty = json!({});
                                    let payload = parsed.get("payload").unwrap_or(&empty);
                                    let _ = handle_remote_input(action, payload);
                                }
                            }
                        })
                    }));
                } else if label == "media" {
                    println!("[WEBRTC] Media DataChannel established via UDP!");
                    let mut slot = media_ch_slot.lock().await;
                    *slot = Some(Arc::clone(&d_clone));
                }
            })
        }));

        // ICE candidate trickle
        let sig_tx = signal_sender.clone();
        pc.on_ice_candidate(Box::new(move |candidate: Option<RTCIceCandidate>| {
            let sig_tx = sig_tx.clone();
            Box::pin(async move {
                if let Some(cand) = candidate {
                    if let Ok(json_cand) = cand.to_json() {
                        let _ = sig_tx.send(json!({
                            "type": "webrtc_signal",
                            "stream_type": "screen",
                            "signal": {
                                "type": "ice_candidate",
                                "candidate": json_cand
                            }
                        })).await;
                    }
                }
            })
        }));

        let peer_conn = Arc::clone(&pc);
        let desc = RTCSessionDescription::offer(sdp).unwrap();
        if let Err(err) = peer_conn.set_remote_description(desc).await {
            eprintln!("[WEBRTC] set_remote_description error: {}", err);
            return;
        }

        let answer = match peer_conn.create_answer(None).await {
            Ok(ans) => ans,
            Err(err) => {
                eprintln!("[WEBRTC] create_answer error: {}", err);
                return;
            }
        };

        if let Err(err) = peer_conn.set_local_description(answer.clone()).await {
            eprintln!("[WEBRTC] set_local_description error: {}", err);
            return;
        }

        // Send answer back to browser via signaling gateway
        let _ = signal_sender.send(json!({
            "type": "webrtc_signal",
            "stream_type": "screen",
            "signal": {
                "type": "answer",
                "sdp": answer.sdp
            }
        })).await;

        let mut lock = self.pc.lock().await;
        *lock = Some(pc);
    }

    async fn handle_ice_candidate(&self, candidate: &Value) {
        let pc_lock = self.pc.lock().await;
        if let Some(pc) = pc_lock.as_ref() {
            if let Ok(cand_str) = serde_json::to_string(candidate) {
                if let Ok(init) = serde_json::from_str::<RTCIceCandidateInit>(&cand_str) {
                    let _ = pc.add_ice_candidate(init).await;
                }
            }
        }
    }

    pub async fn send_media_frame(&self, frame: &[u8]) -> bool {
        let slot = self.active_media_channel.lock().await;
        if let Some(ch) = slot.as_ref() {
            let bytes = bytes::Bytes::copy_from_slice(frame);
            return ch.send(&bytes).await.is_ok();
        }
        false
    }

    pub async fn close(&self) {
        {
            let mut media_slot = self.active_media_channel.lock().await;
            *media_slot = None;
        }
        let mut pc_slot = self.pc.lock().await;
        if let Some(pc) = pc_slot.take() {
            let _ = pc.close().await;
        }
    }
}
