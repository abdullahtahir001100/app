"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Smartphone, Laptop, Battery, Zap, Wifi, Eye, MoreVertical, FileText, RotateCcw, Copy, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useGateway } from "@/hooks/use-gateway";
import { toast } from "sonner";

export default function DashboardPage() {
  const { devices: gatewayDevices, devicesLoading, refreshDevices, dispatch, ensureConnected } = useGateway();
  const router = useRouter();
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingUserId, setPairingUserId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openControlMenu, setOpenControlMenu] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [restartingId, setRestartingId] = useState<string | null>(null);

  const devices = useMemo(
    () =>
      gatewayDevices.map((device) => ({
        id: device.value,
        name: device.label || device.value,
        model: device.platform || device.role || "Unknown",
        status: device.status === "online" ? ("online" as const) : ("offline" as const),
        battery: typeof device.battery === "number" ? device.battery : null,
        storage: typeof device.storage === "number" ? device.storage : null,
        lastSeen: device.lastSeen ? new Date(device.lastSeen).toLocaleString() : "now",
        network: device.localIp ? "LAN" : device.publicIp ? "WAN" : "Unknown",
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

  const loadSession = async () => {
    try {
      const response = await fetch("/api/auth/session", { credentials: "include" });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.success && payload.user) {
        setPairingToken(payload.user.pairingToken || null);
        setPairingUserId(payload.user.pairingUserId || null);
      }
    } catch {
      // ignore
    }
  };

  const onlineCount = devices.filter((device) => device.status === "online").length;
  const totalCount = devices.length;
  const averageBattery = Math.round(
    devices.filter((device) => typeof device.battery === "number").reduce((sum, device) => sum + (device.battery || 0), 0) /
      Math.max(1, devices.filter((device) => typeof device.battery === "number").length)
  );

  const apiBase = (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://zenvora.abdullahtahir.me"
  ).replace(/\/$/, "");
  const gatewayUrl =
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    process.env.ZENVORA_GATEWAY_URL ||
    "wss://zenvora.abdullahtahir.me/ws/gateway";
  const agentDownloadUrl =
    process.env.NEXT_PUBLIC_AGENT_DOWNLOAD_URL || `${apiBase}/api/agent/download`;

  const installCommand = useMemo(() => {
    const token = pairingToken || "<PAIR_TOKEN>";
    const userId = pairingUserId || "<PAIR_USER_ID>";

    // Build script body, then UTF-16LE Base64 encode for -EncodedCommand.
    // This avoids outer PowerShell eating $token / $url when the one-liner is pasted.
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$token = '${token.replace(/'/g, "''")}'`,
      `$userId = '${userId.replace(/'/g, "''")}'`,
      `$api = '${apiBase.replace(/'/g, "''")}'`,
      `$gw = '${gatewayUrl.replace(/'/g, "''")}'`,
      `$url = '${agentDownloadUrl.replace(/'/g, "''")}'`,
      "$out = Join-Path $env:TEMP 'win_32.exe'",
      "Write-Host '[1/4] Downloading agent...' -ForegroundColor Cyan",
      "Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing",
      "if (-not (Test-Path $out)) { throw 'Download failed: win_32.exe missing' }",
      "Write-Host '[2/4] Launching headless provision (pair + service + connect)...' -ForegroundColor Cyan",
      "& $out --headless --pair-token $token --pair-user-id $userId --api-url $api --gateway-url $gw",
      "Write-Host '[3/4] Done. Check status lines above.' -ForegroundColor Green",
    ].join("; ");

    const encoded = (() => {
      if (typeof window === "undefined") return "";
      const codes = new Uint16Array(script.length);
      for (let i = 0; i < script.length; i += 1) codes[i] = script.charCodeAt(i);
      const bytes = new Uint8Array(codes.buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    })();

    if (!encoded) {
      // SSR / first paint fallback (still escaped for nested PS)
      return `powershell -ExecutionPolicy Bypass -NoProfile -Command "& { \`$ErrorActionPreference='Stop'; \`$token='${token}'; \`$userId='${userId}'; \`$api='${apiBase}'; \`$gw='${gatewayUrl}'; \`$url='${agentDownloadUrl}'; \`$out=Join-Path \`$env:TEMP 'win_32.exe'; Write-Host '[1/4] Downloading agent...' -ForegroundColor Cyan; Invoke-WebRequest -Uri \`$url -OutFile \`$out -UseBasicParsing; Write-Host '[2/4] Launching headless provision...' -ForegroundColor Cyan; & \`$out --headless --pair-token \`$token --pair-user-id \`$userId --api-url \`$api --gateway-url \`$gw; Write-Host '[3/4] Done.' -ForegroundColor Green }"`;
    }

    return `powershell -ExecutionPolicy Bypass -NoProfile -EncodedCommand ${encoded}`;
  }, [pairingToken, pairingUserId, apiBase, gatewayUrl, agentDownloadUrl]);

  const copyInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopiedCmd(true);
      toast.success("Install command copied");
      setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      toast.error("Could not copy command");
    }
  };

  const restartAgent = (deviceId: string) => {
    ensureConnected();
    setRestartingId(deviceId);
    setOpenMenu(null);
    const result = dispatch("RESTART_AGENT", {}, deviceId);
    if (!result.ok) {
      toast.error(
        result.reason === "offline"
          ? "Gateway disconnected"
          : result.reason === "agent-offline"
            ? "Agent is offline"
            : "Could not restart agent"
      );
      setRestartingId(null);
      return;
    }
    toast.success("Restart command sent");
    setTimeout(() => {
      void refreshDevices(true);
      setRestartingId(null);
    }, 5000);
  };

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      <main className="flex-1 lg:ml-64 overflow-auto">
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
              <Button
                onClick={() => {
                  setShowPairModal(true);
                  void loadSession();
                }}
                className="bg-foreground hover:bg-foreground/90 text-background px-6 h-12 rounded-full inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Pair Device
              </Button>
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
                              {device.model} · {device.role}
                            </p>
                          </div>
                          <div className="ml-auto flex items-center gap-2">
                            <div
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono ${
                                device.status === "online"
                                  ? "bg-green-500/20 text-green-700"
                                  : "bg-gray-500/20 text-gray-700"
                              }`}
                            >
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  device.status === "online" ? "bg-green-600" : "bg-gray-600"
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
                                  className={`h-full rounded-full ${
                                    typeof device.battery === "number"
                                      ? device.battery > 50
                                        ? "bg-green-600"
                                        : device.battery > 20
                                          ? "bg-orange-600"
                                          : "bg-red-600"
                                      : "bg-gray-400"
                                  }`}
                                  style={{ width: `${typeof device.battery === "number" ? device.battery : 0}%` }}
                                />
                              </div>
                              <span className="text-sm font-mono">
                                {typeof device.battery === "number" ? `${device.battery}%` : "N/A"}
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
                                {typeof device.storage === "number" ? `${device.storage}%` : "N/A"}
                              </span>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Network</p>
                            <div className="flex items-center gap-1.5">
                              <Wifi className="w-4 h-4" />
                              <span className="text-sm font-mono">{device.network}</span>
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
                            onClick={() => router.push(`/screenshot?device=${device.id}`)}
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

        <Dialog open={showPairModal} onOpenChange={setShowPairModal}>
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
                Before downloading, you must agree to the following terms and conditions.
              </DialogDescription>
            </DialogHeader>

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

                  <div className="pt-2">
                    <h3 className="text-xl font-semibold mb-2">One-line install (PowerShell)</h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      Run as Administrator. Uses EncodedCommand so PowerShell does not strip $variables.
                      Status prints in that terminal (no GUI). Manual EXE double-click still shows the connection window.
                    </p>
                    <div className="rounded-xl border border-border bg-muted/40 p-3">
                      <pre className="whitespace-pre-wrap break-all text-xs font-mono leading-5 max-h-40 overflow-auto">
                        {installCommand}
                      </pre>
                      <div className="mt-3 flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => void copyInstallCommand()} className="gap-2">
                          {copiedCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedCmd ? "Copied" : "Copy command"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-border px-8 py-5 bg-background">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">win_32.exe · headless provision + service install</p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Button variant="outline" onClick={() => setShowPairModal(false)}>
                      Close
                    </Button>
                    <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={() => void copyInstallCommand()}>
                      Copy Install Command
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
