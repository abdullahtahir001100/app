"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";

type AdminDevice = {
  deviceId: string;
  userId: string;
  hostname: string;
  platform?: string;
  status: string;
  lastSeen?: string;
};

export default function AdminDevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const session = await fetch("/api/auth/session", { credentials: "include" });
      const sessionData = await session.json().catch(() => ({}));
      if (!session.ok || sessionData?.user?.role !== "admin") {
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
    })();
  }, [router]);

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto lg:ml-64 p-6">
        <h1 className="text-3xl font-display tracking-tight mb-2">All devices</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Admin can open and control any device on the platform
        </p>
        {error && <p className="text-sm text-destructive mb-4">{error}</p>}
        <div className="space-y-2">
          {devices.map((device) => (
            <Card key={device.deviceId} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{device.hostname || device.deviceId}</p>
                <p className="text-xs text-muted-foreground font-mono">{device.deviceId}</p>
                <p className="text-[11px] text-muted-foreground">
                  owner: {device.userId || "—"} · {device.platform || "unknown"} · {device.status}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/screen?device=${encodeURIComponent(device.deviceId)}`}>Screen</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/shell?device=${encodeURIComponent(device.deviceId)}`}>Shell</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href={`/files?device=${encodeURIComponent(device.deviceId)}`}>Files</Link>
                </Button>
              </div>
            </Card>
          ))}
          {devices.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">No devices registered</Card>
          )}
        </div>
      </main>
    </div>
  );
}
