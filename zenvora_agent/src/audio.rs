use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

pub struct AudioState {
    pub streaming_active: Arc<AtomicBool>,
    stream: Option<cpal::Stream>,
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            streaming_active: Arc::new(AtomicBool::new(false)),
            stream: None,
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

    pub fn start_streaming(&mut self, write_tx: mpsc::UnboundedSender<Message>, device_id: Option<String>) -> Result<(), String> {
        if self.streaming_active.load(Ordering::SeqCst) {
            return Ok(());
        }

        let host = cpal::default_host();
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
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        let sample_rate = config.sample_rate().0;
        let channels = config.channels();
        let sample_format = config.sample_format();

        println!(
            "[AUDIO] Capturing from: {} | Sample Rate: {}Hz | Channels: {} | Format: {:?}",
            device.name().unwrap_or_else(|_| "Unknown".to_string()),
            sample_rate,
            channels,
            sample_format
        );

        let streaming_active = Arc::clone(&self.streaming_active);
        streaming_active.store(true, Ordering::SeqCst);

        // We will buffer samples and send them in chunks
        // Calculate target chunk size for ~100ms of mono samples
        let chunk_size = sample_rate as usize / 10; 

        let err_fn = |err| eprintln!("[AUDIO] Stream error: {}", err);

        let write_tx_clone = write_tx.clone();
        let streaming_active_clone = Arc::clone(&streaming_active);

        let send_chunk = move |samples: Vec<i16>| {
            if samples.is_empty() {
                return;
            }
            let mut payload = Vec::with_capacity(1 + 4 + samples.len() * 2);
            payload.push(0x0A); // Frame Type: FRAME_AUDIO_STREAM
            // Write sample rate as u32 big-endian
            payload.extend_from_slice(&sample_rate.to_be_bytes());
            // Write mono i16 samples as bytes
            for s in samples {
                payload.extend_from_slice(&s.to_le_bytes());
            }
            let _ = write_tx_clone.send(Message::Binary(payload));
        };

        let (audio_tx, mut audio_rx) = mpsc::unbounded_channel::<Vec<i16>>();

        // Spawn worker task to handle batching and network dispatching
        tokio::spawn(async move {
            let mut batch = Vec::new();
            while let Some(mut samples) = audio_rx.recv().await {
                if !streaming_active_clone.load(Ordering::SeqCst) {
                    break;
                }
                batch.append(&mut samples);
                if batch.len() >= chunk_size {
                    send_chunk(batch.clone());
                    batch.clear();
                }
            }
        });

        let audio_tx_clone = audio_tx.clone();
        let stream = match sample_format {
            cpal::SampleFormat::F32 => {
                device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let mut mono_samples = Vec::new();
                        for frame in data.chunks(channels as usize) {
                            if frame.is_empty() {
                                continue;
                            }
                            let sum: f32 = frame.iter().sum();
                            let avg = sum / frame.len() as f32;
                            let sample_i16 = (avg * 32767.0).clamp(-32768.0, 32767.0) as i16;
                            mono_samples.push(sample_i16);
                        }
                        let _ = audio_tx_clone.send(mono_samples);
                    },
                    err_fn,
                    None
                )
            }
            cpal::SampleFormat::I16 => {
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let mut mono_samples = Vec::new();
                        for frame in data.chunks(channels as usize) {
                            if frame.is_empty() {
                                continue;
                            }
                            let sum: i32 = frame.iter().map(|&x| x as i32).sum();
                            let avg = (sum / frame.len() as i32) as i16;
                            mono_samples.push(avg);
                        }
                        let _ = audio_tx_clone.send(mono_samples);
                    },
                    err_fn,
                    None
                )
            }
            _ => return Err("Unsupported sample format".to_string()),
        }.map_err(|e| format!("Failed to build input stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to play audio stream: {}", e))?;
        self.stream = Some(stream);

        Ok(())
    }

    pub fn stop_streaming(&mut self) {
        self.streaming_active.store(false, Ordering::SeqCst);
        self.stream = None; 
        println!("[AUDIO] Audio capture stopped");
    }
}
