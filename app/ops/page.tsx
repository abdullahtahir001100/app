"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  Eraser,
  Monitor,
  Sparkles,
  Plus,
  Globe,
  Palette,
  Mic,
  ArrowUp,
  CheckCircle2,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Download,
  Cpu,
  Copy,
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
  const canvasBoardRef = useRef<HTMLDivElement | null>(null);

  const [selectedDevice, setSelectedDevice] = useState(
    searchParams.get("device") || ""
  );
  const [isLogOpen, setIsLogOpen] = useState(true);

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

  const { canvasRef, hasLiveFrame, measuredFps, mediaStatus } = useScreenRemote(
    {
      subscribe,
      selectedDeviceRef,
      mediaDeviceId:
        (monitor === "screen" || hasScreenWin) && selectedDevice
          ? selectedDevice
          : undefined,
    }
  );

  useEffect(() => {
    if (devices.length === 0) return;
    const known = devices.map((d) => d.value);
    const requested = searchParams.get("device") || "";
    if (requested && known.includes(requested)) {
      selectedDeviceRef.current = requested;
      setSelectedDevice(requested);
      return;
    }
    if (selectedDeviceRef.current && known.includes(selectedDeviceRef.current))
      return;
    const next = resolveTarget() || known[0] || "";
    selectedDeviceRef.current = next;
    setSelectedDevice(next);
  }, [devices, resolveTarget, searchParams]);

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    if (!hasCameraWin || !selectedDevice) return;

    const client = new MediaGatewayClient();
    const unsub = client.subscribe((payload) => {
      const decode = (buffer: Uint8Array) => {
        if (buffer.length < 4) return;
        const { deviceId, frame } = unwrapDeviceBinaryFrame(buffer);
        if (
          deviceId &&
          selectedDeviceRef.current &&
          deviceId !== selectedDeviceRef.current
        ) {
          return;
        }
        if (frame.length < 2) return;
        const t = frame[0];
        if (t !== 0x01 && t !== 0x02) return;
        const blob = new Blob([frame.subarray(1).slice()], {
          type: "image/jpeg",
        });
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
    <div className="relative min-h-screen overflow-hidden bg-[#fafafa] text-slate-800 font-sans">
      {/* High Visibility Dot Grid Background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-100"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(0, 0, 0, 0.18) 1.2px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Top Header / Control Actions */}
      <header className="relative z-30 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <select
              value={selectedDevice}
              onChange={(e) => {
                selectedDeviceRef.current = e.target.value;
                setSelectedDevice(e.target.value);
                router.replace(
                  `/ops?device=${encodeURIComponent(e.target.value)}`
                );
              }}
              className="rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm outline-none backdrop-blur focus:ring-2 focus:ring-slate-300"
            >
              {devices.length === 0 && <option value="">No agents</option>}
              {devices.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label || d.value}
                </option>
              ))}
            </select>
            <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
              {gatewayStatus}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void startMonitor("screen")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white"
          >
            <Monitor className="h-3.5 w-3.5 text-slate-600" />
            Screen
          </button>
          <button
            type="button"
            onClick={() => void startMonitor("camera")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white"
          >
            <Camera className="h-3.5 w-3.5 text-slate-600" />
            Camera
          </button>
          <button
            type="button"
            onClick={() => void clearCanvas()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white"
          >
            <Eraser className="h-3.5 w-3.5 text-slate-600" />
            Clear
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-3.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm backdrop-blur hover:bg-white"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </header>

      {/* Main Canvas Area */}
      <main className="relative z-10 h-[calc(100vh-73px)] w-full overflow-hidden">
        {/* Floating Top-Left "Thinking" Widget */}
        <div className="absolute left-6 top-4 z-20 w-80 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white/90 via-purple-50/30 to-blue-50/40 p-4 shadow-md backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1 rounded-full bg-black px-2.5 py-1 text-[10px] text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white"></span>
              <span className="h-1.5 w-1.5 rounded-full bg-white"></span>
            </div>
            <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200/60 bg-white/60 p-2 text-xs text-slate-700">
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                A
              </div>
              <span className="font-medium">{selectedDevice || "agent-a"}</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-400">
              <Copy className="h-3.5 w-3.5 cursor-pointer hover:text-slate-600" />
              <ChevronDown className="h-3.5 w-3.5 cursor-pointer hover:text-slate-600" />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
            <span>
              Agent &apos;{selectedDevice || "a"}&apos; - Status:{" "}
              {busy ? "Thinking..." : "Ready"}
            </span>
          </div>
        </div>

        {/* Floating Bottom-Left "Query History & Agent Log" Widget */}
        <div className="absolute left-6 bottom-24 z-20 w-80 rounded-2xl border border-slate-200/80 bg-white/80 shadow-md backdrop-blur-md">
          <div className="border-b border-slate-100 p-3">
            <h3 className="text-xs font-semibold text-slate-700">
              Query History
            </h3>
          </div>

          <div className="max-h-52 overflow-y-auto p-2 space-y-1">
            <div className="flex items-center justify-between rounded-xl bg-slate-100/70 px-3 py-2 text-xs text-slate-700">
              <span className="font-medium">Query</span>
              <span className="text-slate-400">Status</span>
            </div>

            {messages.length === 0 ? (
              <div className="flex items-center justify-between rounded-xl px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                    A
                  </div>
                  <span>Status query</span>
                </div>
                <CheckCircle2 className="h-4 w-4 text-slate-600" />
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-xl px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2 truncate">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-500 text-[10px] font-bold text-white">
                      {m.role === "user" ? "U" : "A"}
                    </div>
                    <span className="truncate">{m.text}</span>
                  </div>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-slate-600" />
                </div>
              ))
            )}
          </div>

          <div className="border-t border-slate-100 p-2">
            <button
              onClick={() => setIsLogOpen(!isLogOpen)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100/60"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-slate-600" />
                <span>Agent log</span>
              </div>
              {isLogOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {/* Floating Bottom Center Command Dock */}
        <div className="absolute bottom-6 left-1/2 z-30 w-full max-w-2xl -translate-x-1/2 px-4">
          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white/90 p-2 shadow-lg backdrop-blur-md"
          >
            <button
              type="button"
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <Plus className="h-4 w-4" />
            </button>
            <span className="text-slate-400 text-sm font-light">/</span>

            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What would you like to change or create?"
              disabled={!selectedDevice || busy}
              className="flex-1 bg-transparent px-2 text-sm text-slate-800 placeholder-slate-400 outline-none"
            />

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <Cpu className="h-4 w-4" />
              </button>

              <button
                type="button"
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <Globe className="h-4 w-4" />
              </button>

              <button
                type="button"
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <Palette className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                <span>3 Flash</span>
                <ChevronDown className="h-3 w-3 text-slate-500" />
              </div>

              <button
                type="button"
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <Mic className="h-4 w-4" />
              </button>

              <button
                type="submit"
                disabled={!selectedDevice || busy || !draft.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-200 text-slate-700 transition hover:bg-slate-300 disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>

        {/* Dynamic Windows Canvas Board */}
        <div
          ref={canvasBoardRef}
          className="relative h-full w-full overflow-auto"
        >
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
      </main>
    </div>
  );
}

export default function OpsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#fafafa] text-slate-500 font-sans">
          Loading canvas…
        </div>
      }
    >
      <OpsPageInner />
    </Suspense>
  );
}