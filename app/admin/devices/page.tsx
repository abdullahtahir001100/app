"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  Search, 
  Filter, 
  Smartphone, 
  Monitor, 
  Terminal, 
  Folder,
  AlertCircle 
} from "lucide-react";

type AdminDevice = {
  deviceId: string;
  userId: string;
  hostname: string;
  platform?: string;
  status: string;
  lastSeen?: string;
  // Optional fields in case your API ever returns them for the UI bars
  battery?: number; 
  storage?: number; 
};

export default function AdminDevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

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
  const onlineDevices = devices.filter(d => d.status === "online").length;
  const offlineDevices = devices.filter(d => d.status === "offline").length;

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 lg:ml-64 overflow-auto">
        <div className="p-6 lg:p-12">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-end justify-between mb-4">
              <div>
                <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">
                  Device Management
                </h1>
                <p className="text-muted-foreground">Admin can open and control any device on the platform</p>
              </div>
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
              // Fallback values for UI elements not strictly typed in your original API response
              const batteryLevel = device.battery || 0; 
              const storageLevel = device.storage || 0;

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
                            <span className="text-xs font-mono w-6">{batteryLevel}%</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Storage</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-border rounded-full h-2">
                              <div
                                className="h-full rounded-full bg-blue-600"
                                style={{ width: `${storageLevel}%` }}
                              />
                            </div>
                            <span className="text-xs font-mono w-6">{storageLevel}%</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Last Seen</p>
                          <p className="text-xs font-mono">{device.lastSeen || "Unknown"}</p>
                        </div>
                      </div>
                    </div>

                    {/* Actions - Mapped from your logic links to icons */}
                    <div className="flex flex-col sm:flex-row items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex-shrink-0">
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