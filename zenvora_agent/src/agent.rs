use std::sync::Arc;
use tokio::sync::mpsc;
use crate::activity::ActivityLogger;
use crate::audio::AudioState;
use crate::file_commands::FileState;
use crate::screen::ScreenState;
use crate::shell_commands::ShellState;
use crate::system::CameraState;

pub struct AgentState {
    pub camera: CameraState,
    pub screen: ScreenState,
    pub files: FileState,
    pub audio: AudioState,
    pub shell: ShellState,
    pub activity_logger: Option<Arc<ActivityLogger>>,
    /// Dedicated media WS payload senders (raw jpeg/frame bytes before ZV wrap).
    pub screen_media_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
    pub camera_media_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            camera: CameraState::new(),
            screen: ScreenState::new(),
            files: FileState::new(),
            audio: AudioState::new(),
            shell: ShellState::new(),
            activity_logger: None,
            screen_media_tx: None,
            camera_media_tx: None,
        }
    }
}
