"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search, Download, Filter, AlertCircle, Lock, Smartphone, User, Database } from "lucide-react";
import { useState } from "react";

export default function AdminLogsPage() {
  const [filterType, setFilterType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const logs = [
    {
      id: 1,
      type: "login",
      user: "alice.johnson",
      action: "Successful login",
      ip: "192.168.1.100",
      timestamp: "2 mins ago",
      status: "success",
      icon: Lock,
    },
    {
      id: 2,
      type: "device",
      user: "bob.smith",
      action: "Device paired",
      ip: "10.0.0.5",
      timestamp: "15 mins ago",
      status: "success",
      icon: Smartphone,
    },
    {
      id: 3,
      type: "login",
      user: "unknown",
      action: "Failed login attempt",
      ip: "203.0.113.45",
      timestamp: "1 hour ago",
      status: "warning",
      icon: AlertCircle,
    },
    {
      id: 4,
      type: "admin",
      user: "carol.williams",
      action: "User suspended",
      ip: "192.168.1.50",
      timestamp: "2 hours ago",
      status: "warning",
      icon: User,
    },
    {
      id: 5,
      type: "system",
      user: "system",
      action: "Database backup completed",
      ip: "localhost",
      timestamp: "3 hours ago",
      status: "success",
      icon: Database,
    },
    {
      id: 6,
      type: "device",
      user: "eve.martinez",
      action: "Device disconnected",
      ip: "172.16.0.10",
      timestamp: "4 hours ago",
      status: "success",
      icon: Smartphone,
    },
    {
      id: 7,
      type: "login",
      user: "david.brown",
      action: "Successful login",
      ip: "192.168.1.75",
      timestamp: "5 hours ago",
      status: "success",
      icon: Lock,
    },
    {
      id: 8,
      type: "admin",
      user: "carol.williams",
      action: "System settings changed",
      ip: "192.168.1.50",
      timestamp: "1 day ago",
      status: "success",
      icon: User,
    },
  ];

  const filteredLogs =
    filterType === "all"
      ? logs
      : logs.filter((log) => log.type === filterType);

  const logTypes = [
    { id: "all", label: "All Logs", count: 8 },
    { id: "login", label: "Login Activity", count: 3 },
    { id: "device", label: "Device Events", count: 2 },
    { id: "admin", label: "Admin Actions", count: 2 },
    { id: "system", label: "System Logs", count: 1 },
  ];

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 sidebar-aware-main overflow-auto">
        <div className="p-6 lg:p-12">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-end justify-between mb-4">
              <div>
                <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">System Logs</h1>
                <p className="text-muted-foreground">Audit trail and system activity monitoring</p>
              </div>
              <Button className="bg-foreground hover:bg-foreground/90 text-background px-6 rounded-lg gap-2">
                <Download className="w-4 h-4" />
                Export
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card className="p-4 border border-border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Total Logs</p>
              <p className="text-2xl font-display">12,847</p>
            </Card>
            <Card className="p-4 border border-border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Today</p>
              <p className="text-2xl font-display">342</p>
            </Card>
            <Card className="p-4 border border-border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Failed Logins</p>
              <p className="text-2xl font-display text-orange-600">12</p>
            </Card>
            <Card className="p-4 border border-border bg-card">
              <p className="text-xs text-muted-foreground mb-1">Warnings</p>
              <p className="text-2xl font-display text-orange-600">8</p>
            </Card>
          </div>

          {/* Search and filters */}
          <div className="mb-8 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
                />
              </div>
              <Button variant="outline" className="border-border hover:bg-accent/10 gap-2 whitespace-nowrap">
                <Filter className="w-4 h-4" />
                Advanced
              </Button>
            </div>

            {/* Type filter */}
            <div className="flex gap-2 flex-wrap">
              {logTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setFilterType(type.id)}
                  className={`px-4 py-2 rounded-full text-sm transition-colors ${
                    filterType === type.id
                      ? "bg-foreground text-background"
                      : "bg-secondary text-foreground hover:bg-secondary/80"
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logs list */}
          <div className="space-y-3">
            {filteredLogs.map((log) => {
              const IconComponent = log.icon;
              return (
                <Card
                  key={log.id}
                  className="p-4 border border-border bg-card hover:bg-accent/5 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div
                      className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        log.status === "success"
                          ? "bg-green-500/20 text-green-600"
                          : "bg-orange-500/20 text-orange-600"
                      }`}
                    >
                      <IconComponent className="w-5 h-5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-semibold">{log.action}</h3>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {log.timestamp}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span className="font-mono">User: {log.user}</span>
                        <span className="font-mono">IP: {log.ip}</span>
                        <span
                          className={`px-2 py-1 rounded text-xs font-mono ${
                            log.status === "success"
                              ? "bg-green-500/20 text-green-700"
                              : "bg-orange-500/20 text-orange-700"
                          }`}
                        >
                          {log.status === "success" ? "✓ Success" : "⚠ Warning"}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {filteredLogs.length} of {logs.length} entries
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="border-border hover:bg-accent/10">
                Previous
              </Button>
              <Button variant="outline" className="border-border hover:bg-accent/10">
                Next
              </Button>
            </div>
          </div>

          {/* Security alerts */}
          <Card className="mt-12 p-6 border border-orange-500/50 bg-orange-500/10">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-semibold mb-2">Security Alert</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  12 failed login attempts detected from IP 203.0.113.45 in the last hour. Consider adding this IP to the blocklist.
                </p>
                <div className="flex gap-2">
                  <Button className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 text-sm">
                    Block IP
                  </Button>
                  <Button variant="outline" className="border-orange-500/50 hover:bg-orange-500/10 px-4 py-2 text-sm">
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
