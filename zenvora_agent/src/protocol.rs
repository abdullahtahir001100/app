//! Zenvora binary control-plane framing (agent ⇄ Node).
//!
//! Layout (little-endian):
//!   magic[2]=0x5A 0x56 ("ZV")
//!   version u8 = 1
//!   msg_type u8
//!   flags u8
//!   seq u64
//!   payload_len u32
//!   payload[payload_len]

use serde::Serialize;

pub const MAGIC0: u8 = 0x5a;
pub const MAGIC1: u8 = 0x56;
pub const VERSION: u8 = 1;
pub const HEADER_SIZE: usize = 17;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MsgType {
    Heartbeat = 0x01,
    HeartbeatAck = 0x02,
    Auth = 0x03,
    AuthOk = 0x04,
    AuthFail = 0x05,
    Event = 0x10,
    EventAck = 0x11,
    Command = 0x20,
    CommandResult = 0x21,
    SyncCursor = 0x30,
    SyncBatch = 0x31,
}

impl MsgType {
    pub fn from_u8(v: u8) -> Option<Self> {
        Some(match v {
            0x01 => Self::Heartbeat,
            0x02 => Self::HeartbeatAck,
            0x03 => Self::Auth,
            0x04 => Self::AuthOk,
            0x05 => Self::AuthFail,
            0x10 => Self::Event,
            0x11 => Self::EventAck,
            0x20 => Self::Command,
            0x21 => Self::CommandResult,
            0x30 => Self::SyncCursor,
            0x31 => Self::SyncBatch,
            _ => return None,
        })
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    BrowserHistory = 1,
    AppHistory = 2,
    Notification = 3,
    Activity = 4,
    Clipboard = 5,
    Usb = 6,
    Process = 7,
    DeviceStatus = 8,
    Window = 9,
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub msg_type: MsgType,
    pub flags: u8,
    pub seq: u64,
    pub payload: Vec<u8>,
}

pub fn encode_frame(msg_type: MsgType, seq: u64, payload: &[u8], flags: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_SIZE + payload.len());
    out.push(MAGIC0);
    out.push(MAGIC1);
    out.push(VERSION);
    out.push(msg_type as u8);
    out.push(flags);
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out
}

pub fn encode_json_frame<T: Serialize>(msg_type: MsgType, seq: u64, value: &T) -> Vec<u8> {
    let payload = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    encode_frame(msg_type, seq, &payload, 0)
}

#[derive(Default)]
pub struct FrameParser {
    buf: Vec<u8>,
}

impl FrameParser {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<Frame> {
        self.buf.extend_from_slice(chunk);
        let mut frames = Vec::new();

        loop {
            if self.buf.len() < HEADER_SIZE {
                break;
            }
            if self.buf[0] != MAGIC0 || self.buf[1] != MAGIC1 {
                if let Some(pos) = self.buf.iter().skip(1).position(|&b| b == MAGIC0) {
                    self.buf.drain(0..=pos);
                    continue;
                }
                self.buf.clear();
                break;
            }
            if self.buf[2] != VERSION {
                self.buf.drain(0..1);
                continue;
            }
            let payload_len = u32::from_le_bytes([
                self.buf[13],
                self.buf[14],
                self.buf[15],
                self.buf[16],
            ]) as usize;
            if payload_len > 8 * 1024 * 1024 {
                self.buf.drain(0..1);
                continue;
            }
            let total = HEADER_SIZE + payload_len;
            if self.buf.len() < total {
                break;
            }
            let msg_type = match MsgType::from_u8(self.buf[3]) {
                Some(t) => t,
                None => {
                    self.buf.drain(0..total);
                    continue;
                }
            };
            let flags = self.buf[4];
            let seq = u64::from_le_bytes([
                self.buf[5],
                self.buf[6],
                self.buf[7],
                self.buf[8],
                self.buf[9],
                self.buf[10],
                self.buf[11],
                self.buf[12],
            ]);
            let payload = self.buf[HEADER_SIZE..total].to_vec();
            self.buf.drain(0..total);
            frames.push(Frame {
                msg_type,
                flags,
                seq,
                payload,
            });
        }

        frames
    }
}

/// Derive control TCP endpoint from gateway WebSocket URL.
/// `wss://host/ws/gateway` → `host:9443` (or CONTROL_TCP_PORT).
pub fn control_addr_from_gateway(gateway_url: &str, default_port: u16) -> Option<(String, u16)> {
    let cleaned = gateway_url
        .trim()
        .trim_start_matches("wss://")
        .trim_start_matches("ws://")
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host_port = cleaned.split('/').next().unwrap_or("");
    if host_port.is_empty() {
        return None;
    }
    if let Some((host, port_str)) = host_port.rsplit_once(':') {
        // If gateway already has a non-standard port, still use control port for TCP.
        let _ = port_str;
        Some((host.to_string(), default_port))
    } else {
        Some((host_port.to_string(), default_port))
    }
}
