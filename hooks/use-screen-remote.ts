"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";

const FRAME_SCREEN_STREAM = 0x04;
const FRAME_SCREEN_SNAPSHOT = 0x05;

export type ScreenTelemetry = {
  resolution: string;
  screenWidth: number;
  screenHeight: number;
  fps: string;
  status: string;
  displayName: string;
};

export type DetectedDisplay = {
  id: string;
  index: number;
  label: string;
  status: string;
  resolution: string;
  is_primary?: boolean;
};

type UseScreenRemoteOptions = {
  subscribe: (listener: (event: { type: string; data?: ArrayBuffer | Blob; packet?: Record<string, unknown> }) => void) => () => void;
  /** Only paint frames from this agent (multi-device isolation). */
  selectedDeviceRef?: React.MutableRefObject<string>;
};

function parseResolution(resolution: string) {
  const match = resolution.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function useScreenRemote({ subscribe, selectedDeviceRef }: UseScreenRemoteOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const latestBlobRef = useRef<Blob | null>(null);
  const paintScheduledRef = useRef(false);
  const fpsTimerRef = useRef({ last: Date.now(), count: 0 });
  const paintFrameRef = useRef<(blob: Blob) => void>(() => {});
  const hasLiveFrameRef = useRef(false);
  const screenSizeRef = useRef({ width: 1920, height: 1080 });

  const [hasLiveFrame, setHasLiveFrame] = useState(false);
  const [measuredFps, setMeasuredFps] = useState("0");
  const [frameCount, setFrameCount] = useState(0);
  const [telemetry, setTelemetry] = useState<ScreenTelemetry>({
    resolution: "---",
    screenWidth: 1920,
    screenHeight: 1080,
    fps: "---",
    status: "STANDBY",
    displayName: "---",
  });
  const [detectedDisplays, setDetectedDisplays] = useState<DetectedDisplay[]>([]);
  const [activeDisplay, setActiveDisplay] = useState("");

  const paintFrame = useCallback(async (blob: Blob) => {
    if (blob.size < 100) return;

    latestBlobRef.current = blob;
    if (paintScheduledRef.current) return;
    paintScheduledRef.current = true;

    requestAnimationFrame(async () => {
      paintScheduledRef.current = false;
      const frame = latestBlobRef.current;
      const canvas = canvasRef.current;
      if (!frame || !canvas) return;

      try {
        const bitmap = await createImageBitmap(frame);
        const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
        if (!ctx) {
          bitmap.close();
          return;
        }

        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          // Keep screenSizeRef as native desktop size (from telemetry) for mouse mapping.
          // Do NOT overwrite with JPEG dimensions — that breaks remote pointer accuracy.
        }

        ctx.drawImage(bitmap, 0, 0);
        if (bitmapRef.current) bitmapRef.current.close();
        bitmapRef.current = bitmap;

        if (!hasLiveFrameRef.current) {
          hasLiveFrameRef.current = true;
          setHasLiveFrame(true);
        }

        const now = Date.now();
        fpsTimerRef.current.count += 1;
        if (now - fpsTimerRef.current.last >= 1000) {
          const fps = fpsTimerRef.current.count;
          setMeasuredFps(String(fps));
          setFrameCount((c) => c + fps);
          fpsTimerRef.current = { last: now, count: 0 };
        }
      } catch (err) {
        console.warn("Frame paint failed:", err);
      }
    });
  }, []);

  paintFrameRef.current = paintFrame;

  const processBinaryPayload = useCallback((payload: ArrayBuffer | Blob) => {
    const decodeAndPaint = (buffer: Uint8Array) => {
      if (buffer.length < 4) return;
      const { deviceId, frame } = unwrapDeviceBinaryFrame(buffer);
      const selected = selectedDeviceRef?.current || "";
      if (deviceId && selected && deviceId !== selected) return;

      if (frame.length < 4) return;
      const frameType = frame[0];
      if (frameType !== FRAME_SCREEN_STREAM && frameType !== FRAME_SCREEN_SNAPSHOT) return;
      const jpegBytes = frame.subarray(1);
      const jpegBlob = new Blob([jpegBytes.slice()], { type: "image/jpeg" });
      void paintFrameRef.current(jpegBlob);
    };

    if (payload instanceof Blob) {
      void payload.arrayBuffer().then((raw) => decodeAndPaint(new Uint8Array(raw)));
      return;
    }
    decodeAndPaint(new Uint8Array(payload));
  }, [selectedDeviceRef]);

  const processBinaryRef = useRef(processBinaryPayload);
  processBinaryRef.current = processBinaryPayload;

  const resetPreview = useCallback(() => {
    latestBlobRef.current = null;
    if (bitmapRef.current) {
      bitmapRef.current.close();
      bitmapRef.current = null;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasLiveFrameRef.current = false;
    setHasLiveFrame(false);
    setFrameCount(0);
    setMeasuredFps("0");
    fpsTimerRef.current = { last: Date.now(), count: 0 };
  }, []);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "binary" && event.data) {
        processBinaryRef.current(event.data);
        return;
      }
      if (event.type !== "json" || !event.packet) return;

      const packet = event.packet;
      if (packet.type !== "screen_telemetry_stream") return;

      // Ignore remote-input echo telemetry — keeps UI smooth.
      if (typeof packet.action === "string" && String(packet.action).startsWith("REMOTE_")) {
        return;
      }

      const sender = typeof packet.senderAgentId === "string" ? packet.senderAgentId : "";
      const selected = selectedDeviceRef?.current || "";
      if (sender && selected && sender !== selected) return;

      const metrics = (packet.metrics || {}) as Record<string, unknown>;

      if (Array.isArray(metrics.available_displays)) {
        setDetectedDisplays(metrics.available_displays as DetectedDisplay[]);
      }

      const resolution = String(metrics.resolution || "---");
      const parsed = parseResolution(resolution);
      if (parsed) {
        screenSizeRef.current = { width: parsed.width, height: parsed.height };
      }

      setTelemetry((prev) => ({
        resolution: resolution !== "---" ? resolution : prev.resolution,
        screenWidth: parsed?.width || prev.screenWidth,
        screenHeight: parsed?.height || prev.screenHeight,
        fps: String(metrics.fps || prev.fps),
        status: String(packet.status || metrics.status || prev.status),
        displayName: String(metrics.display_name || prev.displayName),
      }));
    });
  }, [subscribe]);

  const mapPointerToRemote = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    // Account for object-contain letterboxing.
    const srcW = canvas.width || 1;
    const srcH = canvas.height || 1;
    const canvasAspect = srcW / srcH;
    const rectAspect = rect.width / rect.height;
    let drawW = rect.width;
    let drawH = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (rectAspect > canvasAspect) {
      drawH = rect.height;
      drawW = drawH * canvasAspect;
      offsetX = (rect.width - drawW) / 2;
    } else {
      drawW = rect.width;
      drawH = drawW / canvasAspect;
      offsetY = (rect.height - drawH) / 2;
    }

    const relX = (clientX - rect.left - offsetX) / drawW;
    const relY = (clientY - rect.top - offsetY) / drawH;
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;

    const screenWidth = screenSizeRef.current.width || telemetry.screenWidth;
    const screenHeight = screenSizeRef.current.height || telemetry.screenHeight;

    return {
      x: Math.round(relX * screenWidth),
      y: Math.round(relY * screenHeight),
      screen_width: screenWidth,
      screen_height: screenHeight,
    };
  }, [telemetry.screenWidth, telemetry.screenHeight]);

  useEffect(() => {
    return () => {
      if (bitmapRef.current) bitmapRef.current.close();
    };
  }, []);

  return {
    canvasRef,
    containerRef,
    hasLiveFrame,
    measuredFps,
    frameCount,
    telemetry,
    detectedDisplays,
    activeDisplay,
    setActiveDisplay,
    resetPreview,
    mapPointerToRemote,
  };
}
