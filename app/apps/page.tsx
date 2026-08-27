"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Package, Play, Terminal, Upload, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useGateway } from "@/hooks/use-gateway";
import { toast } from "sonner";
import Select from "react-select";

type JobLine = { id: string; text: string; kind: "info" | "ok" | "err" };

export default function InstallAppsPage() {
  const searchParams = useSearchParams();
  const { devices, dispatch, subscribe, resolveTarget, ensureConnected } = useGateway();
  const [selectedDevice, setSelectedDevice] = useState(searchParams.get("device") || "");
  const [wingetQuery, setWingetQuery] = useState("");
  const [runPath, setRunPath] = useState("");
  const [shellCmd, setShellCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<JobLine[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const remoteDir = "C:\\Users\\Public\\ZenvoraApps";

  const push = (text: string, kind: JobLine["kind"] = "info") => {
    setLines((prev) => [{ id: `${Date.now()}-${Math.random()}`, text, kind }, ...prev].slice(0, 80));
  };

  useEffect(() => {
    ensureConnected();
    if (!selectedDevice) {
      const next = resolveTarget() || devices[0]?.value || "";
      if (next) setSelectedDevice(next);
    }
  }, [devices, ensureConnected, resolveTarget, selectedDevice]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json" || !event.packet) return;
      const p = event.packet as Record<string, unknown>;
      if (p.type === "shell_result" || p.action === "SHELL_EXECUTE" || p.type === "SHELL_OUTPUT") {
        const out = String(p.output || p.message || p.stdout || "");
        const err = String(p.stderr || p.error || "");
        const code = p.exitCode ?? p.exit_code;
        if (out) push(out.slice(0, 2000), Number(code) === 0 || code == null ? "ok" : "err");
        if (err) push(err.slice(0, 1000), "err");
        setBusy(false);
      }
      if (p.type === "sys_ack" && String(p.action || "").startsWith("FILE_")) {
        push(String(p.message || p.status || "file ok"), p.status === "error" ? "err" : "ok");
      }
    });
  }, [subscribe]);

  const runShell = (command: string) => {
    if (!selectedDevice || !command.trim()) return;
    setBusy(true);
    push(`> ${command}`);
    // Hidden PowerShell — agent uses CREATE_NO_WINDOW
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

  const onUpload = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !selectedDevice) {
      toast.error("Pick a device and an installer file");
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      toast.error("Max 200MB per upload");
      return;
    }
    setBusy(true);
    push(`Uploading ${file.name} (${Math.round(file.size / 1024)} KB)…`);
    ensureDir();

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Chunk as base64 via FILE_UPLOAD if gateway supports it — use dispatch with base64 payload
    // Matching existing file agent pattern: send as binary through FILE_UPLOAD JSON with content_b64
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const content_b64 = btoa(binary);
    const remotePath = `${remoteDir}\\${file.name}`;
    const result = dispatch(
      "FILE_UPLOAD",
      {
        path: remotePath,
        content_b64,
        overwrite: true,
      },
      selectedDevice
    );
    if (!result.ok) {
      push("Upload dispatch failed — agent offline?", "err");
      setBusy(false);
      return;
    }
    setRunPath(remotePath);
    push(`Uploaded → ${remotePath}`, "ok");
    toast.success("Uploaded to agent");
    setBusy(false);
  };

  const installRemote = () => {
    if (!runPath) {
      toast.error("Upload a file or set path first");
      return;
    }
    const lower = runPath.toLowerCase();
    if (lower.endsWith(".msi")) {
      runShell(`Start-Process msiexec.exe -ArgumentList '/i','${runPath}','/qn','/norestart' -Wait -WindowStyle Hidden`);
    } else if (lower.endsWith(".msix") || lower.endsWith(".appx")) {
      runShell(`Add-AppxPackage -Path '${runPath}'`);
    } else {
      // EXE installer — silent-ish; GUI still controllable via Screen
      runShell(
        `Start-Process -FilePath '${runPath}' -WorkingDirectory '${remoteDir}' -WindowStyle Normal`
      );
      push("Installer launched — use Screen Monitor to control GUI if needed", "info");
    }
  };

  const runRemote = () => {
    if (!runPath) return;
    runShell(`Start-Process -FilePath '${runPath}' -WorkingDirectory '${remoteDir}' -WindowStyle Hidden`);
  };

  const wingetInstall = (e: FormEvent) => {
    e.preventDefault();
    if (!wingetQuery.trim()) return;
    const q = wingetQuery.trim();
    runShell(
      `winget install --id ${q} -e --accept-package-agreements --accept-source-agreements --disable-interactivity`
    );
  };

  const deviceOptions = devices.map((d) => ({ value: d.value, label: d.label || d.value }));

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 sidebar-aware-main overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-display tracking-tight flex items-center gap-2">
                <Package className="w-6 h-6" />
                Install Apps
              </h1>
              <p className="text-sm text-muted-foreground">
                Upload installer → install/run on agent. GUI installers: use Screen Monitor.
              </p>
            </div>
            <div className="w-56">
              <Select
                options={deviceOptions}
                value={deviceOptions.find((o) => o.value === selectedDevice) || null}
                onChange={(opt: { value: string } | null) => setSelectedDevice(opt?.value || "")}
                placeholder="Select device"
                classNamePrefix="react-select"
              />
            </div>
          </div>

          <Card className="p-5 space-y-4 border border-border">
            <h2 className="font-semibold text-sm">1. Browse & upload</h2>
            <form onSubmit={onUpload} className="flex flex-wrap gap-2 items-center">
              <input
                ref={fileRef}
                type="file"
                accept=".exe,.msi,.msix,.appx,.bat,.cmd,.ps1,.zip"
                className="text-sm"
              />
              <Button type="submit" disabled={!selectedDevice || busy}>
                <Upload className="w-4 h-4 mr-1" />
                Upload to PC
              </Button>
            </form>
            <input
              value={runPath}
              onChange={(e) => setRunPath(e.target.value)}
              placeholder={`${remoteDir}\\setup.exe`}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={installRemote} disabled={!selectedDevice || busy || !runPath}>
                <Package className="w-4 h-4 mr-1" />
                Install
              </Button>
              <Button type="button" variant="outline" onClick={runRemote} disabled={!selectedDevice || busy || !runPath}>
                <Play className="w-4 h-4 mr-1" />
                Run
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  selectedDevice &&
                  window.open(`/screen?device=${encodeURIComponent(selectedDevice)}`, "_blank")
                }
              >
                Open Screen (GUI control)
              </Button>
            </div>
          </Card>

          <Card className="p-5 space-y-3 border border-border">
            <h2 className="font-semibold text-sm">2. Winget install</h2>
            <form onSubmit={wingetInstall} className="flex gap-2">
              <input
                value={wingetQuery}
                onChange={(e) => setWingetQuery(e.target.value)}
                placeholder="Package id e.g. OpenJS.NodeJS.LTS"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <Button type="submit" disabled={!selectedDevice || busy}>
                Install
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground">
              Tip: search with shell —{" "}
              <button
                type="button"
                className="underline"
                onClick={() => runShell("winget search nodejs")}
              >
                winget search nodejs
              </button>
            </p>
          </Card>

          <Card className="p-5 space-y-3 border border-border">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              3. Shell (hidden window)
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runShell(shellCmd);
              }}
              className="flex gap-2"
            >
              <input
                value={shellCmd}
                onChange={(e) => setShellCmd(e.target.value)}
                placeholder="Any PowerShell command…"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              />
              <Button type="submit" disabled={!selectedDevice || busy}>
                Run
              </Button>
            </form>
          </Card>

          <Card className="p-4 border border-border">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Job log (dashboard)</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setLines([])}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                Clear
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 font-mono text-[11px]">
              {lines.length === 0 && (
                <p className="text-muted-foreground">Upload / install / shell output appears here.</p>
              )}
              {lines.map((l) => (
                <p
                  key={l.id}
                  className={
                    l.kind === "err"
                      ? "text-rose-600 whitespace-pre-wrap"
                      : l.kind === "ok"
                        ? "text-emerald-600 whitespace-pre-wrap"
                        : "text-muted-foreground whitespace-pre-wrap"
                  }
                >
                  {l.text}
                </p>
              ))}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
