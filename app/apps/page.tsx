"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { ScreenPanel } from "@/components/cockpit/screen-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Package,
  Play,
  Terminal,
  Upload,
  RefreshCw,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Copy,
  Layers,
  Sparkles,
  DownloadCloud,
  FileBox,
  HardDrive,
  Cpu,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useGateway } from "@/hooks/use-gateway";
import { toast } from "sonner";
import Select from "react-select";
import { PremiumGate } from "@/components/premium-card";
import { useFeatureAccess } from "@/hooks/use-feature-access";

type JobLine = {
  id: string;
  text: string;
  kind: "info" | "ok" | "err";
  time: string;
};

type PageTab = "apps" | "screen";

const CHUNK_SIZE = 512 * 1024; // 512 KB slices for safe, low-latency streaming

const WINGET_PRESETS = [
  { label: "Node.js (LTS)", id: "OpenJS.NodeJS.LTS", icon: "🟢" },
  { label: "Python 3.12", id: "Python.Python.3.12", icon: "🐍" },
  { label: "Git SCM", id: "Git.Git", icon: "📦" },
  { label: "VS Code", id: "Microsoft.VisualStudioCode", icon: "💻" },
  { label: "Google Chrome", id: "Google.Chrome", icon: "🌐" },
  { label: "7-Zip", id: "7zip.7zip", icon: "🗜️" },
  { label: "Rustup", id: "Rustlang.Rustup", icon: "🦀" },
];

export default function InstallAppsPage() {
  const { allowed, loading } = useFeatureAccess("apps");
  const searchParams = useSearchParams();
  const { devices, dispatch, subscribe, resolveTarget, ensureConnected } = useGateway();
  const [selectedDevice, setSelectedDevice] = useState(searchParams.get("device") || "");
  const [activeTab, setActiveTab] = useState<PageTab>("apps");

  const [wingetQuery, setWingetQuery] = useState("");
  const [runPath, setRunPath] = useState("");
  const [shellCmd, setShellCmd] = useState("");
  const [busy, setBusy] = useState(false);

  // Chunked upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadFileSize, setUploadFileSize] = useState(0);

  // Streaming Job Logs
  const [lines, setLines] = useState<JobLine[]>([]);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const remoteDir = "C:\\Users\\Public\\ZenvoraApps";

  const pushLog = (text: string, kind: JobLine["kind"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setLines((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, kind, time }].slice(-1000));
  };

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    ensureConnected();
    if (!selectedDevice) {
      const next = resolveTarget() || devices[0]?.value || "";
      if (next) setSelectedDevice(next);
    }
  }, [devices, ensureConnected, resolveTarget, selectedDevice]);

  // Handle incoming shell & file acknowledgments
  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json" || !event.packet) return;
      const p = event.packet as Record<string, unknown>;

      if (p.type === "shell_result" || p.action === "SHELL_EXECUTE" || p.type === "SHELL_OUTPUT") {
        const out = String(p.output || p.message || p.stdout || "");
        const err = String(p.stderr || p.error || "");
        const code = p.exitCode ?? p.exit_code;

        if (out) {
          // Clean carriage return streams from winget / curl
          const formatted = out.replace(/\r\n/g, "\n");
          pushLog(formatted, Number(code) === 0 || code == null ? "ok" : "err");
        }
        if (err) {
          pushLog(err, "err");
        }
        setBusy(false);
      }

      if (p.type === "sys_ack" && String(p.action || "").startsWith("FILE_")) {
        const msg = String(p.message || p.status || "File operation acknowledged.");
        if (p.status === "error") {
          pushLog(`[AGENT ERROR] ${msg}`, "err");
        } else if (p.action !== "FILE_CHUNK_UPLOAD") {
          pushLog(`[AGENT ACK] ${msg}`, "ok");
        }
      }
    });
  }, [subscribe]);

  const runShell = (command: string) => {
    if (!selectedDevice || !command.trim()) return;
    setBusy(true);
    pushLog(`> ${command.trim()}`, "info");

    dispatch(
      "SHELL_EXECUTE",
      {
        command: command.trim(),
        shell: "powershell",
      },
      selectedDevice
    );
  };

  const ensureDir = () => {
    runShell(`New-Item -ItemType Directory -Force -Path '${remoteDir}' | Out-Null`);
  };

  // 500MB Chunked File Upload with Real-Time Progress Bar
  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedDevice) return;

    if (file.size > 500 * 1024 * 1024) {
      toast.error("File size exceeds 500 MB limit.");
      return;
    }

    setUploadFileName(file.name);
    setUploadFileSize(file.size);
    setUploading(true);
    setUploadProgress(0);
    setUploadSpeed("0 MB/s");
    ensureDir();

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const startTime = performance.now();
    let uploadedBytes = 0;
    const remotePath = `${remoteDir}\\${file.name}`;

    pushLog(
      `[UPLOAD] Starting chunked upload for "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB, ${totalChunks} chunks)...`,
      "info"
    );

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const slice = file.slice(start, end);
        const arrayBuf = await slice.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuf);

        // Convert slice to base64
        let binary = "";
        const len = uint8.byteLength;
        for (let i = 0; i < len; i += 8192) {
          binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, Math.min(i + 8192, len))));
        }
        const chunkB64 = btoa(binary);

        const res = dispatch(
          "FILE_CHUNK_UPLOAD",
          {
            path: remoteDir,
            file_name: file.name,
            chunk_index: chunkIndex,
            total_chunks: totalChunks,
            chunk_b64: chunkB64,
          },
          selectedDevice
        );

        if (!res.ok) {
          throw new Error(
            `Dispatch failed at chunk ${chunkIndex + 1}/${totalChunks}: ${res.reason || "Agent disconnected"}`
          );
        }

        uploadedBytes += slice.size;
        const percent = Math.min(100, Math.round((uploadedBytes / file.size) * 100));
        setUploadProgress(percent);

        const elapsedSec = (performance.now() - startTime) / 1000;
        if (elapsedSec > 0.3) {
          const mbps = uploadedBytes / (1024 * 1024) / elapsedSec;
          setUploadSpeed(`${mbps.toFixed(1)} MB/s`);
        }

        // Yield loop so UI updates smoothly
        if (chunkIndex % 2 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
      }

      setRunPath(remotePath);
      pushLog(`[UPLOAD COMPLETE] File successfully deployed to: ${remotePath}`, "ok");
      toast.success(`Uploaded ${file.name} (100%)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog(`[UPLOAD FAILED] ${msg}`, "err");
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const installRemote = () => {
    if (!runPath) {
      toast.error("Upload a file or set path first.");
      return;
    }
    const lower = runPath.toLowerCase();
    if (lower.endsWith(".msi")) {
      runShell(`Start-Process msiexec.exe -ArgumentList '/i','${runPath}','/qn','/norestart' -Wait -WindowStyle Hidden`);
      pushLog(`Launched silent MSI installation for ${runPath}`, "info");
    } else if (lower.endsWith(".msix") || lower.endsWith(".appx")) {
      runShell(`Add-AppxPackage -Path '${runPath}'`);
      pushLog(`Deploying AppX package ${runPath}`, "info");
    } else {
      // EXE installer — user can switch to the Live Remote Screen tab to view and click through the installer!
      runShell(`Start-Process -FilePath '${runPath}' -WorkingDirectory '${remoteDir}' -WindowStyle Normal`);
      pushLog(`Interactive installer launched. Switch to the 'Live Remote Screen' tab to interact with the GUI installer!`, "ok");
      toast.info("Installer launched! Switch to Live Remote Screen tab if setup wizard appears.");
    }
  };

  const runRemote = () => {
    if (!runPath) return;
    runShell(`Start-Process -FilePath '${runPath}' -WorkingDirectory '${remoteDir}' -WindowStyle Hidden`);
    pushLog(`Executed background process: ${runPath}`, "info");
  };

  const wingetInstall = (query?: string) => {
    const q = (query || wingetQuery).trim();
    if (!q) return;
    setWingetQuery(q);
    pushLog(`[WINGET] Initiating installation for package ID: ${q}...`, "info");
    runShell(`winget install --id ${q} -e --accept-package-agreements --accept-source-agreements --disable-interactivity`);
  };

  const copyLogs = async () => {
    const text = lines.map((l) => `[${l.time}] ${l.text}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Logs copied to clipboard");
    } catch {
      toast.error("Failed to copy logs");
    }
  };

  const clearLogs = () => {
    setLines([]);
    toast.success("Job logs cleared");
  };

  const deviceOptions = devices.map((d) => ({
    value: d.value,
    label: `${d.label || d.value} ${d.status === "online" ? "🟢" : "⚪"}`,
  }));

  const activeDeviceObj = devices.find((d) => d.value === selectedDevice);

  if (!loading && !allowed) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 sidebar-aware-main overflow-auto p-6 flex items-center justify-center">
          <PremiumGate
            featureKey="apps"
            title="Software & App Deployment"
            description="Remotely deploy and install software, silent MSI packages, and Winget applications across your endpoints."
            price="$19.99/mo"
            features={[
              "Direct 500MB chunked binary uploads",
              "Silent Winget and MSI installer automation",
              "Concurrent batch software rollout",
              "Live remote terminal installation monitoring",
            ]}
            onUnlocked={() => window.location.reload()}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 sidebar-aware-main overflow-auto flex flex-col">
        {/* Header Bar */}
        <header className="border-b border-border bg-card/60 backdrop-blur px-6 py-4">
          <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Package className="w-6 h-6 text-primary" />
                <h1 className="text-xl font-display tracking-tight font-semibold">Software Deployment & Installers</h1>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                500MB chunked uploads, silent MSI/Winget package management, and embedded live desktop control.
              </p>
            </div>

            {/* Device Picker & Session Tabs */}
            <div className="flex items-center gap-3">
              <div className="w-64">
                <Select
                  options={deviceOptions}
                  value={deviceOptions.find((o) => o.value === selectedDevice) || null}
                  onChange={(opt: { value: string } | null) => setSelectedDevice(opt?.value || "")}
                  placeholder="Select target device"
                  classNamePrefix="react-select"
                />
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center rounded-lg border border-border bg-muted/40 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("apps")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    activeTab === "apps"
                      ? "bg-background text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Installers & Jobs
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("screen")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    activeTab === "screen"
                      ? "bg-background text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Live Remote Screen
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Tab 1: Installers, Winget & Jobs */}
        {activeTab === "apps" && (
          <div className="flex-1 p-6 overflow-auto">
            <div className="mx-auto max-w-6xl space-y-6">
              {/* Section 1: 500MB Chunked File Upload Card */}
              <Card className="p-6 border border-border bg-card/80 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold flex items-center gap-2">
                      <DownloadCloud className="w-5 h-5 text-indigo-500" />
                      1. Upload & Deploy Installer (Up to 500 MB)
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Supports .exe, .msi, .msix, .appx, .zip, .bat. Sliced into 512KB chunks for high-speed streaming without browser freezing.
                    </p>
                  </div>
                  {activeDeviceObj && (
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5 ${
                        activeDeviceObj.status === "online"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      {activeDeviceObj.status === "online" ? "Target Online" : "Agent Offline"}
                    </span>
                  )}
                </div>

                {/* Upload Trigger Drop Zone */}
                <div
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                    uploading
                      ? "border-primary/50 bg-primary/5 pointer-events-none"
                      : "border-border hover:border-primary/50 hover:bg-muted/30"
                  }`}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".exe,.msi,.msix,.appx,.bat,.cmd,.ps1,.zip"
                    onChange={onFileSelected}
                    className="hidden"
                    disabled={!selectedDevice || uploading}
                  />
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Upload className={`w-6 h-6 ${uploading ? "animate-bounce" : ""}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {uploading
                          ? `Uploading: ${uploadFileName}`
                          : "Click to browse or drop installer file here"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Maximum file size: 500 MB · Chunks dispatched directly to remote agent disk
                      </p>
                    </div>
                  </div>

                  {/* Real-Time Progress Bar */}
                  {uploading && (
                    <div className="mt-5 max-w-md mx-auto space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-muted-foreground">{uploadSpeed}</span>
                        <span className="font-semibold text-primary">{uploadProgress}%</span>
                      </div>
                      <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-150 rounded-full"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {((uploadFileSize * (uploadProgress / 100)) / (1024 * 1024)).toFixed(1)} MB of{" "}
                        {(uploadFileSize / (1024 * 1024)).toFixed(1)} MB transferred
                      </p>
                    </div>
                  )}
                </div>

                {/* Path & Execution Control */}
                <div className="space-y-3 pt-1">
                  <div className="flex gap-2">
                    <Input
                      value={runPath}
                      onChange={(e) => setRunPath(e.target.value)}
                      placeholder={`${remoteDir}\\setup.exe`}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button
                      type="button"
                      onClick={installRemote}
                      disabled={!selectedDevice || busy || !runPath || uploading}
                      className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Package className="w-3.5 h-3.5" />
                      Install / Launch Setup
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={runRemote}
                      disabled={!selectedDevice || busy || !runPath || uploading}
                      className="gap-1.5 text-xs"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Run Hidden
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setActiveTab("screen")}
                      disabled={!selectedDevice}
                      className="gap-1.5 text-xs ml-auto"
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      View Screen Session Tab
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Section 2: Winget Package Manager with One-Click Presets */}
              <Card className="p-6 border border-border bg-card/80 shadow-sm space-y-4">
                <div>
                  <h2 className="text-base font-semibold flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    2. Windows Package Manager (Winget) Live Deployment
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Install software packages directly from Microsoft repository. Live download progress bars stream into the job logs below.
                  </p>
                </div>

                {/* Quick Presets */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                    Quick 1-Click Presets:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {WINGET_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => wingetInstall(p.id)}
                        disabled={!selectedDevice || busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-muted/30 hover:bg-muted transition-all font-medium"
                      >
                        <span>{p.icon}</span>
                        <span>{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Package Form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    wingetInstall();
                  }}
                  className="flex gap-2 pt-1"
                >
                  <Input
                    value={wingetQuery}
                    onChange={(e) => setWingetQuery(e.target.value)}
                    placeholder="Enter package id e.g. OpenJS.NodeJS.LTS or Git.Git"
                    className="flex-1 text-xs font-mono"
                  />
                  <Button type="submit" disabled={!selectedDevice || busy || !wingetQuery.trim()} className="text-xs">
                    Install Package
                  </Button>
                </form>

                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <span>Quick commands:</span>
                  <button
                    type="button"
                    onClick={() => runShell("winget search nodejs")}
                    className="underline hover:text-foreground"
                  >
                    search nodejs
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => runShell("winget list")}
                    className="underline hover:text-foreground"
                  >
                    list installed apps
                  </button>
                </div>
              </Card>

              {/* Section 3: Quick Hidden Shell */}
              <Card className="p-6 border border-border bg-card/80 shadow-sm space-y-3">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-purple-500" />
                  3. Remote PowerShell Console
                </h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    runShell(shellCmd);
                  }}
                  className="flex gap-2"
                >
                  <Input
                    value={shellCmd}
                    onChange={(e) => setShellCmd(e.target.value)}
                    placeholder="PowerShell command e.g. Get-Process | Select -First 10"
                    className="flex-1 font-mono text-xs"
                  />
                  <Button type="submit" disabled={!selectedDevice || busy || !shellCmd.trim()} className="text-xs">
                    Execute
                  </Button>
                </form>
              </Card>

              {/* Section 4: Live Streaming Job Logs */}
              <Card className="p-5 border border-border bg-zinc-950 text-zinc-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold font-mono">Live Job Logs & Download Stream</h2>
                    <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded font-mono text-zinc-400">
                      {lines.length} lines
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={copyLogs}
                      className="h-7 px-2.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                    >
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      Copy
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearLogs}
                      className="h-7 px-2.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Clear Logs
                    </Button>
                  </div>
                </div>

                <div
                  ref={logContainerRef}
                  className="h-80 overflow-y-auto space-y-1 font-mono text-xs p-2 leading-relaxed select-text"
                >
                  {lines.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-1">
                      <Terminal className="w-6 h-6 opacity-40" />
                      <p className="text-xs">No active job output yet.</p>
                      <p className="text-[11px] opacity-75">
                        Live installer uploads, Winget downloading progress, and shell outputs stream here.
                      </p>
                    </div>
                  ) : (
                    lines.map((l) => (
                      <div key={l.id} className="flex items-start gap-2">
                        <span className="text-zinc-600 select-none text-[10px] shrink-0 pt-0.5">[{l.time}]</span>
                        <span
                          className={`whitespace-pre-wrap break-all ${
                            l.kind === "err"
                              ? "text-rose-400"
                              : l.kind === "ok"
                              ? "text-emerald-400"
                              : "text-zinc-300"
                          }`}
                        >
                          {l.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Tab 2: Embedded Live Screen Session (No need to navigate to /screen) */}
        {activeTab === "screen" && (
          <div className="flex-1 flex flex-col min-h-0 p-4">
            {selectedDevice ? (
              <div className="flex-1 flex flex-col min-h-0 border border-border rounded-xl overflow-hidden shadow-2xl bg-black">
                <ScreenPanel
                  deviceId={selectedDevice}
                  subscribe={subscribe}
                  dispatch={dispatch}
                  autoStart={true}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                <Monitor className="w-12 h-12 mb-3 text-muted-foreground/40" />
                <p className="text-sm font-medium">No Target Device Selected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Please select an active device from the top bar to open the live desktop screen session.
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
