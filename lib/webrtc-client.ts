"use client";

/**
 * WebRTC P2P Client for Ultra-Low-Latency Remote Control & Streaming.
 * Uses unordered UDP DataChannels (ordered: false, maxRetransmits: 0) for zero-lag
 * mouse/keyboard input and high-speed media frames directly between browser and agent.
 */

export type WebRtcState = "idle" | "connecting" | "connected" | "failed" | "closed";

export type WebRtcSignal = {
  type: "offer" | "answer" | "ice_candidate" | "close";
  stream_type?: "screen" | "camera";
  sdp?: string;
  candidate?: RTCIceCandidateInit;
};

type FrameListener = (data: ArrayBuffer) => void;
type StateListener = (state: WebRtcState) => void;
type SignalSender = (signal: WebRtcSignal) => void;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: ["stun:stun2.l.google.com:19302", "stun:stun3.l.google.com:19302"] },
  ],
  iceCandidatePoolSize: 2,
};

export class WebRtcClient {
  private pc: RTCPeerConnection | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private mediaChannel: RTCDataChannel | null = null;
  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();
  private state: WebRtcState = "idle";
  private queuedCandidates: RTCIceCandidateInit[] = [];
  private sendSignal: SignalSender | null = null;
  private deviceId: string = "";
  private streamType: "screen" | "camera" = "screen";
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {}

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  getState(): WebRtcState {
    return this.state;
  }

  isUdpControlReady(): boolean {
    return this.controlChannel !== null && this.controlChannel.readyState === "open";
  }

  private setState(next: WebRtcState) {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.forEach((fn) => {
      try {
        fn(next);
      } catch (err) {
        console.error("[WebRTC] State listener error:", err);
      }
    });
  }

  async start(
    deviceId: string,
    streamType: "screen" | "camera",
    sendSignal: SignalSender
  ): Promise<void> {
    this.close();
    this.deviceId = deviceId;
    this.streamType = streamType;
    this.sendSignal = sendSignal;
    this.setState("connecting");

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;

      // Unordered, un-retransmitted DataChannel for zero-lag remote mouse/keyboard control
      const controlChannel = pc.createDataChannel("control", {
        ordered: false,
        maxRetransmits: 0,
      });
      this.setupControlChannel(controlChannel);

      // Dedicated media DataChannel for direct UDP screen/camera frames
      const mediaChannel = pc.createDataChannel("media", {
        ordered: false,
        maxRetransmits: 0,
      });
      this.setupMediaChannel(mediaChannel);

      pc.ondatachannel = (ev) => {
        if (ev.channel.label === "control") {
          this.setupControlChannel(ev.channel);
        } else if (ev.channel.label === "media") {
          this.setupMediaChannel(ev.channel);
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.sendSignal) {
          this.sendSignal({
            type: "ice_candidate",
            stream_type: this.streamType,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        if (iceState === "connected" || iceState === "completed") {
          this.setState("connected");
          if (this.connectionTimer) {
            clearTimeout(this.connectionTimer);
            this.connectionTimer = null;
          }
        } else if (iceState === "failed") {
          this.setState("failed");
        } else if (iceState === "disconnected" || iceState === "closed") {
          this.setState("closed");
        }
      };

      // Fallback timer: if WebRTC P2P doesn't connect within 7s, mark as failed so WS fallback is used
      this.connectionTimer = setTimeout(() => {
        if (this.state === "connecting") {
          console.warn("[WebRTC] ICE negotiation timed out — falling back to WebSocket transport");
          this.setState("failed");
        }
      }, 7000);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignal({
        type: "offer",
        stream_type: this.streamType,
        sdp: offer.sdp,
      });
    } catch (err) {
      console.error("[WebRTC] Failed to initialize peer connection:", err);
      this.setState("failed");
    }
  }

  private setupControlChannel(ch: RTCDataChannel) {
    this.controlChannel = ch;
    ch.onopen = () => {
      this.setState("connected");
    };
    ch.onerror = (e) => {
      console.warn("[WebRTC] Control channel error:", e);
    };
    ch.onclose = () => {
      if (this.controlChannel === ch) {
        this.controlChannel = null;
      }
    };
  }

  private setupMediaChannel(ch: RTCDataChannel) {
    this.mediaChannel = ch;
    ch.binaryType = "arraybuffer";
    ch.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.frameListeners.forEach((fn) => {
          try {
            fn(ev.data);
          } catch (err) {
            console.error("[WebRTC] Frame listener error:", err);
          }
        });
      }
    };
    ch.onclose = () => {
      if (this.mediaChannel === ch) {
        this.mediaChannel = null;
      }
    };
  }

  async handleRemoteSignal(signal: WebRtcSignal): Promise<void> {
    const pc = this.pc;
    if (!pc) return;

    try {
      if (signal.type === "answer" && signal.sdp) {
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: signal.sdp })
        );
        // Process any queued candidates that arrived before the answer
        for (const cand of this.queuedCandidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.warn("[WebRTC] Failed to add queued ICE candidate:", e);
          }
        }
        this.queuedCandidates = [];
      } else if (signal.type === "ice_candidate" && signal.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          this.queuedCandidates.push(signal.candidate);
        }
      }
    } catch (err) {
      console.error("[WebRTC] Error handling signal:", err);
    }
  }

  /**
   * Send remote pointer/keyboard controls directly over the ultra-fast UDP DataChannel.
   * Returns true if sent over UDP, false if fallback to WebSocket is required.
   */
  sendControl(action: string, payload: Record<string, unknown>): boolean {
    if (this.controlChannel && this.controlChannel.readyState === "open") {
      try {
        this.controlChannel.send(JSON.stringify({ action, payload }));
        return true;
      } catch (err) {
        console.warn("[WebRTC] DataChannel send failed:", err);
        return false;
      }
    }
    return false;
  }

  close(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
    if (this.controlChannel) {
      try {
        this.controlChannel.close();
      } catch {}
      this.controlChannel = null;
    }
    if (this.mediaChannel) {
      try {
        this.mediaChannel.close();
      } catch {}
      this.mediaChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
    this.queuedCandidates = [];
    this.setState("closed");
  }
}
