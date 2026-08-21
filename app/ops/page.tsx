"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Camera,
  Globe,
  Info,
  Monitor,
  Send,
  SquareTerminal,
  Terminal,
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

  const [selectedDevice, setSelectedDevice] = useState(
    searchParams.get("device") || ""
  );
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
    if (
      selectedDeviceRef.current &&
      known.includes(selectedDeviceRef.current)
    )
      return;
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

  const handleQuickAction = (promptText: string) => {
    setDraft(promptText);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#fafafa] text-slate-800">
      {/* Light dot grid canvas atmosphere */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.35) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Full Screen Canvas Container */}
      <div className="absolute inset-0 overflow-auto">
        <div
          ref={canvasBoardRef}
          className="relative min-h-full min-w-[1100px]"
          style={{ height: "max(100%, 900px)" }}
        >
          {/* Quick Options Grid when Canvas is Empty */}
          {windows.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 pb-28">
              <div className="grid w-full max-w-2xl grid-cols-2 gap-3.5 sm:grid-cols-3">
                {/* Camera Card */}
                <button
                  type="button"
                  onClick={() => void startMonitor("camera")}
                  className="group flex flex-col items-start rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="mb-3 rounded-xl bg-blue-50 p-2.5 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white">
                    <Camera className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">
                    Open Camera
                  </span>
                  <span className="mt-0.5 text-xs text-slate-400">
                    Live camera stream
                  </span>
                </button>

                {/* Screen Card */}
                <button
                  type="button"
                  onClick={() => void startMonitor("screen")}
                  className="group flex flex-col items-start rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="mb-3 rounded-xl bg-emerald-50 p-2.5 text-emerald-600 transition group-hover:bg-emerald-600 group-hover:text-white">
                    <Monitor className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">
                    Screen View
                  </span>
                  <span className="mt-0.5 text-xs text-slate-400">
                    Remote screen access
                  </span>
                </button>

                {/* Logs Card */}
                <button
                  type="button"
                  onClick={() => handleQuickAction("logs dikhao")}
                  className="group flex flex-col items-start rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="mb-3 rounded-xl bg-amber-50 p-2.5 text-amber-600 transition group-hover:bg-amber-600 group-hover:text-white">
                    <Terminal className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">
                    Agent Logs
                  </span>
                  <span className="mt-0.5 text-xs text-slate-400">
                    System activity & logs
                  </span>
                </button>

                {/* Browser Card */}
                <button
                  type="button"
                  onClick={() => handleQuickAction("open Chrome")}
                  className="group flex flex-col items-start rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="mb-3 rounded-xl bg-purple-50 p-2.5 text-purple-600 transition group-hover:bg-purple-600 group-hover:text-white">
                    <Globe className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">
                    Browse Web
                  </span>
                  <span className="mt-0.5 text-xs text-slate-400">
                    Launch browser window
                  </span>
                </button>

                {/* Shell Card */}
                <button
                  type="button"
                  onClick={() => handleQuickAction("open terminal")}
                  className="group flex flex-col items-start rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="mb-3 rounded-xl bg-indigo-50 p-2.5 text-indigo-600 transition group-hover:bg-indigo-600 group-hover:text-white">
                    <SquareTerminal className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">
                    Shell Info
                  </span>
                  <span className="mt-0.5 text-xs text-slate-400">
                    Terminal commands
                  </span>
                </button>

                {/* Info Card */}
                <button
                  type="button"
                  onClick={() => handleQuickAction("usage dikhao")}
                  className="group flex flex-col items-start rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="mb-3 rounded-xl bg-rose-50 p-2.5 text-rose-600 transition group-hover:bg-rose-600 group-hover:text-white">
                    <Info className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">
                    Usage Info
                  </span>
                  <span className="mt-0.5 text-xs text-slate-400">
                    System specs & status
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Canvas Rendered Windows */}
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
      </div>

      {/* Stitch Floating Bottom Chat Dock */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center justify-end p-4 md:p-6">
        <div className="pointer-events-auto flex w-full max-w-2xl flex-col rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-xl backdrop-blur-md">
          {/* Chat Messages Log */}
          {messages.length > 0 && (
            <div className="mb-3 max-h-48 space-y-2 overflow-y-auto px-1 text-sm">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto max-w-[80%] bg-blue-600 text-white shadow-sm"
                      : m.role === "system"
                        ? "border border-dashed border-slate-300 bg-slate-50 text-slate-500"
                        : "mr-auto max-w-[80%] bg-slate-100 text-slate-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              ))}
              {busy && (
                <p className="animate-pulse text-xs font-medium text-blue-600">
                  Generating windows…
                </p>
              )}
              <div ref={endRef} />
            </div>
          )}

          {/* Input Bar */}
          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="usage dikhao · screen on · history · open Chrome"
              disabled={!selectedDevice || busy}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!selectedDevice || busy || !draft.trim()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md transition hover:bg-blue-700 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function OpsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#fafafa] text-slate-500">
          Loading canvas…
        </div>
      }
    >
      <OpsPageInner />
    </Suspense>
  );
}