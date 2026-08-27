"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { useGateway } from "@/hooks/use-gateway";
import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import type { DeviceOption } from "@/lib/gateway-client";
import {
  Grid3x3,
  Maximize2,
  Minus,
  MousePointerClick,
  Plus,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const FRAME_SCREEN_STREAM = 0x04;
const FRAME_SCREEN_SNAPSHOT = 0x05;

// Tile geometry in canvas (content) coordinates.
const TILE_W = 300;
const TILE_H = 196; // 168 preview + 28 label strip
const PREVIEW_H = 168;
const GAP = 20;

// Never stream more than this many devices at once — the fleet can be 1000s,
// but only the tiles nearest the viewport get live frames. Everything else
// shows a lightweight placeholder. This is what keeps bandwidth bounded.
const MAX_LIVE_STREAMS = 36;
// Thumbnail stream request: small + slow so many tiles stay cheap. Upgraded
// agents honor max_width/target_fps; older agents fall back to the "saver" preset.
const THUMB_QUALITY = "saver";
const THUMB_FPS = 6;
const THUMB_MAX_WIDTH = 480;

type PendingFrame = { blob: Blob };

export default function FleetPage() {
  const router = useRouter();
  const {
    isConnected,
    devices,
    dispatch: gatewayDispatch,
    refreshDevices,
    subscribe,
    ensureConnected,
  } = useGateway();

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 1200, h: 800 });
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [scale, setScale] = useState(1);
  const [query, setQuery] = useState("");
  const [onlyOnline, setOnlyOnline] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Per-device canvas elements + latest-frame buffers for the paint pump.
  const canvasMapRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const latestFrameRef = useRef<Map<string, PendingFrame>>(new Map());
  const dirtyRef = useRef<Set<string>>(new Set());
  const paintScheduledRef = useRef(false);
  const liveDeviceRef = useRef<Set<string>>(new Set()); // devices that have painted ≥1 frame
  const [, forceRerender] = useState(0);

  // Devices we've asked to stream right now (so we can STOP when they scroll away).
  const streamingRef = useRef<Set<string>>(new Set());

  // ---- filtered + sorted device list (online first, then by label) ----
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = devices.filter((d) => {
      if (onlyOnline && d.status !== "online") return false;
      if (!q) return true;
      return (
        d.label?.toLowerCase().includes(q) ||
        d.value?.toLowerCase().includes(q) ||
        d.hostname?.toLowerCase().includes(q) ||
        d.username?.toLowerCase().includes(q) ||
        d.platform?.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      const ao = a.status === "online" ? 0 : 1;
      const bo = b.status === "online" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (a.label || a.value).localeCompare(b.label || b.value);
    });
  }, [devices, query, onlyOnline]);

  const cols = useMemo(() => Math.max(1, Math.ceil(Math.sqrt(filtered.length || 1))), [filtered.length]);
  const rows = useMemo(() => Math.max(1, Math.ceil((filtered.length || 1) / cols)), [filtered.length, cols]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; index: number }>();
    filtered.forEach((d, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      map.set(d.value, { x: col * (TILE_W + GAP), y: row * (TILE_H + GAP), index: i });
    });
    return map;
  }, [filtered, cols]);

  const contentW = cols * (TILE_W + GAP);
  const contentH = rows * (TILE_H + GAP);

  // ---- measure viewport ----
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    ensureConnected();
    void refreshDevices(true);
  }, [ensureConnected, refreshDevices]);

  // ---- which tiles are inside (or near) the viewport ----
  const visibleIds = useMemo(() => {
    const margin = 400; // prefetch a ring around the viewport
    const ids: string[] = [];
    const cx = (viewport.w / 2 - pan.x) / scale;
    const cy = (viewport.h / 2 - pan.y) / scale;
    const scored: { id: string; d2: number }[] = [];
    for (const d of filtered) {
      const p = positions.get(d.value);
      if (!p) continue;
      const sx = p.x * scale + pan.x;
      const sy = p.y * scale + pan.y;
      const sw = TILE_W * scale;
      const sh = TILE_H * scale;
      const inView =
        sx + sw > -margin && sx < viewport.w + margin && sy + sh > -margin && sy < viewport.h + margin;
      if (inView) {
        ids.push(d.value);
        const ddx = p.x + TILE_W / 2 - cx;
        const ddy = p.y + TILE_H / 2 - cy;
        scored.push({ id: d.value, d2: ddx * ddx + ddy * ddy });
      }
    }
    // Cap the number that will actually stream — nearest to viewport centre win.
    scored.sort((a, b) => a.d2 - b.d2);
    const streamable = new Set(scored.slice(0, MAX_LIVE_STREAMS).map((s) => s.id));
    return { ids, streamable };
  }, [filtered, positions, pan, scale, viewport]);

  // ---- start/stop thumbnail streams as tiles enter/leave the viewport ----
  const gatewayDispatchRef = useRef(gatewayDispatch);
  gatewayDispatchRef.current = gatewayDispatch;

  useEffect(() => {
    const want = new Set<string>();
    for (const id of visibleIds.streamable) {
      const dev = filtered.find((d) => d.value === id);
      if (dev && dev.status === "online") want.add(id);
    }

    const current = streamingRef.current;
    // START newly-wanted devices.
    for (const id of want) {
      if (!current.has(id)) {
        gatewayDispatchRef.current(
          "START_SCREEN_STREAM",
          { quality: THUMB_QUALITY, target_fps: THUMB_FPS, max_width: THUMB_MAX_WIDTH },
          id
        );
        current.add(id);
      }
    }
    // STOP devices that left the streamable set.
    for (const id of Array.from(current)) {
      if (!want.has(id)) {
        gatewayDispatchRef.current("STOP_SCREEN_STREAM", {}, id);
        current.delete(id);
        latestFrameRef.current.delete(id);
        dirtyRef.current.delete(id);
        if (liveDeviceRef.current.delete(id)) forceRerender((n) => n + 1);
      }
    }
  }, [visibleIds, filtered]);

  // Stop everything on unmount.
  useEffect(() => {
    return () => {
      for (const id of Array.from(streamingRef.current)) {
        gatewayDispatchRef.current("STOP_SCREEN_STREAM", {}, id);
      }
      streamingRef.current.clear();
    };
  }, []);

  // ---- paint pump: latest-wins per device, batched in one rAF ----
  const schedulePaint = useCallback(() => {
    if (paintScheduledRef.current) return;
    paintScheduledRef.current = true;
    requestAnimationFrame(() => {
      paintScheduledRef.current = false;
      const dirty = Array.from(dirtyRef.current);
      dirtyRef.current.clear();
      for (const id of dirty) {
        const pending = latestFrameRef.current.get(id);
        const canvas = canvasMapRef.current.get(id);
        if (!pending || !canvas) continue;
        const blob = pending.blob;
        void createImageBitmap(blob)
          .then((bitmap) => {
            const c = canvasMapRef.current.get(id);
            if (!c) {
              bitmap.close();
              return;
            }
            if (c.width !== bitmap.width || c.height !== bitmap.height) {
              c.width = bitmap.width;
              c.height = bitmap.height;
            }
            const ctx = c.getContext("2d", { alpha: false, desynchronized: true });
            if (!ctx) {
              bitmap.close();
              return;
            }
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            if (!liveDeviceRef.current.has(id)) {
              liveDeviceRef.current.add(id);
              forceRerender((n) => n + 1);
            }
          })
          .catch(() => {});
      }
    });
  }, []);

  // ---- receive binary frames from the single gateway socket ----
  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "binary" || !event.data) return;
      const data = event.data;
      const handle = (buf: Uint8Array) => {
        const { deviceId, frame } = unwrapDeviceBinaryFrame(buf);
        if (!deviceId || frame.length < 2) return;
        const frameType = frame[0];
        if (frameType !== FRAME_SCREEN_STREAM && frameType !== FRAME_SCREEN_SNAPSHOT) return;
        // Only keep frames for devices we're actively showing.
        if (!streamingRef.current.has(deviceId)) return;
        const jpeg = frame.subarray(1);
        if (jpeg.length < 100) return;
        latestFrameRef.current.set(deviceId, { blob: new Blob([jpeg.slice()], { type: "image/jpeg" }) });
        dirtyRef.current.add(deviceId);
        schedulePaint();
      };
      if (data instanceof Blob) {
        void data.arrayBuffer().then((raw) => handle(new Uint8Array(raw)));
      } else {
        handle(new Uint8Array(data));
      }
    });
  }, [subscribe, schedulePaint]);

  // ---- panning (drag on empty canvas) ----
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; panX: number; panY: number; moved: boolean }>(
    { active: false, startX: 0, startY: 0, panX: 0, panY: 0, moved: false }
  );

  const onPointerDown = (e: React.PointerEvent) => {
    // Only start a pan when the background (not a tile) is grabbed.
    if ((e.target as HTMLElement).dataset.tile) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setPan({ x: d.panX + dx, y: d.panY + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current.active = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    // Ctrl/⌘ + wheel or plain wheel zooms toward the cursor.
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(2.5, Math.max(0.15, scale * factor));
    const rect = viewportRef.current?.getBoundingClientRect();
    const px = rect ? e.clientX - rect.left : viewport.w / 2;
    const py = rect ? e.clientY - rect.top : viewport.h / 2;
    // Keep the point under the cursor stationary while zooming.
    const cx = (px - pan.x) / scale;
    const cy = (py - pan.y) / scale;
    setPan({ x: px - cx * next, y: py - cy * next });
    setScale(next);
  };

  const zoomBy = (factor: number) => {
    const next = Math.min(2.5, Math.max(0.15, scale * factor));
    const px = viewport.w / 2;
    const py = viewport.h / 2;
    const cx = (px - pan.x) / scale;
    const cy = (py - pan.y) / scale;
    setPan({ x: px - cx * next, y: py - cy * next });
    setScale(next);
  };

  const resetView = () => {
    setScale(1);
    setPan({ x: 40, y: 40 });
  };

  const toggleFullscreen = () => {
    const el = viewportRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  };
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const openCockpit = (id: string) => {
    if (dragRef.current.moved) return; // was a pan, not a click
    router.push(`/cockpit?device=${encodeURIComponent(id)}`);
  };

  const onlineCount = devices.filter((d) => d.status === "online").length;

  return (
    <div className="flex h-screen bg-background">
      {!isFullscreen && <AppSidebar />}

      <main className={`flex flex-1 flex-col min-h-0 ${isFullscreen ? "w-screen" : "sidebar-aware-main"}`}>
        {/* Toolbar */}
        <div className="border-b border-border bg-card/80 backdrop-blur px-4 py-3 lg:px-6 z-20">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl lg:text-2xl font-display tracking-tight flex items-center gap-2">
              <Grid3x3 className="h-5 w-5" /> Fleet Grid
            </h1>
            <span className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              {isConnected ? (
                <Wifi className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-rose-500" />
              )}
              {onlineCount} online / {devices.length} total
            </span>

            <div className="relative min-w-[180px] flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search devices…"
                className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:border-foreground/40"
              />
            </div>

            <Button
              size="sm"
              variant={onlyOnline ? "default" : "outline"}
              onClick={() => setOnlyOnline((v) => !v)}
              className={onlyOnline ? "bg-foreground text-background hover:bg-foreground/90" : "border-border"}
            >
              {onlyOnline ? "Online only" : "All devices"}
            </Button>
            <Button size="sm" variant="outline" className="border-border" onClick={() => void refreshDevices(true)}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>

            <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-1">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => zoomBy(1 / 1.2)}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-12 text-center text-xs font-mono">{Math.round(scale * 100)}%</span>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => zoomBy(1.2)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button size="sm" variant="outline" className="border-border" onClick={resetView}>
              Reset
            </Button>
            <Button size="sm" variant="outline" className="border-border" onClick={toggleFullscreen}>
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground font-mono flex items-center gap-1.5">
            <MousePointerClick className="h-3 w-3" />
            Drag to pan · scroll to zoom · click a screen to open its cockpit · live previews:{" "}
            {Math.min(visibleIds.streamable.size, MAX_LIVE_STREAMS)} (capped at {MAX_LIVE_STREAMS})
          </p>
        </div>

        {/* Canvas */}
        <div className="relative flex-1 min-h-0 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,_var(--color-border)_1px,_transparent_0)] [background-size:24px_24px]">
          <div
            ref={viewportRef}
            className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: contentW,
                height: contentH,
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
              }}
            >
              {filtered.map((d) => {
                const p = positions.get(d.value);
                if (!p) return null;
                const isVisible = visibleIds.ids.includes(d.value);
                return (
                  <FleetTile
                    key={d.value}
                    device={d}
                    x={p.x}
                    y={p.y}
                    render={isVisible}
                    isStreaming={streamingRef.current.has(d.value)}
                    isLive={liveDeviceRef.current.has(d.value)}
                    registerCanvas={(el) => {
                      if (el) canvasMapRef.current.set(d.value, el);
                      else canvasMapRef.current.delete(d.value);
                    }}
                    onOpen={() => openCockpit(d.value)}
                  />
                );
              })}
            </div>

            {filtered.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <Grid3x3 className="h-10 w-10 opacity-30" />
                <p className="text-sm">{devices.length === 0 ? "No devices registered yet." : "No devices match your filter."}</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function FleetTile({
  device,
  x,
  y,
  render,
  isStreaming,
  isLive,
  registerCanvas,
  onOpen,
}: {
  device: DeviceOption;
  x: number;
  y: number;
  render: boolean;
  isStreaming: boolean;
  isLive: boolean;
  registerCanvas: (el: HTMLCanvasElement | null) => void;
  onOpen: () => void;
}) {
  const online = device.status === "online";
  return (
    <div
      data-tile="1"
      onClick={onOpen}
      style={{ position: "absolute", left: x, top: y, width: TILE_W, height: TILE_H }}
      className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:border-foreground/50 hover:shadow-lg"
    >
      {/* Preview */}
      <div data-tile="1" className="relative bg-black" style={{ height: PREVIEW_H }}>
        {render ? (
          <canvas
            data-tile="1"
            ref={registerCanvas}
            className="h-full w-full object-contain"
            style={{ display: isLive ? "block" : "none" }}
          />
        ) : null}
        {!isLive && (
          <div data-tile="1" className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white/40">
            <div
              data-tile="1"
              className={`h-8 w-8 rounded-full border-2 ${
                online ? "border-emerald-400/60 border-t-transparent animate-spin" : "border-white/20"
              }`}
            />
            <span data-tile="1" className="text-[10px] font-mono">
              {online ? (isStreaming ? "starting…" : "queued") : "offline"}
            </span>
          </div>
        )}
        {isLive && (
          <div data-tile="1" className="absolute top-1.5 right-1.5 rounded-full bg-red-600/90 px-1.5 py-0.5 text-[9px] font-mono font-bold text-white">
            LIVE
          </div>
        )}
      </div>
      {/* Label strip */}
      <div data-tile="1" className="flex items-center gap-1.5 px-2.5" style={{ height: TILE_H - PREVIEW_H }}>
        <span data-tile="1" className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-emerald-500" : "bg-zinc-400"}`} />
        <span data-tile="1" className="truncate text-xs font-medium">
          {device.label || device.value}
        </span>
        {device.platform && device.platform !== "unknown" && (
          <span data-tile="1" className="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">
            {device.platform}
          </span>
        )}
      </div>
    </div>
  );
}
