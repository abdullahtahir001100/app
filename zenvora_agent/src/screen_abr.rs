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
    pub rtt_ms: u64,
    pub bad_ticks: u32,
    pub good_ticks: u32,
}

impl Default for AbrState {
    fn default() -> Self {
        Self {
            max_width: 960,
            jpeg_quality: 55,
            target_fps: 26,
            last_ack_time: Instant::now(),
            buffered_amount: 0,
            current_level: 3, // Default to level 3 (Medium)
            rtt_ms: 0,
            bad_ticks: 0,
            good_ticks: 0,
        }
    }
}

pub struct ScreenAbr {
    levels: Vec<(u32, u8, u32)>, // width, quality, fps
    pub state: AbrState,
}

impl ScreenAbr {
    pub fn new() -> Self {
        let mut abr = Self {
            levels: vec![
                (180, 25, 12),   // Level 0: Ultra low (2G / severe network starvation)
                (360, 35, 16),   // Level 1: Low (3G)
                (540, 42, 22),   // Level 2: Medium-low
                (960, 55, 26),   // Level 3: Medium (Default)
                (1280, 68, 22),  // Level 4: High
                (1600, 75, 20),  // Level 5: Ultra
            ],
            state: AbrState::default(),
        };
        abr.apply_level();
        abr
    }

    pub fn update_from_ack(&mut self, buffered_amount: usize, rtt_ms: u64) {
        self.state.last_ack_time = Instant::now();
        self.state.buffered_amount = buffered_amount;
        let prev_rtt = self.state.rtt_ms;
        self.state.rtt_ms = rtt_ms;

        // Smarter drop condition: buffer > 200KB or rtt > 300ms or rtt rising steeply (> 200ms and +50ms)
        let is_degraded = buffered_amount > 200 * 1024
            || rtt_ms > 300
            || (rtt_ms > 200 && rtt_ms > prev_rtt.saturating_add(50));

        // Upgrade condition: buffer < 30KB and rtt < 80ms
        let is_healthy = buffered_amount < 30 * 1024 && rtt_ms < 80;

        if is_degraded {
            self.state.good_ticks = 0;
            self.state.bad_ticks = self.state.bad_ticks.saturating_add(1);
            // Require 2 consecutive bad ticks (or immediate if extreme choke > 500KB)
            if self.state.bad_ticks >= 2 || buffered_amount > 500 * 1024 {
                self.drop_level();
                self.state.bad_ticks = 0;
            }
        } else if is_healthy {
            self.state.bad_ticks = 0;
            self.state.good_ticks = self.state.good_ticks.saturating_add(1);
            // Require 3 consecutive good ticks before upgrading
            if self.state.good_ticks >= 3 {
                self.increase_level();
                self.state.good_ticks = 0;
            }
        } else {
            // Neutral band
            self.state.bad_ticks = self.state.bad_ticks.saturating_sub(1);
            self.state.good_ticks = self.state.good_ticks.saturating_sub(1);
        }
    }

    pub fn current_rtt_ms(&self) -> u64 {
        self.state.rtt_ms
    }

    pub fn current_level(&self) -> usize {
        self.state.current_level
    }

    pub fn drop_level(&mut self) {
        if self.state.current_level > 0 {
            self.state.current_level -= 1;
            self.apply_level();
        }
    }

    pub fn increase_level(&mut self) {
        if self.state.current_level < self.levels.len() - 1 {
            self.state.current_level += 1;
            self.apply_level();
        }
    }

    fn apply_level(&mut self) {
        if let Some(&(w, q, fps)) = self.levels.get(self.state.current_level) {
            self.state.max_width = w;
            self.state.jpeg_quality = q;
            self.state.target_fps = fps;
        }
    }
}

