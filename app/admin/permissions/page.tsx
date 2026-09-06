"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Users, RefreshCw, CheckCircle2, ShieldCheck, Zap } from "lucide-react";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  pages?: string[];
};

const PERMISSION_GROUPS = [
  {
    id: "core",
    title: "Core Pages (Always Free)",
    badge: "Free Default",
    badgeColor: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    description: "Basic capabilities available out-of-the-box to every regular registered user account.",
    keys: ["dashboard", "devices", "settings"],
  },
  {
    id: "logs",
    title: "Activity Logs & Granular Tabs",
    badge: "Granular Add-ons",
    badgeColor: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    description: "Grant full activity logs access or individual sub-tabs (e.g. Browser Data only). If only 'logs.browser' is checked, user sees ONLY browser history while other tabs stay locked.",
    keys: ["logs", "logs.browser", "logs.activity", "logs.apps", "logs.usage"],
  },
  {
    id: "phone",
    title: "Phone Suite & Granular Tabs",
    badge: "Granular Add-ons",
    badgeColor: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    description: "Grant full mobile phone suite access or individual sub-tabs (Calls, SMS, Contacts, or Remote Lock) as add-on purchases.",
    keys: ["phone", "phone.calls", "phone.sms", "phone.contacts", "phone.lock"],
  },
  {
    id: "settings_tabs",
    title: "Settings Suite Granular Tabs",
    badge: "Premium Add-ons",
    badgeColor: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
    description: "Grant access to custom database integration, Cloudinary media storage, AI copilot keys, and advanced security.",
    keys: ["settings.custom_db", "settings.cloudinary", "settings.ai", "settings.security"],
  },
  {
    id: "usage_tabs",
    title: "Usage Metrics & 3D Engine Tabs",
    badge: "Granular Add-ons",
    badgeColor: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
    description: "Grant access to live usage telemetry charts or interactive 3D matrix visualization.",
    keys: ["usage", "usage.charts", "usage.3d"],
  },
  {
    id: "apps_tabs",
    title: "App Suite & Live Screen Tabs",
    badge: "Granular Add-ons",
    badgeColor: "bg-violet-500/10 text-violet-600 border-violet-500/20",
    description: "Grant access to remote application push installer or live application screen streaming.",
    keys: ["apps", "apps.installer", "apps.screen"],
  },
  {
    id: "premium",
    title: "Premium Pro Tools",
    badge: "PRO Upgrade",
    badgeColor: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    description: "High-tier monitoring and live execution tools gated behind premium subscriptions.",
    keys: [
      "camera",
      "screen",
      "files",
      "shell",
      "ops",
      "fleet",
      "cockpit",
      "notifications",
      "console",
      "architecture",
    ],
  },
  {
    id: "admin",
    title: "System Administration",
    badge: "Master Only",
    badgeColor: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    description: "Administrative console access and cross-user device oversight. Strict master DB verification applies.",
    keys: ["admin", "devices.any"],
  },
];

export default function AdminPermissionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pageKeys, setPageKeys] = useState<string[]>([]);
  const [pageLabels, setPageLabels] = useState<Record<string, string>>({});
  const [selectedUserId, setSelectedUserId] = useState(searchParams.get("userId") || "");
  const [pages, setPages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const selected = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  useEffect(() => {
    (async () => {
      try {
        const session = await fetch("/api/auth/session", { credentials: "include" });
        const sessionData = await session.json().catch(() => ({}));
        const canAdmin =
          sessionData?.user?.role === "admin" ||
          (Array.isArray(sessionData?.user?.pages) && sessionData.user.pages.includes("admin"));

        if (!session.ok || !canAdmin) {
          router.replace("/dashboard");
          return;
        }

        const res = await fetch("/api/admin/users", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) return;

        setUsers(data.users || []);
        setPageKeys(data.pageKeys || []);
        setPageLabels(data.pageLabels || {});
        const initial = searchParams.get("userId") || data.users?.[0]?.id || "";
        setSelectedUserId(initial);
        const u = (data.users || []).find((x: AdminUser) => x.id === initial);
        setPages(u?.pages || []);
      } catch (error) {
        console.error("Failed to load permissions", error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [router, searchParams]);

  useEffect(() => {
    const u = users.find((x) => x.id === selectedUserId);
    setPages(u?.pages || []);
  }, [selectedUserId, users]);

  const toggle = (key: string) => {
    setPages((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  };

  const toggleGroup = (keys: string[]) => {
    const allChecked = keys.every((k) => pages.includes(k));
    if (allChecked) {
      setPages((prev) => prev.filter((p) => !keys.includes(p)));
    } else {
      setPages((prev) => [...new Set([...prev, ...keys])]);
    }
  };

  const save = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/permissions/${selectedUserId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.message || "Save failed");
        return;
      }
      setMessage("Permissions saved");
      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUserId ? { ...u, pages: data.pages } : u))
      );
    } finally {
      setSaving(false);
    }
  };

  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");

  const bulkGrantProAll = async () => {
    if (!confirm("Are you sure you want to grant ALL PRO capabilities to ALL registered users in 1 click?")) return;
    setBulkLoading(true);
    setBulkMessage("");
    try {
      const res = await fetch("/api/admin/permissions/bulk-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ grantAllPro: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkMessage(data.message || "Bulk grant failed");
        return;
      }
      setBulkMessage(data.message || "Granted to all users!");
      const uRes = await fetch("/api/admin/users", { credentials: "include" });
      const uData = await uRes.json();
      if (uData.users) setUsers(uData.users);
    } catch (e: any) {
      setBulkMessage(e.message || "Error performing bulk grant");
    } finally {
      setBulkLoading(false);
    }
  };

  const bulkGrantSelectedAll = async () => {
    if (pages.length === 0) {
      alert("No features selected. Please select features first.");
      return;
    }
    if (!confirm(`Are you sure you want to grant these ${pages.length} selected capabilities to ALL registered users in 1 click?`)) return;
    setBulkLoading(true);
    setBulkMessage("");
    try {
      const res = await fetch("/api/admin/permissions/bulk-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkMessage(data.message || "Bulk grant failed");
        return;
      }
      setBulkMessage(data.message || "Granted selected features to all users!");
      const uRes = await fetch("/api/admin/users", { credentials: "include" });
      const uData = await uRes.json();
      if (uData.users) setUsers(uData.users);
    } catch (e: any) {
      setBulkMessage(e.message || "Error performing bulk grant");
    } finally {
      setBulkLoading(false);
    }
  };

  const bulkResetAll = async () => {
    if (!confirm("Are you sure you want to reset ALL users back to Free Default tier in 1 click?")) return;
    setBulkLoading(true);
    setBulkMessage("");
    try {
      const res = await fetch("/api/admin/permissions/bulk-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkMessage(data.message || "Bulk reset failed");
        return;
      }
      setBulkMessage(data.message || "Reset all users to Free default!");
      const uRes = await fetch("/api/admin/users", { credentials: "include" });
      const uData = await uRes.json();
      if (uData.users) setUsers(uData.users);
      setPages(["dashboard", "devices", "settings"]);
    } catch (e: any) {
      setBulkMessage(e.message || "Error performing bulk reset");
    } finally {
      setBulkLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto sidebar-aware-main p-6">
          <Skeleton className="h-8 w-40 mb-2" />
          <Skeleton className="h-4 w-96 mb-6" />

          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <Card className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="rounded-md px-3 py-2">
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-3 w-36" />
                </div>
              ))}
            </Card>

            <Card className="p-5">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-3 w-56 mb-4" />
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-11 w-full rounded-md" />
                ))}
              </div>
              <Skeleton className="h-10 w-36 mt-6 rounded-lg" />
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto sidebar-aware-main p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-display tracking-tight mb-1">Permissions & Subscriptions</h1>
            <p className="text-sm text-muted-foreground">
              Grant full page permissions or granular tab add-ons. Admin can also grant permissions to ALL users in 1 click.
            </p>
          </div>
        </div>

        {/* 1-Click Global Operations Banner */}
        <Card className="mb-6 p-4 border border-primary/20 bg-gradient-to-r from-primary/5 via-card to-primary/5 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-sm tracking-tight text-foreground">1-Click Bulk Permissions (All Users)</h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-bold">
                    GLOBAL OVERRIDE
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Execute single-click capability grants or resets across the entire user base simultaneously.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {bulkMessage && (
                <span className="text-xs font-mono font-medium text-emerald-600 animate-in fade-in flex items-center gap-1.5 mr-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {bulkMessage}
                </span>
              )}
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void bulkGrantProAll()}
                disabled={bulkLoading}
                className="h-8 text-xs font-semibold gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-sm"
              >
                <Zap className="w-3.5 h-3.5" />
                {bulkLoading ? "Applying..." : "Grant ALL PRO to All Users"}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void bulkGrantSelectedAll()}
                disabled={bulkLoading || pages.length === 0}
                className="h-8 text-xs font-medium gap-1.5 border-primary/30 hover:bg-primary/10 text-primary"
              >
                <Users className="w-3.5 h-3.5" />
                Grant Selection to All ({pages.length})
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void bulkResetAll()}
                disabled={bulkLoading}
                className="h-8 text-xs font-medium gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reset All to Free
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* User List */}
          <Card className="p-3 space-y-1 max-h-[80vh] overflow-y-auto">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Users ({users.length})
            </div>
            {users.map((user) => (
              <button
                key={user.id}
                onClick={() => setSelectedUserId(user.id)}
                className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  selectedUserId === user.id
                    ? "bg-primary/10 border border-primary/20 text-primary font-medium"
                    : "hover:bg-muted/50 border border-transparent"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium truncate">{user.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-mono font-bold ${
                      user.role === "admin"
                        ? "bg-rose-500/15 text-rose-600"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {user.role}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
                <div className="text-[10px] text-muted-foreground/80 mt-1">
                  {(user.pages || []).length} features enabled
                </div>
              </button>
            ))}
          </Card>

          {/* Permissions Matrix */}
          <div className="space-y-6">
            {selected ? (
              <>
                <Card className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-lg">{selected.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {selected.email} · Provider: <span className="font-mono font-medium">{selected.provider || "local"}</span> · Role:{" "}
                        <span className="font-mono font-semibold uppercase">{selected.role}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-border">
                        {pages.length} / {pageKeys.length} enabled
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPages(["dashboard", "devices", "settings"])}
                        className="text-xs h-8 px-2.5"
                      >
                        Reset Free Default
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPages([...pageKeys])}
                        className="text-xs h-8 px-2.5"
                      >
                        Select All
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPages([])}
                        className="text-xs h-8 px-2.5"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </Card>

                {/* Grouped Permissions Cards */}
                {PERMISSION_GROUPS.map((group) => {
                  const availableKeys = group.keys.filter((k) => pageKeys.includes(k));
                  if (availableKeys.length === 0) return null;
                  const allActive = availableKeys.every((k) => pages.includes(k));
                  const activeCount = availableKeys.filter((k) => pages.includes(k)).length;

                  return (
                    <Card key={group.id} className="p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <h3 className="font-semibold text-base">{group.title}</h3>
                            <span
                              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${group.badgeColor}`}
                            >
                              {group.badge}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
                        </div>

                        <div className="flex items-center gap-2 self-start sm:self-auto">
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {activeCount} / {availableKeys.length} active
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleGroup(availableKeys)}
                            className="text-xs h-7 px-2 text-primary"
                          >
                            {allActive ? "Deselect Group" : "Select Group"}
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {availableKeys.map((key) => {
                          const checked = pages.includes(key);
                          const isGranularTab = key.includes(".");
                          return (
                            <label
                              key={key}
                              className={`flex items-start gap-3 rounded-lg border p-3 transition-all cursor-pointer select-none ${
                                checked
                                  ? "border-primary/40 bg-primary/5 shadow-sm"
                                  : "border-border hover:border-border/80 hover:bg-muted/30"
                              } ${isGranularTab ? "ml-2 border-dashed" : ""}`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggle(key)}
                                className="mt-0.5"
                              />
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                                  {pageLabels[key] || key}
                                  {isGranularTab && (
                                    <span className="text-[9px] font-semibold uppercase px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-600">
                                      Tab
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono text-[10px] text-muted-foreground mt-0.5">
                                  {key}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}

                {/* Save Bar */}
                <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
                  <div className="text-xs text-muted-foreground">
                    Saving updates user session ACL immediately across all active WebSocket channels.
                  </div>
                  <div className="flex items-center gap-3">
                    {message && (
                      <span className="text-xs font-medium text-emerald-600 animate-in fade-in">
                        {message}
                      </span>
                    )}
                    <Button onClick={() => void save()} disabled={saving} className="px-5">
                      {saving ? "Saving Changes…" : "Save All Permissions"}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <Card className="p-8 text-center text-muted-foreground">
                Select a user from the left pane to manage their permissions.
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
