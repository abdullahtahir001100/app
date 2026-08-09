use std::ffi::OsStr;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use sysinfo::System;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use std::process::Command;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::time::{interval, sleep, MissedTickBehavior, timeout};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
#[cfg(windows)]
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

use crate::activity::ActivityLogger;
use crate::activity_monitor;
use crate::agent::AgentState;
use crate::connection_status;
use crate::commands::{
    build_binary_frame, build_camera_blocked_notice, capture_stream_frame, CommandResponse,
    IncomingPacket,
};
use crate::config::AgentConfig;
use crate::router::dispatch_command;
use crate::screen::invalidate_monitor_cache;
use crate::screen_commands::{capture_display_jpeg, FRAME_SCREEN_STREAM, StreamCaptureSettings};
use crate::ui_notify;

const SCREEN_FRAME_INTERVAL_MS: u64 = 16;
const CAMERA_FRAME_INTERVAL_MS: u64 = 250;
const HANDSHAKE_TIMEOUT_SECS: u64 = 20;
const CONNECT_TIMEOUT_SECS: u64 = 45;
const NETWORK_WAIT_SECS: u64 = 15;
const HEARTBEAT_INTERVAL_SECS: u64 = 25;
const HEARTBEAT_TIMEOUT_SECS: u64 = 75;
const MAX_BACKOFF_SECS: u64 = 30;
const SLEEP_JUMP_SECS: u64 = 90;
/// Only used for install UI "failed" status — agent keeps reconnecting forever.
const FINAL_FAIL_AFTER_ATTEMPTS: u32 = 8;
/// After a stable session, reset backoff so brief blips don't look like hard failure.
const STABLE_SESSION_SECS: u64 = 45;

fn next_reconnect_backoff(attempt: u32) -> u64 {
    match attempt {
        0 | 1 => 1,
        2 => 2,
        3 => 5,
        4 => 10,
        5 => 20,
        _ => MAX_BACKOFF_SECS,
    }
}

fn report_transient_or_final(config: &AgentConfig, reconnect_attempt: u32, message: &str) {
    if reconnect_attempt + 1 >= FINAL_FAIL_AFTER_ATTEMPTS {
        connection_status::report_failed(message);
    } else {
        connection_status::report_connecting(&config.device_id, &config.gateway_url);
    }
}

fn running_in_console_mode() -> bool {
    std::env::args().any(|arg| arg == "--console")
}

fn show_console_result(title: &str, message: &str, success: bool) {
    if !running_in_console_mode() {
        return;
    }
    if success {
        ui_notify::show_blocking_info(title, message);
    } else {
        ui_notify::show_blocking_error(title, message);
    }
}

#[derive(Debug)]
enum ConnectFailure {
    Auth,
    Network(String),
    HandshakeTimeout,
}

#[cfg(windows)]
fn to_pcwstr(input: &str) -> PCWSTR {
    let wide: Vec<u16> = OsStr::new(input).encode_wide().chain(Some(0)).collect();
    PCWSTR(wide.as_ptr())
}

#[cfg(windows)]
fn get_local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("1.1.1.1:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}

#[cfg(not(windows))]
fn get_local_ip() -> Option<String> {
    None
}

#[cfg(windows)]
fn get_battery_percent() -> Option<u32> {
    unsafe {
        let mut status = SYSTEM_POWER_STATUS::default();
        if GetSystemPowerStatus(&mut status).is_ok() {
            let value = status.BatteryLifePercent;
            if value < 100 && value != 255 {
                return Some(value as u32);
            }
            if value == 100 {
                return Some(100);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn get_battery_percent() -> Option<u32> {
    None
}

#[cfg(windows)]
fn get_storage_used_percent() -> Option<u32> {
    unsafe {
        let root = to_pcwstr("C:\\\\");
        let mut free_bytes_available: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free_bytes: u64 = 0;

        if GetDiskFreeSpaceExW(
            root,
            Some(&mut free_bytes_available),
            Some(&mut total_bytes),
            Some(&mut total_free_bytes),
        )
        .is_ok()
        {
            if total_bytes > 0 {
                let used_bytes = total_bytes.saturating_sub(total_free_bytes);
                return Some(((used_bytes * 100) / total_bytes).min(100) as u32);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn get_storage_used_percent() -> Option<u32> {
    None
}

fn schedule_screen_capture(
    active_index: usize,
    settings: StreamCaptureSettings,
    _write_tx: &mpsc::UnboundedSender<Message>,
    media_tx: &Option<mpsc::Sender<Vec<u8>>>,
    screen_busy: &Arc<AtomicBool>,
) {
    if screen_busy
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        return;
    }

    let media_tx = media_tx.clone();
    let busy = Arc::clone(screen_busy);

    // Spawn a non‑blocking task that captures a single JPEG frame and sends it over the media channel.
    // Regardless of success or failure we must always clear the busy flag so that future frames can fire.
    tokio::spawn(async move {
        // Capture the screen (blocking) on a dedicated thread pool.
        let jpeg_result = tokio::task::spawn_blocking(move || {
            capture_display_jpeg(active_index, false, settings)
        })
        .await;

        // If the capture succeeded, send it through the media channel.
        if let Ok(Some(jpeg)) = jpeg_result {
            let binary = build_binary_frame(jpeg, FRAME_SCREEN_STREAM);
            if let Some(tx) = media_tx.as_ref() {
                // Instant non-blocking send. If buffer is full (slow network), drop frame cleanly
                // so agent Tokio threads NEVER block and heartbeats NEVER timeout.
                if let Err(mpsc::error::TrySendError::Full(_)) = tx.try_send(binary) {
                    // Frame dropped cleanly due to network lag — no disconnection!
                }
            } else {
                eprintln!("[SCREEN] screen_media_tx is None while streaming");
            }
        }

        // Always clear the busy flag so the next capture can proceed.
        busy.store(false, Ordering::Release);
    });
}

fn get_hostname() -> String {
    hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn get_username() -> String {
    whoami::username()
}

fn get_os_version() -> String {
    System::long_os_version().unwrap_or_default()
}

fn get_architecture() -> String {
    std::env::consts::ARCH.to_string()
}

fn get_cpu() -> String {
    let mut system = System::new_all();
    system.refresh_cpu_all();

    system
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default()
}

fn get_ram() -> u64 {
    let mut system = System::new_all();
    system.refresh_memory();
    system.total_memory() / 1024 / 1024
}

async fn get_geo_cached(cache: &mut Option<(Instant, Value)>) -> Value {
    if let Some((fetched_at, geo)) = cache {
        if fetched_at.elapsed() < Duration::from_secs(300) {
            return geo.clone();
        }
    }

    let geo = match reqwest::get("http://ip-api.com/json").await {
        Ok(resp) => resp.json::<Value>().await.unwrap_or(json!({})),
        Err(_) => json!({}),
    };
    *cache = Some((Instant::now(), geo.clone()));
    geo
}

fn get_network() -> String {
    let mut cmd = Command::new("netsh");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.args(["wlan", "show", "interfaces"]).output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if line.trim_start().starts_with("SSID") && !line.contains("BSSID") {
                if let Some(v) = line.split(':').nth(1) {
                    return v.trim().to_string();
                }
            }
        }
    }
    String::new()
}

async fn get_public_ip_cached(cache: &mut Option<(Instant, String)>) -> String {
    if let Some((fetched_at, ip)) = cache {
        if fetched_at.elapsed() < Duration::from_secs(120) {
            return ip.clone();
        }
    }

    let ip = match reqwest::get("https://api.ipify.org").await {
        Ok(resp) => resp.text().await.unwrap_or_default(),
        Err(_) => String::new(),
    };
    *cache = Some((Instant::now(), ip.clone()));
    ip
}

async fn emit_response(write_tx: &mpsc::UnboundedSender<Message>, response: CommandResponse) {
    let _ = write_tx.send(Message::Text(response.json.to_string()));

    if let Some(frame) = response.frame {
        let binary = build_binary_frame(frame, response.frame_kind);
        let _ = write_tx.send(Message::Binary(binary));
    }
}

async fn wait_for_network_ready(max_wait_secs: u64) -> bool {
    println!("--> [NETWORK] Waiting for network readiness...");
    for attempt in 1..=max_wait_secs {
        if tokio::net::TcpStream::connect("1.1.1.1:443").await.is_ok()
            || tokio::net::TcpStream::connect("8.8.8.8:53").await.is_ok()
        {
            println!("--> [NETWORK] Network is ready ({}s).", attempt);
            return true;
        }
        sleep(Duration::from_secs(1)).await;
    }
    false
}

fn build_gateway_url(config: &AgentConfig) -> Result<Url, String> {
    // Allow runtime override without re-pairing (e.g. local testing).
    let gateway = std::env::var("ZENVORA_GATEWAY_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.gateway_url.clone());

    // Do NOT put agentToken in the URL.
    // Railway/proxy can hang or truncate long query strings during WebSocket upgrade.
    // Auth is sent in register_channel after connect.
    Url::parse(&gateway).map_err(|e| format!("Invalid gateway URL: {}", e))
}

fn is_auth_failure(err: &tokio_tungstenite::tungstenite::Error) -> bool {
    match err {
        tokio_tungstenite::tungstenite::Error::Http(response) => {
            response.status() == 401 || response.status() == 403
        }
        other => {
            let text = other.to_string().to_lowercase();
            text.contains("401") || text.contains("403") || text.contains("unauthorized")
        }
    }
}

async fn wait_for_gateway_ack(
    read_pipe: &mut futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    >,
) -> Result<(), ConnectFailure> {
    let result = timeout(Duration::from_secs(HANDSHAKE_TIMEOUT_SECS), async {
        while let Some(msg) = read_pipe.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(packet) = serde_json::from_str::<Value>(&text) {
                        let packet_type = packet.get("type").and_then(|v| v.as_str());
                        let status = packet.get("status").and_then(|v| v.as_str());
                        if packet_type == Some("sys_ack") && status == Some("ready") {
                            return Ok(());
                        }
                        if packet_type == Some("sys_ack")
                            && matches!(status, Some("auth_failed") | Some("auth_timeout"))
                        {
                            return Err(ConnectFailure::Auth);
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    return Err(ConnectFailure::Network(
                        "Gateway closed connection during handshake.".into(),
                    ));
                }
                Ok(Message::Ping(_) | Message::Pong(_) | Message::Binary(_)) => {}
                Ok(Message::Frame(_)) => {}
                Err(err) => {
                    return Err(ConnectFailure::Network(format!(
                        "Handshake read error: {}",
                        err
                    )));
                }
            }
        }
        Err(ConnectFailure::HandshakeTimeout)
    })
    .await;

    match result {
        Ok(inner) => inner,
        Err(_) => Err(ConnectFailure::HandshakeTimeout),
    }
}

pub async fn run_network_loop(
    state: &mut AgentState,
    config: &mut AgentConfig,
    stop_flag: Option<Arc<AtomicBool>>,
) {
    let mut reconnect_attempt: u32 = 0;

    connection_status::log(format!(
        "Network loop start device={} gateway={}",
        config.device_id, config.gateway_url
    ));
    connection_status::report_connecting(&config.device_id, &config.gateway_url);

    loop {
        if stop_flag
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::SeqCst))
        {
            connection_status::log("Shutdown requested; stopping network loop.");
            break;
        }

        if !wait_for_network_ready(NETWORK_WAIT_SECS).await {
            let message = "Network not ready. Check internet connection.".to_string();
            report_transient_or_final(config, reconnect_attempt, &message);
            connection_status::log(&message);
            sleep(Duration::from_secs(5)).await;
            reconnect_attempt = reconnect_attempt.saturating_add(1);
            continue;
        }

        let url = match build_gateway_url(config) {
            Ok(url) => url,
            Err(err) => {
                report_transient_or_final(config, reconnect_attempt, &err);
                connection_status::log(&err);
                sleep(Duration::from_secs(5)).await;
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                continue;
            }
        };

        connection_status::log(format!(
            "Connecting to gateway (attempt {}) -> {}",
            reconnect_attempt + 1,
            config.gateway_url
        ));
        connection_status::report_connecting(&config.device_id, &config.gateway_url);

        let connect_result = timeout(
            Duration::from_secs(CONNECT_TIMEOUT_SECS),
            connect_async(url),
        )
        .await;

        match connect_result {
            Ok(Ok((ws_stream, _))) => {
                if stop_flag
                    .as_ref()
                    .is_some_and(|flag| flag.load(Ordering::SeqCst))
                {
                    break;
                }

                let (mut write_pipe, mut read_pipe) = ws_stream.split();

                let reg_packet = json!({
                    "type": "register_channel",
                    "role": "AGENT",
                    "id": config.device_id,
                    "authToken": config.agent_token,
                });

                if write_pipe
                    .send(Message::Text(reg_packet.to_string()))
                    .await
                    .is_err()
                {
                    let message = "Failed to send registration packet.".to_string();
                    report_transient_or_final(config, reconnect_attempt, &message);
                    connection_status::log(&message);
                    sleep(Duration::from_secs(3)).await;
                    reconnect_attempt = reconnect_attempt.saturating_add(1);
                    continue;
                }

                match wait_for_gateway_ack(&mut read_pipe).await {
                    Ok(()) => {
                        reconnect_attempt = 0;
                        connection_status::log(format!(
                            "Gateway handshake complete for {}",
                            config.device_id
                        ));
                        connection_status::report_connected(
                            &config.device_id,
                            &config.gateway_url,
                        );
                        show_console_result(
                            "Zenvora Agent",
                            &format!(
                                "Connected successfully!\nDevice: {}\nGateway: {}",
                                config.device_id, config.gateway_url
                            ),
                            true,
                        );
                    }
                    Err(failure) => {
                        let is_auth = matches!(failure, ConnectFailure::Auth);
                        let message = match failure {
                            ConnectFailure::HandshakeTimeout => {
                                "Gateway did not confirm registration in time.".to_string()
                            }
                            ConnectFailure::Network(err) => err,
                            ConnectFailure::Auth => {
                                "Gateway rejected agent credentials.".to_string()
                            }
                        };
                        if is_auth {
                            connection_status::report_failed(&message);
                        } else {
                            report_transient_or_final(config, reconnect_attempt, &message);
                        }
                        connection_status::log(format!("Handshake failed: {}", message));
                        show_console_result(
                            "Zenvora Agent - Connection Failed",
                            &message,
                            false,
                        );
                        sleep(Duration::from_secs(5)).await;
                        reconnect_attempt = reconnect_attempt.saturating_add(1);
                        continue;
                    }
                }

                let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Message>();
                let session_started = Instant::now();
                let activity_logger =
                    ActivityLogger::init_activity_logger(write_tx.clone(), config.device_id.clone());
                state.activity_logger = Some(activity_logger.clone());
                activity_monitor::start_activity_monitor(activity_logger.clone());

                let status_write_tx = write_tx.clone();
                let status_device_id = config.device_id.clone();
                tokio::spawn(async move {
                    let mut status_interval = interval(Duration::from_secs(60));
                    status_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
                    let mut local_ip_cache = get_local_ip();
                    let mut public_ip_cache: Option<(Instant, String)> = None;
                    let mut geo_cache: Option<(Instant, Value)> = None;
                    let mut cpu_cache = get_cpu();
                    let mut ram_cache = get_ram();
                    let mut tick: u64 = 0;

                    loop {
                        status_interval.tick().await;
                        tick = tick.wrapping_add(1);
                        // Geo/public IP at most every ~5 minutes.
                        let public_ip = if tick % 5 == 1 {
                            get_public_ip_cached(&mut public_ip_cache).await
                        } else {
                            public_ip_cache
                                .as_ref()
                                .map(|(_, ip)| ip.clone())
                                .unwrap_or_default()
                        };
                        let geo = if tick % 5 == 1 {
                            get_geo_cached(&mut geo_cache).await
                        } else {
                            geo_cache
                                .as_ref()
                                .map(|(_, g)| g.clone())
                                .unwrap_or_else(|| json!({}))
                        };

                        if local_ip_cache.is_none() {
                            local_ip_cache = get_local_ip();
                        }
                        if tick % 3 == 1 {
                            cpu_cache = get_cpu();
                            ram_cache = get_ram();
                        }

                        let status_packet = json!({
                            "type":"device_status_update",
                            "deviceId":status_device_id,
                            "status":"online",
                            "platform":std::env::consts::OS,
                            "localIp":local_ip_cache.clone().unwrap_or_default(),
                            "publicIp":public_ip,
                            "battery":get_battery_percent(),
                            "storage":get_storage_used_percent(),
                            "network":get_network(),
                            "hostname":get_hostname(),
                            "username":get_username(),
                            "osVersion":get_os_version(),
                            "architecture":get_architecture(),
                            "cpu":cpu_cache,
                            "ram":ram_cache,
                            "geolocation":{
                                "latitude":geo["lat"],
                                "longitude":geo["lon"]
                            },
                            "country":geo["country"],
                            "region":geo["regionName"],
                            "city":geo["city"],
                            "isp":geo["isp"],
                            "timezone":geo["timezone"],
                            "timestamp":SystemTime::now()
                                .duration_since(SystemTime::UNIX_EPOCH)
                                .unwrap()
                                .as_secs()
                        });
                        let _ = status_write_tx.send(Message::Text(status_packet.to_string()));
                    }
                });

                let mut writer = write_pipe;
                let writer_task = tokio::spawn(async move {
                    while let Some(message) = write_rx.recv().await {
                        if writer.send(message).await.is_err() {
                            break;
                        }
                    }
                });

                let camera_busy = Arc::new(AtomicBool::new(false));
                let screen_busy = Arc::new(AtomicBool::new(false));
                let mut camera_interval = interval(Duration::from_millis(CAMERA_FRAME_INTERVAL_MS));
                camera_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

                let mut screen_pump = interval(Duration::from_millis(SCREEN_FRAME_INTERVAL_MS));
                screen_pump.set_missed_tick_behavior(MissedTickBehavior::Skip);

                let mut heartbeat = interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
                heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
                let mut last_screen_push = Instant::now()
                    .checked_sub(Duration::from_secs(1))
                    .unwrap_or_else(Instant::now);
                let mut last_alive = Instant::now();
                let mut last_heartbeat_tick = Instant::now();

                let mut notif_rx = crate::notifications::global_notifier().rx_channel.subscribe();

                loop {
                    if stop_flag
                        .as_ref()
                        .is_some_and(|flag| flag.load(Ordering::SeqCst))
                    {
                        break;
                    }

                    state.camera.try_complete_release();

                    tokio::select! {
                        biased;
                        
                        Ok(notif) = notif_rx.recv() => {
                            let text = serde_json::json!({
                                "type": "event",
                                "action": "SYSTEM_NOTIFICATION",
                                "payload": notif
                            }).to_string();
                            let _ = write_tx.send(Message::Text(text));
                        }

                        _ = heartbeat.tick() => {
                            let since_last_tick = last_heartbeat_tick.elapsed();
                            last_heartbeat_tick = Instant::now();

                            if since_last_tick > Duration::from_secs(SLEEP_JUMP_SECS) {
                                eprintln!(
                                    "--> [NETWORK] System resume/sleep detected ({}s gap). Reconnecting...",
                                    since_last_tick.as_secs()
                                );
                                break;
                            }

                            if last_alive.elapsed() > Duration::from_secs(HEARTBEAT_TIMEOUT_SECS) {
                                eprintln!(
                                    "--> [NETWORK] Heartbeat timeout ({}s). Reconnecting...",
                                    last_alive.elapsed().as_secs()
                                );
                                break;
                            }

                            if write_tx.send(Message::Ping(vec![])).is_err() {
                                eprintln!("--> [NETWORK] Heartbeat send failed. Reconnecting...");
                                break;
                            }
                            let _ = write_tx.send(Message::Text(
                                json!({ "type": "agent_ping" }).to_string(),
                            ));
                        }
                        msg = read_pipe.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    last_alive = Instant::now();

                                    if !text.contains("\"action\"") {
                                        continue;
                                    }

                                    match serde_json::from_str::<IncomingPacket>(&text) {
                                        Ok(packet) => {
                                            let action = packet.action.clone();
                                            let payload = packet.payload.clone();
                                            let quiet = action.starts_with("REMOTE_");
                                            if !quiet {
                                                println!("[RUST AGENT] Command received: {}", action);
                                            }
                                            if let Some(response) = dispatch_command(packet, state) {
                                                emit_response(&write_tx, response).await;
                                                if action == "START_SCREEN_STREAM" && state.screen.streaming_active {
                                                    last_screen_push = Instant::now();
                                                    let settings = StreamCaptureSettings {
                                                        max_width: state.screen.stream_max_width,
                                                        jpeg_quality: state.screen.stream_jpeg_quality,
                                                    };
                                                    schedule_screen_capture(
                                                        state.screen.active_display_index,
                                                        settings,
                                                        &write_tx,
                                                        &state.screen_media_tx,
                                                        &screen_busy,
                                                    );
                                                } else if action == "START_AUDIO_STREAM" {
                                                    let device_id = payload.get("device_id").and_then(|v| v.as_str()).map(String::from);
                                                    let _ = state.audio.start_streaming(write_tx.clone(), device_id);
                                                } else if action == "STOP_AUDIO_STREAM" {
                                                    state.audio.stop_streaming();
                                                } else if action == "LIST_AUDIO_DEVICES" {
                                                    if let Ok(devices) = crate::audio::AudioState::list_audio_devices() {
                                                        let _ = write_tx.send(Message::Text(serde_json::json!({
                                                            "type": "sys_ack",
                                                            "action": action,
                                                            "status": "success",
                                                            "metrics": {
                                                                "audio_devices": devices
                                                            }
                                                        }).to_string()));
                                                    }
                                                }
                                            }
                                        }
                                        Err(err) => {
                                            eprintln!(
                                                "[RUST AGENT] Invalid command JSON: {} | raw={}",
                                                err,
                                                text.chars().take(160).collect::<String>()
                                            );
                                        }
                                    }
                                }
                                Some(Ok(Message::Binary(_))) => {
                                    last_alive = Instant::now();
                                }
                                Some(Ok(Message::Ping(payload))) => {
                                    last_alive = Instant::now();
                                    let _ = write_tx.send(Message::Pong(payload));
                                }
                                Some(Ok(Message::Pong(_))) => {
                                    last_alive = Instant::now();
                                }
                                Some(Ok(Message::Close(_))) => {
                                    state.screen.streaming_active = false;
                                    state.camera.request_stop_and_release();
                                    state.audio.stop_streaming();
                                    invalidate_monitor_cache();
                                    println!("--> [NETWORK] Gateway closed connection.");
                                    break;
                                }
                                Some(Err(e)) => {
                                    state.screen.streaming_active = false;
                                    state.camera.request_stop_and_release();
                                    state.audio.stop_streaming();
                                    invalidate_monitor_cache();
                                    eprintln!("--> [NETWORK] Socket transmission failure: {}", e);
                                    break;
                                }
                                None => {
                                    state.screen.streaming_active = false;
                                    state.camera.request_stop_and_release();
                                    state.audio.stop_streaming();
                                    invalidate_monitor_cache();
                                    println!("--> [NETWORK] WebSocket stream ended.");
                                    break;
                                }
                                _ => {}
                            }
                        }
                        _ = screen_pump.tick(), if state.screen.streaming_active => {
                            let fps = state.screen.target_fps.max(1);
                            let min_gap = Duration::from_millis((1000 / fps as u64).max(25));
                            if last_screen_push.elapsed() < min_gap {
                                continue;
                            }
                            last_screen_push = Instant::now();
                            let settings = StreamCaptureSettings {
                                max_width: state.screen.stream_max_width,
                                jpeg_quality: state.screen.stream_jpeg_quality,
                            };
                            schedule_screen_capture(
                                state.screen.active_display_index,
                                settings,
                                &write_tx,
                                &state.screen_media_tx,
                                &screen_busy,
                            );
                        }
                        _ = camera_interval.tick(), if state.camera.streaming_active => {
                            if state.camera.capture_in_flight.load(Ordering::Acquire) {
                                continue;
                            }
                            if camera_busy
                                .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
                                .is_err()
                            {
                                continue;
                            }

                            state.camera.capture_in_flight.store(true, Ordering::Release);

                            if let Some(frame) = capture_stream_frame(&state.camera) {
                                state.camera.capture_fail_streak = 0;
                                let binary = build_binary_frame(frame.payload, frame.kind);
                                // Media WS only — never flood gateway.
                                let _ = state
                                    .camera_media_tx
                                    .as_ref()
                                    .map(|tx| tx.try_send(binary));
                            } else if state.camera.handle_capture_failure() {
                                state.camera.try_complete_release();
                                let notice = build_camera_blocked_notice(&state.camera);
                                let _ = write_tx.send(Message::Text(notice.to_string()));
                            }

                            state.camera.capture_in_flight.store(false, Ordering::Release);
                            camera_busy.store(false, Ordering::Release);
                            state.camera.try_complete_release();
                        }
                    }
                }

                writer_task.abort();
                state.audio.stop_streaming();
                invalidate_monitor_cache();
                if session_started.elapsed() >= Duration::from_secs(STABLE_SESSION_SECS) {
                    reconnect_attempt = 0;
                }
                connection_status::log("Socket disconnected. Reconnecting...");
            }
            Ok(Err(err)) => {
                let message = format!("Connection failed: {}", err);
                report_transient_or_final(config, reconnect_attempt, &message);
                connection_status::log(&message);
                if reconnect_attempt + 1 >= FINAL_FAIL_AFTER_ATTEMPTS {
                    show_console_result("Zenvora Agent - Connection Failed", &message, false);
                }

                if is_auth_failure(&err) {
                    // Service Session 0 cannot show pairing dialogs — fail clearly.
                    if running_in_console_mode() {
                        *config = AgentConfig::repair_credentials().await;
                        reconnect_attempt = 0;
                        continue;
                    }
                    connection_status::report_failed(
                        "Gateway rejected credentials. Run: ZenvoraAgent.exe --console to re-pair.",
                    );
                    sleep(Duration::from_secs(15)).await;
                    reconnect_attempt = reconnect_attempt.saturating_add(1);
                    continue;
                }

                reconnect_attempt = reconnect_attempt.saturating_add(1);
                let backoff = next_reconnect_backoff(reconnect_attempt);
                connection_status::log(format!("Retrying in {} seconds...", backoff));
                sleep(Duration::from_secs(backoff)).await;
            }
            Err(_elapsed) => {
                let message = format!(
                    "Gateway connection timed out after {}s ({})",
                    CONNECT_TIMEOUT_SECS, config.gateway_url
                );
                report_transient_or_final(config, reconnect_attempt, &message);
                connection_status::log(&message);
                if reconnect_attempt + 1 >= FINAL_FAIL_AFTER_ATTEMPTS {
                    show_console_result("Zenvora Agent - Connection Failed", &message, false);
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                sleep(Duration::from_secs(5)).await;
            }
        }
    }
}
