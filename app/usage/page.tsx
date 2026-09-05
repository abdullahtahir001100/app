"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGateway } from "@/hooks/use-gateway";
import DeviceUserDataThreeChart from "@/components/DeviceUserDataThreeChart";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Select from "react-select";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type UsageApp = {
  appName: string;
  duration: number;
  sessions: number;
  lastOpened?: string;
};

type UsagePayload = {
  apps: UsageApp[];
  hourly: { hour: number; duration: number; sessions: number }[];
  timeline: { appName: string; duration: number; lastOpened?: string }[];
};

type UsageDetail = {
  appName: string;
  isBrowser?: boolean;
  activity: {
    _id: string;
    action: string;
    appName?: string;
    details?: string;
    windowTitle?: string;
    url?: string;
    duration?: number;
    createdAt: string;
  }[];
  appSessions: {
    _id: string;
    appName: string;
    duration: number;
    lastOpened: string;
    executablePath?: string;
  }[];
  browserHistory: {
    _id: string;
    url: string;
    title: string;
    browser?: string;
    visitTime: string;
  }[];
};

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#14b8a6"];

export default function UsagePage() {
  const searchParams = useSearchParams();
  const requestedDevice = searchParams.get("device") || "";
  const { devices: deviceOptions, dispatch, subscribe } = useGateway() as {
    devices: { value: string; label?: string; status?: string }[];
    dispatch: (
      action: string,
      payload?: Record<string, unknown>,
      target?: string
    ) => { ok: boolean; reason?: string };
    subscribe: (fn: (event: {
      type: string;
      packet?: Record<string, unknown>;
      devices?: unknown;
    }) => void) => () => void;
  };
  const [selectedDevice, setSelectedDevice] = useState("");
  const [tab, setTab] = useState<"charts" | "3d">("charts");
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [detail, setDetail] = useState<UsageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiLog, setAiLog] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [healLast, setHealLast] = useState<string>("");

  useEffect(() => {
    if (!deviceOptions?.length) return;
    const ids = deviceOptions.map((d) => d.value);
    if (requestedDevice && ids.includes(requestedDevice)) {
      setSelectedDevice(requestedDevice);
      return;
    }
    if (!selectedDevice || !ids.includes(selectedDevice)) {
      const online = deviceOptions.find((d) => d.status === "online");
      setSelectedDevice((online || deviceOptions[0]).value);
    }
  }, [deviceOptions, requestedDevice, selectedDevice]);

  const refreshUsage = useCallback(async () => {
    if (!selectedDevice) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/logs/usage?deviceId=${encodeURIComponent(selectedDevice)}`,
        { credentials: "include", cache: "no-store" }
      );
      const json = await res.json();
      if (json.success) {
        setData({
          apps: json.apps || [],
          hourly: json.hourly || [],
          timeline: json.timeline || [],
        });
      }
    } finally {
      setLoading(false);
    }
  }, [selectedDevice]);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  const loadDetail = useCallback(
    async (appName: string) => {
      if (!selectedDevice || !appName) return;
      setSelectedApp(appName);
      setDetailLoading(true);
      try {
        const res = await fetch(
          `/api/logs/usage/detail?deviceId=${encodeURIComponent(selectedDevice)}&appName=${encodeURIComponent(appName)}`,
          { credentials: "include", cache: "no-store" }
        );
        const json = await res.json();
        if (json.success) {
          setDetail({
            appName: json.appName,
            isBrowser: json.isBrowser,
            activity: json.activity || [],
            appSessions: json.appSessions || [],
            browserHistory: json.browserHistory || [],
          });
        }
      } finally {
        setDetailLoading(false);
      }
    },
    [selectedDevice]
  );

  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => {
      if (event.type !== "json") return;
      const packet = event.packet as { type?: string };
      if (packet?.type === "heal_result") {
        setHealLast(JSON.stringify(packet, null, 2).slice(0, 4000));
        setAiLog((prev) => [
          ...prev,
          { role: "ai", text: "Agent heal result received — history/notifications refreshed if available." },
        ]);
        void refreshUsage();
        if (selectedApp) void loadDetail(selectedApp);
      }
    });
  }, [subscribe, refreshUsage, selectedApp, loadDetail]);

  const runHeal = async (message: string, topic = "") => {
    if (!selectedDevice) return;
    setAiBusy(true);
    setAiLog((prev) => [...prev, { role: "user", text: message || `Heal: ${topic || "environment"}` }]);
    try {
      const res = await fetch("/api/agent/heal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: selectedDevice,
          message,
          topic,
          appContext: selectedApp
            ? { appName: selectedApp, detailSummary: detail }
            : { apps: data?.apps?.slice(0, 10) },
        }),
      });
      const json = await res.json();
      setAiLog((prev) => [
        ...prev,
        { role: "ai", text: json.reply || json.error || "No reply" },
      ]);
      const actions = Array.isArray(json.actions) ? json.actions : [];
      for (const step of actions) {
        const action = String(step.action || "");
        const payload = (step.payload || {}) as Record<string, unknown>;
        if (action === "SHELL_EXECUTE") {
          dispatch("SHELL_EXECUTE", { command: payload.command || payload.cmd || "" }, selectedDevice);
        } else {
          dispatch(action, payload, selectedDevice);
        }
      }
      if (!actions.length) {
        dispatch("HEAL_ANALYZE", {}, selectedDevice);
        dispatch("HEAL_FIX", { topic: topic || "environment" }, selectedDevice);
      }
    } catch (err) {
      setAiLog((prev) => [
        ...prev,
        { role: "ai", text: err instanceof Error ? err.message : "Heal request failed" },
      ]);
      dispatch("HEAL_FIX", { topic: "environment" }, selectedDevice);
    } finally {
      setAiBusy(false);
      setAiPrompt("");
    }
  };

  const barData = useMemo(
    () =>
      [...(data?.apps || [])]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 12)
        .map((app) => ({
          fullName: app.appName,
          name: app.appName.length > 22 ? `${app.appName.slice(0, 20)}…` : app.appName,
          seconds: app.duration,
        })),
    [data]
  );

  const pieData = useMemo(() => {
    const apps = [...(data?.apps || [])].sort((a, b) => b.duration - a.duration).slice(0, 8);
    const total = apps.reduce((sum, app) => sum + app.duration, 0) || 1;
    return apps.map((app) => ({
      name: app.appName,
      value: app.duration,
      percent: Math.round((app.duration / total) * 100),
    }));
  }, [data]);

  const threeData = useMemo(
    () =>
      [...(data?.apps || [])]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map((app) => ({
          label: app.appName,
          count: Math.max(1, app.duration),
        })),
    [data]
  );

  const hourlyData = useMemo(
    () =>
      (data?.hourly || []).map((row) => ({
        hour: `${String(row.hour).padStart(2, "0")}:00`,
        seconds: row.duration,
      })),
    [data]
  );

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 sidebar-aware-main p-8">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Usage</h1>
            <p className="text-sm text-muted-foreground">
              Click an app for history & activity. Agent AI can heal collectors from here.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant="outline"
              size="sm"
              disabled={aiBusy || !selectedDevice}
              onClick={() =>
                void runHeal(
                  "Analyze this PC agent environment and fix anything broken for usage, browser history, and notifications.",
                  "environment"
                )
              }
            >
              {aiBusy ? "AI working…" : "AI heal agent"}
            </Button>
            <div className="w-72">
              <Select
                options={(deviceOptions || []).map((d) => ({
                  value: d.value,
                  label: `${d.label || d.value}${d.status === "online" ? "" : " (offline)"}`,
                }))}
                value={
                  selectedDevice
                    ? {
                        value: selectedDevice,
                        label:
                          deviceOptions?.find((d) => d.value === selectedDevice)?.label ||
                          selectedDevice,
                      }
                    : null
                }
                onChange={(opt) => {
                  setSelectedDevice(opt?.value || "");
                  setSelectedApp(null);
                  setDetail(null);
                }}
                classNamePrefix="zenvora"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            className={`px-4 py-2 rounded-md text-sm ${tab === "charts" ? "bg-emerald-600 text-white" : "bg-muted"}`}
            onClick={() => setTab("charts")}
          >
            Charts
          </button>
          <button
            className={`px-4 py-2 rounded-md text-sm ${tab === "3d" ? "bg-emerald-600 text-white" : "bg-muted"}`}
            onClick={() => setTab("3d")}
          >
            3D view
          </button>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading usage…</p>}

        {tab === "charts" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-4 text-sm font-medium">Longest apps — click for detail</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [formatDuration(Number(value) || 0), "Time"]} />
                    <Bar
                      dataKey="seconds"
                      fill="#10b981"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry: { fullName?: string; name?: string }) => {
                        const name = entry?.fullName || entry?.name;
                        if (name) void loadDetail(name);
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4">
              <h2 className="mb-4 text-sm font-medium">Share of time (%)</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={90}
                      cursor="pointer"
                      onClick={(_, index) => {
                        const row = pieData[index];
                        if (row?.name) void loadDetail(row.name);
                      }}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => {
                        const seconds = Number(value) || 0;
                        const row = pieData.find((p) => p.name === String(name));
                        return [`${formatDuration(seconds)} (${row?.percent ?? 0}%)`, String(name)];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4 lg:col-span-2">
              <h2 className="mb-4 text-sm font-medium">Time spent by hour</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip formatter={(value) => [formatDuration(Number(value) || 0), "Time"]} />
                    <Bar dataKey="seconds" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4 lg:col-span-2">
              <h2 className="mb-4 text-sm font-medium">Apps by time — click row</h2>
              <div className="max-h-80 overflow-auto text-sm">
                {(data?.apps || []).map((row) => (
                  <button
                    key={row.appName}
                    type="button"
                    className={`flex w-full justify-between border-b border-border/40 py-2 text-left hover:bg-muted/40 px-1 rounded ${
                      selectedApp === row.appName ? "bg-emerald-500/10" : ""
                    }`}
                    onClick={() => void loadDetail(row.appName)}
                  >
                    <span>{row.appName}</span>
                    <span className="text-muted-foreground">{formatDuration(row.duration)}</span>
                  </button>
                ))}
                {!data?.apps?.length && (
                  <p className="text-muted-foreground">No usage sessions yet.</p>
                )}
              </div>
            </Card>
          </div>
        ) : (
          <Card className="p-4">
            <h2 className="mb-4 text-sm font-medium">3D time spent (seconds)</h2>
            <DeviceUserDataThreeChart data={threeData} />
          </Card>
        )}

        {selectedApp && (
          <Card className="p-4 mt-6">
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <div>
                <h2 className="text-lg font-medium">{selectedApp}</h2>
                <p className="text-sm text-muted-foreground">
                  Same sources as Logs — sessions, activity, and browser visits when applicable
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    dispatch("FETCH_BROWSER_HISTORY", {}, selectedDevice);
                    dispatch("FETCH_APP_HISTORY", {}, selectedDevice);
                    setTimeout(() => void loadDetail(selectedApp), 1500);
                  }}
                >
                  Refresh from agent
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setSelectedApp(null); setDetail(null); }}>
                  Close
                </Button>
              </div>
            </div>
            {detailLoading && <p className="text-sm text-muted-foreground">Loading detail…</p>}
            {!detailLoading && detail && (
              <div className="grid gap-4 lg:grid-cols-3">
                <div>
                  <h3 className="text-sm font-medium mb-2">Sessions</h3>
                  <div className="max-h-64 overflow-auto text-xs space-y-2">
                    {detail.appSessions.map((s) => (
                      <div key={s._id} className="border-b border-border/30 pb-2">
                        <div>{formatDuration(s.duration)}</div>
                        <div className="text-muted-foreground">
                          {s.lastOpened ? new Date(s.lastOpened).toLocaleString() : "—"}
                        </div>
                      </div>
                    ))}
                    {!detail.appSessions.length && <p className="text-muted-foreground">No sessions</p>}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium mb-2">Activity</h3>
                  <div className="max-h-64 overflow-auto text-xs space-y-2">
                    {detail.activity.map((a) => (
                      <div key={a._id} className="border-b border-border/30 pb-2">
                        <div className="font-medium">{a.action}</div>
                        <div className="text-muted-foreground truncate">
                          {a.windowTitle || a.details || a.url || "—"}
                        </div>
                        <div className="text-muted-foreground">
                          {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
                          {a.duration ? ` · ${formatDuration(a.duration)}` : ""}
                        </div>
                      </div>
                    ))}
                    {!detail.activity.length && <p className="text-muted-foreground">No activity</p>}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium mb-2">
                    {detail.isBrowser ? "Searches & sites" : "Related browser (if any)"}
                  </h3>
                  <div className="max-h-64 overflow-auto text-xs space-y-2">
                    {detail.browserHistory.map((b) => (
                      <div key={b._id} className="border-b border-border/30 pb-2">
                        <div className="font-medium truncate">{b.title || b.url}</div>
                        <a
                          href={b.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-600 truncate block"
                        >
                          {b.url}
                        </a>
                        <div className="text-muted-foreground">
                          {b.visitTime ? new Date(b.visitTime).toLocaleString() : ""}
                        </div>
                      </div>
                    ))}
                    {!detail.browserHistory.length && (
                      <p className="text-muted-foreground">
                        {detail.isBrowser
                          ? "No browser history in range — use AI heal or refresh."
                          : "No browser rows for this app"}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        <Card className="p-4 mt-6">
          <h2 className="text-sm font-medium mb-2">Agent AI ops</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Ask anything about missing notifications, history, or usage. AI plans HEAL_*/shell actions;
            the Rust agent analyzes the PC and applies fixes. Commands run as requested.
          </p>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 h-10 rounded-md border border-border bg-background px-3 text-sm"
              placeholder='e.g. "Chrome history not syncing" or "notifications missing"'
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && aiPrompt.trim()) void runHeal(aiPrompt.trim());
              }}
            />
            <Button
              disabled={aiBusy || !aiPrompt.trim()}
              onClick={() => void runHeal(aiPrompt.trim())}
            >
              Run
            </Button>
          </div>
          <div className="max-h-48 overflow-auto text-sm space-y-2 mb-3">
            {aiLog.slice(-12).map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-foreground" : "text-muted-foreground"}>
                <span className="font-mono text-[10px] uppercase mr-2">{m.role}</span>
                {m.text}
              </div>
            ))}
            {!aiLog.length && (
              <p className="text-muted-foreground text-xs">No AI ops yet.</p>
            )}
          </div>
          {healLast && (
            <pre className="text-[10px] max-h-40 overflow-auto rounded bg-muted/50 p-2 whitespace-pre-wrap">
              {healLast}
            </pre>
          )}
        </Card>
      </main>
    </div>
  );
}
