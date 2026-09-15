"use client";

/**
 * PeerDirectTransport
 * 
 * Provides Direct Peer-to-Peer Communication for:
 * 1. Camera
 * 2. Screen
 * 3. Microphone
 * 4. Shell
 * 5. App Installers
 * 
 * Architecture:
 * - LAN Mode (Same Router): Uses local IP (ws://<localIp>:8765) or WebRTC host candidates directly.
 *   Zero server hop, <1ms latency, gigabit speed!
 * - WAN Mode (Different Routers): Uses WebRTC UDP Direct Tunnel (STUN) for direct peer-to-peer.
 * - Gateway Fallback: Seamlessly falls back to Node.js WebSocket gateway if P2P is firewalled.
 */

import { WebRtcClient, WebRtcSignal } from "@/lib/webrtc-client";

export type TransportMode = "lan_p2p" | "wan_tunnel" | "gateway";

export interface TransportStatus {
  mode: TransportMode;
  connected: boolean;
  latencyMs: number;
  localIp: string;
  isLanReachable: boolean;
}

type MessageListener = (data: Record<string, unknown>) => void;
type BinaryListener = (data: ArrayBuffer) => void;
type StatusListener = (status: TransportStatus) => void;

export class PeerDirectTransport {
  private static instances = new Map<string, PeerDirectTransport>();

  private deviceId: string;
  private localIp: string = "";
  private mode: TransportMode = "gateway";
  private lanSocket: WebSocket | null = null;
  private webrtcClient: WebRtcClient | null = null;
  private isLanProbed: boolean = false;
  private isLanConnected: boolean = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastPingSentAt: number = 0;
  private latencyMs: number = 0;

  private messageListeners = new Set<MessageListener>();
  private binaryListeners = new Set<BinaryListener>();
  private statusListeners = new Set<StatusListener>();

  public static get(deviceId: string): PeerDirectTransport {
    if (!this.instances.has(deviceId)) {
      this.instances.set(deviceId, new PeerDirectTransport(deviceId));
    }
    return this.instances.get(deviceId)!;
  }

  constructor(deviceId: string) {
    this.deviceId = deviceId;
  }

  public setLocalIp(ip: string) {
    if (ip && ip !== this.localIp) {
      this.localIp = ip;
      this.isLanProbed = false;
      this.probeLanConnectivity();
    }
  }

  /**
   * Fast probe to check if the target PC is directly reachable on the local LAN (same router).
   */
  public async probeLanConnectivity(): Promise<boolean> {
    if (!this.localIp || this.isLanProbed) return this.isLanConnected;
    this.isLanProbed = true;

    // Check if browser is on HTTPS or local IP is private
    const isPrivate = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.0\.0\.1|localhost)/.test(this.localIp);
    if (!isPrivate) {
      this.notifyStatus();
      return false;
    }

    try {
      // Fast fetch with 1.2s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const url = `http://${this.localIp}:8765/status`;
      const res = await fetch(url, { signal: controller.signal, mode: "cors" }).catch(() => null);
      clearTimeout(timeoutId);

      if (res && res.ok) {
        this.isLanConnected = true;
        this.connectLanWebSocket();
        return true;
      }
    } catch {
      // LAN HTTP not reachable or mixed-content blocked
    }

    // Attempt direct WebSocket probe
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(`ws://${this.localIp}:8765/p2p`);
        const timer = setTimeout(() => {
          try { ws.close(); } catch {}
          resolve(false);
        }, 1500);

        ws.onopen = () => {
          clearTimeout(timer);
          this.isLanConnected = true;
          this.lanSocket = ws;
          this.setupLanSocket(ws);
          this.setMode("lan_p2p");
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
      } catch {
        resolve(false);
      }
    });
  }

  private connectLanWebSocket() {
    if (this.lanSocket && this.lanSocket.readyState === WebSocket.OPEN) return;
    try {
      const ws = new WebSocket(`ws://${this.localIp}:8765/p2p`);
      this.setupLanSocket(ws);
    } catch (err) {
      console.warn("[PeerDirectTransport] LAN WebSocket error:", err);
    }
  }

  private setupLanSocket(ws: WebSocket) {
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      this.lanSocket = ws;
      this.setMode("lan_p2p");
      this.startPingLoop();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed.type === "pong" && this.lastPingSentAt > 0) {
            this.latencyMs = Math.max(0, Date.now() - this.lastPingSentAt);
            this.notifyStatus();
          }
          this.messageListeners.forEach((fn) => fn(parsed));
        } catch {}
      } else if (ev.data instanceof ArrayBuffer) {
        this.binaryListeners.forEach((fn) => fn(ev.data));
      }
    };

    ws.onclose = () => {
      if (this.lanSocket === ws) {
        this.lanSocket = null;
        this.isLanConnected = false;
        if (this.mode === "lan_p2p") {
          this.setMode("gateway");
        }
      }
    };
  }

  private startPingLoop() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.lanSocket && this.lanSocket.readyState === WebSocket.OPEN) {
        this.lastPingSentAt = Date.now();
        this.lanSocket.send(JSON.stringify({ type: "ping", t: this.lastPingSentAt }));
      }
    }, 4000);
  }

  public setMode(mode: TransportMode) {
    this.mode = mode;
    this.notifyStatus();
  }

  public getStatus(): TransportStatus {
    return {
      mode: this.mode,
      connected: this.mode === "lan_p2p" ? Boolean(this.lanSocket?.readyState === WebSocket.OPEN) : true,
      latencyMs: this.latencyMs,
      localIp: this.localIp,
      isLanReachable: this.isLanConnected,
    };
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  public onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public onBinary(listener: BinaryListener): () => void {
    this.binaryListeners.add(listener);
    return () => this.binaryListeners.delete(listener);
  }

  private notifyStatus() {
    const status = this.getStatus();
    this.statusListeners.forEach((fn) => {
      try { fn(status); } catch {}
    });
  }

  public isDirectReady(): boolean {
    return Boolean(
      (this.lanSocket && this.lanSocket.readyState === WebSocket.OPEN) ||
      (this.webrtcClient && this.webrtcClient.isUdpControlReady())
    );
  }

  /**
   * Send control commands directly to the agent.
   * If LAN P2P is connected, it sends immediately over local UDP/WS (<1ms).
   * Otherwise returns false to let the caller dispatch through the gateway.
   */
  public sendDirectControl(action: string, payload: Record<string, unknown>): boolean {
    if (this.lanSocket && this.lanSocket.readyState === WebSocket.OPEN) {
      try {
        this.lanSocket.send(JSON.stringify({ action, payload, target: this.deviceId }));
        return true;
      } catch {}
    }

    if (this.webrtcClient && this.webrtcClient.isUdpControlReady()) {
      return this.webrtcClient.sendControl(action, payload);
    }

    return false;
  }

  /**
   * Upload an installer chunk directly over LAN or P2P tunnel without hitting the remote server.
   */
  public uploadChunkDirect(chunkData: string | ArrayBuffer): boolean {
    if (this.lanSocket && this.lanSocket.readyState === WebSocket.OPEN) {
      try {
        this.lanSocket.send(chunkData);
        return true;
      } catch {}
    }
    return false;
  }

  public destroy() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.lanSocket) {
      try { this.lanSocket.close(); } catch {}
      this.lanSocket = null;
    }
    this.messageListeners.clear();
    this.binaryListeners.clear();
    this.statusListeners.clear();
  }
}

export default PeerDirectTransport;
