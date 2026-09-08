"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Smartphone,
  Activity,
  AlertCircle,
  Shield
} from "lucide-react";

interface Device {
  id?: string | number;
  name?: string;
  deviceName?: string;
  model?: string;
  hostname?: string;
  status?: string;
  isOnline?: boolean;
  user?: { name?: string; email?: string };
  userEmail?: string;
  ip?: string;
  lastSeen?: string;
  lastActive?: string;
  updatedAt?: string;
  createdAt?: string;
  daysOnline?: number;
}

// Helper: Determine device status & styling
function getDeviceStatus(device: Device) {
  if (device.status?.toLowerCase() === "suspended") {
    return {
      status: "suspended",
      label: "Suspended",
      className: "text-red-600 bg-red-500/10 border-red-500/20",
    };
  }

  const lastTimestamp = device.lastSeen || device.lastActive || device.updatedAt || device.createdAt;

  if (lastTimestamp) {
    const lastDate = new Date(lastTimestamp).getTime();
    const diffMs = Date.now() - lastDate;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // Agar 30 days se zyada purana / inactive ho gaya ho to Suspended
    if (diffDays > 30 || (device.daysOnline && device.daysOnline > 30)) {
      return {
        status: "suspended",
        label: "Suspended (>30d)",
        className: "text-red-600 bg-red-500/10 border-red-500/20",
      };
    }

    // 10 minutes ke andar active ho ya status explicitly online ho
    const isRecentlyActive = diffMs <= 10 * 60 * 1000;
    if (device.isOnline || device.status?.toLowerCase() === "online" || isRecentlyActive) {
      return {
        status: "online",
        label: "Online",
        className: "text-green-600 bg-green-500/10 border-green-500/20",
      };
    }
  } else if (device.isOnline || device.status?.toLowerCase() === "online") {
    return {
      status: "online",
      label: "Online",
      className: "text-green-600 bg-green-500/10 border-green-500/20",
    };
  }

  return {
    status: "offline",
    label: "Offline",
    className: "text-orange-600 bg-orange-500/10 border-orange-500/20",
  };
}

// Helper: Format timestamps to relative time strings
function formatRelativeTime(dateString?: string) {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Unknown";

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalDevices: 0,
    agentsOnline: 0,
    credentials: 0,
  });
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Authenticate and fetch real stats and devices
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await fetch("/api/auth/session", { credentials: "include" });
        const sessionData = await session.json().catch(() => ({}));

        const canAdmin = sessionData?.user?.role === "admin" || (Array.isArray(sessionData?.user?.pages) && sessionData.user.pages.includes("admin"));
        if (!session.ok || !canAdmin) {
          router.replace("/dashboard");
          return;
        }

        // Fetch stats aur devices data
        const [statsRes, devicesRes] = await Promise.all([
          fetch("/api/admin/stats", { credentials: "include" }),
          fetch("/api/admin/devices", { credentials: "include" }).catch(() => null)
        ]);

        const statsData = await statsRes.json().catch(() => ({}));

        if (!active) return;

        if (!statsRes.ok) {
          setError(statsData.message || "Failed to load admin stats");
          return;
        }
        setStats(statsData.stats || statsData || {});

        // Process device list
        let loadedDevices: Device[] = [];
        if (devicesRes && devicesRes.ok) {
          const devData = await devicesRes.json().catch(() => ({}));
          loadedDevices = Array.isArray(devData)
            ? devData
            : (devData.devices || devData.data || []);
        } else if (statsData.devices || statsData.recentDevices) {
          loadedDevices = statsData.devices || statsData.recentDevices || [];
        }

        setDevices(loadedDevices);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  // Compute online, offline & suspended device metrics
  const onlineCount = devices.filter(d => getDeviceStatus(d).status === "online").length;
  const offlineCount = devices.filter(d => getDeviceStatus(d).status === "offline").length;
  const suspendedCount = devices.filter(d => getDeviceStatus(d).status === "suspended").length;
  const totalCount = devices.length || stats.totalDevices || 1;

  const deviceStatsBreakdown = [
    {
      label: "Online Devices",
      value: stats.agentsOnline || onlineCount,
      percentage: Math.min(100, Math.round(((stats.agentsOnline || onlineCount) / totalCount) * 100)),
      color: "bg-green-500",
    },
    {
      label: "Offline Devices",
      value: offlineCount,
      percentage: Math.min(100, Math.round((offlineCount / totalCount) * 100)),
      color: "bg-orange-500",
    },
    {
      label: "Suspended Devices (>30d)",
      value: suspendedCount,
      percentage: Math.min(100, Math.round((suspendedCount / totalCount) * 100)),
      color: "bg-red-500",
    },
  ];

  // Dynamic stats cards
  const displayStats = [
    {
      title: "Total Users",
      value: stats.totalUsers,
      tag: "Manage users",
      icon: Users,
      color: "bg-blue-500",
      href: "/admin/users"
    },
    {
      title: "Registered Devices",
      value: stats.totalDevices || devices.length,
      tag: "View devices",
      icon: Smartphone,
      color: "bg-green-500",
      href: "/admin/devices"
    },
    {
      title: "Agents Online",
      value: stats.agentsOnline || onlineCount,
      tag: "Live status",
      icon: Activity,
      color: "bg-purple-500",
      href: "/admin/devices"
    },
    {
      title: "Credentials",
      value: stats.credentials,
      tag: "Permissions",
      icon: Shield,
      color: "bg-orange-500",
      href: "/admin/permissions"
    },
  ];

  if (isLoading) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />

        <main className="flex-1 sidebar-aware-main overflow-auto">
          <div className="p-6 lg:p-12">
            <Skeleton className="h-12 w-72 mb-3" />
            <Skeleton className="h-5 w-96 mb-8" />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="p-6 border border-border bg-card h-full">
                  <div className="flex items-start justify-between mb-4">
                    <Skeleton className="h-12 w-12 rounded-lg" />
                    <Skeleton className="h-7 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-8 w-20" />
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
              <div className="lg:col-span-2">
                <Card className="p-6 border border-border bg-card h-full">
                  <div className="flex items-center justify-between mb-6">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-10 w-24 rounded-lg" />
                  </div>
                  <div className="space-y-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="flex items-start justify-between pb-4 border-b border-border last:border-0 last:pb-0">
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-44" />
                        </div>
                        <div className="space-y-2 text-right">
                          <Skeleton className="h-6 w-24 ml-auto rounded-full" />
                          <Skeleton className="h-3 w-20 ml-auto" />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <div>
                <Card className="p-6 border border-border bg-card h-full">
                  <Skeleton className="h-6 w-32 mb-6" />
                  <div className="space-y-6">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-4 w-8" />
                        </div>
                        <Skeleton className="h-2 w-full rounded-full" />
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>

            <Card className="p-6 border border-border bg-card">
              <Skeleton className="h-6 w-40 mb-6" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 sidebar-aware-main overflow-auto">
        <div className="p-6 lg:p-12">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">Admin Dashboard</h1>
            <p className="text-muted-foreground">Platform overview — control users, devices, and permissions</p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-8 flex items-center gap-2 p-4 text-sm text-destructive bg-destructive/10 rounded-lg border border-destructive/20">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {displayStats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <Link key={index} href={stat.href}>
                  <Card className="p-6 border border-border bg-card hover:border-foreground/30 transition-colors h-full hover:-translate-y-1 duration-200">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-12 h-12 ${stat.color}/20 rounded-lg flex items-center justify-center`}>
                        <Icon className={`w-6 h-6 ${stat.color.replace("bg-", "text-")}`} />
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 bg-secondary/50 text-secondary-foreground text-xs rounded font-medium">
                        {stat.tag}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">{stat.title}</p>
                    <p className="text-3xl font-display">{stat.value}</p>
                  </Card>
                </Link>
              );
            })}
          </div>

          {/* Main content grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
            {/* Recent Activity (Live Devices) */}
            <div className="lg:col-span-2">
              <Card className="p-6 border border-border bg-card h-full">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-display">Recent Activity</h2>
                    <p className="text-xs text-muted-foreground">Live devices, connectivity & suspension status</p>
                  </div>
                  <Button asChild variant="outline" className="border-border hover:bg-accent/10 text-xs">
                    <Link href="/admin/devices">View all</Link>
                  </Button>
                </div>

                <div className="space-y-4">
                  {devices.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">No active or recorded devices found.</p>
                  ) : (
                    devices.slice(0, 6).map((device, index) => {
                      const statusInfo = getDeviceStatus(device);
                      const deviceTitle = device.name || device.deviceName || device.model || device.hostname || `Device #${device.id || index + 1}`;
                      const deviceSubtext = device.user?.name || device.user?.email || device.userEmail || device.ip || "System Agent";
                      const relativeTime = formatRelativeTime(device.lastSeen || device.lastActive || device.updatedAt || device.createdAt);

                      return (
                        <div key={device.id || index} className="flex items-start justify-between pb-4 border-b border-border last:border-0 last:pb-0">
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg bg-secondary/50 flex items-center justify-center mt-0.5">
                              <Smartphone className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{deviceTitle}</p>
                              <p className="text-xs text-muted-foreground">{deviceSubtext}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-xs font-mono mb-1 inline-block px-2 py-0.5 rounded border ${statusInfo.className}`}>
                              {statusInfo.status === "online" && "● "}
                              {statusInfo.status === "offline" && "○ "}
                              {statusInfo.status === "suspended" && "✕ "}
                              {statusInfo.label}
                            </div>
                            <p className="text-xs text-muted-foreground block">{relativeTime}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>

            {/* Device Status Breakdown */}
            <div>
              <Card className="p-6 border border-border bg-card h-full">
                <h2 className="text-xl font-display mb-6">Device Status</h2>

                <div className="space-y-6">
                  {deviceStatsBreakdown.map((stat, index) => (
                    <div key={index}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">{stat.label}</span>
                        <span className="font-mono text-sm font-semibold">{stat.value}</span>
                      </div>
                      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full ${stat.color}`}
                          style={{ width: `${stat.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* Quick Actions / System Controls */}
          <Card className="p-6 border border-border bg-card">
            <h2 className="text-xl font-display mb-6">System Navigation</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Button asChild className="bg-foreground hover:bg-foreground/90 text-background justify-center">
                <Link href="/admin/users">
                  Manage Users & Roles
                </Link>
              </Button>
              <Button asChild variant="outline" className="border-border hover:bg-accent/10">
                <Link href="/admin/permissions">
                  Per-Page Permissions
                </Link>
              </Button>
              <Button asChild variant="outline" className="border-border hover:bg-accent/10">
                <Link href="/admin/devices">
                  View All Devices
                </Link>
              </Button>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}