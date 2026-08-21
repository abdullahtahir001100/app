"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import type { OpsCanvasWindow } from "@/hooks/use-agent-ops";

function formatDur(sec: number) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTime(v: unknown) {
  if (!v) return "—";
  try {
    return new Date(String(v)).toLocaleString();
  } catch {
    return String(v);
  }
}

type Props = {
  win: OpsCanvasWindow;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  screenCanvasRef?: RefObject<HTMLCanvasElement | null>;
  camImgRef?: RefObject<HTMLImageElement | null>;
  screenMeta?: { fps: string; status: string; live: boolean };
};

export function OpsCanvasWindowView({
  win,
  onFocus,
  onClose,
  onMove,
  screenCanvasRef,
  camImgRef,
  screenMeta,
}: Props) {
  const drag = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    onFocus(win.id);
    drag.current = { ox: win.x, oy: win.y, sx: e.clientX, sy: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.sx;
    const dy = e.clientY - drag.current.sy;
    onMove(win.id, drag.current.ox + dx, drag.current.oy + dy);
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className="absolute overflow-hidden rounded-xl border border-white/15 bg-[#12151c]/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-md transition-[opacity,transform] duration-500 ease-out"
      style={{
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        zIndex: win.z,
        opacity: entered ? 1 : 0,
        transform: entered ? "translateY(0) scale(1)" : "translateY(18px) scale(0.96)",
      }}
      onPointerDown={() => onFocus(win.id)}
    >
      <div
        className="flex cursor-grab items-center gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="h-2 w-2 rounded-full bg-cyan-400/80" />
        <span className="flex-1 truncate text-xs font-medium tracking-wide text-slate-200">
          {win.title}
        </span>
        <button
          type="button"
          data-no-drag
          onClick={() => onClose(win.id)}
          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="h-[calc(100%-36px)] overflow-auto p-3 text-sm text-slate-200">
        {renderBody(win, screenCanvasRef, camImgRef, screenMeta)}
      </div>
    </div>
  );
}

function renderBody(
  win: OpsCanvasWindow,
  screenCanvasRef?: RefObject<HTMLCanvasElement | null>,
  camImgRef?: RefObject<HTMLImageElement | null>,
  screenMeta?: { fps: string; status: string; live: boolean }
): ReactNode {
  const items = Array.isArray(win.data.items) ? win.data.items : [];

  if (win.type === "note") {
    return (
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-300">
        {String(win.data.text || "")}
      </p>
    );
  }

  if (win.type === "shell") {
    return (
      <div className="font-mono text-[12px] text-cyan-100/90">
        <p className="mb-2 text-slate-400">Task</p>
        <pre className="whitespace-pre-wrap rounded-lg bg-black/40 p-3">
          {String(win.data.prompt || win.data.command || "Running…")}
        </pre>
      </div>
    );
  }

  if (win.type === "screen") {
    return (
      <div className="flex h-full flex-col">
        <p className="mb-2 text-[11px] text-slate-500">
          {screenMeta?.status || "connecting"} · {screenMeta?.fps || "0"} fps ·{" "}
          {screenMeta?.live ? "live" : "waiting"}
        </p>
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
          <canvas ref={screenCanvasRef} className="max-h-full max-w-full object-contain" />
        </div>
      </div>
    );
  }

  if (win.type === "camera") {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden rounded-lg bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={camImgRef} alt="Live camera" className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (win.type === "usage") {
    const max = Math.max(1, ...items.map((r: { duration?: number }) => Number(r.duration) || 0));
    return (
      <ul className="space-y-2.5">
        {items.length === 0 && (
          <li className="text-slate-500">No usage yet for this device.</li>
        )}
        {items.map((row: { appName?: string; duration?: number }, i: number) => {
          const name = String(row.appName || "App");
          const dur = Number(row.duration) || 0;
          const pct = Math.round((dur / max) * 100);
          return (
            <li key={`${name}-${i}`}>
              <div className="mb-1 flex justify-between gap-2 text-[12px]">
                <span className="truncate text-slate-200">{name}</span>
                <span className="shrink-0 text-slate-400">{formatDur(dur)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  if (win.type === "browser") {
    return (
      <ul className="space-y-2">
        {items.length === 0 && <li className="text-slate-500">No browser visits.</li>}
        {items.map(
          (
            row: { title?: string; url?: string; browser?: string; visitTime?: string },
            i: number
          ) => (
            <li
              key={i}
              className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2"
            >
              <p className="truncate text-[13px] text-slate-100">
                {row.title || row.url || "Visit"}
              </p>
              <p className="truncate text-[11px] text-slate-500">{row.url}</p>
              <p className="mt-1 text-[10px] text-slate-600">
                {row.browser || "browser"} · {formatTime(row.visitTime)}
              </p>
            </li>
          )
        )}
      </ul>
    );
  }

  if (win.type === "notifications") {
    return (
      <ul className="space-y-2">
        {items.length === 0 && <li className="text-slate-500">No notifications.</li>}
        {items.map(
          (
            row: { app?: string; title?: string; message?: string; createdAt?: string },
            i: number
          ) => (
            <li
              key={i}
              className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2"
            >
              <p className="text-[11px] text-cyan-400/80">{row.app || "app"}</p>
              <p className="text-[13px] text-slate-100">{row.title || "Notification"}</p>
              <p className="line-clamp-2 text-[12px] text-slate-400">{row.message}</p>
              <p className="mt-1 text-[10px] text-slate-600">{formatTime(row.createdAt)}</p>
            </li>
          )
        )}
      </ul>
    );
  }

  if (win.type === "activity") {
    return (
      <ul className="relative space-y-0 border-l border-white/10 pl-4">
        {items.length === 0 && <li className="text-slate-500">No activity.</li>}
        {items.map(
          (
            row: {
              action?: string;
              appName?: string;
              details?: string;
              windowTitle?: string;
              duration?: number;
              createdAt?: string;
            },
            i: number
          ) => (
            <li key={i} className="relative pb-3">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-teal-400/70" />
              <p className="text-[12px] text-slate-200">
                <span className="text-slate-400">{row.action || "event"}</span>
                {row.appName ? ` · ${row.appName}` : ""}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {row.windowTitle || row.details || ""}
                {row.duration ? ` · ${formatDur(Number(row.duration))}` : ""}
              </p>
              <p className="text-[10px] text-slate-600">{formatTime(row.createdAt)}</p>
            </li>
          )
        )}
      </ul>
    );
  }

  return <p className="text-slate-500">Empty panel</p>;
}
