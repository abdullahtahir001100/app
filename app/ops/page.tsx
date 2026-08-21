"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  Eraser,
  Monitor,
  Send,
  Sparkles,
} from "lucide-react";
import { useGateway } from "@/hooks/use-gateway";
import { useScreenRemote } from "@/hooks/use-screen-remote";
import { useAgentOps } from "@/hooks/use-agent-ops";
import { OpsCanvasWindowView } from "@/components/ops/ops-canvas-window";
import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import { MediaGatewayClient } from "@/lib/media-gateway-client";

function OpsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedDeviceRef = useRef("");
  const camImgRef = useRef<HTMLImageElement | null>(null);
  const camUrlRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const canvasBoardRef = useRef<HTMLDivElement | null>(null);

  const [selectedDevice, setSelectedDevice] = useState(searchParams.get("device") || "");
  const { devices, subscribe, resolveTarget } = useGateway();

  const {
    messages,
    draft,
    setDraft,
    busy,
    send,
    monitor,
    startMonitor,
    windows,
    focusWindow,
    closeWindow,
    moveWindow,
    clearCanvas,
    gatewayStatus,
  } = useAgentOps(selectedDevice);

  const hasScreenWin = windows.some((w) => w.type === "screen");
  const hasCameraWin = windows.some((w) => w.type === "camera");

  const {
    canvasRef,
    hasLiveFrame,
    measuredFps,
    mediaStatus,
  } = useScreenRemote({
    subscribe,
    selectedDeviceRef,
    mediaDeviceId:
      (monitor === "screen" || hasScreenWin) && selectedDevice
        ? selectedDevice
        : undefined,
  });

  useEffect(() => {
    if (devices.length === 0) return;
    const known = devices.map((d) => d.value);
    const requested = searchParams.get("device") || "";
    if (requested && known.includes(requested)) {
      selectedDeviceRef.current = requested;
      setSelectedDevice(requested);
      return;
    }
    if (selectedDeviceRef.current && known.includes(selectedDeviceRef.current)) return;
    const next = resolveTarget() || known[0] || "";
    selectedDeviceRef.current = next;
    setSelectedDevice(next);
  }, [devices, resolveTarget, searchParams]);

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!hasCameraWin || !selectedDevice) return;

    const client = new MediaGatewayClient();
    const unsub = client.subscribe((payload) => {
      const decode = (buffer: Uint8Array) => {
        if (buffer.length < 4) return;
        const { deviceId, frame } = unwrapDeviceBinaryFrame(buffer);
        if (deviceId && selectedDeviceRef.current && deviceId !== selectedDeviceRef.current) {
          return;
        }
        if (frame.length < 2) return;
        const t = frame[0];
        if (t !== 0x01 && t !== 0x02) return;
        const blob = new Blob([frame.subarray(1).slice()], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        if (camUrlRef.current) URL.revokeObjectURL(camUrlRef.current);
        camUrlRef.current = url;
        if (camImgRef.current) camImgRef.current.src = url;
      };
      if (payload instanceof Blob) {
        void payload.arrayBuffer().then((raw) => decode(new Uint8Array(raw)));
      } else {
        decode(new Uint8Array(payload));
      }
    });

    void client.connect(selectedDevice, "camera");
    return () => {
      unsub();
      client.disconnect();
      if (camUrlRef.current) {
        URL.revokeObjectURL(camUrlRef.current);
        camUrlRef.current = null;
      }
    };
  }, [hasCameraWin, selectedDevice]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0c10] text-slate-100">
      {/* Dot grid canvas atmosphere */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.28) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 15% 0%, rgba(34,211,238,0.08), transparent 50%), radial-gradient(ellipse 50% 40% at 90% 20%, rgba(167,139,250,0.07), transparent 45%)",
        }}
      />

      <header className="relative z-30 flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#0a0c10]/80 px-4 py-3 backdrop-blur-md md:px-5">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-300 hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-cyan-400" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Agent Ops</h1>
            <p className="text-xs text-slate-400">
              Stitch canvas — AI opens windows with live data
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={selectedDevice}
            onChange={(e) => {
              selectedDeviceRef.current = e.target.value;
              setSelectedDevice(e.target.value);
              router.replace(`/ops?device=${encodeURIComponent(e.target.value)}`);
            }}
            className="max-w-[200px] rounded-md border border-white/15 bg-[#141820] px-2 py-1.5 text-sm"
          >
            {devices.length === 0 && <option value="">No agents</option>}
            {devices.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label || d.value}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void startMonitor("screen")}
            className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10"
          >
            <Monitor className="h-3.5 w-3.5" />
            Screen
          </button>
          <button
            type="button"
            onClick={() => void startMonitor("camera")}
            className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10"
          >
            <Camera className="h-3.5 w-3.5" />
            Camera
          </button>
          <button
            type="button"
            onClick={() => void clearCanvas()}
            className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10"
          >
            <Eraser className="h-3.5 w-3.5" />
            Clear
          </button>
          <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-500">
            {gatewayStatus}
          </span>
        </div>
      </header>

      <div className="relative z-10 flex h-[calc(100vh-57px)]">
        {/* Prompt dock — Stitch-like bottom-left chat strip */}
        <aside className="flex w-full max-w-[340px] shrink-0 flex-col border-r border-white/10 bg-[#0c0f14]/90 md:max-w-[360px]">
          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === "user"
                    ? "ml-4 bg-cyan-500/15 text-cyan-50"
                    : m.role === "system"
                      ? "border border-dashed border-white/15 bg-transparent text-slate-500"
                      : "mr-2 bg-white/[0.06] text-slate-200"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            ))}
            {busy && (
              <p className="animate-pulse text-xs text-cyan-400/80">
                Generating windows…
              </p>
            )}
            <div ref={endRef} />
          </div>
          <form onSubmit={onSubmit} className="border-t border-white/10 p-3">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="usage dikhao · screen on · history · open Chrome"
                disabled={!selectedDevice || busy}
                className="flex-1 rounded-xl border border-white/15 bg-[#141820] px-3 py-2.5 text-sm outline-none ring-cyan-500/30 focus:ring-2"
              />
              <button
                type="submit"
                disabled={!selectedDevice || busy || !draft.trim()}
                className="inline-flex items-center justify-center rounded-xl bg-cyan-600 px-3 text-white hover:bg-cyan-500 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </aside>

        {/* Infinite canvas */}
        <section className="relative min-w-0 flex-1 overflow-auto">
          <div
            ref={canvasBoardRef}
            className="relative min-h-full min-w-[1100px]"
            style={{ height: "max(100%, 900px)" }}
          >
            {windows.length === 0 && (
              <div className="pointer-events-none absolute left-1/2 top-[38%] w-full max-w-lg -translate-x-1/2 px-6 text-center">
                <p className="text-3xl font-semibold tracking-tight text-white/85">
                  Empty canvas
                </p>
                <p className="mt-3 text-sm text-slate-400">
                  Prompt do — jaise Stitch screens kholti hai, yahan AI usage bars,
                  browser list, notifications, live screen/camera windows khud open
                  karegi.
                </p>
              </div>
            )}

            {windows.map((win) => (
              <OpsCanvasWindowView
                key={win.id}
                win={win}
                onFocus={focusWindow}
                onClose={closeWindow}
                onMove={moveWindow}
                screenCanvasRef={win.type === "screen" ? canvasRef : undefined}
                camImgRef={win.type === "camera" ? camImgRef : undefined}
                screenMeta={
                  win.type === "screen"
                    ? {
                        fps: measuredFps,
                        status: mediaStatus,
                        live: hasLiveFrame,
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function OpsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0a0c10] text-slate-400">
          Loading canvas…
        </div>
      }
    >
      <OpsPageInner />
    </Suspense>
  );
}
