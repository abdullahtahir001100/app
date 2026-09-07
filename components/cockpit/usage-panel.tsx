"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type UsageApp = { appName: string; duration: number; sessions?: number };

function fmt(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function UsagePanel({ deviceId }: { deviceId: string }) {
  const [apps, setApps] = useState<UsageApp[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logs/usage?deviceId=${encodeURIComponent(deviceId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success) {
        setApps(
          [...(json.apps || [])]
            .sort((a: UsageApp, b: UsageApp) => b.duration - a.duration)
            .slice(0, 15)
        );
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const max = apps.reduce((m, a) => Math.max(m, a.duration), 0) || 1;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-background/60 px-2 py-1.5 text-xs">
        <span className="font-medium">App usage</span>
        <button onClick={() => void load()} className="ml-auto flex h-6 w-6 items-center justify-center rounded-md border border-border" title="Refresh">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex-1 min-h-0 space-y-1.5 overflow-y-auto p-2.5">
        {apps.map((a) => (
          <div key={a.appName} className="text-xs">
            <div className="mb-0.5 flex justify-between gap-2">
              <span className="truncate">{a.appName}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{fmt(a.duration)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((a.duration / max) * 100)}%` }} />
            </div>
          </div>
        ))}
        {!apps.length && <p className="text-xs text-muted-foreground">{loading ? "Loading usage…" : "No usage recorded yet."}</p>}
      </div>
    </div>
  );
}
