"use client";

/**
 * Dedicated media WebSocket for screen/camera frames.
 * Keeps heavy binary traffic off /ws/gateway so heartbeats stay healthy.
 */

type MediaListener = (data: ArrayBuffer | Blob) => void;

const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 75_000;

function nextBackoff(attempt: number): number {
  const steps = [1000, 2000, 5000, 10000, 20000, 30000];
  return steps[Math.min(Math.max(attempt - 1, 0), steps.length - 1)];
}

export class MediaGatewayClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<MediaListener>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private deviceId = "";
  private channel = "";
  private closedByUser = false;
  private connecting = false;

  subscribe(listener: MediaListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(deviceId: string, channel: string) {
    this.deviceId = deviceId;
    this.channel = channel;
    this.closedByUser = false;
    await this.open();
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }

  private async fetchTicket(): Promise<string | null> {
    try {
      // Must match server: GET /api/auth/ws-ticket (POST also supported).
      const res = await fetch("/api/auth/ws-ticket", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return typeof data?.ticket === "string" ? data.ticket : null;
    } catch {
      return null;
    }
  }

  private mediaUrl(ticket: string | null): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const configured =
      typeof process !== "undefined" && process.env.NEXT_PUBLIC_MEDIA_URL
        ? String(process.env.NEXT_PUBLIC_MEDIA_URL).trim()
        : "";
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
    if (typeof window === "undefined" || this.connecting) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.connecting = true;
    const ticket = await this.fetchTicket();
    if (!ticket) {
      console.warn("[MEDIA] ws-ticket missing — not opening /ws/media without auth");
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    const url = this.mediaUrl(ticket);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }

    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempt = 0;
      this.lastPongAt = Date.now();
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          this.stopHeartbeat();
          return;
        }
        if (Date.now() - this.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
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
      
      // Handle string/JSON pong or control packets
      if (typeof event.data === "string") {
        try {
          const packet = JSON.parse(event.data);
          for (const listener of this.listeners) {
            listener({ type: "json", packet } as any);
          }
        } catch {
          // ignore
        }
        return;
      }

      // Handle ArrayBuffer / Blob binary frames (Screen/Camera JPEG/WebP)
      for (const listener of this.listeners) {
        try {
          // Wrap in expected { type: "binary", data } wrapper
          listener({ type: "binary", data: event.data } as any);
        } catch {
          // ignore
        }
      }
    };

    ws.onclose = () => {
      this.connecting = false;
      this.stopHeartbeat();
      if (this.ws === ws) this.ws = null;
      if (!this.closedByUser && this.listeners.size > 0) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose handles reconnect
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempt += 1;
    const delay = nextBackoff(this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      void this.open();
    }, delay);
  }
}
