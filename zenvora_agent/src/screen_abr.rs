use std::time::Instant;

#[derive(Debug, Clone)]
pub struct AbrState {
    pub max_width: u32,
    pub jpeg_quality: u8,
    pub target_fps: u32,
    
    // ABR stats
    pub last_ack_time: Instant,
    pub buffered_amount: usize,
    pub current_level: usize,
}

impl Default for AbrState {
    fn default() -> Self {
        Self {
            max_width: 960,
            jpeg_quality: 55,
            target_fps: 28,
            last_ack_time: Instant::now(),
            buffered_amount: 0,
            current_level: 2, // Default to level 2
        }
    }
}

pub struct ScreenAbr {
    levels: Vec<(u32, u8, u32)>, // width, quality, fps
    pub state: AbrState,
}

impl ScreenAbr {
    pub fn new() -> Self {
        Self {
            levels: vec![
                (360, 35, 18),   // Level 0: Ultra low (e.g., slow 3G)
                (540, 40, 24),   // Level 1: Low
                (960, 55, 28),   // Level 2: Medium (Default)
                (1280, 68, 22),  // Level 3: High
                (1600, 75, 20),  // Level 4: Ultra
            ],
            state: AbrState::default(),
        }
    }

    pub fn update_from_ack(&mut self, buffered_amount: usize, rtt_ms: u64) {
        self.state.last_ack_time = Instant::now();
        self.state.buffered_amount = buffered_amount;

        // Simple ABR logic: if client buffer > 500KB or high RTT, drop quality.
        if buffered_amount > 500 * 1024 || rtt_ms > 500 {
            self.drop_level();
        } else if buffered_amount < 50 * 1024 && rtt_ms < 100 {
            self.increase_level();
        }
    }

    fn drop_level(&mut self) {
        if self.state.current_level > 0 {
            self.state.current_level -= 1;
            self.apply_level();
        }
    }

    fn increase_level(&mut self) {
        if self.state.current_level < self.levels.len() - 1 {
            self.state.current_level += 1;
            self.apply_level();
        }
    }

    fn apply_level(&mut self) {
        let (w, q, fps) = self.levels[self.state.current_level];
        self.state.max_width = w;
        self.state.jpeg_quality = q;
        self.state.target_fps = fps;
    }
}
