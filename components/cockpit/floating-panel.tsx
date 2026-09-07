"use client";

import { GripVertical, Maximize2, Minus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type PanelId = "screen" | "camera" | "mic" | "shell" | "usage" | "history";

type FloatingPanelProps = {
  title: string;
  icon?: React.ReactNode;
  accent?: string; // tailwind text color class for the icon
  initialX: number;
  initialY: number;
  initialW: number;
  initialH: number;
  z: number;
  minimized?: boolean;
  onFocus: () => void;
  onClose: () => void;
  onToggleMinimize: () => void;
  children: React.ReactNode;
  /** Called with the panel body element so children can measure it. */
  bodyClassName?: string;
};

const MIN_W = 260;
const MIN_H = 120;

export function FloatingPanel({
  title,
  icon,
  accent = "text-foreground",
  initialX,
  initialY,
  initialW,
  initialH,
  z,
  minimized = false,
  onFocus,
  onClose,
  onToggleMinimize,
  children,
  bodyClassName,
}: FloatingPanelProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ w: initialW, h: initialH });
  const dragRef = useRef<{ mode: "move" | "resize" | null; sx: number; sy: number; px: number; py: number; pw: number; ph: number }>(
    { mode: null, sx: 0, sy: 0, px: 0, py: 0, pw: 0, ph: 0 }
  );

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    onFocus();
    if ((e.target as HTMLElement).dataset.noDrag) return;
    dragRef.current = {
      mode: "move",
      sx: e.clientX,
      sy: e.clientY,
      px: pos.x,
      py: pos.y,
      pw: size.w,
      ph: size.h,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onFocus();
    dragRef.current = {
      mode: "resize",
      sx: e.clientX,
      sy: e.clientY,
      px: pos.x,
      py: pos.y,
      pw: size.w,
      ph: size.h,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.mode) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === "move") {
      setPos({ x: Math.max(-size.w + 120, d.px + dx), y: Math.max(0, d.py + dy) });
    } else {
      setSize({ w: Math.max(MIN_W, d.pw + dx), h: Math.max(MIN_H, d.ph + dy) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current.mode = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="absolute flex flex-col rounded-xl border border-border bg-card shadow-[0_10px_40px_rgba(15,23,42,0.14)] overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? undefined : size.h,
        zIndex: z,
      }}
      onPointerDown={onFocus}
    >
      {/* Title bar */}
      <div
        className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-border bg-muted/40 px-3 active:cursor-grabbing select-none"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={`shrink-0 ${accent}`}>{icon}</span>
        <span className="truncate text-xs font-semibold">{title}</span>
        <div className="ml-auto flex items-center gap-1" data-no-drag="1">
          <button
            data-no-drag="1"
            onClick={onToggleMinimize}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            title={minimized ? "Restore" : "Minimize"}
          >
            {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </button>
          <button
            data-no-drag="1"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!minimized && (
        <div className={`relative flex-1 min-h-0 overflow-hidden ${bodyClassName ?? ""}`}>{children}</div>
      )}

      {/* Resize handle */}
      {!minimized && (
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 0 50%, var(--color-border) 50% 60%, transparent 60% 70%, var(--color-border) 70% 80%, transparent 80%)",
          }}
        />
      )}
    </div>
  );
}

/** Small helper so panels can lazily start work only when first opened. */
export function useMountedOnce(active: boolean) {
  const [everActive, setEverActive] = useState(active);
  const setActive = useCallback(() => setEverActive(true), []);
  useEffect(() => {
    if (active) setActive();
  }, [active, setActive]);
  return everActive;
}
