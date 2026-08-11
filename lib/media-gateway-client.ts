"use client";

/**
 * Dedicated media WebSocket for screen/camera frames.
 * Keeps heavy binary traffic off /ws/gateway so heartbeats stay healthy.
 */

type MediaListener = (data: ArrayBuffer | Blob) => void;
type MediaStateListener = (state: "connecting" | "open" | "closed" | "error") => void;

const HEARTBEAT_INTERVAL_MS = 25_000;
/** Only close if truly idle — frames + pongs both count as alive. */
const HEARTBEAT_TIMEOUT_MS = 120_000;
const HANDSHAKE_TIMEOUT_MS = 20_000;

function nextBackoff(attempt: number): number {
  const steps = [2000, 4000, 8000, 15000, 30000, 45000];
  return steps[Math.min(Math.max(attempt - 1, 0), steps.length - 1)];
}

export class MediaGatewayClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<MediaListener>();
  private stateListeners = new Set<MediaStateListener>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPongAt = 0;
  private deviceId = "";
  private channel = "";
  private closedByUser = false;
  private connecting = false;
  private connectGeneration = 0;
  private openWaiters: Array<{
    resolve: (ok: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  subscribe(listener: MediaListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: MediaStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Wait until /ws/media is OPEN (or timeout). */
  waitUntilOpen(timeoutMs = 15_000): Promise<boolean> {
    if (this.isOpen()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.openWaiters = this.openWaiters.filter((w) => w.resolve !== resolve);
        resolve(this.isOpen());
      }, timeoutMs);
      this.openWaiters.push({ resolve, timer });
      if (!this.connecting && !this.isOpen()) {
        void this.open();
      }
    });
  }

  async connect(deviceId: string, channel: string) {
    this.deviceId = deviceId;
    this.channel = channel;
    this.closedByUser = false;
    await this.open();
  }

  disconnect() {
    this.closedByUser = true;
    this.connectGeneration += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.clearHandshakeTimer();
    this.failOpenWaiters(false);
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
    this.connecting = false;
    this.emitState("closed");
  }

  private emitState(state: "connecting" | "open" | "closed" | "error") {
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch {
        // ignore
      }
    }
  }

  private resolveOpenWaiters(ok: boolean) {
    const waiters = this.openWaiters.splice(0);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve(ok);
    }
  }

  private failOpenWaiters(ok: boolean) {
    this.resolveOpenWaiters(ok);
  }

  private clearHandshakeTimer() {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private async fetchTicket(): Promise<string | null> {
    try {
      const res = await fetch("/api/auth/ws-ticket", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn(`[MEDIA-DEBUG] ws-ticket HTTP ${res.status}`);
        return null;
      }
      const data = await res.json().catch(() => ({}));
      return typeof data?.ticket === "string" ? data.ticket : null;
    } catch (err) {
      console.warn("[MEDIA-DEBUG] ws-ticket fetch failed", err);
      return null;
    }
  }

  private mediaUrl(ticket: string | null): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const configured =
      typeof process !== "undefined" && process.env.NEXT_PUBLIC_MEDIA_URL
        ? String(process.env.NEXT_PUBLIC_MEDIA_URL).trim()
        : "";
    // Prefer same-origin /ws/media so reverse-proxy WS rules apply consistently.
    const base =
      configured || `${protocol}//${window.location.host}/ws/media`;
    const params = new URLSearchParams();
    if (this.deviceId) params.set("deviceId", this.deviceId);
    if (this.channel) params.set("channel", this.channel);
    if (ticket) params.set("token", ticket);
    const q = params.toString();
    return q ? `${base}?${q}` : base;
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async open() {
    if (typeof window === "undefined") return;
    if (this.closedByUser) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.connecting) return;

    this.connecting = true;
    const generation = ++this.connectGeneration;
    this.emitState("connecting");

    const ticket = await this.fetchTicket();
    if (generation !== this.connectGeneration) {
      this.connecting = false;
      return;
    }
    if (!ticket) {
      console.warn("[MEDIA-DEBUG] ws-ticket missing — not opening /ws/media without auth");
      this.connecting = false;
      this.emitState("error");
      this.failOpenWaiters(false);
      this.scheduleReconnect();
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      this.connecting = false;
      return;
    }

    const url = this.mediaUrl(ticket);
    console.log(`[MEDIA-DEBUG] connecting device=${this.deviceId} channel=${this.channel}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.warn("[MEDIA-DEBUG] WebSocket construct failed", err);
      this.connecting = false;
      this.emitState("error");
      this.failOpenWaiters(false);
      this.scheduleReconnect();
      return;
    }

    ws.binaryType = "arraybuffer";
    this.ws = ws;

    this.clearHandshakeTimer();
    this.handshakeTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN && this.ws === ws) {
        console.warn(
          `[MEDIA-DEBUG] handshake timeout device=${this.deviceId} channel=${this.channel}`
        );
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }, HANDSHAKE_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.clearHandshakeTimer();
      this.connecting = false;
      this.reconnectAttempt = 0;
      this.lastPongAt = Date.now();
      console.log(`[MEDIA-DEBUG] browser media open device=${this.deviceId} channel=${this.channel}`);
      this.emitState("open");
      this.resolveOpenWaiters(true);
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          this.stopHeartbeat();
          return;
        }
        if (Date.now() - this.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
          console.warn(
            `[MEDIA-DEBUG] heartbeat timeout device=${this.deviceId} channel=${this.channel} idleMs=${Date.now() - this.lastPongAt}`
          );
          this.stopHeartbeat();
          try {
            ws.close();
          } catch {
            // ignore
          }
          return;
        }
        try {
          ws.send(JSON.stringify({ type: "media_ping" }));
        } catch {
          this.stopHeartbeat();
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      this.lastPongAt = Date.now();
      if (typeof event.data === "string") {
        return;
      }
      for (const listener of this.listeners) {
        try {
          listener(event.data as ArrayBuffer | Blob);
        } catch {
          // ignore
        }
      }
    };

    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      this.connecting = false;
      this.clearHandshakeTimer();
      this.stopHeartbeat();
      console.warn(
        `[MEDIA-DEBUG] media closed device=${this.deviceId} channel=${this.channel} code=${ev.code} reason=${ev.reason || "n/a"}`
      );
      this.emitState("closed");
      this.failOpenWaiters(false);
      if (!this.closedByUser && this.listeners.size > 0) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      console.warn(`[MEDIA-DEBUG] media error device=${this.deviceId} channel=${this.channel}`);
      this.emitState("error");
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempt += 1;
    const delay = nextBackoff(this.reconnectAttempt);
    console.log(
      `[MEDIA-DEBUG] reconnect in ${delay}ms attempt=${this.reconnectAttempt} device=${this.deviceId}`
    );
    this.reconnectTimer = setTimeout(() => {
      void this.open();
    }, delay);
  }
}
