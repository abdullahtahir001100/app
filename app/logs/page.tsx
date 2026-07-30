"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search, Eye, Download as DownloadIcon, Lock, Smartphone, FileText, Camera, Settings, Globe, Clock, RefreshCw, Monitor, ExternalLink, FolderOpen, Activity } from "lucide-react";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useGateway } from "@/hooks/use-gateway";
import Select from "react-select";

interface ActivityLog {
  _id: string;
  action: string;
  category?: string;
  device: string;
  appName?: string;
  processName?: string;
  windowTitle?: string;
  executablePath?: string;
  createdAt: string;
  status: string;
  details: string;
}

interface BrowserEntry {
  _id: string;
  browser: string;
  url: string;
  title: string;
  visitTime: string;
  visitCount: number;
  windowsUser?: string;
  browserProfile?: string;
}

interface AppEntry {
  _id: string;
  appName: string;
  lastOpened: string;
  appType: string;
  executablePath?: string;
  windowsUser?: string;
}

const iconMap: { [key: string]: any } = {
  "Screen Monitored": Eye,
  "File Downloaded": DownloadIcon,
  "Screen Locked": Lock,
  "Camera Accessed": Camera,
  "File Uploaded": FileText,
  "Settings Changed": Settings,
  "Device Paired": Smartphone,
  "File Deleted": FileText,
  "window_changed": Monitor,
  "app_opened": ExternalLink,
  "app_closed": FolderOpen,
  "application": Activity,
};

const actionLabels: { [key: string]: string } = {
  "window_changed": "Window Changed",
  "app_opened": "App Opened",
  "app_closed": "App Closed",
  "application": "Application Event",
};

const dateOptions = [
  { value: "24hours", label: "Last 24 Hours" },
  { value: "7days", label: "Last 7 Days" },
  { value: "30days", label: "Last 30 Days" },
  { value: "all", label: "All Time" }
];

export default function LogsPage() {
  const searchParams = useSearchParams();
  const requestedDevice = searchParams.get("device") || "";
  const { devices: deviceOptions, sendCommand, socket } = useGateway() as any; 
  
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [activeTab, setActiveTab] = useState("activity");
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState(dateOptions[1]); // Default to 7 days
  const [loading, setLoading] = useState(false);
  
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [liveActivityLogs, setLiveActivityLogs] = useState<ActivityLog[]>([]);
  const [browserHistory, setBrowserHistory] = useState<BrowserEntry[]>([]);
  const [appHistory, setAppHistory] = useState<AppEntry[]>([]);
  
  const [browserFilter, setBrowserFilter] = useState("all");
  const [appFilter, setAppFilter] = useState("all");

  // Prefer ?device= from dashboard deep-link, then first online, then first known.
  useEffect(() => {
    if (!deviceOptions || deviceOptions.length === 0) return;
    const knownIds = deviceOptions.map((d: { value: string }) => d.value);
    if (requestedDevice && knownIds.includes(requestedDevice)) {
      if (selectedDevice !== requestedDevice) setSelectedDevice(requestedDevice);
      return;
    }
    if (!selectedDevice || !knownIds.includes(selectedDevice)) {
      const online = deviceOptions.find((d: { status?: string }) => d.status === "online");
      setSelectedDevice((online || deviceOptions[0]).value);
    }
  }, [deviceOptions, requestedDevice, selectedDevice]);

  // 1. WEBSOCKET LISTENER: Directly updates state when Rust agent replies
  useEffect(() => {
    if (!socket) return;

    const handleLiveMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.deviceId !== selectedDevice) return;

        if (msg.type === 'history_telemetry') {
          const entries = Array.isArray(msg.data) ? msg.data : Array.isArray(msg.entries) ? msg.entries : [];

          if (msg.command === 'FETCH_BROWSER_HISTORY' && entries.length > 0) {
            setBrowserHistory(entries);
            setLoading(false);
          } else if (msg.command === 'FETCH_APP_HISTORY' && entries.length > 0) {
            setAppHistory(entries);
            setLoading(false);
          } else if (msg.command === 'FETCH_SYSTEM_NOTIFICATIONS') {
            setLoading(false);
          }
        }

        if (msg.type === 'activity_telemetry' && msg.log) {
          setLiveActivityLogs((prev) => [msg.log, ...prev]);
        }
      } catch (error) {
        console.error("Live WebSockets parsing failed:", error);
      }
    };

    socket.addEventListener('message', handleLiveMessage);
    return () => socket.removeEventListener('message', handleLiveMessage);
  }, [socket, selectedDevice]);

  // 2. AUTO FETCH & DATABASE FETCH LOGIC
  useEffect(() => {
    if (!selectedDevice) return;
    
    // Step A: Fetch existing data from Database immediately
    fetchDataFromDB();
    
    // Step B: Auto-trigger the Rust agent to send fresh data via WebSockets
    handleLiveFetch();

    // Step C: Fallback polling every 30 seconds for DB syncs
    const interval = setInterval(fetchDataFromDB, 30000); 
    return () => clearInterval(interval);
  }, [activeTab, selectedDevice]);

  const fetchDataFromDB = async () => {
    if (!selectedDevice) return;
    try {
      if (activeTab === "activity") {
        const res = await fetch(`/api/logs/activity?limit=100&deviceId=${selectedDevice}`);
        const data = await res.json();
        if (data.success) setActivityLogs(data.logs || []);
      } else if (activeTab === "browser") {
        const res = await fetch(`/api/logs/browser-history?limit=100&deviceId=${selectedDevice}`);
        const data = await res.json();
        if (data.success) setBrowserHistory(data.history || []);
      } else if (activeTab === "apps") {
        const res = await fetch(`/api/logs/app-history?limit=100&deviceId=${selectedDevice}`);
        const data = await res.json();
        if (data.success) setAppHistory(data.history || []);
      }
    } catch (error) {
      console.error("Failed to fetch logs from DB:", error);
    }
  };

  // The main manual fetch function
  const handleLiveFetch = () => {
    if (!selectedDevice || !sendCommand) return;
    setLoading(true);
    
    if (activeTab === "browser") {
      sendCommand(selectedDevice, "FETCH_BROWSER_HISTORY");
    } else if (activeTab === "apps") {
      sendCommand(selectedDevice, "FETCH_APP_HISTORY");
    } else {
      // Activity tab just fetches from DB
      fetchDataFromDB().then(() => setLoading(false));
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success": return "bg-green-500/10 text-green-700";
      case "warning": return "bg-yellow-500/10 text-yellow-700";
      case "error": return "bg-red-500/10 text-red-700";
      default: return "bg-gray-500/10 text-gray-700";
    }
  };

  const filteredActivityLogs = activityLogs.filter(log =>
    (filter === "all" || log.status === filter) &&
    (searchQuery === "" || log.details.toLowerCase().includes(searchQuery.toLowerCase()) || log.action.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredLiveActivityLogs = liveActivityLogs.filter(log =>
    (filter === "all" || log.status === filter) &&
    (searchQuery === "" || log.details.toLowerCase().includes(searchQuery.toLowerCase()) || log.action.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const combinedActivityLogs = [...filteredLiveActivityLogs, ...filteredActivityLogs];
  const uniqueActivityLogs = combinedActivityLogs.filter((log, index, self) =>
    self.findIndex((item) => item._id === log._id) === index
  );

  const filteredBrowserHistory = browserHistory.filter(entry =>
    (browserFilter === "all" || entry.browser === browserFilter) &&
    (searchQuery === "" || entry.url.toLowerCase().includes(searchQuery.toLowerCase()) || entry.title.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredAppHistory = appHistory.filter(entry =>
    (appFilter === "all" || entry.appType === appFilter) &&
    (searchQuery === "" || entry.appName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getBrowsers = () => [...new Set(browserHistory.map(h => h.browser))];
  const getAppTypes = () => [...new Set(appHistory.map(a => a.appType))];

  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar />

      {/* Main content */}
      <main className="flex-1 lg:ml-64 overflow-auto p-6">
        <div>
          {/* Header */}
          <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-4xl lg:text-5xl font-bold tracking-tight mb-2">Activity Logs</h1>
              <p className="text-muted-foreground">Complete live history of device interactions</p>
            </div>
            
            <div className="flex items-center gap-3">
              {/* React Select for Device */}
              <div className="w-64">
                <Select
                  options={deviceOptions}
                  instanceId="device-selector"
                  value={deviceOptions?.find((d: any) => d.value === selectedDevice) || null}
                  onChange={(opt: any) => setSelectedDevice(opt?.value || "")}
                  placeholder="Choose a device..."
                  className="react-select-container text-black"
                  classNamePrefix="react-select"
                />
              </div>

              {/* Single Consolidated Fetch Button */}
              <Button 
                onClick={handleLiveFetch}
                disabled={loading || !selectedDevice}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg gap-2 shadow-md transition-all h-[38px]"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Fetching...' : 'Fetch Live'}
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-0 border-b border-border">
            <button
              onClick={() => setActiveTab("activity")}
              className={`px-6 py-3 font-medium transition-all border-b-2 ${
                activeTab === "activity"
                  ? "border-b-blue-600 text-blue-600"
                  : "border-b-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Activity
            </button>
            <button
              onClick={() => setActiveTab("browser")}
              className={`px-6 py-3 font-medium transition-all border-b-2 flex items-center gap-2 ${
                activeTab === "browser"
                  ? "border-b-blue-600 text-blue-600"
                  : "border-b-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Globe className="w-4 h-4" />
              Browser History
            </button>
            <button
              onClick={() => setActiveTab("apps")}
              className={`px-6 py-3 font-medium transition-all border-b-2 flex items-center gap-2 ${
                activeTab === "apps"
                  ? "border-b-blue-600 text-blue-600"
                  : "border-b-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Clock className="w-4 h-4" />
              App History
            </button>
          </div>

          {/* Filters */}
          <div className="mb-8 space-y-4">
            {/* Search and React-Select date range */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>

              <div className="w-48">
                <Select
                  options={dateOptions}
                  instanceId="device-selector"
                  value={dateRange}
                  onChange={(opt: any) => setDateRange(opt)}
                  className="react-select-container text-black"
                  classNamePrefix="react-select"
                />
              </div>
            </div>

            {/* Status/Type filter */}
            <div className="flex gap-2 flex-wrap">
              {activeTab === "activity" && (
                <>
                  <button onClick={() => setFilter("all")} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${filter === "all" ? "bg-foreground text-background" : "bg-secondary text-foreground"}`}>All</button>
                  <button onClick={() => setFilter("success")} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${filter === "success" ? "bg-green-600 text-white" : "bg-green-100 text-green-700"}`}>Success</button>
                  <button onClick={() => setFilter("warning")} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${filter === "warning" ? "bg-yellow-600 text-white" : "bg-yellow-100 text-yellow-700"}`}>Warning</button>
                  <button onClick={() => setFilter("error")} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${filter === "error" ? "bg-red-600 text-white" : "bg-red-100 text-red-700"}`}>Error</button>
                </>
              )}

              {activeTab === "browser" && (
                <>
                  <button onClick={() => setBrowserFilter("all")} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${browserFilter === "all" ? "bg-foreground text-background" : "bg-secondary text-foreground"}`}>All Browsers</button>
                  {getBrowsers().map(browser => (
                    <button key={browser} onClick={() => setBrowserFilter(browser)} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${browserFilter === browser ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-700"}`}>{browser}</button>
                  ))}
                </>
              )}

              {activeTab === "apps" && (
                <>
                  <button onClick={() => setAppFilter("all")} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${appFilter === "all" ? "bg-foreground text-background" : "bg-secondary text-foreground"}`}>All Types</button>
                  {getAppTypes().map(type => (
                    <button key={type} onClick={() => setAppFilter(type)} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${appFilter === type ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-700"}`}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Logs Content */}
          <div className="space-y-3">
            {loading && (activityLogs.length === 0 && liveActivityLogs.length === 0 && browserHistory.length === 0 && appHistory.length === 0) ? (
              <div className="text-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-4" />
                <p className="text-muted-foreground">Syncing live data from device...</p>
              </div>
            ) : activeTab === "activity" ? (
              uniqueActivityLogs.length === 0 ? (
                <Card className="p-8 text-center"><p className="text-muted-foreground">No activity logs found</p></Card>
              ) : (
                uniqueActivityLogs.map((log) => {
                  const IconComponent = iconMap[log.action] || Eye;
                  return (
                    <Card key={log._id} className="p-4 hover:shadow-md transition-all">
                      <div className="flex items-start gap-4">
                        <div className="mt-1 p-2 rounded-lg bg-muted"><IconComponent className="w-5 h-5" /></div>
                                <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold">{log.appName ? log.appName : actionLabels[log.action] || log.action}</h4>
                              <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(log.status)}`}>{log.status}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{log.processName || log.windowTitle || log.device}</p>
                            {log.details && <p className="text-sm text-muted-foreground mt-1">{log.details}</p>}
                            <p className="text-xs text-muted-foreground mt-2">{formatTime(log.createdAt)}</p>
                          </div>
                      </div>
                    </Card>
                  );
                })
              )
            ) : activeTab === "browser" ? (
              filteredBrowserHistory.length === 0 ? (
                <Card className="p-8 text-center"><p className="text-muted-foreground">No browser history found</p></Card>
              ) : (
                filteredBrowserHistory.map((entry, idx) => (
                  <Card key={entry._id || idx} className="p-4 hover:shadow-md transition-all">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 p-2 rounded-lg bg-muted"><Globe className="w-5 h-5" /></div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{entry.browser}</span>
                        {entry.browserProfile ? (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded ml-2">
                            Profile: {entry.browserProfile}
                          </span>
                        ) : null}
                        {entry.windowsUser ? (
                          <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded ml-2">User: {entry.windowsUser}</span>
                        ) : null}
                        <h4 className="font-semibold mt-2 truncate">{entry.title || "Untitled"}</h4>
                        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate block mt-1">{entry.url}</a>
                        <p className="text-xs text-muted-foreground mt-2">Visited {formatTime(entry.visitTime)} • {entry.visitCount} times</p>
                      </div>
                    </div>
                  </Card>
                ))
              )
            ) : (
              filteredAppHistory.length === 0 ? (
                <Card className="p-8 text-center"><p className="text-muted-foreground">No app history found</p></Card>
              ) : (
                filteredAppHistory.map((entry, idx) => (
                  <Card key={entry._id || idx} className="p-4 hover:shadow-md transition-all">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 p-2 rounded-lg bg-muted"><Clock className="w-5 h-5" /></div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold">{entry.appName}</h4>
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">{entry.appType}</span>
                          {entry.windowsUser ? (
                            <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">User: {entry.windowsUser}</span>
                          ) : null}
                        </div>
                        {entry.executablePath && <p className="text-sm text-muted-foreground mt-1 truncate">{entry.executablePath}</p>}
                        <p className="text-xs text-muted-foreground mt-2">Last opened {formatTime(entry.lastOpened)}</p>
                      </div>
                    </div>
                  </Card>
                ))
              )
            )}
          </div>
        </div>
      </main>
    </div>
  );
}