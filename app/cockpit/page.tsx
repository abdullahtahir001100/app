"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { PremiumGate } from "@/components/premium-card";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import { CameraPanel } from "@/components/cockpit/camera-panel";
import { FloatingPanel, type PanelId } from "@/components/cockpit/floating-panel";
import { HistoryPanel } from "@/components/cockpit/history-panel";
import { MicPanel } from "@/components/cockpit/mic-panel";
import { ScreenPanel } from "@/components/cockpit/screen-panel";
import { ShellPanel } from "@/components/cockpit/shell-panel";
import { UsagePanel } from "@/components/cockpit/usage-panel";
import { AgentChatPanel } from "@/components/shell/agent-chat-panel";
import { Button } from "@/components/ui/button";
import { useGateway } from "@/hooks/use-gateway";
import {
  ArrowLeft,
  Camera,
  Clock,
  LayoutGrid,
  Mic,
  Monitor,
  RotateCcw,
  TerminalSquare,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

type DispatchFn = (
  action: string,
  payload?: Record<string, unknown>,
  target?: string
) => { ok: boolean; reason?: string };

type SubscribeFn = (
  listener: (event: { type: string; data?: ArrayBuffer | Blob; packet?: Record<string, unknown> }) => void
) => () => void;

type PanelDef = {
  id: PanelId;
  title: string;
  icon: React.ReactNode;
  accent: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bodyClassName?: string;
  render: (ctx: { deviceId: string; subscribe: SubscribeFn; dispatch: DispatchFn }) => React.ReactNode;
};

// Default tiled layout in workspace (content) coordinates. The workspace scrolls,
// and every panel is independently draggable + resizable, so this is only a
// starting arrangement — "Reset layout" returns here.
const PANELS: PanelDef[] = [
  {
    id: "screen",
    title: "Live Screen · Remote Control",
    icon: <Monitor className="h-3.5 w-3.5" />,
    accent: "text-sky-500",
    x: 24,
    y: 16,
    w: 720,
    h: 508,
    bodyClassName: "bg-black",
    render: ({ deviceId, subscribe, dispatch }) => (
      <ScreenPanel deviceId={deviceId} subscribe={subscribe} dispatch={dispatch} autoStart />
    ),
  },
  {
    id: "camera",
    title: "Live Camera",
    icon: <Camera className="h-3.5 w-3.5" />,
    accent: "text-violet-500",
    x: 764,
    y: 16,
    w: 348,
    h: 300,
    render: ({ deviceId, subscribe, dispatch }) => (
      <CameraPanel deviceId={deviceId} subscribe={subscribe} dispatch={dispatch} />
    ),
  },
  {
    id: "mic",
    title: "Microphone",
    icon: <Mic className="h-3.5 w-3.5" />,
    accent: "text-emerald-500",
    x: 764,
    y: 332,
    w: 348,
    h: 192,
    render: ({ deviceId, subscribe, dispatch }) => (
      <MicPanel deviceId={deviceId} subscribe={subscribe} dispatch={dispatch} />
    ),
  },
  {
    id: "usage",
    title: "App Usage",
    icon: <LayoutGrid className="h-3.5 w-3.5" />,
    accent: "text-amber-500",
    x: 1132,
    y: 16,
    w: 340,
    h: 300,
    render: ({ deviceId }) => <UsagePanel deviceId={deviceId} />,
  },
  {
    id: "history",
    title: "History",
    icon: <Clock className="h-3.5 w-3.5" />,
    accent: "text-rose-500",
    x: 1132,
    y: 332,
    w: 340,
    h: 508,
    render: ({ deviceId, subscribe, dispatch }) => (
      <HistoryPanel deviceId={deviceId} subscribe={subscribe} dispatch={dispatch} />
    ),
  },
  {
    id: "shell",
    title: "Secure Shell",
    icon: <TerminalSquare className="h-3.5 w-3.5" />,
    accent: "text-slate-500",
    x: 24,
    y: 540,
    w: 720,
    h: 300,
    render: ({ deviceId, subscribe, dispatch }) => (
      <ShellPanel deviceId={deviceId} subscribe={subscribe} dispatch={dispatch} />
    ),
  },
];

// Workspace is sized to comfortably hold the default layout; it scrolls if the
// window is smaller, and panels can be dragged anywhere inside it.
const WORKSPACE_W = 1520;
const WORKSPACE_H = 880;

type PanelState = { open: boolean; min: boolean; z: number };

function CockpitInner() {
  const { allowed, loading } = useFeatureAccess("cockpit");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("device") ?? "";

  const { isConnected, devices, dispatch, subscribe, resolveTarget, refreshDevices } = useGateway();

  const [deviceId, setDeviceId] = useState(requested);
  // Fresh mount of all panels when the device changes or layout is reset.
  const [layoutNonce, setLayoutNonce] = useState(0);

  const initialPanelState = useCallback((): Record<PanelId, PanelState> => {
    const out = {} as Record<PanelId, PanelState>;
    PANELS.forEach((p, i) => {
      out[p.id] = { open: true, min: false, z: i + 1 };
    });
    return out;
  }, []);

  const [panels, setPanels] = useState<Record<PanelId, PanelState>>(initialPanelState);
  const [zTop, setZTop] = useState(PANELS.length);

  // Resolve a device: prefer the one in the URL, else first online / first known.
  useEffect(() => {
    if (deviceId) return;
    const t = resolveTarget();
    if (t) setDeviceId(t);
  }, [deviceId, resolveTarget, devices]);

  // Keep in sync if the URL device changes (e.g. navigating from another tile).
  useEffect(() => {
    if (requested && requested !== deviceId) setDeviceId(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const device = useMemo(() => devices.find((d) => d.value === deviceId), [devices, deviceId]);
  const label = device?.label || deviceId || "No device";
  const online = device?.status === "online";
  const platform = device?.platform || "—";

  const focusPanel = useCallback((id: PanelId) => {
    setZTop((prev) => {
      const next = prev + 1;
      setPanels((s) => ({ ...s, [id]: { ...s[id], z: next } }));
      return next;
    });
  }, []);

  const openPanel = useCallback(
    (id: PanelId) => {
      setPanels((s) => ({ ...s, [id]: { ...s[id], open: true, min: false } }));
      focusPanel(id);
    },
    [focusPanel]
  );

  const closePanel = useCallback((id: PanelId) => {
    setPanels((s) => ({ ...s, [id]: { ...s[id], open: false } }));
  }, []);

  const toggleMinimize = useCallback((id: PanelId) => {
    setPanels((s) => ({ ...s, [id]: { ...s[id], min: !s[id].min } }));
  }, []);

  const resetLayout = useCallback(() => {
    setPanels(initialPanelState());
    setZTop(PANELS.length);
    setLayoutNonce((n) => n + 1);
  }, [initialPanelState]);

  const switchDevice = useCallback(
    (next: string) => {
      if (!next || next === deviceId) return;
      setDeviceId(next);
      router.replace(`/cockpit?device=${encodeURIComponent(next)}`);
    },
    [deviceId, router]
  );

  if (!loading && !allowed) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 sidebar-aware-main overflow-auto p-6 flex items-center justify-center">
          <PremiumGate
            featureKey="cockpit"
            title="Unified Device Cockpit"
            description="All-in-one mission control dashboard featuring simultaneous live screen, camera, microphone, terminal, and telemetry panels."
            price="$29.99/mo"
            features={[
              "Draggable, resizable multi-window workspace",
              "Concurrent real-time screen, camera, and mic monitors",
              "Interactive bidirectional command terminal",
              "Live hardware metrics and system resource graphs",
            ]}
            onUnlocked={() => window.location.reload()}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      <main className="flex flex-1 flex-col min-h-0 sidebar-aware-main">
        {/* Header */}
        <div className="z-20 border-b border-border bg-card/80 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="border-border"
              onClick={() => router.push("/fleet")}
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Fleet
            </Button>

            <h1 className="flex items-center gap-2 font-display text-lg tracking-tight lg:text-xl">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  online ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]" : "bg-muted-foreground/40"
                }`}
              />
              <span className="max-w-[280px] truncate">{label}</span>
            </h1>
            <span className="font-mono text-xs text-muted-foreground">
              {online ? "online" : "offline"} · {platform}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              {isConnected ? (
                <Wifi className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-rose-500" />
              )}
              gateway
            </span>

            {devices.length > 1 && (
              <select
                value={deviceId}
                onChange={(e) => switchDevice(e.target.value)}
                className="max-w-[220px] rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/40"
                title="Switch device"
              >
                {devices.map((d) => (
                  <option key={d.value} value={d.value}>
                    {(d.status === "online" ? "● " : "○ ") + d.label}
                  </option>
                ))}
              </select>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" className="border-border" onClick={() => void refreshDevices(true)}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Refresh
              </Button>
              <Button size="sm" variant="outline" className="border-border" onClick={resetLayout}>
                <LayoutGrid className="mr-1 h-3.5 w-3.5" /> Reset layout
              </Button>
            </div>
          </div>

          {/* Panel launcher — reopen / restore any panel */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {PANELS.map((p) => {
              const st = panels[p.id];
              const active = st.open && !st.min;
              return (
                <button
                  key={p.id}
                  onClick={() => (st.open && !st.min ? focusPanel(p.id) : openPanel(p.id))}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-transparent bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  title={st.open ? (st.min ? "Restore" : "Bring to front") : "Open"}
                >
                  <span className={active ? "text-background" : p.accent}>{p.icon}</span>
                  {p.title.split(" · ")[0]}
                  {!st.open && <span className="opacity-60">+</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Workspace — scrollable canvas of draggable panels */}
        <div className="relative flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_1px_1px,_var(--color-border)_1px,_transparent_0)] [background-size:24px_24px]">
          <div className="relative" style={{ width: WORKSPACE_W, height: WORKSPACE_H }}>
            {!deviceId && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="rounded-xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
                  No device selected. Pick one from the Fleet Grid.
                </p>
              </div>
            )}

            {deviceId &&
              PANELS.map((p) => {
                const st = panels[p.id];
                if (!st.open) return null;
                return (
                  <FloatingPanel
                    key={`${p.id}:${deviceId}:${layoutNonce}`}
                    title={p.title}
                    icon={p.icon}
                    accent={p.accent}
                    initialX={p.x}
                    initialY={p.y}
                    initialW={p.w}
                    initialH={p.h}
                    z={st.z}
                    minimized={st.min}
                    bodyClassName={p.bodyClassName}
                    onFocus={() => focusPanel(p.id)}
                    onClose={() => closePanel(p.id)}
                    onToggleMinimize={() => toggleMinimize(p.id)}
                  >
                    {p.render({ deviceId, subscribe: subscribe as SubscribeFn, dispatch: dispatch as DispatchFn })}
                  </FloatingPanel>
                );
              })}
          </div>
        </div>
      </main>

      {/* AI assistant — self-contained floating trigger + chat drawer */}
      <AgentChatPanel />
    </div>
  );
}

export default function CockpitPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
          Loading cockpit…
        </div>
      }
    >
      <CockpitInner />
    </Suspense>
  );
}
