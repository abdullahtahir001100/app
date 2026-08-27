"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertCircle, Shield, Lock, Key, Eye, Trash2, Plus, MoreVertical, CheckCircle, AlertTriangle } from "lucide-react";
import { useState } from "react";

export default function AdminSecurityPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const securityAlerts = [
    {
      id: 1,
      level: "critical",
      title: "Failed Login Attempts",
      description: "12 failed attempts detected from IP 203.0.113.45",
      time: "30 mins ago",
    },
    {
      id: 2,
      level: "warning",
      title: "Unusual Activity",
      description: "User uploaded 500 files in 5 minutes",
      time: "2 hours ago",
    },
    {
      id: 3,
      level: "info",
      title: "New Admin Created",
      description: "User carol.williams granted admin privileges",
      time: "1 day ago",
    },
  ];

  const blockedIPs = [
    { ip: "203.0.113.45", reason: "Multiple failed logins", date: "2 hours ago" },
    { ip: "198.51.100.89", reason: "Suspicious activity", date: "1 day ago" },
    { ip: "192.0.2.15", reason: "Brute force attempt", date: "3 days ago" },
  ];

  const apiKeys = [
    {
      name: "Device API",
      key: "sk_live_abcd1234****",
      status: "active",
      created: "30 days ago",
      lastUsed: "5 mins ago",
    },
    {
      name: "Admin Panel",
      key: "sk_live_efgh5678****",
      status: "active",
      created: "60 days ago",
      lastUsed: "1 hour ago",
    },
    {
      name: "Legacy Integration",
      key: "sk_live_ijkl9012****",
      status: "inactive",
      created: "6 months ago",
      lastUsed: "Never",
    },
  ];

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 sidebar-aware-main overflow-auto">
        <div className="p-6 lg:p-12">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">Security Center</h1>
            <p className="text-muted-foreground">Manage security settings and access control</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 mb-8 border-b border-border">
            {[
              { id: "overview", label: "Overview" },
              { id: "alerts", label: "Security Alerts" },
              { id: "blocklist", label: "IP Blocklist" },
              { id: "apikeys", label: "API Keys" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 font-semibold text-sm border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="space-y-8">
              {/* Security score */}
              <Card className="p-8 border border-border bg-card">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-display mb-2">Security Score</h2>
                    <p className="text-muted-foreground">Overall system security health</p>
                  </div>
                  <Shield className="w-12 h-12 text-green-600 opacity-30" />
                </div>

                <div className="flex items-end gap-8">
                  <div>
                    <p className="text-6xl font-display text-green-600">95</p>
                    <p className="text-sm text-muted-foreground mt-1">out of 100</p>
                  </div>

                  <div className="flex-1 space-y-3 mb-2">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Encryption</span>
                        <span className="text-green-600">✓</span>
                      </div>
                      <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-green-600" style={{ width: "100%" }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>2FA Adoption</span>
                        <span className="text-green-600">✓</span>
                      </div>
                      <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-green-600" style={{ width: "87%" }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Password Policy</span>
                        <span className="text-orange-600">⚠</span>
                      </div>
                      <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-orange-600" style={{ width: "65%" }} />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Recent security alerts */}
              <div>
                <h2 className="text-xl font-display mb-4">Recent Security Events</h2>
                <div className="space-y-3">
                  {securityAlerts.slice(0, 2).map((alert) => (
                    <Card
                      key={alert.id}
                      className={`p-4 border ${
                        alert.level === "critical"
                          ? "border-red-500/50 bg-red-500/10"
                          : alert.level === "warning"
                          ? "border-orange-500/50 bg-orange-500/10"
                          : "border-blue-500/50 bg-blue-500/10"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {alert.level === "critical" && (
                          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        )}
                        {alert.level === "warning" && (
                          <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                        )}
                        {alert.level === "info" && (
                          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <h3 className="font-semibold">{alert.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
                          <p className="text-xs text-muted-foreground mt-2">{alert.time}</p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Alerts Tab */}
          {activeTab === "alerts" && (
            <div className="space-y-4">
              {securityAlerts.map((alert) => (
                <Card
                  key={alert.id}
                  className={`p-4 border ${
                    alert.level === "critical"
                      ? "border-red-500/50 bg-red-500/10"
                      : alert.level === "warning"
                      ? "border-orange-500/50 bg-orange-500/10"
                      : "border-blue-500/50 bg-blue-500/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold">{alert.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
                      <p className="text-xs text-muted-foreground mt-2">{alert.time}</p>
                    </div>
                    <Button variant="outline" className="border-border whitespace-nowrap">
                      Review
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Blocklist Tab */}
          {activeTab === "blocklist" && (
            <div className="space-y-4">
              <div className="flex justify-end mb-4">
                <Button className="bg-foreground hover:bg-foreground/90 text-background gap-2">
                  <Plus className="w-4 h-4" />
                  Add IP
                </Button>
              </div>

              <div className="space-y-3">
                {blockedIPs.map((item, index) => (
                  <Card key={index} className="p-4 border border-border bg-card">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-mono font-semibold">{item.ip}</p>
                        <p className="text-sm text-muted-foreground mt-1">{item.reason}</p>
                        <p className="text-xs text-muted-foreground mt-1">Blocked {item.date}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="border-border hover:bg-accent/10" size="sm">
                          Unblock
                        </Button>
                        <button className="p-2 hover:bg-red-500/10 rounded transition-colors">
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* API Keys Tab */}
          {activeTab === "apikeys" && (
            <div className="space-y-4">
              <div className="flex justify-end mb-4">
                <Button className="bg-foreground hover:bg-foreground/90 text-background gap-2">
                  <Plus className="w-4 h-4" />
                  Generate Key
                </Button>
              </div>

              <div className="space-y-3">
                {apiKeys.map((key, index) => (
                  <Card key={index} className="p-4 border border-border bg-card">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold">{key.name}</h3>
                          <div
                            className={`text-xs font-mono px-2 py-1 rounded ${
                              key.status === "active"
                                ? "bg-green-500/20 text-green-700"
                                : "bg-gray-500/20 text-gray-700"
                            }`}
                          >
                            {key.status}
                          </div>
                        </div>
                        <p className="font-mono text-sm text-muted-foreground mb-2">{key.key}</p>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span>Created: {key.created}</span>
                          <span>Last used: {key.lastUsed}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className="p-2 hover:bg-accent/10 rounded transition-colors" title="Copy">
                          <Key className="w-4 h-4" />
                        </button>
                        <button className="p-2 hover:bg-orange-500/10 rounded transition-colors" title="Rotate">
                          <AlertCircle className="w-4 h-4 text-orange-600" />
                        </button>
                        <button className="p-2 hover:bg-red-500/10 rounded transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
