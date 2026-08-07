"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Card } from "@/components/ui/card";
import { Users, Smartphone, Activity, Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalDevices: 0,
    agentsOnline: 0,
    credentials: 0,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await fetch("/api/auth/session", { credentials: "include" });
        const sessionData = await session.json().catch(() => ({}));
        if (!session.ok || sessionData?.user?.role !== "admin") {
          router.replace("/dashboard");
          return;
        }
        const res = await fetch("/api/admin/stats", { credentials: "include" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          setError(data.message || "Failed to load admin stats");
          return;
        }
        setStats(data.stats || {});
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const cards = [
    { title: "Total Users", value: stats.totalUsers, icon: Users, href: "/admin/users" },
    { title: "Registered Devices", value: stats.totalDevices, icon: Smartphone, href: "/admin/devices" },
    { title: "Agents Online", value: stats.agentsOnline, icon: Activity, href: "/admin/devices" },
    { title: "Credentials", value: stats.credentials, icon: Shield, href: "/admin/permissions" },
  ];

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto lg:ml-64 p-6">
        <h1 className="text-3xl font-display tracking-tight mb-2">Admin</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Platform overview — control users, devices, and permissions
        </p>
        {error && <p className="text-sm text-destructive mb-4">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-8">
          {cards.map((card) => (
            <Link key={card.title} href={card.href}>
              <Card className="p-5 hover:border-foreground/30 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-muted-foreground">{card.title}</p>
                  <card.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-semibold">{card.value}</p>
              </Card>
            </Link>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/admin/users" className="rounded-lg border border-border p-4 hover:bg-muted/40">
            Manage users & roles
          </Link>
          <Link href="/admin/permissions" className="rounded-lg border border-border p-4 hover:bg-muted/40">
            Per-page permissions
          </Link>
          <Link href="/admin/devices" className="rounded-lg border border-border p-4 hover:bg-muted/40">
            All devices (any owner)
          </Link>
        </div>
      </main>
    </div>
  );
}
