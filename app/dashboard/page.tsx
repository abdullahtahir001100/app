"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Smartphone, Laptop, Battery, Zap, Wifi, Eye, MoreVertical, FileText, RotateCcw, RefreshCw, Copy, Check, Loader2, ChevronDown, Terminal, DownloadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useGateway } from "@/hooks/use-gateway";
import { alertMsg, Z } from "@/lib/messages";

type InstallLogEntry = {
  step?: number;
  total?: number;
  state?: string;
  message?: string;
  hostname?: string;
  final?: boolean;
  at?: string;
  sessionId?: string;
};

export default function DashboardPage() {
  const { devices: gatewayDevices, devicesLoading, refreshDevices, dispatch, ensureConnected, subscribe } = useGateway();
  const router = useRouter();
  const [showPairModal, setShowPairModal] = useState(false);
  const [openPlatformMenu, setOpenPlatformMenu] = useState(false);
  const [openWindowsMenu, setOpenWindowsMenu] = useState(false);
  const [openAndroidMenu, setOpenAndroidMenu] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [selectedAndroidVersion, setSelectedAndroidVersion] = useState<number | null>(null);
  const [windowsCliInlineOpen, setWindowsCliInlineOpen] = useState(false);
  const [cliPanelMode, setCliPanelMode] = useState<"command" | "logs">("command");
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  
  const [pairingUserId, setPairingUserId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openControlMenu, setOpenControlMenu] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [installSessionId, setInstallSessionId] = useState(() => `web-${Date.now().toString(36)}`);
  const [installLogs, setInstallLogs] = useState<InstallLogEntry[]>([]);
  const [installLive, setInstallLive] = useState(false);
  const [installCommand, setInstallCommand] = useState("Loading short command…");
  const [bootstrapCode, setBootstrapCode] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const devices = useMemo(
    () =>
      gatewayDevices.map((device) => ({
        id: device.value,
        name: device.label || device.value,
        model: device.platform && device.platform !== "unknown" ? device.platform : "",
        status: device.status === "online" ? ("online" as const) : ("offline" as const),
        battery: typeof device.battery === "number" ? device.battery : null,
        storage: typeof device.storage === "number" ? device.storage : null,
        lastSeen: device.lastSeen ? new Date(device.lastSeen).toLocaleString() : "—",
        network: device.localIp
          ? "LAN"
          : device.publicIp
            ? "WAN"
            : device.network
              ? device.network
              : "",
        role: device.role || "AGENT",
        platform: device.platform,
        localIp: device.localIp,
        publicIp: device.publicIp,
      })),
    [gatewayDevices]
  );

  const showSkeleton = devicesLoading && devices.length === 0;

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshDevices();
    }, 60_000);

    return () => clearInterval(interval);
  }, [refreshDevices]);

  useEffect(() => {
    if (!showPairModal && !windowsCliInlineOpen) return;
    ensureConnected();
    setInstallLive(true);

    const unsub = subscribe((event) => {
      if (event.type !== "json") return;
      const packet = event.packet;
      if (packet.type !== "install_telemetry") return;
      const entry = packet as InstallLogEntry;
      setInstallLogs((prev) => {
        const next = [...prev, entry];
        return next.slice(-120);
      });
      if (entry.final) {
        if (entry.state === "ok") alertMsg(Z.CONNECTED, entry.message);
        else if (entry.state === "fail") alertMsg(Z.PAIR_FAILED, entry.message);
        else alertMsg(Z.PAIRING, entry.message);
      }
    });

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/install-logs?sessionId=${encodeURIComponent(installSessionId)}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.logs) && data.logs.length > 0) {
          setInstallLogs(data.logs.slice(-120));
        }
      } catch {
        // ignore
      }
    }, 2500);

    return () => {
      unsub();
      clearInterval(poll);
      setInstallLive(false);
    };
  }, [showPairModal, windowsCliInlineOpen, subscribe, ensureConnected, installSessionId]);

  // Agent UPDATE_AGENT progress — all devices success/error (also Live Console)
  useEffect(() => {
    ensureConnected();
    return subscribe((event) => {
      if (event.type !== "json" || !event.packet) return;
      const packet = event.packet as Record<string, unknown>;
      const isUpdate =
        packet.type === "update_log" ||
        (packet.type === "install_telemetry" && packet.kind === "agent_update");
      if (!isUpdate) return;
      const entry = {
        sessionId: String(packet.sessionId || ""),
        step: Number(packet.step) || 0,
        total: Number(packet.total) || 0,
        state: String(packet.state || "running"),
        message: `[update ${packet.deviceId || packet.hostname || ""}] ${packet.message || ""}`,
        hostname: String(packet.hostname || ""),
        deviceId: String(packet.deviceId || ""),
        final: Boolean(packet.final),
        at: String(packet.at || new Date().toISOString()),
      } as InstallLogEntry;
      setInstallLogs((prev) => [...prev, entry].slice(-120));
      setInstallLive(true);
      if (entry.final) {
        if (entry.state === "ok" || entry.state === "success") {
          alertMsg(Z.AGENT_UPDATE_SENT, entry.message);
        } else if (entry.state === "fail" || entry.state === "error") {
          alertMsg(Z.COMMAND_FAILED, entry.message);
        }
      }
    });
  }, [subscribe, ensureConnected]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installLogs]);

  const loadSession = async () => {
    try {
      const response = await fetch("/api/auth/session", { credentials: "include" });
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload.success && payload.user) {
        const token = payload.user.pairingToken || null;
        const userId = payload.user.pairingUserId || null;
        setPairingToken(token);
        setPairingUserId(userId);
        return { token, userId } as { token: string | null; userId: string | null };
      }
    } catch {
      // ignore
    }
    return null;
  };

  const onlineCount = devices.filter((device) => device.status === "online").length;
  const totalCount = devices.length;
  const averageBattery = Math.round(
    devices.filter((device) => typeof device.battery === "number").reduce((sum, device) => sum + (device.battery || 0), 0) /
    Math.max(1, devices.filter((device) => typeof device.battery === "number").length)
  );

  const apiBase = (() => {
    const configured = (
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      ""
    ).replace(/\/$/, "");
    const origin =
      typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "";
    // Prefer live origin when build-time env still points at localhost.
    if (origin && (!configured || /localhost|127\.0\.0\.1/i.test(configured))) {
      return origin;
    }
    return configured || origin || "https://www.zenvora.abdullahtahir.me";
  })();
  const gatewayUrl = (() => {
    const configured =
      process.env.NEXT_PUBLIC_GATEWAY_URL || process.env.ZENVORA_GATEWAY_URL || "";
    // Ignore baked localhost gateway on a public origin.
    if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) {
      if (apiBase.startsWith("http://") && configured.startsWith("wss://")) {
        return configured.replace(/^wss:\/\//i, "ws://");
      }
      if (apiBase.startsWith("https://") && configured.startsWith("ws://")) {
        return configured.replace(/^ws:\/\//i, "wss://");
      }
      return configured;
    }
    try {
      const u = new URL(apiBase);
      const scheme = u.protocol === "https:" ? "wss" : "ws";
      return `${scheme}://${u.host}/ws/gateway`;
    } catch {
      return "wss://www.zenvora.abdullahtahir.me/ws/gateway";
    }
  })();
  const agentDownloadUrl =
    process.env.NEXT_PUBLIC_AGENT_DOWNLOAD_URL || `${apiBase}/api/agent/download`;
  const androidApkUrl =
    process.env.NEXT_PUBLIC_ANDROID_APK_URL || `${apiBase}/api/agent/download?platform=android`;

  const refreshBootstrapCommand = async (token: string, userId: string) => {
    setBootstrapLoading(true);
    try {
      const sessionId = `web-${Date.now().toString(36)}`;
      setInstallSessionId(sessionId);
      const res = await fetch("/api/agent/bootstrap", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingToken: token,
          pairingUserId: userId,
          sessionId,
          apiBase,
          gatewayUrl,
          downloadUrl: agentDownloadUrl,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data?.command) {
        throw new Error(data?.message || "Could not create install code");
      }
      setBootstrapCode(String(data.code || ""));
      setInstallCommand(String(data.command));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Bootstrap failed";
      setInstallCommand(`# ${message} — reopen Pair Device`);
      setBootstrapCode(null);
      alertMsg(Z.SHORT_CMD_NOT_READY, message);
    } finally {
      setBootstrapLoading(false);
    }
  };

  useEffect(() => {
    if ((!showPairModal && !windowsCliInlineOpen) || !pairingToken || !pairingUserId) return;
    void refreshBootstrapCommand(pairingToken, pairingUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPairModal, windowsCliInlineOpen, pairingToken, pairingUserId]);

  const copyInstallCommand = async () => {
    try {
      if (!installCommand || installCommand.startsWith("#") || installCommand.startsWith("Loading")) {
        alertMsg(Z.SHORT_CMD_NOT_READY);
        return;
      }
      setInstallLogs((prev) => [
        ...prev,
        {
          step: 0,
          total: 8,
          state: "running",
          message: `Command copied (${bootstrapCode || "code"}) — run in Admin PowerShell.`,
          at: new Date().toISOString(),
        },
      ]);
      await navigator.clipboard.writeText(installCommand);
      setCopiedCmd(true);
      alertMsg(Z.COMMAND_COPIED);
      setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      alertMsg(Z.COPY_FAILED);
    }
  };

  const restartAgent = (deviceId: string) => {
    ensureConnected();
    setRestartingId(deviceId);
    setOpenMenu(null);
    const result = dispatch("RESTART_AGENT", {}, deviceId);
    if (!result.ok) {
      const reason = (result as { reason?: string }).reason;
      if (reason === "offline") alertMsg(Z.GATEWAY_UNREACHABLE);
      else if (reason === "agent-offline") alertMsg(Z.AGENT_OFFLINE);
      else alertMsg(Z.COMMAND_FAILED);
      setRestartingId(null);
      return;
    }
    alertMsg(Z.RESTART_SENT);
    setTimeout(() => {
      void refreshDevices(true);
      setRestartingId(null);
    }, 5000);
  };

  const updateAgent = (deviceId: string) => {
    ensureConnected();
    setRestartingId(deviceId);
    setOpenMenu(null);
    const downloadUrl =
      process.env.NEXT_PUBLIC_AGENT_DOWNLOAD_URL ||
      `${typeof window !== "undefined" ? window.location.origin : ""}/api/agent/download`;
    const result = dispatch("UPDATE_AGENT", { download_url: downloadUrl }, deviceId);
    if (!result.ok) {
      const reason = (result as { reason?: string }).reason;
      if (reason === "offline") alertMsg(Z.GATEWAY_UNREACHABLE);
      else if (reason === "agent-offline") alertMsg(Z.AGENT_OFFLINE);
      else alertMsg(Z.COMMAND_FAILED);
      setRestartingId(null);
      return;
    }
    alertMsg(Z.AGENT_UPDATE_SENT);
    setTimeout(() => {
      void refreshDevices(true);
      setRestartingId(null);
    }, 8000);
  };

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      <main className="flex-1 sidebar-aware-main overflow-auto">
        <div className="p-6 lg:p-12">
          <div className="mb-12">
            <div className="flex items-end justify-between mb-4">
              <div>
                <h1 className="text-4xl lg:text-5xl font-display tracking-tight mb-2">
                  Device Dashboard
                </h1>
                <p className="text-muted-foreground">
                  Monitor and manage your connected Android devices
                </p>
              </div>
              <div className="relative">
                <button
                  className="bg-foreground hover:bg-foreground/90 text-background px-4 h-12 rounded-full inline-flex items-center gap-2 focus:outline-none"
                  onClick={() => setOpenPlatformMenu((s) => !s)}
                >
                  <Plus className="w-4 h-4" />
                  <span>Pair Device</span>
                  <ChevronDown className="w-4 h-4 ml-1" />
                </button>

                {openPlatformMenu && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-card border border-border rounded-lg shadow-lg z-50">
                    <div className="py-1">
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center justify-between"
                        onClick={() => {
                          setOpenPlatformMenu(false);
                          setSelectedPlatform(null);
                          setShowPairModal(true);
                          void loadSession();
                        }}
                      >
                        <span>Open full Pair modal</span>
                        <span className="text-xs text-muted-foreground">Large</span>
                      </button>
                      <div className="border-t border-border" />
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center justify-between"
                        onClick={() => {
                          setOpenPlatformMenu(false);
                          setOpenWindowsMenu(true);
                        }}
                      >
                        <span>Windows</span>
                        <span className="text-xs text-muted-foreground">CLI / GUI</span>
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center justify-between"
                        onClick={() => {
                          setOpenPlatformMenu(false);
                          setSelectedPlatform("mac");
                          setShowPairModal(true);
                          void loadSession();
                        }}
                      >
                        <span>macOS</span>
                        <span className="text-xs text-muted-foreground">Open</span>
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center justify-between"
                        onClick={() => {
                          setOpenPlatformMenu(false);
                          setSelectedPlatform("linux");
                          setShowPairModal(true);
                          void loadSession();
                        }}
                      >
                        <span>Linux</span>
                        <span className="text-xs text-muted-foreground">Open</span>
                      </button>
                      <div className="border-t border-border" />
                      <div className="px-3 py-1 text-xs text-muted-foreground">Mobile</div>
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center justify-between"
                        onClick={() => {
                          setOpenPlatformMenu(false);
                          setOpenAndroidMenu(true);
                        }}
                      >
                        <span>Android</span>
                        <span className="text-xs text-muted-foreground">v8–v16</span>
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center justify-between"
                        onClick={() => {
                          setOpenPlatformMenu(false);
                          setSelectedPlatform("ios");
                          setShowPairModal(true);
                          void loadSession();
                        }}
                      >
                        <span>iOS</span>
                        <span className="text-xs text-muted-foreground">Open</span>
                      </button>
                    </div>
                  </div>
                )}

                {openWindowsMenu && (
                  <div className="absolute right-0 top-full mt-2 w-44 bg-card border border-border rounded-lg shadow-lg z-50">
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center gap-2 rounded-t-lg"
                      onClick={async () => {
                        setOpenWindowsMenu(false);
                        setCliPanelMode("command");
                        setWindowsCliInlineOpen(true);
                        const session = await loadSession();
                        const token = session?.token || pairingToken;
                        const userId = session?.userId || pairingUserId;
                        if (token && userId) {
                          await refreshBootstrapCommand(token, userId);
                        }
                      }}
                    >
                      <Terminal className="w-4 h-4" />
                      CLI
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center gap-2 rounded-b-lg"
                      onClick={() => {
                        setOpenWindowsMenu(false);
                        setSelectedPlatform("windows");
                        setShowPairModal(true);
                        void loadSession();
                      }}
                    >
                      <Laptop className="w-4 h-4" />
                      GUI
                    </button>
                  </div>
                )}

                {openAndroidMenu && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-lg shadow-lg z-50">
                    <div className="px-2 py-1 text-xs text-muted-foreground">Android versions</div>
                    <div className="max-h-40 overflow-auto">
                      {Array.from({ length: 9 }).map((_, i) => {
                        const ver = 8 + i;
                        return (
                          <button
                            key={ver}
                            className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center gap-2"
                            onClick={() => {
                              setOpenAndroidMenu(false);
                              setSelectedPlatform("android");
                              setSelectedAndroidVersion(ver);
                              setShowPairModal(true);
                              void loadSession();
                            }}
                          >
                            <Smartphone className="w-4 h-4" />
                            Android {ver}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {windowsCliInlineOpen && (
                  <div className="absolute right-0 top-full mt-2 w-[min(92vw,28rem)] bg-card border border-border rounded-xl shadow-xl z-50 p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="text-sm font-semibold">Windows — CLI</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Admin PowerShell · keep open for live logs
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground text-sm px-1"
                        onClick={() => {
                          setWindowsCliInlineOpen(false);
                          setCliPanelMode("command");
                        }}
                        aria-label="Close"
                      >
                        ✕
                      </button>
                    </div>

                    {cliPanelMode === "command" ? (
                      <>
                        <pre className="whitespace-pre-wrap break-all text-sm font-mono leading-5 max-h-36 overflow-auto rounded-lg border border-border p-3 bg-muted/30">
                          {bootstrapLoading ? "Creating short code…" : installCommand}
                        </pre>
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-accent/10 disabled:opacity-50"
                            disabled={bootstrapLoading || !pairingToken}
                            onClick={() => {
                              if (pairingToken && pairingUserId) {
                                void refreshBootstrapCommand(pairingToken, pairingUserId);
                              }
                            }}
                          >
                            Refresh
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs bg-foreground text-background rounded-md disabled:opacity-50 inline-flex items-center gap-1.5"
                            disabled={bootstrapLoading || !bootstrapCode}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(installCommand);
                                setCopiedCmd(true);
                                setTimeout(() => setCopiedCmd(false), 2000);
                                setCliPanelMode("logs");
                                alertMsg(Z.COMMAND_COPIED);
                              } catch {
                                alertMsg(Z.COPY_FAILED);
                              }
                            }}
                          >
                            {copiedCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedCmd ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
                            {installLive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                            Live install logs
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] border border-border rounded hover:bg-accent/10 inline-flex items-center gap-1"
                              onClick={() => setCliPanelMode("command")}
                              title="View command"
                            >
                              <Eye className="w-3 h-3" />
                              View
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] border border-border rounded hover:bg-accent/10 inline-flex items-center gap-1 disabled:opacity-50"
                              disabled={bootstrapLoading || !pairingToken}
                              onClick={() => {
                                if (pairingToken && pairingUserId) {
                                  void refreshBootstrapCommand(pairingToken, pairingUserId);
                                }
                                setCliPanelMode("command");
                              }}
                              title="Refresh command"
                            >
                              <RotateCcw className={`w-3 h-3 ${bootstrapLoading ? "animate-spin" : ""}`} />
                              Refresh
                            </button>
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 p-3 h-52 overflow-auto font-mono text-[11px] leading-5 text-muted-foreground">
                          {installLogs.length === 0 ? (
                            <p>Waiting for agent… run the copied command on the PC.</p>
                          ) : (
                            installLogs.map((log, idx) => {
                              const tag =
                                log.state === "ok"
                                  ? "[OK]"
                                  : log.state === "fail"
                                    ? "[FAIL]"
                                    : log.state === "warn"
                                      ? "[WARN]"
                                      : "[..]";
                              const color =
                                log.state === "ok"
                                  ? "text-foreground"
                                  : log.state === "fail"
                                    ? "text-rose-600"
                                    : log.state === "warn"
                                      ? "text-amber-500"
                                      : "text-muted-foreground";
                              return (
                                <div key={`${log.at || idx}-${idx}`} className={color}>
                                  {tag}{" "}
                                  {log.step && log.total ? `(${log.step}/${log.total}) ` : ""}
                                  {log.message}
                                  {log.hostname ? `  · ${log.hostname}` : ""}
                                </div>
                              );
                            })
                          )}
                          <div ref={logsEndRef} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {showSkeleton ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-6">
                  <Skeleton className="h-4 w-24 mb-4" />
                  <Skeleton className="h-10 w-16" />
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <Card className="p-6 border border-border bg-card hover-lift">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Online Devices</p>
                    <p className="text-3xl font-display">{onlineCount}</p>
                  </div>
                  <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-green-600" />
                  </div>
                </div>
              </Card>

              <Card className="p-6 border border-border bg-card hover-lift">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Total Devices</p>
                    <p className="text-3xl font-display">{totalCount}</p>
                  </div>
                  <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                    <Zap className="w-5 h-5 text-blue-600" />
                  </div>
                </div>
              </Card>

              <Card className="p-6 border border-border bg-card hover-lift">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Avg Battery</p>
                    <p className="text-3xl font-display">{Number.isNaN(averageBattery) ? "—" : `${averageBattery}%`}</p>
                  </div>
                  <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center">
                    <Battery className="w-5 h-5 text-orange-600" />
                  </div>
                </div>
              </Card>
            </div>
          )}

          <div>
            <h2 className="text-xl font-display mb-6">Paired Devices</h2>

            <div className="space-y-4">
              {showSkeleton ? (
                [...Array(3)].map((_, i) => (
                  <Card key={i} className="p-6">
                    <div className="flex gap-4">
                      <Skeleton className="h-12 w-12 rounded-lg" />
                      <div className="flex-1">
                        <Skeleton className="h-5 w-48 mb-2" />
                        <Skeleton className="h-4 w-32 mb-6" />
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                          {[1, 2, 3, 4].map((j) => (
                            <div key={j}>
                              <Skeleton className="h-3 w-16 mb-2" />
                              <Skeleton className="h-4 w-full" />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Skeleton className="h-9 w-24 rounded-md" />
                          <Skeleton className="h-9 w-24 rounded-md" />
                          <Skeleton className="h-9 w-28 rounded-md" />
                        </div>
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                devices.map((device) => (
                  <Card
                    key={device.id}
                    className="p-6 border border-border bg-card hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 bg-sidebar rounded-lg flex items-center justify-center">
                            {device.platform && (device.platform === "android" || device.platform === "android") ? (
                              <Smartphone className="w-6 h-6" />
                            ) : device.platform && ["windows", "mac", "linux"].includes(String(device.platform).toLowerCase()) ? (
                              <Laptop className="w-6 h-6" />
                            ) : (
                              <Smartphone className="w-6 h-6" />
                            )}
                          </div>
                          <div>
                            <h3 className="font-semibold text-lg">{device.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {device.model ? `${device.model} · ${device.role}` : device.role}

                            </p>
                          </div>
                          <div className="ml-auto flex items-center gap-2">
                            <div
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono ${device.status === "online"
                                  ? "bg-green-500/20 text-green-700"
                                  : "bg-gray-500/20 text-gray-700"
                                }`}
                            >
                              <span
                                className={`w-2 h-2 rounded-full ${device.status === "online" ? "bg-green-600" : "bg-gray-600"
                                  }`}
                              />
                              {device.status === "online" ? "Online" : "Offline"}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Battery</p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-border rounded-full h-2">
                                <div
                                  className={`h-full rounded-full ${typeof device.battery === "number"
                                      ? device.battery > 50
                                        ? "bg-green-600"
                                        : device.battery > 20
                                          ? "bg-orange-600"
                                          : "bg-red-600"
                                      : "bg-transparent"
                                    }`}
                                  style={{ width: `${typeof device.battery === "number" ? device.battery : 0}%` }}
                                />
                              </div>
                              <span className="text-sm font-mono">
                                {typeof device.battery === "number" ? `${device.battery}%` : "—"}
                              </span>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Storage</p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-border rounded-full h-2">
                                <div
                                  className="h-full rounded-full bg-blue-600"
                                  style={{ width: `${typeof device.storage === "number" ? device.storage : 0}%` }}
                                />
                              </div>
                              <span className="text-sm font-mono">
                                {typeof device.storage === "number" ? `${device.storage}%` : "—"}
                              </span>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Network</p>
                            <div className="flex items-center gap-1.5">
                              <Wifi className="w-4 h-4" />
                              <span className="text-sm font-mono">{device.network || "—"}</span>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Last Seen</p>
                            <p className="text-sm font-mono">{device.lastSeen}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <div className="relative">
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-border hover:bg-accent/10"
                              onClick={() => setOpenControlMenu(openControlMenu === device.id ? null : device.id)}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              Control
                            </Button>
                            {openControlMenu === device.id && (
                              <div className="absolute right-0 mt-2 w-40 bg-card border border-border rounded shadow-sm z-40">
                                <button
                                  className="w-full text-left px-3 py-2 hover:bg-accent/10"
                                  onClick={() => {
                                    setOpenControlMenu(null);
                                    router.push(`/camera?device=${device.id}`);
                                  }}
                                >
                                  Camera
                                </button>
                                <button
                                  className="w-full text-left px-3 py-2 hover:bg-accent/10"
                                  onClick={() => {
                                    setOpenControlMenu(null);
                                    router.push(`/screen?device=${device.id}`);
                                  }}
                                >
                                  Screen
                                </button>
                                <button
                                  className="w-full text-left px-3 py-2 hover:bg-accent/10"
                                  onClick={() => {
                                    setOpenControlMenu(null);
                                    router.push(`/ops?device=${device.id}`);
                                  }}
                                >
                                  Agent Ops
                                </button>
                              </div>
                            )}
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            className="border-border hover:bg-accent/10"
                            onClick={() => router.push(`/files?device=${device.id}`)}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            Files
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            className="border-border hover:bg-accent/10"
                            onClick={() => router.push(`/screen?device=${device.id}`)}
                          >
                            Screenshot
                          </Button>
                        </div>
                      </div>

                      <div className="relative">
                        <button
                          className="p-2 hover:bg-accent/10 rounded-lg transition-colors"
                          onClick={() => setOpenMenu(openMenu === device.id ? null : device.id)}
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openMenu === device.id && (
                          <div className="absolute right-0 mt-2 w-44 bg-card border border-border rounded shadow-sm z-50">
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-accent/10"
                              onClick={() => {
                                setOpenMenu(null);
                                router.push(`/files?device=${device.id}`);
                              }}
                            >
                              Files
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-accent/10"
                              onClick={() => {
                                setOpenMenu(null);
                                router.push(`/camera?device=${device.id}`);
                              }}
                            >
                              Camera
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-accent/10"
                              onClick={() => {
                                setOpenMenu(null);
                                router.push(`/screen?device=${device.id}`);
                              }}
                            >
                              Screen
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-accent/10"
                              onClick={() => {
                                setOpenMenu(null);
                                router.push(`/logs?device=${device.id}`);
                              }}
                            >
                              Activity
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center gap-2 disabled:opacity-50"
                              disabled={device.status !== "online" || restartingId === device.id}
                              onClick={() => restartAgent(device.id)}
                            >
                              <RotateCcw className={`w-3.5 h-3.5 ${restartingId === device.id ? "animate-spin" : ""}`} />
                              Restart agent
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 hover:bg-accent/10 flex items-center gap-2 disabled:opacity-50"
                              disabled={device.status !== "online" || restartingId === device.id}
                              onClick={() => updateAgent(device.id)}
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${restartingId === device.id ? "animate-spin" : ""}`} />
                              Update agent
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>

          {!showSkeleton && devices.length === 0 && (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">No paired devices found.</p>
            </Card>
          )}
        </div>

        <Dialog open={showPairModal} onOpenChange={(v) => { setShowPairModal(v); if (!v) { setSelectedPlatform(null); setSelectedAndroidVersion(null); } }}>
          <DialogContent
            showCloseButton={false}
            className="w-[min(95vw,1200px)] max-w-[1200px] h-[90vh] overflow-hidden rounded-[1.5rem] border border-border bg-background shadow-2xl"
          >
            <div className="absolute top-4 right-4">
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="rounded-full p-2">
                  ✕
                </Button>
              </DialogClose>
            </div>

            <DialogHeader className="px-8 pt-8 pb-4">
              <DialogTitle>Pair Device ON Zenvora Agent</DialogTitle>
              <DialogDescription className="mt-3 text-sm text-muted-foreground max-w-2xl">
                Copy the short command, run it as Admin, and <strong className="text-foreground">keep this modal open</strong>.
                Live install logs appear in the console area below.
              </DialogDescription>
            </DialogHeader>

            {/* Content */}
            {selectedPlatform === "android" ? (
              <div className="px-8 py-6 overflow-y-auto max-h-[calc(90vh-180px)] space-y-6">
                <div>
                  <h3 className="text-xl font-semibold mb-1">
                    Install Zenvora APK
                    {selectedAndroidVersion ? ` · Android ${selectedAndroidVersion}` : ""}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Sideload the workspace companion. After install, open the app and enter the Pair Token below.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Pair Token</p>
                    <p className="mt-2 break-all font-mono text-lg text-foreground">{pairingToken ?? "Loading..."}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Pair User ID</p>
                    <p className="mt-2 break-all font-mono text-lg text-foreground">{pairingUserId ?? "Loading..."}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border p-4 space-y-3">
                  <h4 className="font-semibold text-foreground">Install options</h4>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                    <li>Download the APK on this phone (or transfer from PC).</li>
                    <li>Allow install from this browser / Files (Unknown apps).</li>
                    <li>Open Zenvora → enter Pair Token + User ID → Grant permissions (battery, notifications, device admin).</li>
                    <li>Keep the ongoing “Zenvora connection” notification on (silent is fine).</li>
                  </ol>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <a href={androidApkUrl} target="_blank" rel="noreferrer">
                      <Button className="bg-foreground text-background hover:bg-foreground/90">
                        <DownloadCloud className="w-4 h-4 mr-2" />
                        Download Zenvora APK
                      </Button>
                    </a>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (pairingToken) void navigator.clipboard.writeText(pairingToken);
                      }}
                    >
                      Copy Pair Token
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (pairingUserId) void navigator.clipboard.writeText(pairingUserId);
                      }}
                    >
                      Copy User ID
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2 text-sm">
                  <h4 className="font-semibold text-foreground">Play Protect / legitimate install</h4>
                  <p className="text-muted-foreground">
                    Zenvora is a signed workspace agent (not on Play Store by default). Google Play Protect may warn on first sideload — that is normal for enterprise companions.
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1">
                    <li>Install only from <strong className="text-foreground">your</strong> Zenvora dashboard URL.</li>
                    <li>If Play Protect blocks: open the warning → Details → Install anyway (only if you trust this workspace).</li>
                    <li>Or: Play Store → profile → Play Protect → Settings → scan apps with Play Protect (temporarily off while installing), then turn back on.</li>
                    <li>For org-wide trust: publish via Managed Google Play / private track, or enroll as Device Owner / work profile MDM.</li>
                  </ul>
                </div>
              </div>
            ) : ['mac', 'ios', 'linux'].includes(String(selectedPlatform)) ? (
              <div className="px-8 py-12 text-center">
                <h3 className="text-2xl font-semibold mb-4">Coming soon</h3>
                <p className="text-muted-foreground">Pairing for {selectedPlatform} is coming soon. Check back later or use the gateway installer.</p>
              </div>
            ) : (
              <div className="flex flex-col ">
                <div className="px-8 ">
                  <div className="">
                    <h3 className="text-xl font-semibold mb-4">Terms and Conditions</h3>
                    <div className="space-y-4 text-sm leading-7 text-muted-foreground">
                      <p>This is the Android Software Development Kit License Agreement.</p>
                      <div>
                        <h4 className="font-semibold text-foreground">1. Introduction</h4>
                        <p>
                          The Android Software Development Kit is licensed to you subject to the terms of this agreement. The
                          agreement forms a legally binding contract between you and Google in relation to your use of the SDK.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground">2. Accepting this License Agreement</h4>
                        <p>
                          To use the SDK, you must first agree to the license agreement. By using the SDK, you acknowledge that
                          you accept these terms and agree to comply with them.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground">3. SDK License from Google</h4>
                        <p>
                          Google grants you a limited, worldwide, non-exclusive license to use the SDK solely to develop
                          applications for compatible implementations of Android.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground">4. Use of the SDK by You</h4>
                        <p>
                          You agree to use the SDK only for permitted purposes and in compliance with applicable laws, privacy
                          expectations, and Google’s policies.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground">5. Privacy and Information</h4>
                        <p>
                          Google may collect usage statistics and other information to improve the SDK. Any such data collection
                          is managed under Google’s privacy policy.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground">6. General Legal Terms</h4>
                        <p>
                          The agreement is governed by the laws of the State of California, and you agree to submit to the
                          exclusive jurisdiction of courts located in Santa Clara County, California.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 space-y-4">
                    <div className="">
                      <h3 className="text-xl font-semibold mb-4">User Tokens</h3>
                      <div className="space-y-4 gap-8 flex flex-wrap">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">Pair Token</p>
                          <p className="mt-2 break-all font-mono text-lg text-foreground">{pairingToken ?? "Loading..."}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">Pair User ID</p>
                          <p className="mt-2 break-all font-mono text-lg text-foreground">{pairingUserId ?? "Loading..."}</p>
                        </div>
                      </div>
                    </div>

                    {/* Short install command and logs are shown only when not opening a GUI-specific platform modal */}
                    {selectedPlatform === null && (
                      <>
                        <div className="pt-2">
                          <h3 className="text-xl font-semibold mb-2">Short install command</h3>
                          <p className="text-sm text-muted-foreground mb-3">
                            Run in <strong className="text-foreground">Admin PowerShell</strong> (Win 10 / 11 best;
                            Win 8.1 / 7 need .NET 4.5+). Uses a timeout-safe download — not{' '}
                            <code className="text-xs">irm | iex</code> (that hangs on many PCs).
                            Keep this modal open for live logs.
                            {bootstrapCode ? (
                              <span className="ml-2 font-mono text-foreground">code={bootstrapCode}</span>
                            ) : null}
                          </p>
                          <div className="rounded-xl border border-border bg-muted/40 p-3">
                            <pre className="whitespace-pre-wrap break-all text-sm font-mono leading-5 max-h-28 overflow-auto">
                              {bootstrapLoading ? "Creating short code…" : installCommand}
                            </pre>
                            <div className="mt-3 flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={bootstrapLoading || !pairingToken}
                                onClick={() => {
                                  if (pairingToken && pairingUserId) void refreshBootstrapCommand(pairingToken, pairingUserId);
                                }}
                                className="gap-2"
                              >
                                Refresh code
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void copyInstallCommand()}
                                disabled={bootstrapLoading || !bootstrapCode}
                                className="gap-2"
                              >
                                {copiedCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                {copiedCmd ? "Copied" : "Copy command"}
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className="pt-4">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xl font-semibold">Live install logs</h3>
                            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                              {installLive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                              {installLive ? "Listening…" : "Idle"}
                              <span className="font-mono opacity-70">{installSessionId}</span>
                            </span>
                          </div>
                          <div className="rounded-xl border border-border bg-card text-muted-foreground p-3 h-48 overflow-auto font-mono text-xs leading-5">
                            {installLogs.length === 0 ? (
                              <p className="text-muted-foreground">Waiting for agent… copy the command and run it on the PC.</p>
                            ) : (
                              installLogs.map((log, idx) => {
                                const tag =
                                  log.state === "ok"
                                    ? "[OK]"
                                    : log.state === "fail"
                                      ? "[FAIL]"
                                      : log.state === "warn"
                                        ? "[WARN]"
                                        : "[..]";
                                const color =
                                  log.state === "ok"
                                    ? "text-foreground"
                                    : log.state === "fail"
                                      ? "text-rose-600"
                                      : log.state === "warn"
                                        ? "text-amber-500"
                                        : "text-muted-foreground";
                                return (
                                  <div key={`${log.at || idx}-${idx}`} className={color}>
                                    {tag}{" "}
                                    {log.step && log.total ? `(${log.step}/${log.total}) ` : ""}
                                    {log.message}
                                    {log.hostname ? `  · ${log.hostname}` : ""}
                                  </div>
                                );
                              })
                            )}
                            <div ref={logsEndRef} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-border px-8 py-5 bg-background">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedPlatform === "android"
                    ? "Zenvora.apk · pair in-app after install"
                    : "ZenvoraAgent.exe · headless provision + service install"}
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button variant="outline" onClick={() => setShowPairModal(false)}>
                    Close
                  </Button>
                  {selectedPlatform === "android" ? (
                    <a href={androidApkUrl} target="_blank" rel="noreferrer">
                      <Button className="bg-foreground text-background hover:bg-foreground/90">
                        <DownloadCloud className="w-4 h-4 mr-2" />
                        Download APK
                      </Button>
                    </a>
                  ) : selectedPlatform === "windows" ? (
                    <a href={agentDownloadUrl} target="_blank" rel="noreferrer">
                      <Button className="bg-foreground text-background hover:bg-foreground/90">
                        <DownloadCloud className="w-4 h-4 mr-2" />
                        Download exe
                      </Button>
                    </a>
                  ) : ['mac', 'ios', 'linux'].includes(String(selectedPlatform)) ? (
                    <Button className="bg-foreground text-background hover:bg-foreground/90" disabled>
                      <DownloadCloud className="w-4 h-4 mr-2" />
                      Coming soon
                    </Button>
                  ) : (
                    <Button
                      className="bg-foreground text-background hover:bg-foreground/90"
                      disabled={bootstrapLoading || !bootstrapCode}
                      onClick={() => void copyInstallCommand()}
                    >
                      Copy Short Command
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      
    </main>
    </div >
  );
}
