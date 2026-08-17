"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Card } from "@/components/ui/card";
import { useGateway } from "@/hooks/use-gateway";
import DeviceUserDataThreeChart from "@/components/DeviceUserDataThreeChart";
import { useEffect, useMemo, useState } from "react";
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
  const { devices: deviceOptions } = useGateway() as {
    devices: { value: string; label?: string; status?: string }[];
  };
  const [selectedDevice, setSelectedDevice] = useState("");
  const [tab, setTab] = useState<"charts" | "3d">("charts");
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!selectedDevice) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/logs/usage?deviceId=${encodeURIComponent(selectedDevice)}`,
          { credentials: "include", cache: "no-store" }
        );
        const json = await res.json();
        if (!cancelled && json.success) {
          setData({
            apps: json.apps || [],
            hourly: json.hourly || [],
            timeline: json.timeline || [],
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDevice]);

  const barData = useMemo(
    () =>
      (data?.apps || []).slice(0, 12).map((app) => ({
        name: app.appName.length > 18 ? `${app.appName.slice(0, 16)}…` : app.appName,
        minutes: Math.round(app.duration / 60),
        duration: app.duration,
      })),
    [data]
  );

  const pieData = useMemo(
    () =>
      (data?.apps || []).slice(0, 8).map((app) => ({
        name: app.appName,
        value: Math.max(1, Math.round(app.duration / 60)),
      })),
    [data]
  );

  const threeData = useMemo(
    () =>
      (data?.apps || []).slice(0, 10).map((app) => ({
        label: app.appName,
        count: Math.max(1, Math.round(app.duration / 60)),
      })),
    [data]
  );

  const hourlyData = useMemo(
    () =>
      (data?.hourly || []).map((row) => ({
        hour: `${String(row.hour).padStart(2, "0")}:00`,
        minutes: Math.round(row.duration / 60),
      })),
    [data]
  );

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Usage</h1>
            <p className="text-sm text-muted-foreground">Time spent in apps over the last 24 hours</p>
          </div>
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
              onChange={(opt) => setSelectedDevice(opt?.value || "")}
              classNamePrefix="zenvora"
            />
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
              <h2 className="mb-4 text-sm font-medium">Time by app (minutes)</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={70} />
                    <YAxis />
                    <Tooltip formatter={(value) => [`${value} min`, "Time"]} />
                    <Bar dataKey="minutes" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4">
              <h2 className="mb-4 text-sm font-medium">Share of time</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} min`, String(name)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4 lg:col-span-2">
              <h2 className="mb-4 text-sm font-medium">Hourly activity</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip formatter={(value) => [`${value} min`, "Time"]} />
                    <Bar dataKey="minutes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4 lg:col-span-2">
              <h2 className="mb-4 text-sm font-medium">Recent sessions</h2>
              <div className="max-h-80 overflow-auto text-sm">
                {(data?.timeline || []).slice(0, 40).map((row, i) => (
                  <div key={`${row.appName}-${i}`} className="flex justify-between border-b border-border/40 py-2">
                    <span>{row.appName}</span>
                    <span className="text-muted-foreground">{formatDuration(row.duration)}</span>
                  </div>
                ))}
                {!data?.timeline?.length && (
                  <p className="text-muted-foreground">No usage sessions yet.</p>
                )}
              </div>
            </Card>
          </div>
        ) : (
          <Card className="p-4">
            <h2 className="mb-4 text-sm font-medium">3D time spent (minutes)</h2>
            <DeviceUserDataThreeChart data={threeData} />
          </Card>
        )}
      </main>
    </div>
  );
}
