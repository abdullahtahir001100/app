"use client";

import { useScreenRemote } from "@/hooks/use-screen-remote";
import { Keyboard, MousePointer2, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type DispatchFn = (
  action: string,
  payload?: Record<string, unknown>,
  target?: string
) => { ok: boolean; reason?: string };

type SubscribeFn = (
  listener: (event: { type: string; data?: ArrayBuffer | Blob; packet?: Record<string, unknown> }) => void
) => () => void;

const QUALITY_OPTIONS = [
  { value: "saver", label: "Slow Net" },
  { value: "medium", label: "Balanced" },
  { value: "high", label: "Sharp" },
  { value: "ultra", label: "Ultra" },
];
const FPS_OPTIONS = [8, 12, 15, 20, 30];

export function ScreenPanel({
  deviceId,
  subscribe,
  dispatch,
  autoStart = false,
}: {
  deviceId: string;
  subscribe: SubscribeFn;
  dispatch: DispatchFn;
  autoStart?: boolean;
}) {
  const selectedDeviceRef = useRef(deviceId);
  selectedDeviceRef.current = deviceId;

  const {
    canvasRef,
    containerRef,
    hasLiveFrame,
    measuredFps,
    telemetry,
    mapPointerToRemote,
    resetPreview,
  } = useScreenRemote({ subscribe, selectedDeviceRef });

  const [streaming, setStreaming] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [quality, setQuality] = useState("high");
  const [fps, setFps] = useState(20);
  const lastMoveRef = useRef(0);
  const controlRef = useRef(controlEnabled);
  controlRef.current = controlEnabled;

  const start = useCallback(() => {
    resetPreview();
    dispatch("START_SCREEN_STREAM", { quality, target_fps: fps }, deviceId);
    dispatch("PROBE_DISPLAYS", {}, deviceId);
    setStreaming(true);
  }, [deviceId, dispatch, quality, fps, resetPreview]);

  const stop = useCallback(() => {
    dispatch("STOP_SCREEN_STREAM", {}, deviceId);
    setStreaming(false);
    resetPreview();
  }, [deviceId, dispatch, resetPreview]);

  // Re-apply quality/fps live while streaming.
  useEffect(() => {
    if (streaming) dispatch("SET_SCREEN_QUALITY", { quality, target_fps: fps }, deviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, fps]);

  useEffect(() => {
    return () => {
      dispatch("STOP_SCREEN_STREAM", {}, deviceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const sendPointer = useCallback(
    (action: string, clientX: number, clientY: number, extra: Record<string, unknown> = {}) => {
      if (!controlRef.current) return;
      const mapped = mapPointerToRemote(clientX, clientY);
      if (!mapped) return;
      dispatch(action, { ...mapped, ...extra }, deviceId);
    },
    [deviceId, dispatch, mapPointerToRemote]
  );

  const buttonOf = (e: React.MouseEvent) => (e.button === 2 ? "right" : e.button === 1 ? "middle" : "left");

  const onMouseMove = (e: React.MouseEvent) => {
    const now = performance.now();
    if (now - lastMoveRef.current < 16) return;
    lastMoveRef.current = now;
    sendPointer("REMOTE_MOUSE_MOVE", e.clientX, e.clientY);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    (e.currentTarget as HTMLElement).focus();
    sendPointer("REMOTE_MOUSE_DOWN", e.clientX, e.clientY, { button: buttonOf(e) });
  };
  const onMouseUp = (e: React.MouseEvent) => {
    sendPointer("REMOTE_MOUSE_UP", e.clientX, e.clientY, { button: buttonOf(e) });
  };

  // Native non-passive wheel so we can preventDefault (stop page scroll).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!controlRef.current) return;
      e.preventDefault();
      sendPointer("REMOTE_MOUSE_WHEEL", e.clientX, e.clientY, { delta: Math.round(-e.deltaY) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef, sendPointer]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!controlRef.current) return;
    e.preventDefault();
    const single = e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
    dispatch("REMOTE_KEY_DOWN", single ? { text: e.key } : { code: e.code }, deviceId);
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (!controlRef.current) return;
    e.preventDefault();
    const single = e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
    dispatch("REMOTE_KEY_UP", single ? { text: e.key } : { code: e.code }, deviceId);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/60 px-2 py-1.5 text-xs">
        {!streaming ? (
          <button
            onClick={start}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-700"
          >
            <Play className="h-3 w-3" /> Start
          </button>
        ) : (
          <button
            onClick={stop}
            className="flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700"
          >
            <Square className="h-3 w-3" /> Stop
          </button>
        )}
        <button
          onClick={() => setControlEnabled((v) => !v)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium ${
            controlEnabled ? "bg-foreground text-background" : "border border-border text-muted-foreground"
          }`}
          title="Toggle mouse/keyboard control"
        >
          <MousePointer2 className="h-3 w-3" /> {controlEnabled ? "Control ON" : "Control OFF"}
        </button>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          className="rounded-md border border-border bg-background px-1.5 py-1 outline-none"
        >
          {QUALITY_OPTIONS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
        <select
          value={fps}
          onChange={(e) => setFps(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-1.5 py-1 outline-none"
        >
          {FPS_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {telemetry.resolution} · {measuredFps} fps
        </span>
      </div>

      {/* Surface */}
      <div
        ref={containerRef}
        tabIndex={0}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className={`relative flex-1 min-h-0 bg-black outline-none ${
          controlEnabled ? "cursor-none" : "cursor-default"
        }`}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full object-contain"
          style={{ display: hasLiveFrame ? "block" : "none" }}
        />
        {!hasLiveFrame && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
            <Keyboard className="h-8 w-8 opacity-40" />
            <p className="text-xs">{streaming ? "Waiting for frames…" : "Press Start to stream this screen"}</p>
            {streaming && (
              <p className="text-[10px] text-white/30">Click the view, then use your mouse &amp; keyboard to control it</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
