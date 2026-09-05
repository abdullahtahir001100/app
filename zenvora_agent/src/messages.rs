//! Production user-facing messages with stable codes.
//! Keep in sync with `../shared/zenvora-messages.json` and `../MESSAGES.md`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MsgKind {
    Info,
    Success,
    Warn,
    Error,
}

#[derive(Clone, Copy, Debug)]
pub struct Msg {
    pub code: u16,
    pub kind: MsgKind,
    pub text: &'static str,
}

impl Msg {
    /// Production display: `[ZENVORA-804] Could not save credentials.`
    pub fn display(self) -> String {
        format!("[ZENVORA-{}] {}", self.code, self.text)
    }

    pub fn with_detail(self, detail: &str) -> String {
        let d = detail.trim();
        if d.is_empty() {
            self.display()
        } else {
            format!("[ZENVORA-{}] {} ({})", self.code, self.text, d)
        }
    }
}

// --- Progress / setup (100–199) ---
pub const M100_PROVISION_STARTED: Msg = Msg {
    code: 100,
    kind: MsgKind::Info,
    text: "Setup started",
};
pub const M101_PREPARING: Msg = Msg {
    code: 101,
    kind: MsgKind::Success,
    text: "Agent ready",
};
pub const M102_PAIRING: Msg = Msg {
    code: 102,
    kind: MsgKind::Info,
    text: "Pairing with cloud",
};
pub const M103_CREDENTIALS_READY: Msg = Msg {
    code: 103,
    kind: MsgKind::Success,
    text: "Credentials saved",
};
pub const M104_SERVICE_INSTALLING: Msg = Msg {
    code: 104,
    kind: MsgKind::Info,
    text: "Installing auto-start service",
};
pub const M105_SERVICE_RUNNING: Msg = Msg {
    code: 105,
    kind: MsgKind::Success,
    text: "Windows service running",
};
pub const M106_WORKER_STARTING: Msg = Msg {
    code: 106,
    kind: MsgKind::Info,
    text: "Starting agent worker",
};
pub const M107_WORKER_STARTED: Msg = Msg {
    code: 107,
    kind: MsgKind::Success,
    text: "Agent worker started",
};
pub const M108_CONNECTING: Msg = Msg {
    code: 108,
    kind: MsgKind::Info,
    text: "Connecting to gateway",
};
pub const M109_HANDSHAKE: Msg = Msg {
    code: 109,
    kind: MsgKind::Info,
    text: "Waiting for handshake",
};
pub const M110_GATEWAY_OK: Msg = Msg {
    code: 110,
    kind: MsgKind::Success,
    text: "Gateway connected",
};
pub const M111_SERVICE_FALLBACK: Msg = Msg {
    code: 111,
    kind: MsgKind::Warn,
    text: "Service issue — using backup start",
};
pub const M112_STILL_CONNECTING: Msg = Msg {
    code: 112,
    kind: MsgKind::Warn,
    text: "Still connecting in background",
};
pub const M113_SERVICE_REMOVED: Msg = Msg {
    code: 113,
    kind: MsgKind::Success,
    text: "Service removed",
};
pub const M114_CREDENTIALS_REFRESH: Msg = Msg {
    code: 114,
    kind: MsgKind::Info,
    text: "Refreshing pairing credentials",
};
pub const M115_GATEWAY_UPDATED: Msg = Msg {
    code: 115,
    kind: MsgKind::Success,
    text: "Gateway settings updated",
};
pub const M116_SERVICE_WORKER_OK: Msg = Msg {
    code: 116,
    kind: MsgKind::Success,
    text: "Service worker ready",
};

// --- Success finals (200–299) ---
pub const M200_CONNECTED: Msg = Msg {
    code: 200,
    kind: MsgKind::Success,
    text: "Connected successfully",
};

// --- Auth / pairing (400–499) ---
pub const M401_PAIR_REQUIRED: Msg = Msg {
    code: 401,
    kind: MsgKind::Error,
    text: "Pairing required — run install from the dashboard",
};
pub const M402_PAIR_FAILED: Msg = Msg {
    code: 402,
    kind: MsgKind::Error,
    text: "Pairing failed",
};
pub const M403_AUTH_REJECTED: Msg = Msg {
    code: 403,
    kind: MsgKind::Error,
    text: "Gateway rejected credentials",
};

// --- Connection (500–599) ---
pub const M501_CONNECT_FAILED: Msg = Msg {
    code: 501,
    kind: MsgKind::Error,
    text: "Could not reach gateway",
};
pub const M502_HANDSHAKE_TIMEOUT: Msg = Msg {
    code: 502,
    kind: MsgKind::Warn,
    text: "Handshake timed out — agent keeps retrying",
};
pub const M503_DUPLICATE_AGENT: Msg = Msg {
    code: 503,
    kind: MsgKind::Error,
    text: "Another agent is already connected for this device",
};

// --- Install / elevation / service (700–799) ---
pub const M701_ADMIN_REQUIRED: Msg = Msg {
    code: 701,
    kind: MsgKind::Error,
    text: "Administrator permission required to install",
};
pub const M702_INSTALL_DENIED: Msg = Msg {
    code: 702,
    kind: MsgKind::Error,
    text: "Install blocked — stop Zenvora service and retry",
};
pub const M703_INSTALL_COPY_FAILED: Msg = Msg {
    code: 703,
    kind: MsgKind::Error,
    text: "Could not copy agent to install folder",
};
pub const M704_LAUNCH_FAILED: Msg = Msg {
    code: 704,
    kind: MsgKind::Error,
    text: "Could not start agent from install folder",
};
pub const M705_SERVICE_START_FAILED: Msg = Msg {
    code: 705,
    kind: MsgKind::Error,
    text: "Could not start Windows service",
};
pub const M706_WORKER_LAUNCH_FAILED: Msg = Msg {
    code: 706,
    kind: MsgKind::Error,
    text: "Could not start agent worker",
};
pub const M707_SERVICE_OP_FAILED: Msg = Msg {
    code: 707,
    kind: MsgKind::Error,
    text: "Service operation failed",
};

// --- Storage / data (800–899) ---
pub const M801_CREDENTIAL_READ_FAILED: Msg = Msg {
    code: 801,
    kind: MsgKind::Error,
    text: "Could not read saved credentials",
};
pub const M802_CREDENTIAL_WRITE_FAILED: Msg = Msg {
    code: 802,
    kind: MsgKind::Error,
    text: "Could not save credentials",
};
pub const M803_CONFIG_INVALID: Msg = Msg {
    code: 803,
    kind: MsgKind::Error,
    text: "Agent configuration is invalid",
};
/// Reserved for server-side Mongo persistence failures surfaced to the agent UI.
pub const M804_STORAGE_ERROR: Msg = Msg {
    code: 804,
    kind: MsgKind::Error,
    text: "Cloud storage error",
};
pub const M805_STATUS_WRITE_FAILED: Msg = Msg {
    code: 805,
    kind: MsgKind::Warn,
    text: "Could not write connection status file",
};

// --- Media / hardware (900–949) ---
pub const M901_SESSION_ZERO: Msg = Msg {
    code: 901,
    kind: MsgKind::Error,
    text: "Camera/screen unavailable in Session 0 — restart while logged in",
};
pub const M902_CAMERA_IN_USE: Msg = Msg {
    code: 902,
    kind: MsgKind::Error,
    text: "Camera is in use by another app",
};
pub const M903_CAMERA_OPEN_FAILED: Msg = Msg {
    code: 903,
    kind: MsgKind::Error,
    text: "Could not open camera",
};
pub const M904_SCREEN_CAPTURE_FAILED: Msg = Msg {
    code: 904,
    kind: MsgKind::Error,
    text: "Screen capture failed",
};
