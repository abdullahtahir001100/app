"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CustomSlider } from "@/components/custom-slider";
import { Label } from "@/components/ui/label";
import { useScreenRemote } from "@/hooks/use-screen-remote";
import { useGateway } from "@/hooks/use-gateway";
import { gatewayClient, type DeviceOption } from "@/lib/gateway-client";
import type { WebRtcSignal } from "@/lib/webrtc-client";
import {
  Keyboard,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer2,
  Power,
  RefreshCw,
  Settings,
  Volume2,
  X,
  Sparkles,
  Mic,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Select from "react-select";
import {
  dispatchMediaTransportPreference,
  getPreferredMediaTransport,
  type MediaTransport,
} from "@/lib/media-transport";
import { MicPanel } from "@/components/cockpit/mic-panel";
import { PremiumGate } from "@/components/premium-card";
import { FullPageLoader } from "@/components/full-page-loader";
import { useFeatureAccess } from "@/hooks/use-feature-access";

type StreamQuality = "fast" | "high" | "ultra" | "medium" | "saver" | "low";

function buildQualityPayload(quality: StreamQuality, target_fps: number) {
  switch (quality) {
    case "fast":
      return { quality: "fast", max_width: 1280, jpeg_quality: 58, target_fps: target_fps || 60 };
    case "high":
      return { quality: "high", max_width: 1600, jpeg_quality: 72, target_fps: target_fps || 45 };
    case "ultra":
      return { quality: "ultra", max_width: 1920, jpeg_quality: 84, target_fps: target_fps || 30 };
    case "medium":
      return { quality: "medium", max_width: 1280, jpeg_quality: 62, target_fps: target_fps || 30 };
    case "saver":
    case "low":
    default:
      return { quality: "saver", max_width: 960, jpeg_quality: 50, target_fps: target_fps || 20 };
  }
}

const QUALITY_OPTIONS: { value: StreamQuality; label: string; hint: string; recommended?: boolean }[] = [
  { value: "fast", label: "⚡ Ultra Smooth (60 FPS)", hint: "720p · 60 FPS (Zero-Lag Butter Motion)", recommended: true },
  { value: "high", label: "Crisp Video ⭐", hint: "1600px · 45 FPS (HQ Clean Text)" },
  { value: "ultra", label: "Studio Ultra", hint: "1080p · Lossless High-Res" },
  { value: "saver", label: "Low Bandwidth", hint: "960px · Light Net" },
];

const FPS_OPTIONS = [15, 24, 30, 45, 60];

function loadSavedQuality(): StreamQuality {
  try {
    const saved = sessionStorage.getItem("zenvora_screen_quality") as StreamQuality;
    if (saved === "fast" || saved === "high" || saved === "ultra" || saved === "medium" || saved === "saver" || saved === "low") {
      return saved;
    }
  } catch {
    // ignore
  }
  return "fast"; // Default to fast (60 FPS Butter) for lightning-fast responsive frames
}

function loadSavedFps(): number {
  try {
    const saved = sessionStorage.getItem("zenvora_screen_fps");
    if (saved) {
      const num = parseInt(saved, 10);
      if (FPS_OPTIONS.includes(num)) return num;
    }
  } catch {
    // ignore
  }
  return 60; // 60 FPS buttery smooth standard on LAN
}

export default function ScreenPage() {
  const { allowed: featureAllowed, loading: featureLoading } = useFeatureAccess("screen");
  const searchParams = useSearchParams();
  const requestedDevice = searchParams.get("device") || "";
  const {
    isConnected,
    devices: deviceOptions,
    dispatch: gatewayDispatch,
    refreshDevices,
    resolveTarget,
    isDeviceOnline,
    ensureConnected,
    subscribe,
  } = useGateway();

  const selectedDeviceRef = useRef("");
  const [selectedDevice, setSelectedDevice] = useState("");

  const sendWebRtcSignal = useCallback(
    (signal: WebRtcSignal) => {
      const target = selectedDeviceRef.current || selectedDevice;
      if (target) {
        gatewayDispatch("WEBRTC_SIGNAL", { signal, stream_type: "screen" }, target);
      }
    },
    [gatewayDispatch, selectedDevice]
  );

  const {
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
    mediaReady,
    mediaStatus,
    ensureMediaReady,
    sendUdpControl,
    webrtcState,
    isUdpConnected,
  } = useScreenRemote({
    selectedDeviceRef,
    mediaDeviceId: selectedDevice || undefined,
    sendSignal: sendWebRtcSignal,
    subscribe: (listener) =>
      subscribe((event) => {
        if (event.type === "binary") listener({ type: "binary", data: event.data });
        else if (event.type === "json") listener({ type: "json", packet: event.packet });
      }),
  });

  const [commandStatus, setCommandStatus] = useState("Connecting...");
  const [mediaTransport, setMediaTransport] = useState<MediaTransport>("wss");
  const agentOnline = Boolean(selectedDevice) && isDeviceOnline(selectedDevice);
  const canControl = isConnected && agentOnline;
  const [isStreaming, setIsStreaming] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [brightness, setBrightness] = useState(100);
  const [volume, setVolume] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamQuality, setStreamQuality] = useState<StreamQuality>(loadSavedQuality);
  const [streamFps, setStreamFps] = useState<number>(loadSavedFps);

  // Stable link light: green live/online, amber connecting, red only when truly offline.
  const linkState = useMemo<"online" | "connecting" | "offline">(() => {
    if (hasLiveFrame || agentOnline) return "online";
    if (!isConnected || isStreaming || !selectedDevice || deviceOptions.length === 0) {
      return "connecting";
    }
    return "offline";
  }, [
    hasLiveFrame,
    agentOnline,
    isConnected,
    isStreaming,
    selectedDevice,
    deviceOptions.length,
  ]);

  const linkDotClass =
    linkState === "online"
      ? "bg-emerald-500 animate-pulse"
      : linkState === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-rose-500";

  const streamQualityRef = useRef<StreamQuality>(streamQuality);
  const streamFpsRef = useRef<number>(streamFps);

  const activeDisplayRef = useRef("");
  const moveThrottleRef = useRef(0);
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedDeviceOption =
    deviceOptions.find((opt) => opt.value === selectedDevice) || null;

  useEffect(() => {
    streamQualityRef.current = streamQuality;
  }, [streamQuality]);

  useEffect(() => {
    streamFpsRef.current = streamFps;
  }, [streamFps]);

  useEffect(() => {
    setMediaTransport(getPreferredMediaTransport());
  }, []);

  const switchMediaTransport = useCallback(
    (next: MediaTransport) => {
      setMediaTransport(next);
      const ok = dispatchMediaTransportPreference(gatewayDispatch, next, selectedDevice);
      setCommandStatus(
        ok
          ? `Switched media transport to ${next.toUpperCase()} (manual). Restart stream if needed.`
          : `Saved ${next.toUpperCase()} preference — agent offline / not pushed.`
      );
    },
    [gatewayDispatch, selectedDevice]
  );

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    activeDisplayRef.current = activeDisplay;
  }, [activeDisplay]);

  useEffect(() => {
    ensureConnected();
    void refreshDevices(true);
  }, [ensureConnected, refreshDevices]);

  useEffect(() => {
    if (deviceOptions.length === 0) return;
    const knownIds = deviceOptions.map((d) => d.value);
    const fromQuery =
      requestedDevice && knownIds.includes(requestedDevice) ? requestedDevice : "";
    if (fromQuery && selectedDeviceRef.current !== fromQuery) {
      selectedDeviceRef.current = fromQuery;
      setSelectedDevice(fromQuery);
      return;
    }
    if (!selectedDeviceRef.current || !knownIds.includes(selectedDeviceRef.current)) {
      const online = deviceOptions.find((d) => d.status === "online");
      const first = (online || deviceOptions[0]).value;
      selectedDeviceRef.current = first;
      setSelectedDevice(first);
    }
  }, [deviceOptions, requestedDevice]);

  useEffect(() => {
    // Frames already flowing — keep a calm online status (never flash Reconnecting/offline).
    if (hasLiveFrame) {
      setCommandStatus(`Live — ${selectedDevice || "agent"}`);
      return;
    }
    if (!isConnected) {
      setCommandStatus("Connecting to gateway…");
      return;
    }
    if (!agentOnline) {
      setCommandStatus(
        selectedDevice
          ? "Waiting for agent…"
          : deviceOptions.length === 0
            ? "Scanning for devices…"
            : "Select an agent device…"
      );
      return;
    }
    if (isStreaming) {
      setCommandStatus(
        mediaReady
          ? "Waiting for agent stream…"
          : mediaStatus || "Connecting media socket…"
      );
      return;
    }
    setCommandStatus(`Ready — ${selectedDevice || "agent"} online`);
  }, [
    isConnected,
    agentOnline,
    selectedDevice,
    isStreaming,
    hasLiveFrame,
    mediaReady,
    mediaStatus,
    deviceOptions.length,
  ]);

  const dispatchControl = useCallback(
    (action: string, payload: Record<string, unknown> = {}, targetOverride?: string) => {
      const target =
        targetOverride || selectedDeviceRef.current || resolveTarget(deviceOptions[0]?.value);
      if (!target) {
        setCommandStatus("No live agent found.");
        void refreshDevices();
        return false;
      }

      if (!selectedDeviceRef.current) {
        selectedDeviceRef.current = target;
        setSelectedDevice(target);
      }

      const result = gatewayDispatch(action, payload, target);
      if (!result.ok) {
        setCommandStatus(
          result.reason === "offline"
            ? "Gateway disconnected — reconnecting..."
            : "No live agent found."
        );
        if (result.reason === "offline") ensureConnected();
        return false;
      }
      return true;
    },
    [deviceOptions, gatewayDispatch, refreshDevices, resolveTarget, ensureConnected]
  );

  const probeAndStream = useCallback(async () => {
    const target = selectedDeviceRef.current || resolveTarget();
    if (!target) {
      setCommandStatus("No live agent.");
      return;
    }

    selectedDeviceRef.current = target;
    setIsStreaming(true);
    setCommandStatus("Connecting media socket…");

    const mediaOk = await ensureMediaReady(12_000);
    if (!mediaOk) {
      setCommandStatus("Media socket not ready — retry Start (check /api/auth/ws-ticket)");
      // Still try start so agent prepares frames for when media reconnects.
    } else {
      setCommandStatus("Media ready — starting agent stream…");
    }

    const started = dispatchControl(
      "START_SCREEN_STREAM",
      buildQualityPayload(streamQualityRef.current, streamFpsRef.current),
      target
    );
    if (!started) {
      setCommandStatus("Could not send START_SCREEN_STREAM — gateway/agent offline");
      return;
    }

    try {
      sessionStorage.setItem("zenvora_screen_streaming", "1");
    } catch {
      // ignore
    }

    setCommandStatus("Waiting for agent stream…");
    dispatchControl("PROBE_DISPLAYS", {}, target);
    dispatchControl("LIST_DISPLAYS", {}, target);
  }, [dispatchControl, ensureMediaReady, resolveTarget]);
  const stopStream = useCallback(() => {
    dispatchControl("STOP_SCREEN_STREAM", {});
    resetPreview();
    setIsStreaming(false);
    try {
      sessionStorage.setItem("zenvora_screen_streaming", "0");
    } catch {
      // ignore
    }
    setCommandStatus("Remote desktop stopped.");
  }, [dispatchControl, resetPreview]);

  // If media socket comes back while user still wants stream, nudge agent once.
  const wasMediaReadyRef = useRef(false);
  useEffect(() => {
    if (!isStreaming || !agentOnline || !selectedDevice) return;
    if (mediaReady && !wasMediaReadyRef.current) {
      dispatchControl(
        "START_SCREEN_STREAM",
        buildQualityPayload(streamQualityRef.current, streamFpsRef.current),
        selectedDevice
      );
      setCommandStatus("Media reconnected — resuming stream…");
    }
    wasMediaReadyRef.current = mediaReady;
  }, [mediaReady, isStreaming, agentOnline, selectedDevice, dispatchControl]);

  // Leave page / close tab: stop stream only if user had it ON.
  useEffect(() => {
    const stopOnUnload = () => {
      try {
        if (sessionStorage.getItem("zenvora_screen_streaming") !== "1") return;
        gatewayClient.dispatch("STOP_SCREEN_STREAM", selectedDeviceRef.current || "", {});
        sessionStorage.setItem("zenvora_screen_streaming", "0");
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", stopOnUnload);
    window.addEventListener("beforeunload", stopOnUnload);
    return () => {
      window.removeEventListener("pagehide", stopOnUnload);
      window.removeEventListener("beforeunload", stopOnUnload);
      stopOnUnload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json") return;
      const packet = event.packet;

      if (packet.type === "sys_error") {
        setCommandStatus(String(packet.message || "Command failed."));
        return;
      }

      if (packet.type === "screen_telemetry_stream") {
        const metrics = (packet.metrics || {}) as Record<string, unknown>;
        const sender = packet.senderAgentId as string | undefined;
        if (selectedDeviceRef.current && sender && sender !== selectedDeviceRef.current) return;

        if (Array.isArray(metrics.available_displays) && metrics.available_displays.length > 0) {
          const displays = metrics.available_displays as Array<{ id: string }>;
          if (!activeDisplayRef.current) {
            setActiveDisplay(displays[0].id);
            activeDisplayRef.current = displays[0].id;
          }
        }

        if (typeof metrics.brightness === "number") setBrightness(metrics.brightness);
        if (typeof metrics.volume === "number") setVolume(metrics.volume);
        // Do not auto-toggle local streaming from telemetry — user Start/Stop only.
        if (typeof metrics.stream_quality === "string") {
          const q = metrics.stream_quality as StreamQuality;
          if (QUALITY_OPTIONS.some((o) => o.value === q)) {
            setStreamQuality(q);
          }
        }
        // Don't overwrite status with every telemetry spam during mouse moves.
        if (
          packet.message &&
          typeof packet.action === "string" &&
          !String(packet.action).startsWith("REMOTE_")
        ) {
          setCommandStatus(String(packet.message));
        }
        if (hasLiveFrame && isStreaming) {
          setCommandStatus("Remote desktop active — click canvas to control.");
        }
      }

      if (
        packet.type === "sys_ack" &&
        typeof packet.message === "string" &&
        packet.message &&
        !String(packet.message).includes("REMOTE_")
      ) {
        setCommandStatus(packet.message);
      }
    });
  }, [subscribe, hasLiveFrame, isStreaming]);

  const sendPointer = useCallback(
    (action: string, e: React.MouseEvent, extra: Record<string, unknown> = {}) => {
      if (!controlEnabled || !isStreaming) return;
      const mapped = mapPointerToRemote(e.clientX, e.clientY);
      if (!mapped) return;
      const payload = { ...mapped, ...extra };
      if (!sendUdpControl(action, payload)) {
        dispatchControl(action, payload);
      }
    },
    [controlEnabled, dispatchControl, isStreaming, mapPointerToRemote, sendUdpControl]
  );

  const cursorRef = useRef<HTMLDivElement>(null);
  const containerRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);

  const updateContainerRect = useCallback(() => {
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      containerRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    updateContainerRect();
    const ro = new ResizeObserver(updateContainerRect);
    ro.observe(containerRef.current);
    window.addEventListener("resize", updateContainerRect, { passive: true });
    window.addEventListener("scroll", updateContainerRect, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateContainerRect);
      window.removeEventListener("scroll", updateContainerRect);
    };
  }, [updateContainerRect]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (controlEnabled && isStreaming && cursorRef.current) {
      let rect = containerRectRef.current;
      if (!rect) {
        const r = containerRef.current?.getBoundingClientRect();
        if (r) {
          rect = { left: r.left, top: r.top, width: r.width, height: r.height };
          containerRectRef.current = rect;
        }
      }
      if (rect) {
        cursorRef.current.style.transform = `translate3d(${e.clientX - rect.left}px, ${e.clientY - rect.top}px, 0)`;
        cursorRef.current.style.display = "block";
      }
    }
    const now = performance.now();
    // 0ms delay on WebRTC UDP for instantaneous buttery smooth tracking; 4ms on WebSocket
    const throttleMs = isUdpConnected ? 0 : 4;
    if (throttleMs > 0 && now - moveThrottleRef.current < throttleMs) return;
    moveThrottleRef.current = now;
    sendPointer("REMOTE_MOUSE_MOVE", e);
  };

  const handleMouseLeave = () => {
    if (cursorRef.current) {
      cursorRef.current.style.display = "none";
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    canvasRef.current?.focus();
    const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    sendPointer("REMOTE_MOUSE_DOWN", e, { button });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    sendPointer("REMOTE_MOUSE_UP", e, { button });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    sendPointer("REMOTE_MOUSE_WHEEL", e, { delta: Math.round(-e.deltaY) });
  };

  useEffect(() => {
    if (!controlEnabled || !isStreaming) return;

    const handleWindowKey = (e: KeyboardEvent) => {
      // Handle key events when streaming and control is enabled
      e.preventDefault();

      const mapped = mapPointerToRemote(
        (canvasRef.current?.getBoundingClientRect().left || 0) +
          (canvasRef.current?.width || 0) / 2,
        (canvasRef.current?.getBoundingClientRect().top || 0) +
          (canvasRef.current?.height || 0) / 2
      );
      const base = mapped || {
        x: Math.round(telemetry.screenWidth / 2),
        y: Math.round(telemetry.screenHeight / 2),
        screen_width: telemetry.screenWidth,
        screen_height: telemetry.screenHeight,
      };

      const action = e.type === "keydown" ? "REMOTE_KEY_DOWN" : "REMOTE_KEY_UP";
      const payload =
        e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey
          ? { ...base, text: e.key }
          : { ...base, code: e.code };

      if (!sendUdpControl(action, payload)) {
        dispatchControl(action, payload);
      }
    };

    window.addEventListener("keydown", handleWindowKey);
    window.addEventListener("keyup", handleWindowKey);

    return () => {
      window.removeEventListener("keydown", handleWindowKey);
      window.removeEventListener("keyup", handleWindowKey);
    };
  }, [controlEnabled, isStreaming, telemetry, mapPointerToRemote, dispatchControl, sendUdpControl]);

  const handleQualityChange = (quality: StreamQuality) => {
    setStreamQuality(quality);
    streamQualityRef.current = quality;
    try {
      sessionStorage.setItem("zenvora_screen_quality", quality);
    } catch {
      // ignore
    }

    const payload = buildQualityPayload(quality, streamFpsRef.current);
    dispatchControl("SET_SCREEN_QUALITY", payload);
    if (isStreaming) {
      resetPreview();
      dispatchControl("START_SCREEN_STREAM", payload);
      setCommandStatus(`Quality set to ${quality} — refreshing stream...`);
    } else {
      setCommandStatus(`Quality set to ${quality}.`);
    }
  };

  const handleFpsChange = (fps: number) => {
    setStreamFps(fps);
    streamFpsRef.current = fps;
    try {
      sessionStorage.setItem("zenvora_screen_fps", String(fps));
    } catch {
      // ignore
    }

    const payload = buildQualityPayload(streamQualityRef.current, fps);
    dispatchControl("SET_SCREEN_QUALITY", payload);
    if (isStreaming) {
      dispatchControl("START_SCREEN_STREAM", payload);
      setCommandStatus(`Stream set to ${fps} FPS.`);
    } else {
      setCommandStatus(`Frame rate set to ${fps} FPS.`);
    }
  };

  const handleDisplaySwitch = (displayId: string, index: number) => {
    setActiveDisplay(displayId);
    activeDisplayRef.current = displayId;
    dispatchControl("SWITCH_DISPLAY", { display: displayId, display_index: index });
    if (isStreaming) {
      resetPreview();
      setTimeout(
        () =>
          dispatchControl("START_SCREEN_STREAM", buildQualityPayload(streamQualityRef.current, streamFpsRef.current)),
        200
      );
    }
  };

  const handleSliderChange = (
    param: "SET_DISPLAY_BRIGHTNESS" | "SET_SYSTEM_VOLUME",
    value: number
  ) => {
    if (param === "SET_DISPLAY_BRIGHTNESS") setBrightness(value);
    else setVolume(value);
    if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    sliderTimerRef.current = setTimeout(() => {
      dispatchControl(param, { degree_value: value });
    }, 150);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  };

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    return () => {
      if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    };
  }, []);

  if (featureLoading) {
    return <FullPageLoader message="Verifying screen monitor permissions…" />;
  }

  if (!featureAllowed) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 sidebar-aware-main overflow-auto p-6 flex items-center justify-center">
          <PremiumGate featureKey="screen" onUnlocked={() => window.location.reload()} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {!isFullscreen && <AppSidebar />}

      <main className={`flex flex-1 flex-col min-h-0 ${isFullscreen ? "w-screen" : "sidebar-aware-main"}`}>
        {/* Header toolbar — matches dashboard / camera pages */}
        <div className="border-b border-border bg-card/80 backdrop-blur px-4 py-3 lg:px-8 z-20">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-xl lg:text-2xl font-display tracking-tight flex items-center gap-2">
                Remote Desktop
                <span
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${linkDotClass}`}
                />
              </h1>
            </div>

            <div className="min-w-[180px] flex-1 max-w-xs">
              <Select<DeviceOption, false>
                instanceId="screen-device-dropdown"
                value={selectedDeviceOption}
                onChange={(option) => {
                  if (!option) return;
                  stopStream();
                  setSelectedDevice(option.value);
                  selectedDeviceRef.current = option.value;
                  setActiveDisplay("");
                  activeDisplayRef.current = "";
                }}
                options={deviceOptions}
                className="text-sm"
                classNamePrefix="react-select"
                placeholder="Select agent..."
                isDisabled={deviceOptions.length === 0}
              />
            </div>

            <Button
              size="sm"
              disabled={!canControl || isStreaming}
              onClick={() => void probeAndStream()}
              className="gap-1.5"
            >
              <Power className="h-3.5 w-3.5" /> Connect
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!isStreaming}
              onClick={stopStream}
              className="gap-1.5 border-border"
            >
              <X className="h-3.5 w-3.5" /> Stop
            </Button>
            <Button
              size="sm"
              variant={controlEnabled ? "default" : "outline"}
              onClick={() => setControlEnabled((v) => !v)}
              className={`gap-1.5 ${controlEnabled ? "bg-foreground text-background hover:bg-foreground/90" : "border-border"}`}
            >
              <MousePointer2 className="h-3.5 w-3.5" />
              {controlEnabled ? "Control ON" : "Control OFF"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPanel((v) => !v)}
              className="border-border"
            >
              {showPanel ? <Minimize2 className="h-3.5 w-3.5" /> : <Settings className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="outline" onClick={toggleFullscreen} className="border-border">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground font-mono truncate flex-1 min-w-[12rem]">{commandStatus}</p>
            {isUdpConnected ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ⚡ WebRTC UDP (Ultra-Fast)
              </span>
            ) : webrtcState === "connecting" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                Negotiating WebRTC UDP…
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-muted-foreground border border-border">
                WebSocket Transport
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-1 min-h-0 p-4 lg:p-6 gap-4 lg:gap-6">
          {/* Stream stage */}
          <div className="flex flex-1 min-w-0 min-h-0">
            <div
              ref={containerRef}
              className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border bg-black shadow-2xl"
            >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              className={`h-full w-full max-h-full max-w-full object-contain outline-none ${
                controlEnabled && isStreaming ? "cursor-none" : "cursor-default"
              }`}
              style={{
                transform: "translateZ(0)",
                backfaceVisibility: "hidden",
                imageRendering: "auto",
              }}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onContextMenu={(e) => e.preventDefault()}
              onWheel={handleWheel}
              onMouseLeave={handleMouseLeave}
              onMouseEnter={() => {
                if (controlEnabled && isStreaming) canvasRef.current?.focus();
              }}
            />

            {controlEnabled && isStreaming && (
              <div
                ref={cursorRef}
                className="pointer-events-none absolute z-30 top-0 left-0 -translate-x-1/2 -translate-y-1/2 hidden will-change-transform"
              >
                <div className="relative flex items-center justify-center">
                  <div className="h-2.5 w-2.5 rounded-full bg-cyan-400 border border-white shadow-[0_0_10px_rgba(34,211,238,0.9)] ring-2 ring-cyan-500/60" />
                </div>
              </div>
            )}

            {!hasLiveFrame && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-900 to-black p-6 text-center">
                <Monitor className="h-14 w-14 text-white/25 animate-pulse" />
                <p className="text-white/80 text-sm">
                  {isStreaming ? "Waiting for screen frames..." : "Select agent and click Connect"}
                </p>
                <p className="text-xs text-white/50 font-mono">{commandStatus}</p>
              </div>
            )}

            {hasLiveFrame && (
              <>
                <div className="absolute top-4 right-4 z-30 rounded-full bg-red-600/90 px-3 py-1 text-xs font-mono font-bold text-white">
                  LIVE • {measuredFps} FPS
                </div>
                <div className="absolute bottom-4 left-4 z-30 rounded-full bg-black/60 px-3 py-1 text-xs font-mono text-white backdrop-blur-sm">
                  {telemetry.resolution} • {telemetry.displayName} • {frameCount} frames
                </div>
                {controlEnabled && (
                  <div className="absolute bottom-4 right-4 z-30 rounded-full bg-emerald-600/85 px-3 py-1 text-xs font-mono text-white flex items-center gap-1">
                    <Keyboard className="h-3 w-3" /> Click to type
                  </div>
                )}
              </>
            )}
            </div>
          </div>

          {/* Side panel */}
          {showPanel && (
            <aside className="w-72 shrink-0 space-y-4 overflow-y-auto">
              <Card className="p-4 border border-border bg-card">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-semibold">Network Speed & Quality</Label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {QUALITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleQualityChange(option.value)}
                      className={`rounded-lg border px-2.5 py-2 text-left transition ${
                        streamQuality === option.value
                          ? "border-foreground bg-accent/30"
                          : "border-border hover:border-foreground/40 bg-background"
                      }`}
                    >
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{option.hint}</div>
                    </button>
                  ))}
                </div>
              </Card>

              <Card className="p-4 border border-border bg-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm font-semibold">Frame Rate (FPS)</Label>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-500">{streamFps} FPS</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {FPS_OPTIONS.map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      onClick={() => handleFpsChange(fps)}
                      className={`rounded-md border py-1.5 text-center text-xs font-mono transition ${
                        streamFps === fps
                          ? "border-foreground bg-foreground text-background font-bold"
                          : "border-border hover:border-foreground/40 bg-background text-muted-foreground"
                      }`}
                    >
                      {fps} FPS
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2.5 font-mono">
                  💡 Choose 5-8 FPS for slow/mobile internet to eliminate freezing & disconnects.
                </p>
              </Card>

              <Card className="p-4 border border-border bg-card space-y-4">
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Displays</p>
                {detectedDisplays.length === 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-border"
                    onClick={() => {
                      dispatchControl("PROBE_DISPLAYS");
                      dispatchControl("LIST_DISPLAYS");
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Scan Displays
                  </Button>
                ) : (
                  detectedDisplays.map((display) => (
                    <button
                      key={display.id}
                      type="button"
                      onClick={() => handleDisplaySwitch(display.id, display.index)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                        activeDisplay === display.id
                          ? "border-foreground bg-accent/20"
                          : "border-border hover:border-foreground/40"
                      }`}
                    >
                      <div className="font-medium">{display.label}</div>
                      <div className="text-xs text-muted-foreground">{display.resolution}</div>
                    </button>
                  ))
                )}

                <CustomSlider
                  label="Brightness"
                  min={0}
                  max={100}
                  value={brightness}
                  onChange={(val) => handleSliderChange("SET_DISPLAY_BRIGHTNESS", val)}
                  showValue
                  unit="%"
                />
                <CustomSlider
                  label="PC Speaker Volume"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(val) => handleSliderChange("SET_SYSTEM_VOLUME", val)}
                  showValue
                  unit="%"
                />

                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                    <Label className="text-sm font-semibold">Remote microphone</Label>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Listen sources: mic + system audio (videos). Speak to PC = tumhari awaaz
                    victim speakers pe. PC Speaker Volume = system volume.
                  </p>
                  {selectedDevice ? (
                    <div className="rounded-lg border border-border bg-background/60">
                      <MicPanel
                        deviceId={selectedDevice}
                        subscribe={subscribe}
                        dispatch={gatewayDispatch}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Select a device first.</p>
                  )}
                </div>

                <div className="space-y-2 pt-2 border-t border-border">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full justify-start border-border"
                    onClick={() => dispatchControl("LOCK_SCREEN")}
                  >
                    <Lock className="h-3.5 w-3.5 mr-2" /> Lock Screen
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full justify-start border-border"
                    onClick={() => dispatchControl("OPEN_SETTINGS")}
                  >
                    <Settings className="h-3.5 w-3.5 mr-2" /> Settings
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full justify-start border-border"
                    onClick={() => {
                      resetPreview();
                      dispatchControl("START_SCREEN_STREAM", {
                        quality: streamQualityRef.current,
                        target_fps: streamFpsRef.current,
                      });
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-2" /> Refresh Stream
                  </Button>
                </div>
              </Card>

              <Card className="p-4 border border-border bg-card/60 text-xs text-muted-foreground space-y-2">
                <div className="flex justify-between">
                  <span>Status</span>
                  <span className="font-mono text-foreground">{telemetry.status}</span>
                </div>
                <div className="flex justify-between">
                  <span>Quality</span>
                  <span className="font-mono capitalize">{streamQuality}</span>
                </div>
                <div className="flex justify-between">
                  <span>Target FPS</span>
                  <span className="font-mono">{telemetry.fps}</span>
                </div>
                <div className="flex items-center gap-1 pt-1 text-[11px]">
                  <Volume2 className="h-3 w-3 shrink-0" />
                  <span>Mouse + keyboard control on the canvas</span>
                </div>
              </Card>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
