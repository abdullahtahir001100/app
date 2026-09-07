"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  AlertCircle, 
  Shield, 
  Lock, 
  Key, 
  Eye, 
  Trash2, 
  Plus, 
  MoreVertical, 
  CheckCircle, 
  AlertTriangle,
  Database,
  HardDrive,
  Cloud,
  Server,
  RefreshCw,
  Sliders,
  CheckCircle2,
  XCircle,
  X,
  Layers,
  Activity,
  Smartphone
} from "lucide-react";
import { alertMsg, Z } from "@/lib/messages";

interface AdminDbConfig {
  provider: string;
  mongodbUri?: string;
  mysqlHost?: string;
  mysqlPort?: string;
  mysqlDatabase?: string;
  mysqlUser?: string;
  mysqlPassword?: string;
  mysqlUri?: string;
}

interface AdminSyncSettings {
  syncToAdminDbEnabled: boolean;
  excludedDeviceIds: string[];
  adminDbProvider: string;
  adminDbConfig: AdminDbConfig;
  globalCloudinaryEnabled?: boolean;
}

interface UserStorageItem {
  userId: string;
  name: string;
  email: string;
  deviceCount: number;
  cloudinaryFiles: number;
  cloudinaryBytes: number;
  dbRecords: number;
}

interface DeviceStorageItem {
  deviceId: string;
  hostname: string;
  userId: string;
  userName: string;
  userEmail: string;
  platform: string;
  cloudinaryEnabled: boolean;
  cloudinaryFiles: number;
  cloudinaryBytes: number;
}

interface StorageLogItem {
  id: string;
  name: string;
  deviceId: string;
  size: number;
  mimeType: string;
  resourceType: string;
  createdAt: string;
}

interface StorageAnalyticsData {
  summary: {
    totalCloudinaryBytes: number;
    totalCloudinaryFiles: number;
    totalDbRecords: number;
    totalUsers: number;
    totalDevices: number;
  };
  userStorage: UserStorageItem[];
  deviceStorage: DeviceStorageItem[];
  recentLogs: StorageLogItem[];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function AdminSecurityPage() {
  const [activeTab, setActiveTab] = useState("overview");

  // Database Management & Sync state
  const [syncSettings, setSyncSettings] = useState<AdminSyncSettings>({
    syncToAdminDbEnabled: true,
    excludedDeviceIds: [],
    adminDbProvider: "mongo",
    adminDbConfig: {
      provider: "mongo",
      mongodbUri: "",
      mysqlHost: "127.0.0.1",
      mysqlPort: "3306",
      mysqlDatabase: "",
      mysqlUser: "root",
      mysqlPassword: "",
      mysqlUri: "",
    },
    globalCloudinaryEnabled: true,
  });
  const [loadingSync, setLoadingSync] = useState(false);
  const [savingSync, setSavingSync] = useState(false);
  const [testingDb, setTestingDb] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [newExcludedDevice, setNewExcludedDevice] = useState("");

  // Storage Analytics state
  const [storageData, setStorageData] = useState<StorageAnalyticsData | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(false);

  // Security Alerts & Blocklist mock/seed
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
      description: "High file transfer detected across 3 connected devices",
      time: "2 hours ago",
    },
    {
      id: 3,
      level: "info",
      title: "Master Database Replicated",
      description: "Admin sync policy verified active for all tenant devices",
      time: "1 day ago",
    },
  ];

  const blockedIPs = [
    { ip: "203.0.113.45", reason: "Multiple failed logins", date: "2 hours ago" },
    { ip: "198.51.100.89", reason: "Suspicious telemetry burst", date: "1 day ago" },
    { ip: "192.0.2.15", reason: "Brute force pin attempt", date: "3 days ago" },
  ];

  const apiKeys = [
    {
      name: "Device Agent Master Key",
      key: "sk_live_agent_master_****",
      status: "active",
      created: "12 days ago",
      lastUsed: "Just now",
    },
    {
      name: "Admin Panel API",
      key: "sk_live_admin_panel_****",
      status: "active",
      created: "30 days ago",
      lastUsed: "5 mins ago",
    },
    {
      name: "Cloudinary Webhook Secret",
      key: "sk_live_cld_webhook_****",
      status: "active",
      created: "60 days ago",
      lastUsed: "1 hour ago",
    },
  ];

  // Fetch Database Sync Settings
  const fetchSyncSettings = async () => {
    setLoadingSync(true);
    try {
      const res = await fetch("/api/admin/security/database-sync");
      const data = await res.json();
      if (res.ok && data.success && data.settings) {
        setSyncSettings(data.settings);
      }
    } catch (err) {
      console.error("Failed to load sync settings:", err);
    } finally {
      setLoadingSync(false);
    }
  };

  // Fetch Storage Analytics
  const fetchStorageAnalytics = async () => {
    setLoadingStorage(true);
    try {
      const res = await fetch("/api/admin/storage-analytics");
      const data = await res.json();
      if (res.ok && data.success) {
        setStorageData(data);
      }
    } catch (err) {
      console.error("Failed to load storage analytics:", err);
    } finally {
      setLoadingStorage(false);
    }
  };

  useEffect(() => {
    if (activeTab === "database") {
      fetchSyncSettings();
    } else if (activeTab === "storage") {
      fetchStorageAnalytics();
    }
  }, [activeTab]);

  // Handle Save Database Sync Settings
  const handleSaveSyncSettings = async () => {
    setSavingSync(true);
    try {
      const res = await fetch("/api/admin/security/database-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syncSettings),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSyncSettings(data.settings);
        alertMsg("Sync Settings Saved", data.message || "Database sync policy updated successfully.");
      } else {
        alertMsg(Z.COMMAND_FAILED, data.message || "Failed to update sync settings.");
      }
    } catch {
      alertMsg(Z.COMMAND_FAILED, "Network error updating sync settings.");
    } finally {
      setSavingSync(false);
    }
  };

  // Test Admin Master DB Connection
  const handleTestAdminDb = async () => {
    setTestingDb(true);
    setTestResult(null);
    try {
      const isSql = syncSettings.adminDbProvider === "mysql";
      const testConfig = isSql
        ? {
            host: syncSettings.adminDbConfig.mysqlHost,
            port: syncSettings.adminDbConfig.mysqlPort,
            database: syncSettings.adminDbConfig.mysqlDatabase,
            user: syncSettings.adminDbConfig.mysqlUser,
            password: syncSettings.adminDbConfig.mysqlPassword,
            uri: syncSettings.adminDbConfig.mysqlUri,
          }
        : {
            mongodbUri: syncSettings.adminDbConfig.mongodbUri,
          };

      const res = await fetch("/api/admin/security/test-admin-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: syncSettings.adminDbProvider,
          config: testConfig,
        }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        alertMsg("Database Test Successful", data.message || "Connected successfully!");
      } else {
        alertMsg(Z.COMMAND_FAILED, data.error || "Connection failed.");
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message || "Network error testing database." });
    } finally {
      setTestingDb(false);
    }
  };

  const handleAddExcludedDevice = () => {
    const clean = newExcludedDevice.trim();
    if (!clean) return;
    if (syncSettings.excludedDeviceIds.includes(clean)) {
      alertMsg("Device already in list", clean);
      return;
    }
    setSyncSettings((prev) => ({
      ...prev,
      excludedDeviceIds: [...prev.excludedDeviceIds, clean],
    }));
    setNewExcludedDevice("");
  };

  const handleRemoveExcludedDevice = (deviceId: string) => {
    setSyncSettings((prev) => ({
      ...prev,
      excludedDeviceIds: prev.excludedDeviceIds.filter((id) => id !== deviceId),
    }));
  };

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 sidebar-aware-main overflow-auto">
        <div className="p-6 lg:p-12">
          {/* Header */}
          <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">Security & Data Center</h1>
              <p className="text-muted-foreground">Manage Admin Master Database, dual-database sync, Cloudinary storage controls, and audit logs</p>
            </div>
            {activeTab === "storage" && (
              <Button
                variant="outline"
                size="sm"
                onClick={fetchStorageAnalytics}
                disabled={loadingStorage}
                className="gap-2 self-start"
              >
                <RefreshCw className={`w-4 h-4 ${loadingStorage ? "animate-spin" : ""}`} />
                Refresh Storage
              </Button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-2 md:gap-4 mb-8 border-b border-border overflow-x-auto pb-1">
            {[
              { id: "overview", label: "Overview", icon: Shield },
              { id: "database", label: "Database Management & Sync", icon: Database },
              { id: "storage", label: "Storage Analytics & Logs", icon: HardDrive },
              { id: "alerts", label: "Security Alerts", icon: AlertTriangle },
              { id: "blocklist", label: "IP Blocklist", icon: Lock },
              { id: "apikeys", label: "API Keys", icon: Key },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-3 font-semibold text-sm border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                    activeTab === tab.id
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="space-y-8">
              <Card className="p-8 border border-border bg-card">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-display mb-2">Security & Master Sync Health</h2>
                    <p className="text-muted-foreground">Admin database replication and Cloudinary security status</p>
                  </div>
                  <Shield className="w-12 h-12 text-green-600 opacity-30" />
                </div>

                <div className="flex items-end gap-8 flex-wrap">
                  <div>
                    <p className="text-6xl font-display text-green-600">98</p>
                    <p className="text-sm text-muted-foreground mt-1">out of 100</p>
                  </div>

                  <div className="flex-1 space-y-3 mb-2 min-w-[240px]">
                    <div className="flex justify-between text-sm">
                      <span>Dual-Database Master Sync</span>
                      <span className="text-green-600 font-semibold">Active</span>
                    </div>
                    <div className="w-full bg-border rounded-full h-2">
                      <div className="bg-green-600 h-2 rounded-full w-full" />
                    </div>

                    <div className="flex justify-between text-sm">
                      <span>Cloudinary Storage Guard</span>
                      <span className="text-green-600 font-semibold">Protected</span>
                    </div>
                    <div className="w-full bg-border rounded-full h-2">
                      <div className="bg-green-600 h-2 rounded-full w-4/5" />
                    </div>
                  </div>
                </div>
              </Card>

              {/* Quick status cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6 border border-border bg-card flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-500">
                        <Database className="w-5 h-5" />
                      </div>
                      <h3 className="font-semibold">Admin Master Database</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Centralized administration database where all platform records, user credentials, and telemetry are mirrored.
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-4 gap-2 self-start"
                    onClick={() => setActiveTab("database")}
                  >
                    Configure DB Sync
                  </Button>
                </Card>

                <Card className="p-6 border border-border bg-card flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                        <Cloud className="w-5 h-5" />
                      </div>
                      <h3 className="font-semibold">Cloudinary Storage</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Track per-device media uploads and control ON/OFF upload permissions directly from Device Management.
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-4 gap-2 self-start"
                    onClick={() => setActiveTab("storage")}
                  >
                    View Storage Logs
                  </Button>
                </Card>

                <Card className="p-6 border border-border bg-card flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-500">
                        <Layers className="w-5 h-5" />
                      </div>
                      <h3 className="font-semibold">Device Filter Policy</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Exclude specific high-traffic or test devices from sending records to the Admin database.
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-4 gap-2 self-start"
                    onClick={() => setActiveTab("database")}
                  >
                    Manage Exclusions
                  </Button>
                </Card>
              </div>
            </div>
          )}

          {/* Database Management & Sync Tab */}
          {activeTab === "database" && (
            <div className="space-y-8">
              {/* Dual Sync Master Toggle Card */}
              <Card className="p-6 border border-border bg-card">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-xl font-display">Dual Database Replication Policy</h2>
                      <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase font-bold ${
                        syncSettings.syncToAdminDbEnabled ? "bg-green-500/20 text-green-700 dark:text-green-400" : "bg-gray-500/20 text-gray-700 dark:text-gray-400"
                      }`}>
                        {syncSettings.syncToAdminDbEnabled ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      When enabled, whenever a user connects their personal database (SQL or Mongo), data automatically writes to <strong>both</strong> their database and the Admin Master Database.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() =>
                      setSyncSettings((prev) => ({
                        ...prev,
                        syncToAdminDbEnabled: !prev.syncToAdminDbEnabled,
                      }))
                    }
                    className={`gap-2 whitespace-nowrap ${
                      syncSettings.syncToAdminDbEnabled
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : "bg-secondary text-foreground hover:bg-secondary/80"
                    }`}
                  >
                    <Sliders className="w-4 h-4" />
                    Admin Sync: {syncSettings.syncToAdminDbEnabled ? "ENABLED" : "DISABLED"}
                  </Button>
                </div>
              </Card>

              {/* Admin Master Database Settings */}
              <Card className="p-6 border border-border bg-card">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-display">Admin Master Database Configuration</h2>
                    <p className="text-sm text-muted-foreground">Configure the central database that receives all platform records</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSyncSettings((prev) => ({
                          ...prev,
                          adminDbProvider: "mongo",
                          adminDbConfig: { ...prev.adminDbConfig, provider: "mongo" },
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        syncSettings.adminDbProvider === "mongo"
                          ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/40"
                          : "bg-secondary text-muted-foreground border-transparent hover:text-foreground"
                      }`}
                    >
                      MongoDB
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSyncSettings((prev) => ({
                          ...prev,
                          adminDbProvider: "mysql",
                          adminDbConfig: { ...prev.adminDbConfig, provider: "mysql" },
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        syncSettings.adminDbProvider === "mysql"
                          ? "bg-blue-500/20 text-blue-600 border-blue-500/40"
                          : "bg-secondary text-muted-foreground border-transparent hover:text-foreground"
                      }`}
                    >
                      MySQL / MariaDB
                    </button>
                  </div>
                </div>

                {/* Form fields based on selected provider */}
                {syncSettings.adminDbProvider === "mongo" ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                        Admin MongoDB Connection URI
                      </label>
                      <input
                        type="text"
                        placeholder="mongodb+srv://admin:pass@cluster.mongodb.net/zenvora_admin?retryWrites=true&w=majority"
                        value={syncSettings.adminDbConfig.mongodbUri || ""}
                        onChange={(e) =>
                          setSyncSettings((prev) => ({
                            ...prev,
                            adminDbConfig: { ...prev.adminDbConfig, mongodbUri: e.target.value },
                          }))
                        }
                        className="w-full px-4 py-2.5 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Leave blank to use default MONGODB_URI from server environment (.env).
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1">Host / Endpoint</label>
                        <input
                          type="text"
                          placeholder="jhsldo.stackhero-network.com"
                          value={syncSettings.adminDbConfig.mysqlHost || ""}
                          onChange={(e) =>
                            setSyncSettings((prev) => ({
                              ...prev,
                              adminDbConfig: { ...prev.adminDbConfig, mysqlHost: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1">Port</label>
                        <input
                          type="text"
                          placeholder="7736 or 3306"
                          value={syncSettings.adminDbConfig.mysqlPort || "3306"}
                          onChange={(e) =>
                            setSyncSettings((prev) => ({
                              ...prev,
                              adminDbConfig: { ...prev.adminDbConfig, mysqlPort: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1">Database Name</label>
                        <input
                          type="text"
                          placeholder="root or zenvora"
                          value={syncSettings.adminDbConfig.mysqlDatabase || ""}
                          onChange={(e) =>
                            setSyncSettings((prev) => ({
                              ...prev,
                              adminDbConfig: { ...prev.adminDbConfig, mysqlDatabase: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1">Username</label>
                        <input
                          type="text"
                          placeholder="root"
                          value={syncSettings.adminDbConfig.mysqlUser || ""}
                          onChange={(e) =>
                            setSyncSettings((prev) => ({
                              ...prev,
                              adminDbConfig: { ...prev.adminDbConfig, mysqlUser: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1">Password</label>
                        <input
                          type="password"
                          placeholder="••••••••"
                          value={syncSettings.adminDbConfig.mysqlPassword || ""}
                          onChange={(e) =>
                            setSyncSettings((prev) => ({
                              ...prev,
                              adminDbConfig: { ...prev.adminDbConfig, mysqlPassword: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1">Or Connection URI</label>
                        <input
                          type="text"
                          placeholder="mysql://root:pass@host:port/db"
                          value={syncSettings.adminDbConfig.mysqlUri || ""}
                          onChange={(e) =>
                            setSyncSettings((prev) => ({
                              ...prev,
                              adminDbConfig: { ...prev.adminDbConfig, mysqlUri: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Connection test banner */}
                {testResult && (
                  <div
                    className={`mt-4 p-3 rounded-lg border text-sm flex items-center gap-2 ${
                      testResult.success
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : "bg-destructive/10 border-destructive/20 text-destructive"
                    }`}
                  >
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span>{testResult.message || testResult.error}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestAdminDb}
                    disabled={testingDb}
                    className="gap-2"
                  >
                    <Activity className={`w-4 h-4 ${testingDb ? "animate-spin" : ""}`} />
                    {testingDb ? "Testing Connection..." : "Test Connection"}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSaveSyncSettings}
                    disabled={savingSync}
                    className="gap-2 bg-foreground text-background hover:bg-foreground/90"
                  >
                    {savingSync ? "Saving..." : "Save Master Settings"}
                  </Button>
                </div>
              </Card>

              {/* Specific Device Exclusion List */}
              <Card className="p-6 border border-border bg-card">
                <div className="mb-4">
                  <h2 className="text-xl font-display mb-1">Admin DB Device Exclusions</h2>
                  <p className="text-sm text-muted-foreground">
                    Devices added to this list will <strong>NOT</strong> sync their records to the Admin Master DB (their data remains strictly in the user's personal database).
                  </p>
                </div>

                {/* Add Device ID input */}
                <div className="flex gap-2 mb-4 max-w-md">
                  <input
                    type="text"
                    placeholder="Enter Device ID (e.g. dev-xyz-123)"
                    value={newExcludedDevice}
                    onChange={(e) => setNewExcludedDevice(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddExcludedDevice();
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none"
                  />
                  <Button type="button" onClick={handleAddExcludedDevice} className="gap-1.5">
                    <Plus className="w-4 h-4" />
                    Exclude Device
                  </Button>
                </div>

                {/* Badge list of excluded devices */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {syncSettings.excludedDeviceIds.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No devices excluded. All active devices are currently synced to the Admin Master Database.
                    </p>
                  ) : (
                    syncSettings.excludedDeviceIds.map((deviceId) => (
                      <span
                        key={deviceId}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono bg-destructive/10 text-destructive border border-destructive/20"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        {deviceId}
                        <button
                          type="button"
                          onClick={() => handleRemoveExcludedDevice(deviceId)}
                          className="hover:bg-destructive/20 rounded-full p-0.5 ml-1 transition-colors"
                          title="Remove from exclusion list (enable admin sync)"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {syncSettings.excludedDeviceIds.length > 0 && (
                  <div className="mt-4">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveSyncSettings}
                      disabled={savingSync}
                      className="bg-foreground text-background"
                    >
                      Save Exclusion Rules
                    </Button>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* Storage Analytics & Logs Tab */}
          {activeTab === "storage" && (
            <div className="space-y-8">
              {/* Summary KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-5 border border-border bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground font-semibold uppercase">Cloudinary Storage</p>
                    <Cloud className="w-4 h-4 text-emerald-500" />
                  </div>
                  <p className="text-3xl font-display text-emerald-600 dark:text-emerald-400">
                    {loadingStorage ? "..." : formatBytes(storageData?.summary.totalCloudinaryBytes || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {storageData?.summary.totalCloudinaryFiles || 0} total media files stored
                  </p>
                </Card>

                <Card className="p-5 border border-border bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground font-semibold uppercase">Database Records</p>
                    <Database className="w-4 h-4 text-blue-500" />
                  </div>
                  <p className="text-3xl font-display text-blue-600 dark:text-blue-400">
                    {loadingStorage ? "..." : (storageData?.summary.totalDbRecords || 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Across all synced platform tables</p>
                </Card>

                <Card className="p-5 border border-border bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground font-semibold uppercase">Registered Users</p>
                    <Shield className="w-4 h-4 text-purple-500" />
                  </div>
                  <p className="text-3xl font-display">
                    {loadingStorage ? "..." : storageData?.summary.totalUsers || 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Tenants & Admin accounts</p>
                </Card>

                <Card className="p-5 border border-border bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground font-semibold uppercase">Managed Devices</p>
                    <Smartphone className="w-4 h-4 text-amber-500" />
                  </div>
                  <p className="text-3xl font-display">
                    {loadingStorage ? "..." : storageData?.summary.totalDevices || 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Fleet agents & phones</p>
                </Card>
              </div>

              {/* User Storage Breakdown Table */}
              <Card className="p-6 border border-border bg-card">
                <div className="mb-4">
                  <h2 className="text-xl font-display mb-1">User Storage Usage Breakdown</h2>
                  <p className="text-sm text-muted-foreground">Details showing how much database records and Cloudinary storage each user consumes</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                        <th className="pb-3 font-semibold">User</th>
                        <th className="pb-3 font-semibold">Email</th>
                        <th className="pb-3 font-semibold">Devices</th>
                        <th className="pb-3 font-semibold">Cloudinary Storage</th>
                        <th className="pb-3 font-semibold">Media Files</th>
                        <th className="pb-3 font-semibold">DB Records</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {loadingStorage ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-muted-foreground">
                            Loading storage usage analytics...
                          </td>
                        </tr>
                      ) : !storageData?.userStorage || storageData.userStorage.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-muted-foreground">
                            No user storage data available.
                          </td>
                        </tr>
                      ) : (
                        storageData.userStorage.map((u) => (
                          <tr key={u.userId} className="hover:bg-accent/5 transition-colors">
                            <td className="py-3 font-semibold">{u.name}</td>
                            <td className="py-3 text-muted-foreground font-mono text-xs">{u.email}</td>
                            <td className="py-3 font-mono">{u.deviceCount}</td>
                            <td className="py-3">
                              <span className="font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                                {formatBytes(u.cloudinaryBytes)}
                              </span>
                            </td>
                            <td className="py-3 font-mono">{u.cloudinaryFiles}</td>
                            <td className="py-3 font-mono text-blue-600 dark:text-blue-400">
                              {u.dbRecords.toLocaleString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Device Storage & Cloudinary Control Table */}
              <Card className="p-6 border border-border bg-card">
                <div className="mb-4">
                  <h2 className="text-xl font-display mb-1">Device Storage & Upload Status</h2>
                  <p className="text-sm text-muted-foreground">Per-device Cloudinary bytes and current upload permissions</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                        <th className="pb-3 font-semibold">Device</th>
                        <th className="pb-3 font-semibold">Owner</th>
                        <th className="pb-3 font-semibold">Platform</th>
                        <th className="pb-3 font-semibold">Cloudinary Status</th>
                        <th className="pb-3 font-semibold">Files</th>
                        <th className="pb-3 font-semibold">Total Storage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {loadingStorage ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-muted-foreground">
                            Loading device storage breakdown...
                          </td>
                        </tr>
                      ) : !storageData?.deviceStorage || storageData.deviceStorage.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-muted-foreground">
                            No devices recorded yet.
                          </td>
                        </tr>
                      ) : (
                        storageData.deviceStorage.map((d) => (
                          <tr key={d.deviceId} className="hover:bg-accent/5 transition-colors">
                            <td className="py-3">
                              <p className="font-semibold">{d.hostname}</p>
                              <p className="text-xs font-mono text-muted-foreground">{d.deviceId}</p>
                            </td>
                            <td className="py-3">
                              <p className="text-xs font-medium">{d.userName}</p>
                              <p className="text-xs text-muted-foreground font-mono">{d.userEmail}</p>
                            </td>
                            <td className="py-3 font-mono text-xs uppercase">{d.platform}</td>
                            <td className="py-3">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  d.cloudinaryEnabled
                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                }`}
                              >
                                <Cloud className="w-3 h-3" />
                                {d.cloudinaryEnabled ? "ON" : "OFF"}
                              </span>
                            </td>
                            <td className="py-3 font-mono">{d.cloudinaryFiles}</td>
                            <td className="py-3 font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                              {formatBytes(d.cloudinaryBytes)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Recent Storage Activity Logs */}
              <Card className="p-6 border border-border bg-card">
                <div className="mb-4">
                  <h2 className="text-xl font-display mb-1">Recent Storage Activity Logs</h2>
                  <p className="text-sm text-muted-foreground">Audit log of latest media uploads recorded on the platform</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                        <th className="pb-3 font-semibold">File Name</th>
                        <th className="pb-3 font-semibold">Device</th>
                        <th className="pb-3 font-semibold">Type</th>
                        <th className="pb-3 font-semibold">File Size</th>
                        <th className="pb-3 font-semibold">Date & Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-mono text-xs">
                      {loadingStorage ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-muted-foreground font-sans">
                            Loading logs...
                          </td>
                        </tr>
                      ) : !storageData?.recentLogs || storageData.recentLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-muted-foreground font-sans">
                            No file logs recorded yet.
                          </td>
                        </tr>
                      ) : (
                        storageData.recentLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-accent/5 transition-colors">
                            <td className="py-2.5 font-medium truncate max-w-xs">{log.name}</td>
                            <td className="py-2.5 text-muted-foreground">{log.deviceId}</td>
                            <td className="py-2.5 uppercase">{log.resourceType || log.mimeType?.split("/")[0] || "FILE"}</td>
                            <td className="py-2.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                              {formatBytes(log.size)}
                            </td>
                            <td className="py-2.5 text-muted-foreground">
                              {log.createdAt ? new Date(log.createdAt).toLocaleString() : "-"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* Security Alerts Tab */}
          {activeTab === "alerts" && (
            <div className="space-y-4">
              {securityAlerts.map((alert) => (
                <Card key={alert.id} className="p-6 border border-border bg-card">
                  <div className="flex items-start gap-4">
                    <div
                      className={`p-3 rounded-lg flex-shrink-0 ${
                        alert.level === "critical"
                          ? "bg-red-500/20 text-red-600"
                          : alert.level === "warning"
                          ? "bg-orange-500/20 text-orange-600"
                          : "bg-blue-500/20 text-blue-600"
                      }`}
                    >
                      <AlertCircle className="w-5 h-5" />
                    </div>

                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-base mb-1">{alert.title}</h3>
                          <p className="text-sm text-muted-foreground mb-3">{alert.description}</p>
                          <span className="text-xs text-muted-foreground font-mono">{alert.time}</span>
                        </div>
                        <Button variant="outline" size="sm">
                          Investigate
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* IP Blocklist Tab */}
          {activeTab === "blocklist" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-muted-foreground">Currently blocking 3 suspicious IP addresses</p>
                <Button className="bg-foreground hover:bg-foreground/90 text-background gap-2">
                  <Plus className="w-4 h-4" />
                  Block IP
                </Button>
              </div>

              <div className="space-y-3">
                {blockedIPs.map((item, index) => (
                  <Card key={index} className="p-4 border border-border bg-card">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono font-semibold">{item.ip}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.reason} • Blocked {item.date}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">
                        Unblock
                      </Button>
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
