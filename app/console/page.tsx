"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGateway } from "@/hooks/use-gateway";
import { RefreshCw, Trash2, Radio } from "lucide-react";
import {
  dispatchMediaTransportPreference,
  getPreferredMediaTransport,
  setPreferredMediaTransport,
  type MediaTransport,
} from "@/lib/media-transport";

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

const CHANNELS = ["all", "http", "ws", "tcp", "agent", "install", "mongo", "system"] as const;

function levelColor(level: string) {
  switch (level) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-300";
    case "ok":
    case "success":
      return "text-emerald-400";
    default:
      return "text-zinc-200";
  }
}

function channelBadge(channel: string) {
  const map: Record<string, string> = {
    http: "bg-sky-500/20 text-sky-300",
    ws: "bg-violet-500/20 text-violet-300",
    tcp: "bg-cyan-500/20 text-cyan-300",
    agent: "bg-emerald-500/20 text-emerald-300",
    install: "bg-orange-500/20 text-orange-300",
    mongo: "bg-rose-500/20 text-rose-300",
    system: "bg-zinc-500/20 text-zinc-300",
  };
  return map[channel] || "bg-zinc-500/20 text-zinc-300";
}

export default function ConsolePage() {
  const { isConnected, devices, subscribe, dispatch } = useGateway();
  const [logs, setLogs] = useState<LiveLog[]>([]);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [mediaTransport, setMediaTransport] = useState<MediaTransport>("wss");
  const [transportMsg, setTransportMsg] = useState("");
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
          message: `device ${packet.deviceId} → ${packet.status}`,
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
    return logs.filter((l) => {
      if (channel !== "all" && l.channel !== channel) return false;
      if (!q) return true;
      return (
        l.message.toLowerCase().includes(q) ||
        (l.route || "").toLowerCase().includes(q) ||
        (l.deviceId || "").toLowerCase().includes(q) ||
        (l.channel || "").toLowerCase().includes(q)
      );
    });
  }, [logs, channel, query]);

  const onlineDevices = devices.filter((d) => d.status === "online").length;
  const selectedAgent =
    devices.find((d) => d.status === "online")?.value || devices[0]?.value || "";

  useEffect(() => {
    setMediaTransport(getPreferredMediaTransport());
  }, []);

  const applyMediaTransport = useCallback(
    (next: MediaTransport) => {
      setMediaTransport(next);
      setPreferredMediaTransport(next);
      if (!selectedAgent) {
        setTransportMsg(`Saved ${next.toUpperCase()} locally. Select/start an agent to push live.`);
        return;
      }
      const ok = dispatchMediaTransportPreference(dispatch, next, selectedAgent);
      setTransportMsg(
        ok
          ? `Pushed ${next.toUpperCase()} to agent ${selectedAgent} (manual — no auto-failover).`
          : `Saved ${next.toUpperCase()} locally; agent offline — push when online.`
      );
    },
    [dispatch, selectedAgent]
  );

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 sidebar-aware-main p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Live Console</h1>
            <p className="text-sm text-muted-foreground">
              Realtime HTTP · WebSocket · TCP · agent · install · mongo
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

        <div className="mb-4 rounded-lg border border-border bg-card/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Preferred media transport</p>
              <p className="text-xs text-muted-foreground">
                Agent env <code className="text-[11px]">PREFERRED_MEDIA_TRANSPORT</code> · no auto-switch on failure
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={mediaTransport === "wss" ? "default" : "outline"}
                onClick={() => applyMediaTransport("wss")}
              >
                WSS
              </Button>
              <Button
                size="sm"
                variant={mediaTransport === "tcp" ? "default" : "outline"}
                onClick={() => applyMediaTransport("tcp")}
              >
                TCP
              </Button>
            </div>
          </div>
          {transportMsg ? (
            <p className="mt-2 text-xs text-muted-foreground">{transportMsg}</p>
          ) : null}
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

        <div className="mb-3 flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                channel === c ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
              }`}
            >
              {c}
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter message / route / device…"
            className="min-w-[220px] flex-1 rounded border bg-background px-3 py-1.5 text-sm"
          />
        </div>

        <div
          ref={scrollerRef}
          className="h-[calc(100vh-240px)] overflow-auto rounded-lg border border-zinc-800 bg-[#0b0f14] p-3 font-mono text-[12px] leading-5 shadow-inner"
        >
          {filtered.length === 0 ? (
            <div className="text-zinc-500">Waiting for live events…</div>
          ) : (
            filtered.map((log) => (
              <div key={log.id} className="mb-1 flex flex-wrap gap-x-2 gap-y-0.5 border-b border-zinc-900/80 pb-1">
                <span className="shrink-0 text-zinc-500">{new Date(log.ts).toLocaleTimeString()}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${channelBadge(log.channel)}`}>
                  {log.channel}
                </span>
                <span className={`shrink-0 uppercase ${levelColor(log.level)}`}>{log.level}</span>
                {log.method ? (
                  <span className="text-sky-400">
                    {log.method} {log.route}
                    {log.status != null ? ` ${log.status}` : ""}
                    {log.ms != null ? ` ${log.ms}ms` : ""}
                  </span>
                ) : null}
                <span className={levelColor(log.level)}>{log.message}</span>
                {log.deviceId ? <span className="text-emerald-500/80">device={log.deviceId}</span> : null}
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
