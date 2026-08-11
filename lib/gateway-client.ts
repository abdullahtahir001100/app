"use client";

export type DeviceOption = {
  value: string;
  label: string;
  role?: string;
  status?: string;
  platform?: string;
  localIp?: string;
  publicIp?: string;
  battery?: number | null;
  storage?: number | null;
  lastSeen?: string | null;
  network?: string;
  hostname?: string;
  username?: string;
};

export type DeviceRecord = {
  deviceId: string;
  platform: "windows" | "mac" | "android" | "linux" | "unknown";
  status: "online" | "offline";
  clientPort: number;
  localIp: string;
  publicIp: string;
  battery: number | null;
  storage: number | null;
  network: string;
  latitude: number | null;
  longitude: number | null;
  country: string;
  region: string;
  city: string;
  isp: string;
  timezone: string;
  hostname: string;
  username: string;
  osVersion: string;
  architecture: string;
  cpu: string;
  ram: number | null;
  lastSeen: string;
};

export type GatewayEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "devices"; devices: DeviceOption[] }
  | { type: "json"; packet: Record<string, unknown> }
  | { type: "binary"; data: ArrayBuffer | Blob };

type GatewayListener = (event: GatewayEvent) => void;

const DEVICE_CACHE_PREFIX = "zenvora_device_registry:";
const DEVICE_CACHE_LEGACY_KEY = "zenvora_device_registry";
const DEVICE_CACHE_TTL_MS = 12_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
/** Only treat as dead after long silence — never flap on brief proxy stalls. */
const HEARTBEAT_TIMEOUT_MS = 5 * 60_000;
const CACHE_USER_KEY = "zenvora_cache_user_id";

function deviceCacheKey(userId: string | null | undefined) {
  return `${DEVICE_CACHE_PREFIX}${userId || "anon"}`;
}

function readDeviceCache(userId?: string | null): {
  options: DeviceOption[];
  records: DeviceRecord[];
  at: number;
  userId?: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    // Drop legacy unscoped cache (cross-user leak source).
    sessionStorage.removeItem(DEVICE_CACHE_LEGACY_KEY);
    const uid = userId || sessionStorage.getItem(CACHE_USER_KEY);
    if (!uid) return null;
    const raw = sessionStorage.getItem(deviceCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      options?: DeviceOption[];
      records?: DeviceRecord[];
      at?: number;
      userId?: string;
    };
    if (!parsed.at || !Array.isArray(parsed.options) || !Array.isArray(parsed.records)) {
      return null;
    }
    if (parsed.userId && parsed.userId !== uid) return null;
    return { options: parsed.options, records: parsed.records, at: parsed.at, userId: uid };
  } catch {
    return null;
  }
}

function writeDeviceCache(
  options: DeviceOption[],
  records: DeviceRecord[],
  userId?: string | null
) {
  if (typeof window === "undefined") return;
  try {
    const uid = userId || sessionStorage.getItem(CACHE_USER_KEY);
    if (!uid) return;
    sessionStorage.setItem(CACHE_USER_KEY, uid);
    sessionStorage.setItem(
      deviceCacheKey(uid),
      JSON.stringify({ options, records, at: Date.now(), userId: uid })
    );
  } catch {
    // ignore quota errors
  }
}

export function clearDeviceRegistryCache() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(DEVICE_CACHE_LEGACY_KEY);
    const uid = sessionStorage.getItem(CACHE_USER_KEY);
    if (uid) sessionStorage.removeItem(deviceCacheKey(uid));
    sessionStorage.removeItem(CACHE_USER_KEY);
    // Sweep any leftover keyed caches
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(DEVICE_CACHE_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

/** Bind device cache to the signed-in user; clears stale cache on user switch. */
export function bindDeviceCacheUser(userId: string | null | undefined) {
  if (typeof window === "undefined") return;
  const next = userId ? String(userId) : "";
  try {
    const prev = sessionStorage.getItem(CACHE_USER_KEY) || "";
    if (prev && next && prev !== next) {
      clearDeviceRegistryCache();
    }
    if (next) {
      sessionStorage.setItem(CACHE_USER_KEY, next);
    } else {
      clearDeviceRegistryCache();
    }
  } catch {
    // ignore
  }
}

function toDeviceOption(record: DeviceRecord): DeviceOption {
  return {
    value: record.deviceId,
    label: record.hostname || record.deviceId,
    role: "AGENT",
    status: record.status,
    platform: record.platform,
    localIp: record.localIp || undefined,
    publicIp: record.publicIp || undefined,
    battery: record.battery,
    storage: record.storage,
    lastSeen: record.lastSeen || null,
    network: record.network || undefined,
    hostname: record.hostname || undefined,
    username: record.username || undefined,
  };
}

function normalizeDeviceRecord(raw: Record<string, unknown>): DeviceRecord {
  return {
    deviceId: String(raw.deviceId || raw.value || ""),
    platform: (raw.platform as DeviceRecord["platform"]) || "unknown",
    status: raw.status === "online" ? "online" : "offline",
    clientPort: typeof raw.clientPort === "number" ? raw.clientPort : 8080,
    localIp: String(raw.localIp || ""),
    publicIp: String(raw.publicIp || ""),
    battery: typeof raw.battery === "number" ? raw.battery : null,
    storage: typeof raw.storage === "number" ? raw.storage : null,
    network: String(raw.network || ""),
    latitude: typeof raw.latitude === "number" ? raw.latitude : null,
    longitude: typeof raw.longitude === "number" ? raw.longitude : null,
    country: String(raw.country || ""),
    region: String(raw.region || ""),
    city: String(raw.city || ""),
    isp: String(raw.isp || ""),
    timezone: String(raw.timezone || ""),
    hostname: String(raw.hostname || raw.label || ""),
    username: String(raw.username || ""),
    osVersion: String(raw.osVersion || ""),
    architecture: String(raw.architecture || ""),
    cpu: String(raw.cpu || ""),
    ram: typeof raw.ram === "number" ? raw.ram : null,
    lastSeen: raw.lastSeen ? String(raw.lastSeen) : "",
  };
}

/** One WebSocket per browser tab — survives Next.js page navigation. */
class GatewayClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<GatewayListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private devices: DeviceOption[] = [];
  private fullDevices: DeviceRecord[] = [];
  private connecting = false;
  private cameraStreaming = false;
  private cameraStreamingAgentId = "";
  private screenStreaming = false;
  private screenStreamingAgentId = "";
  private lastRefreshAt = 0;
  private refreshPromise: Promise<DeviceOption[]> | null = null;
  private devicesFetchInFlight = false;
  /** Unique per tab so multiple dashboards don't overwrite DASHBOARD_UNIFIED_PANEL. */
  private panelId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `panel-${crypto.randomUUID()}`
      : `panel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  private lifecycleBound = false;
  private reconnectAttempt = 0;
  private connectGeneration = 0;
  /** Cached short-lived WS ticket — avoid blocking first open on HTTP. */
  private cachedWsTicket: string | null = null;
  private cachedWsTicketAt = 0;
  private preferTicket = false;

  constructor() {
    const cached = readDeviceCache();
    if (cached) {
      this.devices = cached.options;
      this.fullDevices = cached.records;
      this.lastRefreshAt = cached.at;
    } else {
      this.devices = [];
      this.fullDevices = [];
    }
    this.bindLifecycleHandlers();
  }

  /** Call after login/session resolve so cache never crosses users. */
  bindUser(userId: string | null | undefined) {
    const prev =
      typeof window !== "undefined" ? sessionStorage.getItem(CACHE_USER_KEY) : null;
    bindDeviceCacheUser(userId);
    if (prev && userId && prev !== String(userId)) {
      this.devices = [];
      this.fullDevices = [];
      this.lastRefreshAt = 0;
      this.emit({ type: "devices", devices: [] });
    } else if (userId) {
      const cached = readDeviceCache(String(userId));
      if (cached) {
        this.devices = cached.options;
        this.fullDevices = cached.records;
        this.lastRefreshAt = cached.at;
      }
    }
  }

  clearCachedDevices() {
    clearDeviceRegistryCache();
    this.devices = [];
    this.fullDevices = [];
    this.lastRefreshAt = 0;
  }

  private bindLifecycleHandlers() {
    if (typeof window === "undefined" || this.lifecycleBound) return;
    this.lifecycleBound = true;

    const resumeIfDead = () => {
      const state = this.ws?.readyState;
      // Never abort OPEN/CONNECTING — persistence first.
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING || this.connecting) {
        return;
      }
      this.ws = null;
      this.ensureConnected();
    };

    window.addEventListener("online", () => {
      resumeIfDead();
      void this.refreshDevices({ force: true });
    });

    // BFCache (back/forward) kills WS — resume only when actually dead.
    window.addEventListener("pageshow", (ev) => {
      const persisted = Boolean((ev as PageTransitionEvent).persisted);
      if (persisted) resumeIfDead();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      // Visible again: reconnect ONLY if socket died; never close a live one.
      resumeIfDead();
    });
  }

  subscribe(listener: GatewayListener): () => void {
    this.listeners.add(listener);
    this.ensureConnected();

    if (this.ws?.readyState === WebSocket.OPEN) {
      listener({ type: "connected" });
      if (this.devices.length > 0) {
        listener({ type: "devices", devices: this.devices });
      }
    } else if (this.devices.length > 0) {
      listener({ type: "devices", devices: this.devices });
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: GatewayEvent) {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("[GATEWAY] listener error:", err);
      }
    });
  }

  ensureConnected() {
    if (typeof window === "undefined") return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.connecting) return;
    void this.connect();
  }

  private async fetchWsTicket(): Promise<string | null> {
    try {
      const res = await fetch("/api/auth/ws-ticket", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const ticket = typeof data?.ticket === "string" ? data.ticket : null;
      if (ticket) {
        this.cachedWsTicket = ticket;
        this.cachedWsTicketAt = Date.now();
      }
      return ticket;
    } catch {
      return null;
    }
  }

  private getFreshCachedTicket(): string | null {
    if (!this.cachedWsTicket) return null;
    // Tickets last 15m server-side; reuse ~10m client-side.
    if (Date.now() - this.cachedWsTicketAt > 10 * 60_000) {
      this.cachedWsTicket = null;
      return null;
    }
    return this.cachedWsTicket;
  }

  private async connect() {
    if (typeof window === "undefined") return;
    // Single-flight: never open a second socket while one is connecting/open.
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.connecting) return;

    this.connecting = true;
    const generation = ++this.connectGeneration;

    const configured =
      typeof process !== "undefined" && process.env.NEXT_PUBLIC_GATEWAY_URL
        ? String(process.env.NEXT_PUBLIC_GATEWAY_URL).trim()
        : "";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const baseUrl = configured || `${protocol}//${window.location.host}/ws/gateway`;

    // Prefer ticket auth (proxies often strip Cookie on Upgrade).
    // Cached ticket = open immediately; otherwise one fast HTTP then open.
    let ticket: string | null = this.getFreshCachedTicket();
    if (!ticket) {
      ticket = await this.fetchWsTicket();
      if (generation !== this.connectGeneration) {
        this.connecting = false;
        return;
      }
    }
    this.preferTicket = Boolean(ticket);

    // Re-check after await — another caller may have connected.
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      this.connecting = false;
      return;
    }

    const gatewayUrl = ticket
      ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(ticket)}`
      : baseUrl;

    let ws: WebSocket;
    try {
      ws = new WebSocket(gatewayUrl);
    } catch (err) {
      console.warn("[GATEWAY] WebSocket construct failed:", err);
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }

    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let lastPongAt = Date.now();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    // Do NOT abort CONNECTING sockets — that caused "closed before established" loops on Railway.

    ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempt = 0;
      lastPongAt = Date.now();
      ws.send(
        JSON.stringify({
          type: "register_channel",
          role: "DASHBOARD",
          id: this.panelId,
        })
      );
      this.emit({ type: "connected" });
      // Always re-fetch owner-scoped HTTP list after connect — never trust a stale
      // session cache that may have leaked cross-user devices from a prior bug.
      void this.refreshDevices({ force: true });

      heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          stopHeartbeat();
          return;
        }

        // Soft keep-alive: ping often, but only drop after 5 minutes of total silence.
        if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
          console.warn(
            `[GATEWAY] no traffic for ${Math.round((Date.now() - lastPongAt) / 1000)}s — soft reconnect`
          );
          stopHeartbeat();
          // Mark dead without racing a second connect while CLOSE is in-flight.
          try {
            ws.close(4000, "idle-timeout");
          } catch {
            // ignore
          }
          return;
        }

        try {
          ws.send(JSON.stringify({ type: "dashboard_ping" }));
        } catch {
          // Send failure means socket is already dead — onclose will reconnect.
          stopHeartbeat();
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      // Any healthy traffic resets heartbeat timeout (prevents false close during media).
      lastPongAt = Date.now();

      if (typeof event.data !== "string") {
        this.emit({ type: "binary", data: event.data as ArrayBuffer | Blob });
        return;
      }

      try {
        const packet = JSON.parse(event.data) as Record<string, unknown>;
        if (packet.type === "dashboard_pong" || packet.type === "sys_ack" || packet.type === "agent_pong") {
          lastPongAt = Date.now();
        }

        // Auth failed after open — next connect must use a fresh ticket.
        if (
          packet.type === "sys_ack" &&
          (packet.status === "auth_failed" || packet.status === "auth_timeout")
        ) {
          console.warn("[GATEWAY]", packet.message || packet.status);
          this.preferTicket = true;
          this.cachedWsTicket = null;
          this.cachedWsTicketAt = 0;
          stopHeartbeat();
          try {
            ws.close();
          } catch {
            // ignore
          }
          // Immediately reconnect with a fresh ticket (don't wait full backoff).
          this.reconnectAttempt = 0;
          setTimeout(() => this.ensureConnected(), 300);
          return;
        }

        this.trackStreamingState(packet);

        if (
          (packet.type === "device_list_update" || packet.type === "sys_ack") &&
          Array.isArray(packet.devices)
        ) {
          const incoming = (packet.devices as Record<string, unknown>[]).map((raw) => {
            const record = normalizeDeviceRecord(raw);
            return toDeviceOption(record);
          });
          this.devices = incoming;
          this.fullDevices = (packet.devices as Record<string, unknown>[])
            .map(normalizeDeviceRecord)
            .filter((d) => d.deviceId);
          this.lastRefreshAt = Date.now();
          writeDeviceCache(this.devices, this.fullDevices);
          this.emit({ type: "devices", devices: this.devices });
        }

        if (packet.type === "device_status_update" && typeof packet.deviceId === "string") {
          const deviceId = String(packet.deviceId);
          const status = packet.status === "online" ? "online" : "offline";
          const patchOption = (d: DeviceOption): DeviceOption => {
            if (d.value !== deviceId) return d;
            const next: DeviceOption = { ...d, status };
            if (typeof packet.battery === "number") next.battery = packet.battery;
            if (typeof packet.storage === "number") next.storage = packet.storage;
            if (typeof packet.localIp === "string" && packet.localIp) next.localIp = packet.localIp;
            if (typeof packet.publicIp === "string" && packet.publicIp) next.publicIp = packet.publicIp;
            if (typeof packet.network === "string" && packet.network) next.network = packet.network;
            if (typeof packet.platform === "string" && packet.platform && packet.platform !== "unknown") {
              next.platform = packet.platform;
            }
            if (typeof packet.hostname === "string" && packet.hostname) {
              next.hostname = packet.hostname;
              next.label = packet.hostname;
            }
            if (typeof packet.username === "string" && packet.username) next.username = packet.username;
            if (typeof packet.lastSeen === "string" && packet.lastSeen) next.lastSeen = packet.lastSeen;
            return next;
          };
          const patchRecord = (d: DeviceRecord): DeviceRecord => {
            if (d.deviceId !== deviceId) return d;
            return {
              ...d,
              status,
              ...(typeof packet.battery === "number" ? { battery: packet.battery } : {}),
              ...(typeof packet.storage === "number" ? { storage: packet.storage } : {}),
              ...(typeof packet.localIp === "string" && packet.localIp
                ? { localIp: packet.localIp }
                : {}),
              ...(typeof packet.publicIp === "string" && packet.publicIp
                ? { publicIp: packet.publicIp }
                : {}),
              ...(typeof packet.network === "string" && packet.network
                ? { network: packet.network }
                : {}),
              ...(typeof packet.platform === "string" && packet.platform
                ? { platform: packet.platform as DeviceRecord["platform"] }
                : {}),
              ...(typeof packet.hostname === "string" && packet.hostname
                ? { hostname: packet.hostname }
                : {}),
              ...(typeof packet.username === "string" && packet.username
                ? { username: packet.username }
                : {}),
              ...(typeof packet.lastSeen === "string" && packet.lastSeen
                ? { lastSeen: packet.lastSeen }
                : {}),
            };
          };
          this.devices = this.devices.map(patchOption);
          this.fullDevices = this.fullDevices.map(patchRecord);
          // If agent was live-only (not in list yet), add a stub with whatever we have.
          if (!this.devices.some((d) => d.value === deviceId)) {
            const record = normalizeDeviceRecord({ ...packet, deviceId, status });
            this.devices = [toDeviceOption(record), ...this.devices];
            this.fullDevices = [record, ...this.fullDevices];
          }
          writeDeviceCache(this.devices, this.fullDevices);
          this.emit({ type: "devices", devices: this.devices });
        }

        this.emit({ type: "json", packet });
      } catch {
        // ignore malformed packets
      }
    };

    ws.onerror = () => {
      // onclose will schedule reconnect
    };

    ws.onclose = () => {
      stopHeartbeat();
      this.connecting = false;
      if (this.ws === ws) this.ws = null;
      this.emit({ type: "disconnected" });
      // Singleton must stay alive across React remounts / BFCache — always resume.
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Already open/connecting — nothing to do.
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING ||
      this.connecting
    ) {
      return;
    }
    this.reconnectAttempt += 1;
    // Gentle backoff: 1s → 2s → 5s → 10s → 20s (cap) — never spam.
    const steps = [1000, 2000, 5000, 10000, 20000];
    const delay = steps[Math.min(this.reconnectAttempt - 1, steps.length - 1)];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private sameDevices(a: DeviceOption[], b: DeviceOption[]) {
    if (a.length !== b.length) return false;

    const sortFn = (x: DeviceOption, y: DeviceOption) => x.value.localeCompare(y.value);
    const aa = [...a].sort(sortFn);
    const bb = [...b].sort(sortFn);

    return aa.every((d, i) => {
      const x = bb[i];
      return (
        d.value === x.value &&
        d.status === x.status &&
        d.battery === x.battery &&
        d.storage === x.storage &&
        d.lastSeen === x.lastSeen
      );
    });
  }

  isDevicesFetchInFlight(): boolean {
    return this.devicesFetchInFlight;
  }

  hasDeviceCache(): boolean {
    return this.devices.length > 0 || this.fullDevices.length > 0;
  }

  getFullDevices(): DeviceRecord[] {
    return this.fullDevices;
  }

  async refreshDevices(options: { force?: boolean } = {}): Promise<DeviceOption[]> {
    const { force = false } = options;
    const now = Date.now();

    if (!force && this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!force && now - this.lastRefreshAt < DEVICE_CACHE_TTL_MS && this.devices.length > 0) {
      return this.devices;
    }

    this.devicesFetchInFlight = true;
    this.refreshPromise = this.fetchDevicesFromNetwork()
      .finally(() => {
        this.devicesFetchInFlight = false;
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  private async fetchDevicesFromNetwork(): Promise<DeviceOption[]> {
    try {
      const response = await fetch("/api/network/devices", {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        return this.devices;
      }

      const data = await response.json().catch(() => null);
      if (!data?.success || !Array.isArray(data.devices)) {
        return this.devices;
      }

      const records = (data.devices as Record<string, unknown>[])
        .map(normalizeDeviceRecord)
        .filter((device) => device.deviceId);

      const options = records.map(toDeviceOption);

      this.lastRefreshAt = Date.now();
      writeDeviceCache(options, records);

      if (!this.sameDevices(this.devices, options)) {
        this.devices = options;
        this.fullDevices = records;
        this.emit({ type: "devices", devices: this.devices });
      } else {
        this.fullDevices = records;
      }

      return this.devices;
    } catch {
      return this.devices;
    }
  }

  dispatch(action: string, targetDeviceId: string, payload: Record<string, unknown> = {}): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!targetDeviceId) {
      return false;
    }

    this.ws.send(
      JSON.stringify({
        type: "dispatch_control",
        targetDeviceId,
        action,
        payload,
      })
    );
    return true;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getDevices(): DeviceOption[] {
    return this.devices;
  }

  getSocket(): WebSocket | null {
    return this.ws;
  }

  isCameraStreaming(): boolean {
    return this.cameraStreaming;
  }

  getCameraStreamingAgentId(): string {
    return this.cameraStreamingAgentId;
  }

  isScreenStreaming(): boolean {
    return this.screenStreaming;
  }

  getScreenStreamingAgentId(): string {
    return this.screenStreamingAgentId;
  }

  private trackStreamingState(packet: Record<string, unknown>) {
    const packetType = String(packet.type || "");
    const isCameraPacket =
      packetType === "camera_telemetry_stream" ||
      (packetType === "sys_ack" && packet.channel === "camera");
    const isScreenPacket =
      packetType === "screen_telemetry_stream" ||
      (packetType === "sys_ack" && packet.channel === "screen");

    const metrics =
      (packet.metrics as Record<string, unknown> | undefined) ||
      (packet.hardware_metrics as Record<string, unknown> | undefined);

    const sender = typeof packet.senderAgentId === "string" ? packet.senderAgentId : "";

    if (isCameraPacket && typeof metrics?.streaming_active === "boolean") {
      // Only promote ON — transient false during reconnect must not clear intent.
      if (metrics.streaming_active === true) {
        this.cameraStreaming = true;
        if (sender) this.cameraStreamingAgentId = sender;
        try {
          sessionStorage.setItem("zenvora_camera_streaming", "1");
        } catch {
          // ignore storage errors
        }
      }
    }

    if (isScreenPacket && typeof metrics?.streaming_active === "boolean") {
      if (metrics.streaming_active === true) {
        this.screenStreaming = true;
        if (sender) this.screenStreamingAgentId = sender;
        try {
          sessionStorage.setItem("zenvora_screen_streaming", "1");
        } catch {
          // ignore storage errors
        }
      }
    }

    if (isCameraPacket && metrics?.camera_blocked === true) {
      this.cameraStreaming = false;
      try {
        sessionStorage.setItem("zenvora_camera_streaming", "0");
      } catch {
        // ignore storage errors
      }
    }
  }
}

export const gatewayClient = new GatewayClient();
