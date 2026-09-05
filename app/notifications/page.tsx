"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MessageCircle, Mail, Smartphone, Settings, Trash2, Archive, MoreVertical, Filter, Search, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { useGateway } from "@/hooks/use-gateway";
import Select from "react-select";

// Icon map for apps (using Lucide where possible + colors; replace with real SVG/img URLs if you have them in /public)
const getAppIcon = (app: string) => {
  const appLower = app.toLowerCase().trim();
  switch (appLower) {
    case "whatsapp":
      return { icon: MessageCircle, color: "#25D366" };
    case "instagram":
      return { icon: MessageCircle, color: "#E1306C" };
    case "gmail":
    case "email":
      return { icon: Mail, color: "#4285F4" };
    case "telegram":
      return { icon: MessageCircle, color: "#229ED9" };
    case "chrome":
    case "system":
      return { icon: Smartphone, color: "#4285F4" };
    default:
      return { icon: MessageCircle, color: "#6B7280" };
  }
};

interface Notification {
  _id: string;
  app: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  category: string;
  icon?: string;
  image?: string;
}

interface Category {
  id: string;
  label: string;
  count: number;
}

interface DeviceOption {
  value: string;
  label: string;
}

export default function NotificationsPage() {
  const { devices: deviceOptionsRaw, sendCommand } = useGateway();
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDeviceSelect, setShowDeviceSelect] = useState(false);

  // Convert device options for React Select
  const deviceOptions: DeviceOption[] = deviceOptionsRaw?.map((d: any) => ({
    value: d.value,
    label: d.label || d.value,
  })) || [];

  // Auto-select first device
  useEffect(() => {
    if (deviceOptions.length > 0 && !selectedDevice) {
      setSelectedDevice(deviceOptions[0].value);
    }
  }, [deviceOptions, selectedDevice]);

const fetchNotifications = async (showRefresh = false) => {
  if (showRefresh) setRefreshing(true);

  try {
    const query = new URLSearchParams();

    query.append("limit", "100");

    if (selectedDevice) {
      query.append("deviceId", selectedDevice);

      if (sendCommand) {
        await sendCommand(
          selectedDevice,
          "FETCH_SYSTEM_NOTIFICATIONS"
        );

        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    const response = await fetch(
      `/api/notifications?${query}`
    );

    const data = await response.json();

    if (data.success) {
      setNotifications(data.notifications || []);
    }
  } catch (error) {
    console.error(error);
  } finally {
    setLoading(false);
    setRefreshing(false);
  }
};

useEffect(() => {
  const counts: Record<string, number> = {};

  notifications.forEach((n) => {
    const app = n.app?.trim() || "Unknown";
    counts[app] = (counts[app] || 0) + 1;
  });

  const cats = [
    {
      id: "all",
      label: "All Notifications",
      count: notifications.length,
    },
    ...Object.entries(counts).map(([app, count]) => ({
      id: app,
      label: app,
      count,
    })),
  ];

  setCategories(cats);
}, [notifications]);

  // Initial load + polling
  useEffect(() => {
    fetchNotifications();
    // fetchCategories();

    // const interval = setInterval(() => {
    //   fetchNotifications();
    // }, 15000); // Poll every 15s to reduce flicker

    // return () => clearInterval(interval);
  }, [selectedDevice]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "now";
    if (mins < 60) return `${mins} min${mins > 1 ? "s" : ""} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "PUT" });
      fetchNotifications();
    } catch (error) {
      console.error("Failed to mark as read:", error);
    }
  };

const handleDelete = async (id: string) => {
  try {
    await fetch(`/api/notifications/${id}`, {
      method: "DELETE",
    });

    setNotifications((prev) =>
      prev.filter((n) => n._id !== id)
    );
  } catch (error) {
    console.error(error);
  }
};

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications/mark-all-read", { 
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: selectedDevice })
      });
      fetchNotifications();
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    }
  };

const filteredNotifications = notifications.filter((n) => {
  const matchesCategory =
    filter === "all" ||
    n.app.trim().toLowerCase() ===
      filter.trim().toLowerCase();

  const matchesSearch =
    searchQuery === "" ||
    n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    n.message.toLowerCase().includes(searchQuery.toLowerCase());

  return matchesCategory && matchesSearch;
});

  const selectedDeviceOption = deviceOptions.find(d => d.value === selectedDevice);

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
                <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">Notifications</h1>
                <p className="text-muted-foreground">Real-time alerts from your devices</p>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  className="border-border hover:bg-accent/10"
                  onClick={handleMarkAllRead}
                >
                  Mark all read
                </Button>
                <Button 
                  variant="outline" 
                  className="border-border hover:bg-accent/10"
                  onClick={() => fetchNotifications(true)}
                  disabled={refreshing}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {/* Search and filter */}
          <div className="mb-8 flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Search notifications..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>
            
            <Button 
              variant="outline" 
              className="border-border hover:bg-accent/10 gap-2 whitespace-nowrap"
              onClick={() => setShowDeviceSelect(!showDeviceSelect)}
            >
              <Filter className="w-4 h-4" />
              {showDeviceSelect ? "Hide Devices" : "More Filters"}
            </Button>
          </div>

          {/* Device Selector */}
          {showDeviceSelect && deviceOptions.length > 0 && (
            <div className="mb-6 p-4 border border-border rounded-xl bg-card">
              <p className="text-sm text-muted-foreground mb-3">Select Device</p>
              <Select
                options={deviceOptions}
                value={selectedDeviceOption}
                onChange={(option) => {
                  if (option) {
                    setSelectedDevice(option.value);
                    setShowDeviceSelect(false); // Auto-hide after selection
                  }
                }}
                className="react-select-container"
                classNamePrefix="react-select"
                placeholder="Choose a device..."
                isClearable
              />
            </div>
          )}

          {/* Category filter */}
          <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setFilter(cat.id)}
                className={`px-4 py-2 rounded-full whitespace-nowrap text-sm transition-colors flex-shrink-0 ${ 
                  filter === cat.id 
                    ? "bg-foreground text-background" 
                    : "bg-secondary text-foreground hover:bg-secondary/80" 
                }`}
              >
                {cat.label}
                <span className="ml-2 text-xs opacity-70">({cat.count})</span>
              </button>
            ))}
          </div>

          {/* Notifications list */}
          <div className="space-y-3">
            {loading && notifications.length === 0 ? (
              <div className="text-center py-12">
                <div className="animate-spin w-8 h-8 border-4 border-foreground/20 border-t-foreground mx-auto rounded-full"></div>
                <p className="text-muted-foreground mt-4">Loading notifications...</p>
              </div>
            ) : filteredNotifications.length > 0 ? (
              filteredNotifications.map((notification) => {
                const { icon: IconComponent, color } = getAppIcon(notification.app);
                return (
                  <Card 
                    key={notification._id} 
                    className={`p-4 border transition-all cursor-pointer group ${ 
                      notification.read 
                        ? "border-border bg-card hover:bg-accent/5" 
                        : "border-foreground/30 bg-accent/10 hover:bg-accent/15" 
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      {/* Icon / image */}
                      <div
                        className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden`}
                        style={{ backgroundColor: `${color}15` }}
                      >
                        {(notification.image || (notification.icon && String(notification.icon).startsWith("data:"))) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={notification.image || notification.icon}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <IconComponent
                            className="w-6 h-6"
                            style={{ color }}
                          />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className={`font-semibold ${!notification.read ? "text-foreground" : ""}`}>
                            {notification.title}
                          </h3>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatTime(notification.createdAt)}
                          </span>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-2">
                          <span className="font-mono text-xs bg-sidebar/50 px-2 py-1 rounded mr-2">
                            {notification.app}
                          </span>
                        </p>
                        
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {notification.message}
                        </p>
                        {notification.image && String(notification.image).startsWith("data:") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={notification.image}
                            alt=""
                            className="mt-3 max-h-48 rounded-lg border border-border object-contain bg-muted/30"
                          />
                        ) : null}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button 
                          className="p-2 hover:bg-accent/10 rounded transition-colors" 
                          title="Archive"
                          onClick={() => !notification.read && handleMarkAsRead(notification._id)}

                        >
                          <Archive className="w-4 h-4" />
                        </button>
                        <button 
                          className="p-2 hover:bg-red-500/10 rounded transition-colors" 
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(notification._id);
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                        {/* <button className="p-2 hover:bg-accent/10 rounded transition-colors">
                          <MoreVertical className="w-4 h-4" />
                        </button> */}
                      </div>

                      {/* Unread indicator */}
                      {!notification.read && (
                        <div className="w-2 h-2 rounded-full bg-foreground flex-shrink-0 mt-2" />
                      )}
                    </div>
                  </Card>
                );
              })
            ) : (
              <div className="text-center py-12">
                <MessageCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                <p className="text-muted-foreground mb-4">No notifications found</p>
                <Button 
                  variant="outline" 
                  className="border-border"
                  onClick={() => {
                    setFilter("all");
                    setSearchQuery("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>

          {/* Notification settings */}
        
        </div>
      </main>
    </div>
  );
}