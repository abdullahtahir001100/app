"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  Users, 
  Smartphone, 
  Activity, 
  AlertCircle, 
  TrendingUp, 
  Shield 
} from "lucide-react";

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalDevices: 0,
    agentsOnline: 0,
    credentials: 0,
  });
  const [error, setError] = useState("");

  // Authenticate and fetch stats
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

  // Map dynamic stats to the UI template's structure
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
      value: stats.totalDevices,
      tag: "View devices",
      icon: Smartphone,
      color: "bg-green-500",
      href: "/admin/devices"
    },
    {
      title: "Agents Online",
      value: stats.agentsOnline,
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

  // Placeholder data for the UI components
  const recentActivity = [
    {
      user: "Alice Johnson",
      action: "Paired new device",
      time: "5 mins ago",
      status: "success",
    },
    {
      user: "Bob Smith",
      action: "Accessed screen monitoring",
      time: "12 mins ago",
      status: "success",
    },
    {
      user: "System",
      action: "Backup completed",
      time: "1 hour ago",
      status: "success",
    },
    {
      user: "Carol Williams",
      action: "Failed login attempt",
      time: "2 hours ago",
      status: "warning",
    },
    {
      user: "David Brown",
      action: "Disabled account",
      time: "3 hours ago",
      status: "warning",
    },
  ];

  const userStats = [
    { label: "Active Users", value: 892, percentage: 72 },
    { label: "Inactive Users", value: 245, percentage: 20 },
    { label: "Suspended Users", value: 97, percentage: 8 },
  ];

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 lg:ml-64 overflow-auto">
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
            {/* Recent Activity */}
            <div className="lg:col-span-2">
              <Card className="p-6 border border-border bg-card h-full">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-display">Recent Activity</h2>
                  <Button variant="outline" className="border-border hover:bg-accent/10 text-xs">
                    View all
                  </Button>
                </div>

                <div className="space-y-4">
                  {recentActivity.map((activity, index) => (
                    <div key={index} className="flex items-start justify-between pb-4 border-b border-border last:border-0 last:pb-0">
                      <div>
                        <p className="font-medium text-sm">{activity.user}</p>
                        <p className="text-xs text-muted-foreground">{activity.action}</p>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs font-mono mb-1 inline-block ${
                          activity.status === "success" 
                            ? "text-green-600 bg-green-500/20 px-2 py-1 rounded" 
                            : "text-orange-600 bg-orange-500/20 px-2 py-1 rounded"
                        }`}>
                          {activity.status === "success" ? "✓ Success" : "⚠ Warning"}
                        </div>
                        <p className="text-xs text-muted-foreground block">{activity.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* User Status */}
            <div>
              <Card className="p-6 border border-border bg-card h-full">
                <h2 className="text-xl font-display mb-6">User Status</h2>

                <div className="space-y-6">
                  {userStats.map((stat, index) => (
                    <div key={index}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">{stat.label}</span>
                        <span className="font-mono text-sm font-semibold">{stat.value}</span>
                      </div>
                      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            index === 0 ? "bg-blue-500" : index === 1 ? "bg-gray-500" : "bg-red-500"
                          }`}
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