"use client";

import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import { MediaGatewayClient } from "@/lib/media-gateway-client";
import { Play, RefreshCw, Square, SwitchCamera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type DispatchFn = (
  action: string,
  payload?: Record<string, unknown>,
  target?: string
) => { ok: boolean; reason?: string };

type SubscribeFn = (
  listener: (event: { type: string; data?: ArrayBuffer | Blob; packet?: Record<string, unknown> }) => void
) => () => void;

type DetectedCamera = { id: string; index: number; label: string };

export function CameraPanel({
  deviceId,
  subscribe,
  dispatch,
}: {
  deviceId: string;
  subscribe: SubscribeFn;
  dispatch: DispatchFn;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const rgbCanvasRef = useRef<HTMLCanvasElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [cameras, setCameras] = useState<DetectedCamera[]>([]);
  const [activeCamera, setActiveCamera] = useState("");
  const framesRef = useRef(0);
  const [frameCount, setFrameCount] = useState(0);

  const showBlob = useCallback((blob: Blob) => {
    if (blob.size < 100) return;
    const url = URL.createObjectURL(blob);
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = url;
    if (imgRef.current) imgRef.current.src = url;
    framesRef.current += 1;
    setFrameCount(framesRef.current);
    setHasFrame(true);
  }, []);

  const decodeFrame = useCallback(
    async (payload: ArrayBuffer | Blob) => {
      const buffer = payload instanceof Blob ? await payload.arrayBuffer() : payload;
      const raw = new Uint8Array(buffer);
      if (raw.length < 2) return;
      const { deviceId: fromId, frame: bytes } = unwrapDeviceBinaryFrame(raw);
      if (fromId && fromId !== deviceId) return;
      if (bytes.length < 2) return;
      const frameType = bytes[0];

      if (frameType === 0x01 || frameType === 0x02) {
        showBlob(new Blob([bytes.subarray(1).slice()], { type: "image/jpeg" }));
        return;
      }
      if (frameType === 0x03 && bytes.length >= 6) {
        const width = (bytes[1] << 8) | bytes[2];
        const height = (bytes[3] << 8) | bytes[4];
        const rgb = bytes.slice(5);
        const expected = width * height * 3;
        if (width < 16 || height < 16 || rgb.length < expected) return;
        const canvas = rgbCanvasRef.current ?? document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const imageData = ctx.createImageData(width, height);
        const out = imageData.data;
        const pixels = width * height;
        for (let i = 0; i < pixels; i += 1) {
          const s = i * 3;
          const d = i * 4;
          out[d] = rgb[s];
          out[d + 1] = rgb[s + 1];
          out[d + 2] = rgb[s + 2];
          out[d + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((jpeg) => jpeg && showBlob(jpeg), "image/jpeg", 0.88);
      }
    },
    [deviceId, showBlob]
  );

  const decodeRef = useRef(decodeFrame);
  decodeRef.current = decodeFrame;

  // Dedicated media socket for camera frames.
  useEffect(() => {
    if (!deviceId || !streaming) return;
    const client = new MediaGatewayClient();
    const unsub = client.subscribe((data) => void decodeRef.current(data));
    void client.connect(deviceId, "camera").catch(() => {});
    return () => {
      unsub();
      client.disconnect();
    };
  }, [deviceId, streaming]);

  // Gateway fallback (owner binary) + camera telemetry (available cameras).
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "binary" && event.data) {
        void decodeRef.current(event.data);
        return;
      }
      if (event.type !== "json" || !event.packet) return;
      const data = event.packet as Record<string, unknown>;
      const sender = typeof data.senderAgentId === "string" ? data.senderAgentId : "";
      if (sender && sender !== deviceId) return;
      const metrics = (data.metrics || data.hardware_metrics) as Record<string, unknown> | undefined;
      if (metrics && Array.isArray(metrics.available_cameras)) {
        setCameras(metrics.available_cameras as DetectedCamera[]);
        if (!activeCamera && (metrics.available_cameras as DetectedCamera[]).length > 0) {
          setActiveCamera((metrics.available_cameras as DetectedCamera[])[0].id);
        }
      }
    });
  }, [subscribe, deviceId, activeCamera]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const start = () => {
    framesRef.current = 0;
    setFrameCount(0);
    setStreaming(true);
    dispatch("START_STREAM", {}, deviceId);
    dispatch("LIST_CAMERAS", {}, deviceId);
  };
  const stop = () => {
    dispatch("STOP_STREAM", {}, deviceId);
    setStreaming(false);
    setHasFrame(false);
  };
  const flip = () => {
    const idx = cameras.findIndex((c) => c.id === activeCamera);
    const next = cameras[(idx + 1) % Math.max(1, cameras.length)];
    if (!next) return;
    setActiveCamera(next.id);
    dispatch("SWITCH_CAMERA", { camera: next.id, camera_index: next.index }, deviceId);
  };

  useEffect(() => {
    return () => {
      dispatch("STOP_STREAM", {}, deviceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border bg-background/60 px-2 py-1.5 text-xs">
        {!streaming ? (
          <button onClick={start} className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-700">
            <Play className="h-3 w-3" /> Start
          </button>
        ) : (
          <button onClick={stop} className="flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700">
            <Square className="h-3 w-3" /> Stop
          </button>
        )}
        <button
          onClick={flip}
          disabled={cameras.length < 2}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium disabled:opacity-40"
          title="Switch camera"
        >
          <SwitchCamera className="h-3 w-3" /> Flip
        </button>
        <button onClick={() => dispatch("LIST_CAMERAS", {}, deviceId)} className="flex h-6 w-6 items-center justify-center rounded-md border border-border" title="Detect cameras">
          <RefreshCw className="h-3 w-3" />
        </button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{frameCount} frames</span>
      </div>
      <div className="relative flex-1 min-h-0 bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} alt="camera" className="h-full w-full object-contain" style={{ display: hasFrame ? "block" : "none" }} />
        <canvas ref={rgbCanvasRef} className="hidden" />
        {!hasFrame && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">
            {streaming ? "Waiting for camera…" : "Camera off"}
          </div>
        )}
      </div>
    </div>
  );
}
