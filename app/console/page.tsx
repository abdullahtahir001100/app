"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { PremiumGate } from "@/components/premium-card";
import { FullPageLoader } from "@/components/full-page-loader";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGateway } from "@/hooks/use-gateway";
import { RefreshCw, Trash2, Radio } from "lucide-react";

type LiveLog = {
  id: string;
  ts: string;
  channel: string;
  level: string;
  message: string;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  ms?: number | null;
  deviceId?: string | null;
  userId?: string | null;
  meta?: Record<string, unknown>;
};

const CHANNELS = ["all", "agent", "node", "db", "ws", "http", "tcp", "install", "system"] as const;

function levelColor(level: string) {
  switch (level) {
    case "error":
      return "text-red-400 font-semibold";
    case "warn":
      return "text-amber-300 font-semibold";
    case "ok":
    case "success":
      return "text-emerald-400 font-semibold";
    default:
      return "text-zinc-200";
  }
}

function channelBadge(channel: string) {
  const map: Record<string, string> = {
    agent: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    node: "bg-purple-500/20 text-purple-300 border border-purple-500/30",
    db: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    ws: "bg-violet-500/20 text-violet-300 border border-violet-500/30",
    http: "bg-sky-500/20 text-sky-300 border border-sky-500/30",
    tcp: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
    install: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
    mongo: "bg-rose-500/20 text-rose-300 border border-rose-500/30",
    system: "bg-zinc-500/20 text-zinc-300 border border-zinc-500/30",
  };
  return map[channel] || "bg-zinc-500/20 text-zinc-300";
}

export default function ConsolePage() {
  const { allowed, loading } = useFeatureAccess("console");
  const { isConnected, devices, subscribe, dispatch, ensureConnected } = useGateway();
  const [logs, setLogs] = useState<LiveLog[]>([]);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("all");
  const [selectedDevice, setSelectedDevice] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [health, setHealth] = useState<{
    ok?: boolean;
    agents?: number;
    dashboards?: number;
    controlTcp?: number;
    uptime?: number;
    mongo?: boolean;
  } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  const appendLog = useCallback((entry: LiveLog) => {
    if (pausedRef.current) return;
    setLogs((prev) => {
      if (prev.some((p) => p.id === entry.id)) return prev;
      const next = [...prev, entry];
      return next.length > 2000 ? next.slice(-2000) : next;
    });
  }, []);

  const loadSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/live-logs?limit=500", { credentials: "include", cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data?.success && Array.isArray(data.logs)) {
        setLogs(data.logs as LiveLog[]);
        setHealth({
          ok: data.ok,
          agents: data.agents,
          dashboards: data.dashboards,
          controlTcp: data.controlTcp,
          uptime: data.uptime,
          mongo: undefined,
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const pingHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data) setHealth(data);
    } catch {
      setHealth((h) => ({ ...(h || {}), ok: false }));
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
    void pingHealth();
    const t = setInterval(() => void pingHealth(), 5000);
    return () => clearInterval(t);
  }, [loadSnapshot, pingHealth]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json" || !event.packet) return;
      const packet = event.packet as Record<string, unknown>;
      if (packet.type === "live_log" && packet.log && typeof packet.log === "object") {
        appendLog(packet.log as LiveLog);
        return;
      }
      if (packet.type === "device_status_update") {
        appendLog({
          id: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ts: new Date().toISOString(),
          channel: "agent",
          level: packet.status === "online" ? "ok" : "warn",
          message: `Device ${packet.deviceId} → ${packet.status}`,
          deviceId: String(packet.deviceId || ""),
        });
      }
      if (packet.type === "history_telemetry") {
        appendLog({
          id: `ui-hist-${Date.now()}`,
          ts: new Date().toISOString(),
          channel: "agent",
          level: "info",
          message: `history ${packet.command} (+${packet.count || 0})`,
          deviceId: String(packet.deviceId || ""),
        });
      }
      if (packet.type === "activity_telemetry") {
        appendLog({
          id: `ui-act-${Date.now()}`,
          ts: new Date().toISOString(),
          channel: "agent",
          level: "info",
          message: `activity ${(packet.log as any)?.action || "event"}`,
          deviceId: String(packet.deviceId || ""),
        });
      }
    });
  }, [subscribe, appendLog]);

  useEffect(() => {
    if (paused) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, paused]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const targetDev = selectedDevice.trim().toLowerCase();

    return logs.filter((l) => {
      if (channel !== "all" && l.channel !== channel) return false;
      if (targetDev !== "all") {
        const devId = (l.deviceId || "").toLowerCase();
        if (devId && !devId.includes(targetDev) && !targetDev.includes(devId)) {
          return false;
        }
      }
      if (!q) return true;
      return (
        l.message.toLowerCase().includes(q) ||
        (l.route || "").toLowerCase().includes(q) ||
        (l.deviceId || "").toLowerCase().includes(q) ||
        (l.channel || "").toLowerCase().includes(q)
      );
    });
  }, [logs, channel, selectedDevice, query]);

  const onlineDevices = devices.filter((d) => d.status === "online").length;

  if (loading) {
    return <FullPageLoader message="Verifying Live Console access…" />;
  }

  if (!allowed) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 sidebar-aware-main overflow-auto p-6 flex items-center justify-center">
          <PremiumGate
            featureKey="console"
            title="Live Telemetry Console"
            description="Real-time administrative telemetry, dispatches, agent streams, and server logs."
            price="$29.99/mo"
            features={[
              "Sub-millisecond WebSocket and TCP packet streaming",
              "Agent event and dispatch diagnostics",
              "Live HTTP and socket error tracking",
              "Health status and cluster connection metrics",
            ]}
            onUnlocked={() => window.location.reload()}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 sidebar-aware-main p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Live Console</h1>
            <p className="text-sm text-muted-foreground">
              Realtime telemetry · Dispatches · Agent streams · HTTP & WebSocket logs
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadSnapshot()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
              <Radio className="mr-2 h-4 w-4" />
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLogs([])}>
              <Trash2 className="mr-2 h-4 w-4" /> Clear
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-6">
          <Stat label="Gateway WS" value={isConnected ? "UP" : "DOWN"} ok={isConnected} />
          <Stat label="Health" value={health?.ok ? "OK" : "FAIL"} ok={Boolean(health?.ok)} />
          <Stat label="Agents" value={String(health?.agents ?? onlineDevices)} />
          <Stat label="Dashboards" value={String(health?.dashboards ?? "—")} />
          <Stat label="TCP control" value={String(health?.controlTcp ?? "—")} />
          <Stat
            label="Uptime"
            value={health?.uptime != null ? `${Math.floor(health.uptime)}s` : "—"}
          />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* Channel selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            {CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  channel === c ? "bg-foreground text-background font-semibold" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Single Device Filter Dropdown */}
          <div className="flex items-center gap-1.5 ml-auto">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Filter Device:</label>
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              className="rounded border border-input bg-background px-3 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring min-w-[160px]"
            >
              <option value="all">⚡ All Devices ({devices.length})</option>
              {devices.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.status === "online" ? "🟢" : "⚪"} {d.label || d.value} ({d.value})
                </option>
              ))}
            </select>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search log messages / actions / routes…"
            className="w-full md:w-auto min-w-[240px] flex-1 rounded border bg-background px-3 py-1 text-xs font-mono"
          />
        </div>

        <div
          ref={scrollerRef}
          className="h-[calc(100vh-250px)] overflow-auto rounded-lg border border-zinc-800 bg-[#0b0f14] p-3 font-mono text-[12px] leading-5 shadow-inner"
        >
          {filtered.length === 0 ? (
            <div className="text-zinc-500 text-center py-12">
              Waiting for live debug events… (Try running an agent command or connecting a device)
            </div>
          ) : (
            filtered.map((log) => (
              <div key={log.id} className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-900/80 pb-1.5">
                <span className="shrink-0 text-zinc-500 text-[11px]">
                  {new Date(log.ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase font-semibold ${channelBadge(log.channel)}`}>
                  {log.channel}
                </span>
                <span className={`shrink-0 uppercase font-bold text-[10px] ${levelColor(log.level)}`}>
                  [{log.level}]
                </span>
                {log.deviceId && (
                  <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 font-mono">
                    device:{log.deviceId}
                  </span>
                )}
                {log.method ? (
                  <span className="text-sky-300 font-semibold">
                    {log.method} {log.route}
                    {log.status != null ? ` → ${log.status}` : ""}
                    {log.ms != null ? ` (${log.ms}ms)` : ""}
                  </span>
                ) : null}
                <span className={`flex-1 ${levelColor(log.level)}`}>{log.message}</span>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold ${
          ok === true ? "text-emerald-500" : ok === false ? "text-red-500" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
