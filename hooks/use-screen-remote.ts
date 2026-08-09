"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import { MediaGatewayClient } from "@/lib/media-gateway-client";

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
  subscribe: (
    listener: (event: {
      type: string;
      data?: ArrayBuffer | Blob;
      packet?: Record<string, unknown>;
    }) => void
  ) => () => void;

  /** Only paint frames from this agent (multi-device isolation). */
  selectedDeviceRef?: React.MutableRefObject<string>;

  /** When set, open dedicated /ws/media for frames. */
  mediaDeviceId?: string;
};

function parseResolution(resolution: string) {
  const match = resolution.match(/(\d+)\s*x\s*(\d+)/i);

  if (!match) return null;

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

export function useScreenRemote({
  subscribe,
  selectedDeviceRef,
  mediaDeviceId,
}: UseScreenRemoteOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Currently displayed bitmap.
   *
   * We keep only one bitmap alive at a time.
   */
  const bitmapRef = useRef<ImageBitmap | null>(null);

  /**
   * IMPORTANT:
   *
   * Only the newest frame is kept here.
   *
   * If 10 frames arrive while the browser is decoding one frame,
   * the old 9 frames are discarded and only the newest one survives.
   */
  const latestBlobRef = useRef<Blob | null>(null);

  /**
   * Prevent multiple createImageBitmap() operations from running
   * at the same time.
   */
  const decodeRunningRef = useRef(false);

  /**
   * Used to keep the latest paint function available to callbacks
   * without creating stale closures.
   */
  const paintFrameRef = useRef<(blob: Blob) => void>(() => {});

  /**
   * FPS measurement.
   */
  const fpsTimerRef = useRef({
    last: performance.now(),
    count: 0,
  });

  /**
   * Whether we have successfully painted at least one frame.
   */
  const hasLiveFrameRef = useRef(false);

  /**
   * Native desktop resolution.
   *
   * IMPORTANT:
   * This is intentionally NOT replaced with JPEG dimensions.
   */
  const screenSizeRef = useRef({
    width: 1920,
    height: 1080,
  });

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

  const [detectedDisplays, setDetectedDisplays] = useState<
    DetectedDisplay[]
  >([]);

  const [activeDisplay, setActiveDisplay] = useState("");

  /**
   * ============================================================
   * FRAME PAINT PIPELINE
   * ============================================================
   *
   * Main fix for frozen/stuck screen.
   *
   * We NEVER allow multiple createImageBitmap() calls to run
   * simultaneously.
   *
   * We also NEVER build a queue of old frames.
   *
   * Example:
   *
   *     F1 decoding
   *     F2 arrives
   *     F3 arrives
   *     F4 arrives
   *     F5 arrives
   *
   * Only F5 is kept.
   *
   * When F1 finishes:
   *
   *     F1 is discarded if F5 exists
   *     F5 gets decoded
   *     F2/F3/F4 are never painted
   *
   * This gives us low-latency remote desktop behavior.
   */
  const paintFrame = useCallback((blob: Blob) => {
    if (blob.size < 100) return;

    /**
     * Always overwrite with newest frame.
     */
    latestBlobRef.current = blob;

    /**
     * If decoder is already running, don't start another one.
     *
     * Current decoder will pick up the newest frame when done.
     */
    if (decodeRunningRef.current) {
      return;
    }

    decodeRunningRef.current = true;

    const processLatestFrame = async () => {
      try {
        while (true) {
          /**
           * Grab the latest frame.
           */
          const frame = latestBlobRef.current;

          /**
           * Mark it as consumed.
           */
          latestBlobRef.current = null;

          const canvas = canvasRef.current;

          if (!frame || !canvas) {
            break;
          }

          let bitmap: ImageBitmap | null = null;

          try {
            /**
             * Decode JPEG.
             *
             * IMPORTANT:
             * There is only ONE decode running at a time.
             */
            bitmap = await createImageBitmap(frame);

            /**
             * If another frame arrived while decoding,
             * this bitmap is already stale.
             *
             * Do NOT paint it.
             */
            if (latestBlobRef.current !== null) {
              bitmap.close();
              bitmap = null;

              continue;
            }

            /**
             * Wait for browser's next render cycle.
             *
             * This prevents unnecessary canvas work between
             * browser paint cycles.
             */
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            });

            /**
             * Get canvas context.
             */
            const ctx = canvas.getContext("2d", {
              alpha: false,
              desynchronized: true,
            });

            if (!ctx) {
              bitmap.close();
              bitmap = null;
              break;
            }

            /**
             * Update canvas dimensions if JPEG dimensions changed.
             *
             * NOTE:
             * This does NOT change screenSizeRef.
             *
             * Remote pointer coordinates continue using
             * native desktop resolution from telemetry.
             */
            if (
              canvas.width !== bitmap.width ||
              canvas.height !== bitmap.height
            ) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }

            /**
             * Paint frame.
             */
            ctx.drawImage(bitmap, 0, 0);

            /**
             * Release previous bitmap.
             */
            if (bitmapRef.current) {
              bitmapRef.current.close();
            }

            /**
             * Keep current bitmap alive.
             */
            bitmapRef.current = bitmap;

            /**
             * Ownership transferred to bitmapRef.
             */
            bitmap = null;

            /**
             * First successful frame.
             */
            if (!hasLiveFrameRef.current) {
              hasLiveFrameRef.current = true;
              setHasLiveFrame(true);
            }

            /**
             * FPS measurement.
             */
            const now = performance.now();

            fpsTimerRef.current.count += 1;

            if (now - fpsTimerRef.current.last >= 1000) {
              const fps = fpsTimerRef.current.count;

              setMeasuredFps(String(fps));

              setFrameCount((count) => count + fps);

              fpsTimerRef.current = {
                last: now,
                count: 0,
              };
            }
          } catch (err) {
            console.warn("Frame decode/paint failed:", err);

            if (bitmap) {
              bitmap.close();
            }
          }
        }
      } finally {
        decodeRunningRef.current = false;

        /**
         * Race-condition protection:
         *
         * A frame might arrive exactly after the while loop
         * checked latestBlobRef.
         *
         * If that happened, immediately restart processing.
         */
        if (latestBlobRef.current !== null) {
          paintFrameRef.current(latestBlobRef.current);
        }
      }
    };

    void processLatestFrame();
  }, []);

  /**
   * Keep latest paint function available.
   */
  paintFrameRef.current = paintFrame;

  /**
   * ============================================================
   * BINARY FRAME PROCESSING
   * ============================================================
   */
  const processBinaryPayload = useCallback(
    (payload: ArrayBuffer | Blob) => {
      const decodeAndPaint = (buffer: Uint8Array) => {
        if (buffer.length < 4) return;

        const { deviceId, frame } = unwrapDeviceBinaryFrame(buffer);

        /**
         * Multi-device isolation.
         */
        const selected = selectedDeviceRef?.current || "";

        if (deviceId && selected && deviceId !== selected) {
          return;
        }

        if (frame.length < 4) {
          return;
        }

        /**
         * First byte is frame type.
         */
        const frameType = frame[0];

        if (
          frameType !== FRAME_SCREEN_STREAM &&
          frameType !== FRAME_SCREEN_SNAPSHOT
        ) {
          return;
        }

        /**
         * Everything after frame type is JPEG data.
         */
        const jpegBytes = frame.subarray(1);

        if (jpegBytes.length < 100) {
          return;
        }

        /**
         * Wrap JPEG bytes into Blob.
         */
        const jpegBlob = new Blob([jpegBytes], {
          type: "image/jpeg",
        });

        /**
         * Latest-frame-only paint pipeline.
         */
        paintFrameRef.current(jpegBlob);
      };

      /**
       * Blob payload.
       */
      if (payload instanceof Blob) {
        void payload
          .arrayBuffer()
          .then((raw) => {
            decodeAndPaint(new Uint8Array(raw));
          })
          .catch((err) => {
            console.warn("Binary Blob read failed:", err);
          });

        return;
      }

      /**
       * ArrayBuffer payload.
       */
      decodeAndPaint(new Uint8Array(payload));
    },
    [selectedDeviceRef]
  );

  /**
   * Keep latest binary processor.
   */
  const processBinaryRef = useRef(processBinaryPayload);
  processBinaryRef.current = processBinaryPayload;

  /**
   * ============================================================
   * RESET PREVIEW
   * ============================================================
   */
  const resetPreview = useCallback(() => {
    /**
     * Drop pending frame.
     */
    latestBlobRef.current = null;

    /**
     * Reset decoder state.
     *
     * Normally decoder should already be idle when reset happens.
     */
    decodeRunningRef.current = false;

    /**
     * Release current bitmap.
     */
    if (bitmapRef.current) {
      bitmapRef.current.close();
      bitmapRef.current = null;
    }

    /**
     * Clear canvas.
     */
    const canvas = canvasRef.current;

    if (canvas) {
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    /**
     * Reset live state.
     */
    hasLiveFrameRef.current = false;

    setHasLiveFrame(false);
    setFrameCount(0);
    setMeasuredFps("0");

    fpsTimerRef.current = {
      last: performance.now(),
      count: 0,
    };
  }, []);

  /**
   * ============================================================
   * SUBSCRIBE TO MAIN SOCKET
   * ============================================================
   */
  useEffect(() => {
    return subscribe((event) => {
      /**
       * Binary screen frame.
       */
      if (event.type === "binary" && event.data) {
        processBinaryRef.current(event.data);
        return;
      }

      /**
       * Ignore non-JSON events.
       */
      if (event.type !== "json" || !event.packet) {
        return;
      }

      const packet = event.packet;

      /**
       * Only process screen telemetry.
       */
      if (packet.type !== "screen_telemetry_stream") {
        return;
      }

      /**
       * Ignore remote-input echo telemetry.
       *
       * This keeps the UI smoother while controlling
       * the remote computer.
       */
      if (
        typeof packet.action === "string" &&
        String(packet.action).startsWith("REMOTE_")
      ) {
        return;
      }

      /**
       * Multi-device isolation.
       */
      const sender =
        typeof packet.senderAgentId === "string"
          ? packet.senderAgentId
          : "";

      const selected = selectedDeviceRef?.current || "";

      if (sender && selected && sender !== selected) {
        return;
      }

      const metrics = (packet.metrics || {}) as Record<string, unknown>;

      /**
       * Available displays.
       */
      if (Array.isArray(metrics.available_displays)) {
        setDetectedDisplays(
          metrics.available_displays as DetectedDisplay[]
        );
      }

      /**
       * Screen resolution.
       */
      const resolution = String(metrics.resolution || "---");

      const parsed = parseResolution(resolution);

      /**
       * IMPORTANT:
       * Native desktop dimensions are stored separately.
       */
      if (parsed) {
        screenSizeRef.current = {
          width: parsed.width,
          height: parsed.height,
        };
      }

      /**
       * Update telemetry.
       */
      setTelemetry((prev) => ({
        resolution:
          resolution !== "---" ? resolution : prev.resolution,

        screenWidth:
          parsed?.width || prev.screenWidth,

        screenHeight:
          parsed?.height || prev.screenHeight,

        fps: String(metrics.fps || prev.fps),

        status: String(
          packet.status ||
            metrics.status ||
            prev.status
        ),

        displayName: String(
          metrics.display_name ||
            prev.displayName
        ),
      }));
    });
  }, [subscribe, selectedDeviceRef]);

  /**
   * ============================================================
   * REMOTE POINTER MAPPING
   * ============================================================
   */
  const mapPointerToRemote = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return null;
      }

      const rect = canvas.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      /**
       * Canvas source dimensions.
       */
      const srcW = canvas.width || 1;
      const srcH = canvas.height || 1;

      const canvasAspect = srcW / srcH;
      const rectAspect = rect.width / rect.height;

      let drawW = rect.width;
      let drawH = rect.height;

      let offsetX = 0;
      let offsetY = 0;

      /**
       * Account for object-contain letterboxing.
       */
      if (rectAspect > canvasAspect) {
        drawH = rect.height;
        drawW = drawH * canvasAspect;

        offsetX = (rect.width - drawW) / 2;
      } else {
        drawW = rect.width;
        drawH = drawW / canvasAspect;

        offsetY = (rect.height - drawH) / 2;
      }

      const relX =
        (clientX - rect.left - offsetX) / drawW;

      const relY =
        (clientY - rect.top - offsetY) / drawH;

      /**
       * Pointer is outside actual screen image.
       */
      if (
        relX < 0 ||
        relX > 1 ||
        relY < 0 ||
        relY > 1
      ) {
        return null;
      }

      /**
       * IMPORTANT:
       *
       * Use native desktop resolution from telemetry,
       * NOT JPEG dimensions.
       */
      const screenWidth =
        screenSizeRef.current.width ||
        telemetry.screenWidth;

      const screenHeight =
        screenSizeRef.current.height ||
        telemetry.screenHeight;

      return {
        x: Math.round(relX * screenWidth),
        y: Math.round(relY * screenHeight),

        screen_width: screenWidth,
        screen_height: screenHeight,
      };
    },
    [telemetry.screenWidth, telemetry.screenHeight]
  );

  /**
   * ============================================================
   * CLEANUP BITMAP
   * ============================================================
   */
  useEffect(() => {
    return () => {
      if (bitmapRef.current) {
        bitmapRef.current.close();
        bitmapRef.current = null;
      }

      latestBlobRef.current = null;
    };
  }, []);

  /**
   * ============================================================
   * DEDICATED MEDIA GATEWAY
   * ============================================================
   */
  useEffect(() => {
    if (!mediaDeviceId) {
      return;
    }

    const client = new MediaGatewayClient();

    const unsub = client.subscribe((data) => {
      processBinaryRef.current(data);
    });

    void client.connect(mediaDeviceId, "screen");

    return () => {
      unsub();
      client.disconnect();
    };
  }, [mediaDeviceId]);

  /**
   * ============================================================
   * RETURN
   * ============================================================
   */
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