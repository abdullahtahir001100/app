"use client";

import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  Eraser,
  Monitor,
  Plus,
  Mic,
  ArrowUp,
  Loader2,
  X,
  ChevronDown,
  Download,
  Cpu,
  Copy,
  FileText,
  Check,
  Key,
  Trash2,
} from "lucide-react";
import { useGateway } from "@/hooks/use-gateway";
import { useScreenRemote } from "@/hooks/use-screen-remote";
import { useAgentOps } from "@/hooks/use-agent-ops";
import { OpsCanvasWindowView } from "@/components/ops/ops-canvas-window";
import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import { MediaGatewayClient } from "@/lib/media-gateway-client";
import {
  useApiConfig,
  PROVIDER_OPTIONS,
  type ProviderKey,
} from "@/hooks/use-api-config";

/* ── Constants ─────────────────────────────────────────────── */
const MAX_FILE_SIZE = 500 * 1024; // 500 KB

function OpsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedDeviceRef = useRef("");
  const camImgRef = useRef<HTMLImageElement | null>(null);
  const camUrlRef = useRef<string | null>(null);
  const canvasBoardRef = useRef<HTMLDivElement | null>(null);
  const [draftProvider, setDraftProvider] = useState(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedDevice, setSelectedDevice] = useState(
    searchParams.get("device") || ""
  );
  const [isLogOpen, setIsLogOpen] = useState(true);

  /* ── API Config Modal ────────────────────────────────────── */
  const [showApiModal, setShowApiModal] = useState(false);
  const {
    config: apiConfig,
    activeProvider,
    configuredProviders,
    setActiveProvider,
    setProviderApiKey,
    setProviderModel,
  } = useApiConfig("ops");

  /* ── Model Selector Dropdown ─────────────────────────────── */
  const [showModelPicker, setShowModelPicker] = useState(false);

  /* ── File Context ────────────────────────────────────────── */
  const [fileContext, setFileContext] = useState<{
    name: string;
    content: string;
    size: number;
  } | null>(null);

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

  /* ── File upload handler ────────────────────────────────── */
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.name.endsWith(".txt")) {
        alert("Only .txt files are allowed.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert("File must be under 500 KB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setFileContext({
          name: file.name,
          content: reader.result as string,
          size: file.size,
        });
      };
      reader.readAsText(file);
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    []
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(fileContext?.content, apiConfig);
  };

  /* ── Active model display label ─────────────────────────── */
  const activeModelLabel = activeProvider?.model
    ? activeProvider.model.split("/").pop()?.split("-").slice(0, 3).join(" ") ||
      activeProvider.model
    : "2.0 Flash";

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

        {/* Floating Bottom Center Command Dock */}
        <div className="absolute bottom-6 left-1/2 z-30 w-full max-w-2xl -translate-x-1/2 px-4">
          {/* File Context Chip */}
          {fileContext && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-blue-200/80 bg-blue-50/80 px-3 py-1.5 text-xs text-blue-700 backdrop-blur-sm">
              <FileText className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate font-medium">{fileContext.name}</span>
              <span className="text-blue-500">
                ({(fileContext.size / 1024).toFixed(1)} KB)
              </span>
              <button
                type="button"
                onClick={() => setFileContext(null)}
                className="ml-auto rounded-md p-0.5 hover:bg-blue-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white/90 p-2 shadow-lg backdrop-blur-md"
          >
            {/* Plus → file upload */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="Attach .txt file (max 500 KB)"
            >
              <Plus className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <span className="text-slate-400 text-sm font-light">/</span>

            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What would you like to change or create?"
              disabled={!selectedDevice || busy}
              className="flex-1 bg-transparent px-2 text-sm text-slate-800 placeholder-slate-400 outline-none"
            />

            <div className="flex items-center gap-1.5">
              {/* CPU → API settings */}
              <button
                type="button"
                onClick={() => setShowApiModal(true)}
                className={`rounded-xl p-1.5 transition-colors ${
                  activeProvider?.apiKey
                    ? "text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                }`}
                title="API Settings"
              >
                <Cpu className="h-4 w-4" />
              </button>

              {/* Model selector */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowModelPicker((prev) => !prev)}
                  className="flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <span className="max-w-[80px] truncate">{activeModelLabel}</span>
                  <ChevronDown className="h-3 w-3 text-slate-500" />
                </button>

                {showModelPicker && (
                  <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl z-50">
                    <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Select Model
                    </div>
                    {configuredProviders.length === 0 && (
                      <div className="px-2 py-3 text-xs text-slate-400 text-center">
                        No API keys configured.
                        <br />
                        Click the CPU icon to add keys.
                      </div>
                    )}
                    {(configuredProviders.length > 0
                      ? PROVIDER_OPTIONS.filter((p) =>
                          configuredProviders.some((c) => c.provider === p.key)
                        )
                      : PROVIDER_OPTIONS
                    ).map((provOpt) => (
                      <div key={provOpt.key} className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-semibold text-slate-500 uppercase">
                          {provOpt.label}
                        </div>
                        {provOpt.models.map((model) => {
                          const isActive =
                            apiConfig.activeProvider === provOpt.key &&
                            activeProvider?.model === model;
                          return (
                            <button
                              key={model}
                              type="button"
                              onClick={() => {
                                setActiveProvider(provOpt.key);
                                setProviderModel(provOpt.key, model);
                                setShowModelPicker(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition ${
                                isActive
                                  ? "bg-slate-100 text-slate-900 font-medium"
                                  : "text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <span className="font-mono text-[11px]">
                                {model}
                              </span>
                              {isActive && (
                                <Check className="h-3 w-3 text-emerald-500" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
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

      {/* ── API Settings Modal ──────────────────────────────── */}
      {showApiModal && (
  <div
    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm"
    onClick={() => {
      setShowApiModal(false);
      setDraftProvider(null); // Reset step on close
    }}
  >
    <div
      className="relative w-full max-w-md rounded-none border border-slate-300 bg-[#fafafa] p-6 shadow-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-800">
            {draftProvider ? `Configure ${draftProvider.label}` : "Select Provider"}
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {draftProvider 
              ? "Enter your API details below" 
              : "Choose an AI company to set up"}
          </p>
        </div>
        <button
          onClick={() => {
            setShowApiModal(false);
            setDraftProvider(null);
          }}
          className="rounded-none p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Step 1: Select Company */}
      {!draftProvider ? (
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
          {PROVIDER_OPTIONS.map((opt) => {
            const isActive = apiConfig.activeProvider === opt.key;
            const hasKey = (apiConfig.providers.find((p) => p.provider === opt.key)?.apiKey || "").trim().length > 0;

            return (
              <button
                key={opt.key}
                onClick={() => setDraftProvider(opt)}
                className={`group flex h-24 flex-col items-start justify-between rounded-none border p-3 shadow-none transition-colors ${
                  isActive
                    ? "border-slate-800 bg-slate-100"
                    : "border-slate-200 bg-white hover:border-slate-400"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className={`text-xs font-semibold ${isActive ? "text-slate-800" : "text-slate-600 group-hover:text-slate-800"}`}>
                    {opt.label}
                  </span>
                  <div className={`h-2 w-2 rounded-none ${isActive ? "bg-slate-800" : "bg-transparent"}`} />
                </div>
                
                {hasKey ? (
                  <span className="inline-flex rounded-none bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-100">
                    Key Configured
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400">Not configured</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        /* Step 2: Add API Configuration */
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              API Key
            </label>
            <input
              type="password"
              placeholder={`Paste ${draftProvider.label} API Key`}
              value={apiConfig.providers.find((p) => p.provider === draftProvider.key)?.apiKey || ""}
              onChange={(e) => setProviderApiKey(draftProvider.key, e.target.value)}
              className="w-full rounded-none border border-slate-300 bg-white px-3 py-2.5 text-xs font-mono text-slate-800 placeholder-slate-400 shadow-none outline-none transition-colors focus:border-slate-800"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              Default Model
            </label>
            <select
              value={apiConfig.providers.find((p) => p.provider === draftProvider.key)?.model || draftProvider.defaultModel}
              onChange={(e) => setProviderModel(draftProvider.key, e.target.value)}
              className="w-full rounded-none border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-800 shadow-none outline-none transition-colors focus:border-slate-800"
            >
              {draftProvider.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6 flex items-center gap-2 pt-2 border-t border-slate-200">
            <button
              onClick={() => setDraftProvider(null)}
              className="flex-1 rounded-none border border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-600 shadow-none transition-colors hover:bg-slate-50 hover:text-slate-800"
            >
              Back
            </button>
            <button
              onClick={() => {
                setActiveProvider(draftProvider.key);
                setDraftProvider(null);
                setShowApiModal(false);
              }}
              className="flex-1 rounded-none bg-slate-800 py-2.5 text-xs font-semibold text-white shadow-none transition-colors hover:bg-slate-700"
            >
              Save & Activate
            </button>
          </div>
        </div>
      )}
    </div>
  </div>
)}

      {/* Close model picker on outside click */}
      {showModelPicker && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setShowModelPicker(false)}
        />
      )}
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