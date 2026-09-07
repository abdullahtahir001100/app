use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

/// Agent → dashboard (listen: mic and/or system audio)
pub const FRAME_AUDIO_STREAM: u8 = 0x0A;
/// Dashboard → agent (play on PC speakers)
pub const FRAME_AUDIO_PLAY: u8 = 0x0B;

const PLAYBACK_MAX_SAMPLES: usize = 48000 * 3;
const MIX_TARGET_HZ: u32 = 48000;
const MIX_CHUNK_SAMPLES: usize = 48000 / 20; // 50ms @ 48k

#[derive(Clone, Debug)]
pub struct AudioCaptureOpts {
    pub device_id: Option<String>,
    /// Capture microphone (voice).
    pub include_mic: bool,
    /// Capture what the PC plays (videos, apps) via WASAPI loopback.
    pub include_system: bool,
}

impl Default for AudioCaptureOpts {
    fn default() -> Self {
        Self {
            device_id: None,
            include_mic: true,
            include_system: false,
        }
    }
}

pub struct AudioState {
    pub streaming_active: Arc<AtomicBool>,
    mic_stream: Option<cpal::Stream>,
    system_stream: Option<cpal::Stream>,
    playback_active: Arc<AtomicBool>,
    playback_stream: Option<cpal::Stream>,
    playback_buf: Arc<Mutex<VecDeque<i16>>>,
    playback_rate: Arc<AtomicU32>,
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            streaming_active: Arc::new(AtomicBool::new(false)),
            mic_stream: None,
            system_stream: None,
            playback_active: Arc::new(AtomicBool::new(false)),
            playback_stream: None,
            playback_buf: Arc::new(Mutex::new(VecDeque::with_capacity(8192))),
            playback_rate: Arc::new(AtomicU32::new(48000)),
        }
    }

    pub fn list_audio_devices() -> Result<Vec<Value>, String> {
        let host = cpal::default_host();
        let devices = host.input_devices().map_err(|e| e.to_string())?;

        let mut list = Vec::new();
        for (index, device) in devices.enumerate() {
            if let Ok(name) = device.name() {
                list.push(json!({
                    "id": name.clone(),
                    "label": name,
                    "index": index,
                }));
            }
        }
        Ok(list)
    }

    pub fn start_streaming(
        &mut self,
        write_tx: mpsc::UnboundedSender<Message>,
        opts: AudioCaptureOpts,
    ) -> Result<(), String> {
        if self.streaming_active.load(Ordering::SeqCst) {
            return Ok(());
        }

        let include_mic = opts.include_mic;
        let include_system = opts.include_system;
        if !include_mic && !include_system {
            return Err("Enable mic and/or system audio".to_string());
        }

        self.stop_streaming();

        let mic_q: Arc<Mutex<VecDeque<i16>>> = Arc::new(Mutex::new(VecDeque::new()));
        let sys_q: Arc<Mutex<VecDeque<i16>>> = Arc::new(Mutex::new(VecDeque::new()));
        let mic_rate = Arc::new(AtomicU32::new(MIX_TARGET_HZ));
        let sys_rate = Arc::new(AtomicU32::new(MIX_TARGET_HZ));

        let streaming_active = Arc::clone(&self.streaming_active);
        streaming_active.store(true, Ordering::SeqCst);

        // Mixer → network (always 48 kHz mono for the dashboard).
        {
            let active = Arc::clone(&streaming_active);
            let mic_q = Arc::clone(&mic_q);
            let sys_q = Arc::clone(&sys_q);
            let mic_rate = Arc::clone(&mic_rate);
            let sys_rate = Arc::clone(&sys_rate);
            let write_tx = write_tx.clone();
            tokio::spawn(async move {
                let mut ticker =
                    tokio::time::interval(std::time::Duration::from_millis(50));
                while active.load(Ordering::SeqCst) {
                    ticker.tick().await;
                    let mic_raw = drain_queue(&mic_q);
                    let sys_raw = drain_queue(&sys_q);
                    let mr = mic_rate.load(Ordering::Relaxed).max(1);
                    let sr = sys_rate.load(Ordering::Relaxed).max(1);

                    let mic = if include_mic && !mic_raw.is_empty() {
                        resample_linear(&mic_raw, mr, MIX_TARGET_HZ)
                    } else {
                        Vec::new()
                    };
                    let sys = if include_system && !sys_raw.is_empty() {
                        resample_linear(&sys_raw, sr, MIX_TARGET_HZ)
                    } else {
                        Vec::new()
                    };

                    let mixed = mix_mono(&mic, &sys, include_mic, include_system);
                    if mixed.is_empty() {
                        continue;
                    }
                    // Send in ~50ms chunks (or whatever we mixed).
                    for chunk in mixed.chunks(MIX_CHUNK_SAMPLES.max(1)) {
                        send_pcm_frame(&write_tx, MIX_TARGET_HZ, chunk);
                    }
                }
            });
        }

        let host = cpal::default_host();
        let err_fn = |err| eprintln!("[AUDIO] Capture error: {}", err);

        if include_mic {
            match open_mic_stream(
                &host,
                opts.device_id.as_deref(),
                Arc::clone(&mic_q),
                Arc::clone(&mic_rate),
                Arc::clone(&streaming_active),
                err_fn,
            ) {
                Ok(stream) => {
                    stream
                        .play()
                        .map_err(|e| format!("Failed to start mic stream: {}", e))?;
                    self.mic_stream = Some(stream);
                    println!("[AUDIO] Mic capture started");
                }
                Err(e) => {
                    if !include_system {
                        streaming_active.store(false, Ordering::SeqCst);
                        return Err(e);
                    }
                    eprintln!("[AUDIO] Mic unavailable, continuing with system only: {}", e);
                }
            }
        }

        if include_system {
            match open_system_loopback(
                &host,
                Arc::clone(&sys_q),
                Arc::clone(&sys_rate),
                Arc::clone(&streaming_active),
                err_fn,
            ) {
                Ok(stream) => {
                    stream
                        .play()
                        .map_err(|e| format!("Failed to start system loopback: {}", e))?;
                    self.system_stream = Some(stream);
                    println!("[AUDIO] System (loopback) capture started");
                }
                Err(e) => {
                    if self.mic_stream.is_none() {
                        streaming_active.store(false, Ordering::SeqCst);
                        return Err(e);
                    }
                    eprintln!(
                        "[AUDIO] System loopback failed, continuing with mic only: {}",
                        e
                    );
                }
            }
        }

        if self.mic_stream.is_none() && self.system_stream.is_none() {
            streaming_active.store(false, Ordering::SeqCst);
            return Err("No audio capture source started".to_string());
        }

        Ok(())
    }

    pub fn stop_streaming(&mut self) {
        self.streaming_active.store(false, Ordering::SeqCst);
        self.mic_stream = None;
        self.system_stream = None;
        println!("[AUDIO] Audio capture stopped");
    }

    pub fn ensure_playback(&mut self, sample_rate: u32) -> Result<(), String> {
        let rate = if sample_rate >= 8000 && sample_rate <= 96000 {
            sample_rate
        } else {
            48000
        };

        if self.playback_active.load(Ordering::SeqCst)
            && self.playback_stream.is_some()
            && self.playback_rate.load(Ordering::SeqCst) == rate
        {
            return Ok(());
        }

        self.stop_playback();

        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No default output (speaker) device".to_string())?;

        let default_config = device
            .default_output_config()
            .map_err(|e| format!("Failed to get output config: {}", e))?;

        let channels = default_config.channels().max(1);
        let sample_format = default_config.sample_format();

        let mut config: cpal::StreamConfig = default_config.clone().into();
        config.sample_rate = cpal::SampleRate(rate);
        config.channels = channels;

        println!(
            "[AUDIO] Playback on: {} | {}Hz | {} ch | {:?}",
            device.name().unwrap_or_else(|_| "Unknown".to_string()),
            rate,
            channels,
            sample_format
        );

        let buf = Arc::clone(&self.playback_buf);
        let active = Arc::clone(&self.playback_active);
        let err_fn = |err| eprintln!("[AUDIO] Playback error: {}", err);

        let stream = match sample_format {
            cpal::SampleFormat::F32 => {
                let buf_c = Arc::clone(&buf);
                device
                    .build_output_stream(
                        &config,
                        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                            fill_output_f32(data, channels, &buf_c);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build output stream: {}", e))?
            }
            cpal::SampleFormat::I16 => {
                let buf_c = Arc::clone(&buf);
                device
                    .build_output_stream(
                        &config,
                        move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                            fill_output_i16(data, channels, &buf_c);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build output stream: {}", e))?
            }
            other => {
                return Err(format!("Unsupported speaker sample format: {:?}", other));
            }
        };

        stream
            .play()
            .map_err(|e| format!("Failed to start speaker playback: {}", e))?;
        self.playback_rate.store(rate, Ordering::SeqCst);
        active.store(true, Ordering::SeqCst);
        self.playback_stream = Some(stream);
        Ok(())
    }

    pub fn stop_playback(&mut self) {
        self.playback_active.store(false, Ordering::SeqCst);
        self.playback_stream = None;
        if let Ok(mut q) = self.playback_buf.lock() {
            q.clear();
        }
        println!("[AUDIO] Speaker playback stopped");
    }

    pub fn enqueue_playback(&mut self, sample_rate: u32, pcm: &[u8]) {
        if pcm.len() < 2 {
            return;
        }
        if let Err(err) = self.ensure_playback(sample_rate) {
            eprintln!("[AUDIO] ensure_playback: {}", err);
            return;
        }

        let sample_count = pcm.len() / 2;
        let mut samples = Vec::with_capacity(sample_count);
        for i in 0..sample_count {
            let lo = pcm[i * 2];
            let hi = pcm[i * 2 + 1];
            samples.push(i16::from_le_bytes([lo, hi]));
        }

        if let Ok(mut q) = self.playback_buf.lock() {
            for s in samples {
                if q.len() >= PLAYBACK_MAX_SAMPLES {
                    q.pop_front();
                }
                q.push_back(s);
            }
        }
    }
}

fn open_mic_stream(
    host: &cpal::Host,
    device_id: Option<&str>,
    queue: Arc<Mutex<VecDeque<i16>>>,
    rate_out: Arc<AtomicU32>,
    active: Arc<AtomicBool>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, String> {
    let device = if let Some(id) = device_id {
        let mut found = None;
        if let Ok(devices) = host.input_devices() {
            for dev in devices {
                if let Ok(name) = dev.name() {
                    if name == id {
                        found = Some(dev);
                        break;
                    }
                }
            }
        }
        found.ok_or_else(|| format!("Audio device '{}' not found", id))?
    } else {
        host.default_input_device()
            .ok_or_else(|| "No default input audio device found".to_string())?
    };

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get mic config: {}", e))?;
    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let sample_format = config.sample_format();
    rate_out.store(sample_rate, Ordering::Relaxed);

    println!(
        "[AUDIO] Mic device: {} | {}Hz | {} ch",
        device.name().unwrap_or_else(|_| "?".into()),
        sample_rate,
        channels
    );

    let q = Arc::clone(&queue);
    let act = Arc::clone(&active);
    match sample_format {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if !act.load(Ordering::Relaxed) {
                        return;
                    }
                    push_mono(&q, &mono_f32(data, channels));
                },
                err_fn,
                None,
            )
            .map_err(|e| e.to_string()),
        cpal::SampleFormat::I16 => device
            .build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if !act.load(Ordering::Relaxed) {
                        return;
                    }
                    push_mono(&q, &mono_i16(data, channels));
                },
                err_fn,
                None,
            )
            .map_err(|e| e.to_string()),
        other => Err(format!("Unsupported mic format: {:?}", other)),
    }
}

/// WASAPI loopback: build an *input* stream on the default *output* device.
/// Captures whatever the PC is playing (YouTube, games, etc.).
fn open_system_loopback(
    host: &cpal::Host,
    queue: Arc<Mutex<VecDeque<i16>>>,
    rate_out: Arc<AtomicU32>,
    active: Arc<AtomicBool>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, String> {
    let device = host
        .default_output_device()
        .ok_or_else(|| "No default output device for system loopback".to_string())?;

    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get output config for loopback: {}", e))?;
    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let sample_format = config.sample_format();
    rate_out.store(sample_rate, Ordering::Relaxed);

    println!(
        "[AUDIO] System loopback: {} | {}Hz | {} ch",
        device.name().unwrap_or_else(|_| "?".into()),
        sample_rate,
        channels
    );

    let stream_config: cpal::StreamConfig = config.clone().into();
    let q = Arc::clone(&queue);
    let act = Arc::clone(&active);

    match sample_format {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                &stream_config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if !act.load(Ordering::Relaxed) {
                        return;
                    }
                    push_mono(&q, &mono_f32(data, channels));
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("System loopback (f32) failed: {}", e)),
        cpal::SampleFormat::I16 => device
            .build_input_stream(
                &stream_config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if !act.load(Ordering::Relaxed) {
                        return;
                    }
                    push_mono(&q, &mono_i16(data, channels));
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("System loopback (i16) failed: {}", e)),
        other => Err(format!("Unsupported loopback format: {:?}", other)),
    }
}

fn push_mono(q: &Arc<Mutex<VecDeque<i16>>>, samples: &[i16]) {
    if let Ok(mut g) = q.lock() {
        for &s in samples {
            if g.len() > MIX_TARGET_HZ as usize * 2 {
                g.pop_front();
            }
            g.push_back(s);
        }
    }
}

fn drain_queue(q: &Arc<Mutex<VecDeque<i16>>>) -> Vec<i16> {
    match q.lock() {
        Ok(mut g) => g.drain(..).collect(),
        Err(_) => Vec::new(),
    }
}

fn mono_f32(data: &[f32], channels: usize) -> Vec<i16> {
    let ch = channels.max(1);
    let mut out = Vec::with_capacity(data.len() / ch);
    for frame in data.chunks(ch) {
        let sum: f32 = frame.iter().sum();
        let avg = sum / frame.len() as f32;
        out.push((avg * 32767.0).clamp(-32768.0, 32767.0) as i16);
    }
    out
}

fn mono_i16(data: &[i16], channels: usize) -> Vec<i16> {
    let ch = channels.max(1);
    let mut out = Vec::with_capacity(data.len() / ch);
    for frame in data.chunks(ch) {
        let sum: i32 = frame.iter().map(|&x| x as i32).sum();
        out.push((sum / frame.len() as i32) as i16);
    }
    out
}

fn resample_linear(input: &[i16], from_rate: u32, to_rate: u32) -> Vec<i16> {
    if input.is_empty() || from_rate == 0 {
        return Vec::new();
    }
    if from_rate == to_rate {
        return input.to_vec();
    }
    let out_len = ((input.len() as u64) * (to_rate as u64) / (from_rate as u64)) as usize;
    if out_len == 0 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = (i as f64) * (from_rate as f64) / (to_rate as f64);
        let i0 = src.floor() as usize;
        let i1 = (i0 + 1).min(input.len() - 1);
        let frac = (src - i0 as f64) as f32;
        let s =
            input[i0] as f32 * (1.0 - frac) + input[i1] as f32 * frac;
        out.push(s.round().clamp(-32768.0, 32767.0) as i16);
    }
    out
}

fn mix_mono(mic: &[i16], sys: &[i16], want_mic: bool, want_sys: bool) -> Vec<i16> {
    match (want_mic && !mic.is_empty(), want_sys && !sys.is_empty()) {
        (true, true) => {
            let n = mic.len().max(sys.len());
            let mut out = Vec::with_capacity(n);
            for i in 0..n {
                let a = *mic.get(i).unwrap_or(&0) as i32;
                let b = *sys.get(i).unwrap_or(&0) as i32;
                // Sum with soft clip — system usually louder.
                let m = (a + b).clamp(-32768, 32767) as i16;
                out.push(m);
            }
            out
        }
        (true, false) => mic.to_vec(),
        (false, true) => sys.to_vec(),
        _ => Vec::new(),
    }
}

fn send_pcm_frame(write_tx: &mpsc::UnboundedSender<Message>, sample_rate: u32, samples: &[i16]) {
    if samples.is_empty() {
        return;
    }
    let mut payload = Vec::with_capacity(1 + 4 + samples.len() * 2);
    payload.push(FRAME_AUDIO_STREAM);
    payload.extend_from_slice(&sample_rate.to_be_bytes());
    for s in samples {
        payload.extend_from_slice(&s.to_le_bytes());
    }
    let _ = write_tx.send(Message::Binary(payload));
}

fn fill_output_f32(data: &mut [f32], channels: u16, buf: &Arc<Mutex<VecDeque<i16>>>) {
    let ch = channels.max(1) as usize;
    let frames = data.len() / ch;
    let mut q = match buf.lock() {
        Ok(g) => g,
        Err(_) => {
            for s in data.iter_mut() {
                *s = 0.0;
            }
            return;
        }
    };
    for f in 0..frames {
        let sample = q.pop_front().unwrap_or(0);
        let v = sample as f32 / 32768.0;
        for c in 0..ch {
            data[f * ch + c] = v;
        }
    }
}

fn fill_output_i16(data: &mut [i16], channels: u16, buf: &Arc<Mutex<VecDeque<i16>>>) {
    let ch = channels.max(1) as usize;
    let frames = data.len() / ch;
    let mut q = match buf.lock() {
        Ok(g) => g,
        Err(_) => {
            for s in data.iter_mut() {
                *s = 0;
            }
            return;
        }
    };
    for f in 0..frames {
        let sample = q.pop_front().unwrap_or(0);
        for c in 0..ch {
            data[f * ch + c] = sample;
        }
    }
}
