"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Users,
  Activity,
  ShieldAlert,
  Ban,
  Unlock,
  Trash2,
  RefreshCw,
  Search,
  Clock,
  Laptop,
  Smartphone,
  Eye,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
  Monitor,
  Calendar,
  X
} from "lucide-react";

interface OnlineUser {
  id: string;
  name: string;
  email: string;
  role: string;
  provider: string;
  isOnline: boolean;
  isBlocked: boolean;
  blockedReason?: string;
  blockedAt?: string | null;
  blockedBy?: string;
  currentPage?: string;
  lastActiveAt?: string | null;
  lastLoginIp?: string;
  loginCount: number;
  failedLoginCount: number;
  lastFailedLoginAt?: string | null;
  devicesCount: number;
  avatarUrl?: string;
  createdAt?: string;
}

interface AuditLogItem {
  id: string;
  eventType: string;
  page?: string;
  pageTitle?: string;
  dwellSeconds: number;
  ip?: string;
  userAgent?: string;
  status: string;
  reason?: string;
  timestamp: string;
}

interface UserDeviceItem {
  deviceId: string;
  hostname: string;
  platform: string;
  status: string;
  lastSeen?: string;
  publicIp?: string;
  localIp?: string;
  battery?: number | null;
  storage?: number | null;
  osVersion?: string;
  cpu?: string;
  ram?: number | null;
}

interface UserAuditData {
  user: OnlineUser & {
    loginSuccessCount: number;
    loginFailureCount: number;
    totalDwellSeconds: number;
  };
  logs: AuditLogItem[];
  devices: UserDeviceItem[];
}

export default function AdminOnlineUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "blocked" | "offline">("all");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Deep Dive Modal State
  const [selectedUser, setSelectedUser] = useState<OnlineUser | null>(null);
  const [auditData, setAuditData] = useState<UserAuditData | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [activeTab, setActiveTab] = useState<"security" | "navigation" | "devices">("security");

  // Block Modal State
  const [userToBlock, setUserToBlock] = useState<OnlineUser | null>(null);
  const [blockReason, setBlockReason] = useState("Violation of system security policy");
  const [blockingInProgress, setBlockingInProgress] = useState(false);

  // Action feedback
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const loadData = async (isBackground = false) => {
    if (!isBackground) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/online-users", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.replace("/dashboard");
          return;
        }
        setActionError(data.message || "Failed to load live users");
        return;
      }
      setUsers(data.users || []);
      setOnlineCount(data.onlineCount || 0);
      setBlockedCount(data.blockedCount || 0);
      setTotalUsers(data.totalUsers || 0);
    } catch (err: unknown) {
      if (!isBackground) {
        setActionError(err instanceof Error ? err.message : "Network error while fetching live users");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
    let timer: NodeJS.Timeout;
    if (autoRefresh) {
      timer = setInterval(() => {
        void loadData(true);
      }, 10000);
    }
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const openAuditModal = async (u: OnlineUser) => {
    setSelectedUser(u);
    setLoadingAudit(true);
    setAuditData(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/audit`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        setAuditData(data);
      } else {
        setActionError(data.message || "Could not fetch user audit data");
      }
    } catch (_) {
      setActionError("Error fetching audit details");
    } finally {
      setLoadingAudit(false);
    }
  };

  const handleBlockUser = async () => {
    if (!userToBlock) return;
    setBlockingInProgress(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/admin/users/${userToBlock.id}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: blockReason }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(`User ${userToBlock.email} has been blocked & all sessions terminated!`);
        setUserToBlock(null);
        await loadData(true);
        if (selectedUser?.id === userToBlock.id) {
          void openAuditModal(userToBlock);
        }
      } else {
        setActionError(data.message || "Failed to block user");
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Error blocking user");
    } finally {
      setBlockingInProgress(false);
    }
  };

  const handleUnblockUser = async (u: OnlineUser) => {
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/admin/users/${u.id}/unblock`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(`User ${u.email} has been unblocked! They can now log in.`);
        await loadData(true);
        if (selectedUser?.id === u.id) {
          void openAuditModal(u);
        }
      } else {
        setActionError(data.message || "Failed to unblock user");
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Error unblocking user");
    }
  };

  const handleDeleteUser = async (u: OnlineUser) => {
    if (!confirm(`Are you sure you want to permanently delete user ${u.email}? This action cannot be undone.`)) {
      return;
    }
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(`User ${u.email} was permanently deleted.`);
        if (selectedUser?.id === u.id) {
          setSelectedUser(null);
        }
        await loadData(true);
      } else {
        setActionError(data.message || "Failed to delete user");
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Error deleting user");
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return "0s";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const rem = seconds % 60;
    if (mins < 60) return `${mins}m ${rem}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (statusFilter === "online" && !u.isOnline) return false;
      if (statusFilter === "blocked" && !u.isBlocked) return false;
      if (statusFilter === "offline" && (u.isOnline || u.isBlocked)) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.currentPage || "").toLowerCase().includes(q) ||
        (u.lastLoginIp || "").toLowerCase().includes(q)
      );
    });
  }, [users, statusFilter, searchQuery]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar />

      <main className="flex-1 p-6 md:p-8 space-y-6 max-w-7xl mx-auto overflow-y-auto">
        {/* Top Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Activity className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Live Online & Security Audit</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Real-time web user monitoring, immediate session blocking, dwell time analytics, and device inspection.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={autoRefresh ? "border-emerald-500/40 text-emerald-400" : ""}
            >
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              {autoRefresh ? "Auto-refresh: ON" : "Auto-refresh: OFF"}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={refreshing}
              onClick={() => void loadData()}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Notifications */}
        {actionSuccess && (
          <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              {actionSuccess}
            </div>
            <button onClick={() => setActionSuccess("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {actionError && (
          <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              {actionError}
            </div>
            <button onClick={() => setActionError("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-5 border-border bg-card/40 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Online Now (Web)</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <h2 className="text-3xl font-extrabold text-emerald-400">{onlineCount}</h2>
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                </div>
              </div>
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                <Globe className="h-6 w-6" />
              </div>
            </div>
          </Card>

          <Card className="p-5 border-border bg-card/40 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Blocked Accounts</p>
                <h2 className="text-3xl font-extrabold text-rose-400 mt-2">{blockedCount}</h2>
              </div>
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400">
                <Ban className="h-6 w-6" />
              </div>
            </div>
          </Card>

          <Card className="p-5 border-border bg-card/40 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Total Users</p>
                <h2 className="text-3xl font-extrabold text-foreground mt-2">{totalUsers}</h2>
              </div>
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl text-primary">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </Card>

          <Card className="p-5 border-border bg-card/40 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Security Shield</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 font-mono text-xs">
                    ACTIVE SESSIONS VERIFIED
                  </Badge>
                </div>
              </div>
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
                <ShieldAlert className="h-6 w-6" />
              </div>
            </div>
          </Card>
        </div>

        {/* Filter Bar */}
        <Card className="p-4 border-border bg-card/30 backdrop-blur">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search user name, email, active page, or IP..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm bg-background/50"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
              <Button
                variant={statusFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("all")}
                className="h-8 text-xs"
              >
                All ({users.length})
              </Button>
              <Button
                variant={statusFilter === "online" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("online")}
                className={`h-8 text-xs ${statusFilter === "online" ? "text-emerald-400" : ""}`}
              >
                Online ({onlineCount})
              </Button>
              <Button
                variant={statusFilter === "blocked" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("blocked")}
                className={`h-8 text-xs ${statusFilter === "blocked" ? "text-rose-400" : ""}`}
              >
                Blocked ({blockedCount})
              </Button>
              <Button
                variant={statusFilter === "offline" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("offline")}
                className="h-8 text-xs text-muted-foreground"
              >
                Offline ({users.length - onlineCount - blockedCount})
              </Button>
            </div>
          </div>
        </Card>

        {/* Users Table */}
        <Card className="border-border bg-card/40 backdrop-blur overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="py-3.5 px-4 font-semibold">User / Identity</th>
                  <th className="py-3.5 px-4 font-semibold">Live Presence</th>
                  <th className="py-3.5 px-4 font-semibold">Active Web Page</th>
                  <th className="py-3.5 px-4 font-semibold">IP & Last Active</th>
                  <th className="py-3.5 px-4 font-semibold">Logins & Fails</th>
                  <th className="py-3.5 px-4 font-semibold">Devices</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7} className="p-4">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No matching users found.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                      {/* Identity */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-bold text-xs uppercase text-primary">
                            {u.name ? u.name.slice(0, 2) : "US"}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground flex items-center gap-1.5">
                              {u.name}
                              {u.role === "admin" && (
                                <Badge variant="outline" className="border-purple-500/40 text-purple-400 text-[10px] px-1.5 py-0">
                                  ADMIN
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Presence Status */}
                      <td className="py-3 px-4">
                        {u.isBlocked ? (
                          <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-400 text-xs flex items-center gap-1 w-fit">
                            <Ban className="h-3 w-3" />
                            BLOCKED
                          </Badge>
                        ) : u.isOnline ? (
                          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs flex items-center gap-1 w-fit">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            ONLINE NOW
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-border text-muted-foreground text-xs flex items-center gap-1 w-fit">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"></span>
                            OFFLINE
                          </Badge>
                        )}
                      </td>

                      {/* Current Page */}
                      <td className="py-3 px-4">
                        {u.isOnline && u.currentPage ? (
                          <div className="flex items-center gap-1.5">
                            <Monitor className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="font-mono text-xs text-foreground font-medium bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                              {u.currentPage}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* IP & Last Active */}
                      <td className="py-3 px-4">
                        <div className="text-xs font-mono text-foreground">{u.lastLoginIp || "Unknown IP"}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleTimeString() : "Never"}
                        </div>
                      </td>

                      {/* Login Stats */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-400 font-mono font-medium" title="Successful Logins">
                            ✓ {u.loginCount || 0}
                          </span>
                          {u.failedLoginCount > 0 ? (
                            <span className="text-rose-400 font-mono font-bold bg-rose-500/10 border border-rose-500/20 px-1.5 rounded" title="Failed Logins">
                              ✕ {u.failedLoginCount}
                            </span>
                          ) : (
                            <span className="text-muted-foreground font-mono">✕ 0</span>
                          )}
                        </div>
                      </td>

                      {/* Devices Count */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                          <Laptop className="h-3.5 w-3.5 text-primary" />
                          <span className="font-semibold text-foreground">{u.devicesCount}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void openAuditModal(u)}
                            className="h-7 text-xs px-2.5"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Inspect
                          </Button>

                          {u.isBlocked ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleUnblockUser(u)}
                              className="h-7 text-xs px-2.5 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                            >
                              <Unlock className="h-3.5 w-3.5 mr-1" />
                              Unblock
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setUserToBlock(u);
                                setBlockReason("Violation of security policy");
                              }}
                              className="h-7 text-xs px-2.5 border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                            >
                              <Ban className="h-3.5 w-3.5 mr-1" />
                              Block
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDeleteUser(u)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-400"
                            title="Delete User"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* User Block Confirmation Modal */}
        {userToBlock && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-rose-500/30 bg-card p-6 space-y-4 shadow-2xl animate-in fade-in-50 zoom-in-95">
              <div className="flex items-center gap-3 text-rose-400">
                <div className="p-2.5 rounded-full bg-rose-500/10 border border-rose-500/30">
                  <ShieldAlert className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-foreground">Block & Terminate User</h3>
                  <p className="text-xs text-muted-foreground">{userToBlock.email}</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Blocking will immediately terminate all active WebSockets, invalidate existing browser session cookies, and forbid this user from logging in until unblocked.
              </p>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reason for Blocking:
                </label>
                <Input
                  className="mt-1.5 text-sm"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="e.g. Unauthorized access, account compromised..."
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setUserToBlock(null)}
                  disabled={blockingInProgress}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleBlockUser()}
                  disabled={blockingInProgress || !blockReason.trim()}
                >
                  {blockingInProgress ? "Blocking..." : "Confirm Block & Kick"}
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Detailed User Audit Inspection Drawer / Modal */}
        {selectedUser && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-8">
            <Card className="w-full max-w-4xl h-[85vh] border-border bg-card flex flex-col shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className="p-5 border-b border-border flex items-center justify-between bg-muted/20">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-bold text-sm uppercase text-primary">
                    {selectedUser.name ? selectedUser.name.slice(0, 2) : "US"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-foreground">{selectedUser.name}</h2>
                      {selectedUser.isBlocked ? (
                        <Badge variant="outline" className="border-rose-500/40 text-rose-400 text-xs">
                          BLOCKED
                        </Badge>
                      ) : selectedUser.isOnline ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs">
                          ● ONLINE
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-border text-muted-foreground text-xs">
                          OFFLINE
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{selectedUser.email}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedUser.isBlocked ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleUnblockUser(selectedUser)}
                      className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs"
                    >
                      <Unlock className="h-3.5 w-3.5 mr-1" />
                      Unblock
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setUserToBlock(selectedUser);
                        setBlockReason("Security audit lock");
                      }}
                      className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-xs"
                    >
                      <Ban className="h-3.5 w-3.5 mr-1" />
                      Block User
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedUser(null)}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Modal Tabs */}
              <div className="flex border-b border-border bg-muted/10 px-5 gap-4 text-xs font-semibold">
                <button
                  onClick={() => setActiveTab("security")}
                  className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
                    activeTab === "security"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ShieldAlert className="h-4 w-4" />
                  Security & Logins
                </button>
                <button
                  onClick={() => setActiveTab("navigation")}
                  className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
                    activeTab === "navigation"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Monitor className="h-4 w-4" />
                  Page Navigation & Dwell Time
                </button>
                <button
                  onClick={() => setActiveTab("devices")}
                  className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
                    activeTab === "devices"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Laptop className="h-4 w-4" />
                  User's Devices ({auditData?.devices?.length || 0})
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 p-6 overflow-y-auto space-y-4">
                {loadingAudit ? (
                  <div className="space-y-4 py-8">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                ) : !auditData ? (
                  <div className="py-12 text-center text-muted-foreground">
                    Unable to load audit logs.
                  </div>
                ) : (
                  <>
                    {/* Tab 1: Security & Logins */}
                    {activeTab === "security" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Card className="p-3 border-border bg-card/60">
                            <p className="text-xs text-muted-foreground">Total Successful Logins</p>
                            <p className="text-2xl font-bold text-emerald-400 mt-1">
                              {auditData.user.loginSuccessCount || selectedUser.loginCount || 0}
                            </p>
                          </Card>
                          <Card className="p-3 border-border bg-card/60">
                            <p className="text-xs text-muted-foreground">Failed Login Attempts</p>
                            <p className="text-2xl font-bold text-rose-400 mt-1">
                              {auditData.user.loginFailureCount || selectedUser.failedLoginCount || 0}
                            </p>
                          </Card>
                          <Card className="p-3 border-border bg-card/60">
                            <p className="text-xs text-muted-foreground">Total Web Time</p>
                            <p className="text-2xl font-bold text-primary mt-1">
                              {formatDuration(auditData.user.totalDwellSeconds)}
                            </p>
                          </Card>
                        </div>

                        {selectedUser.isBlocked && (
                          <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">
                            <strong>Account Blocked Reason:</strong> {selectedUser.blockedReason || "Policy violation"}
                            {selectedUser.blockedAt && ` • on ${new Date(selectedUser.blockedAt).toLocaleString()}`}
                            {selectedUser.blockedBy && ` • by ${selectedUser.blockedBy}`}
                          </div>
                        )}

                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">
                          Authentication Events History
                        </h4>

                        <div className="border border-border rounded-lg overflow-hidden divide-y divide-border/60">
                          {auditData.logs
                            .filter((l) => l.eventType.startsWith("login_") || l.eventType.startsWith("account_"))
                            .length === 0 ? (
                            <div className="p-4 text-xs text-muted-foreground text-center">
                              No authentication events recorded yet.
                            </div>
                          ) : (
                            auditData.logs
                              .filter((l) => l.eventType.startsWith("login_") || l.eventType.startsWith("account_"))
                              .map((l) => (
                                <div key={l.id} className="p-3 flex items-center justify-between text-xs hover:bg-muted/10">
                                  <div className="flex items-center gap-2.5">
                                    {l.eventType === "login_success" ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                    ) : l.eventType === "login_failure" ? (
                                      <XCircle className="h-4 w-4 text-rose-400" />
                                    ) : (
                                      <ShieldAlert className="h-4 w-4 text-amber-400" />
                                    )}
                                    <div>
                                      <div className="font-semibold text-foreground capitalize">
                                        {l.eventType.replace("_", " ")}
                                      </div>
                                      <div className="text-muted-foreground text-[11px]">
                                        {l.reason || "Standard authentication event"} • IP: {l.ip || "unknown"}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-right text-muted-foreground font-mono text-[11px]">
                                    {new Date(l.timestamp).toLocaleString()}
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tab 2: Navigation & Dwell Time */}
                    {activeTab === "navigation" && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Page Visits & Time Spent
                          </h4>
                          <span className="text-xs font-mono text-primary">
                            Total Web Dwell: {formatDuration(auditData.user.totalDwellSeconds)}
                          </span>
                        </div>

                        <div className="border border-border rounded-lg overflow-hidden divide-y divide-border/60">
                          {auditData.logs
                            .filter((l) => l.eventType === "page_dwell" || l.eventType === "page_visit")
                            .length === 0 ? (
                            <div className="p-6 text-center text-xs text-muted-foreground">
                              No navigation history recorded for this user yet. Dwell tracking records activity as the user navigates pages.
                            </div>
                          ) : (
                            auditData.logs
                              .filter((l) => l.eventType === "page_dwell" || l.eventType === "page_visit")
                              .map((l) => (
                                <div key={l.id} className="p-3 flex items-center justify-between text-xs hover:bg-muted/10">
                                  <div className="flex items-center gap-2.5">
                                    <Monitor className="h-4 w-4 text-primary" />
                                    <div>
                                      <div className="font-semibold font-mono text-foreground">{l.page}</div>
                                      <div className="text-muted-foreground text-[11px]">
                                        {l.pageTitle || "Application Page"} • IP: {l.ip || "unknown"}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <Badge variant="outline" className="border-primary/30 text-primary font-mono text-[11px]">
                                      ⏱ {formatDuration(l.dwellSeconds)}
                                    </Badge>
                                    <div className="text-[10px] text-muted-foreground font-mono mt-1">
                                      {new Date(l.timestamp).toLocaleTimeString()}
                                    </div>
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tab 3: Devices Data */}
                    {activeTab === "devices" && (
                      <div className="space-y-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Paired Devices for {selectedUser.email}
                        </h4>

                        {auditData.devices.length === 0 ? (
                          <div className="p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
                            No devices paired with this user account.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {auditData.devices.map((d) => (
                              <Card key={d.deviceId} className="p-4 border-border bg-card/60 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {d.platform === "android" ? (
                                      <Smartphone className="h-4 w-4 text-emerald-400" />
                                    ) : (
                                      <Laptop className="h-4 w-4 text-primary" />
                                    )}
                                    <span className="font-semibold text-sm text-foreground">{d.hostname}</span>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${
                                      d.status === "online"
                                        ? "border-emerald-500/40 text-emerald-400"
                                        : "border-border text-muted-foreground"
                                    }`}
                                  >
                                    {d.status.toUpperCase()}
                                  </Badge>
                                </div>

                                <div className="text-xs font-mono text-muted-foreground space-y-1">
                                  <div>
                                    <span className="text-foreground">Device ID:</span> {d.deviceId}
                                  </div>
                                  <div>
                                    <span className="text-foreground">Platform:</span> {d.platform} {d.osVersion ? `(${d.osVersion})` : ""}
                                  </div>
                                  <div>
                                    <span className="text-foreground">Public IP:</span> {d.publicIp || d.localIp || "N/A"}
                                  </div>
                                  {d.battery !== null && d.battery !== undefined && (
                                    <div>
                                      <span className="text-foreground">Battery:</span> {d.battery}%
                                    </div>
                                  )}
                                  {d.lastSeen && (
                                    <div className="text-[11px] text-muted-foreground/80 pt-1">
                                      Last seen: {new Date(d.lastSeen).toLocaleString()}
                                    </div>
                                  )}
                                </div>
                              </Card>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
