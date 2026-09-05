"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Trash2, MonitorSmartphone } from "lucide-react";
import { useGateway } from "@/hooks/use-gateway";
import { AgentChatPanel } from "@/components/shell/agent-chat-panel";

type TerminalLine = {
  id: string;
  text: string;
  color?: string;
  isCommand?: boolean;
};

type ShellEngine = "cmd" | "powershell";

function newShellId() {
  return `shell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ShellPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const selectedDeviceRef = useRef("");

  const shellId = useMemo(
    () => searchParams.get("shellId") || newShellId(),
    [searchParams]
  );

  const [selectedDevice, setSelectedDevice] = useState(searchParams.get("device") || "");
  const [status, setStatus] = useState("Secure terminal ready");
  const [isExecuting, setIsExecuting] = useState(false);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [input, setInput] = useState("");
  const [username, setUsername] = useState("User");
  const [cwd, setCwd] = useState("C:\\");
  const [shellEngine, setShellEngine] = useState<ShellEngine>("cmd");

  const [history, setHistory] = useState<TerminalLine[]>([
    { id: "init-1", text: "Zenvora Secure Shell", color: "#2563eb" },
    { id: "init-2", text: "Connected to the authenticated gateway.", color: "#64748b" },
    {
      id: "init-3",
      text: "Toggle CMD or PowerShell above. Output is returned exactly as the agent shell produced it.",
      color: "#0ea5e9",
    },
  ]);

  const { devices, dispatch, resolveTarget, subscribe } = useGateway();

  const promptLabel = useMemo(() => {
    const path = cwd || "C:\\";
    if (shellEngine === "powershell") {
      return `PS ${path}> `;
    }
    const user = username || "User";
    return `${user}@${path}> `;
  }, [username, cwd, shellEngine]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  useEffect(() => {
    if (devices.length === 0) return;
    const knownIds = devices.map((d) => d.value);
    const requested = searchParams.get("device") || "";
    if (requested && knownIds.includes(requested)) {
      if (selectedDeviceRef.current !== requested) {
        selectedDeviceRef.current = requested;
        setSelectedDevice(requested);
      }
      return;
    }
    if (selectedDeviceRef.current && knownIds.includes(selectedDeviceRef.current)) {
      return;
    }
    const online = devices.find((d) => d.status === "online");
    const next = (online || devices[0]).value;
    selectedDeviceRef.current = next;
    setSelectedDevice(next);
    const match = devices.find((d) => d.value === next);
    if (match?.username) setUsername(match.username);
  }, [devices, searchParams]);

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
    const match = devices.find((d) => d.value === selectedDevice);
    if (match?.username) setUsername(match.username);
  }, [selectedDevice, devices]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json") return;
      const packet = event.packet as Record<string, unknown>;
      const isShellResponse =
        packet.type === "shell_output" ||
        packet.type === "shell_output_chunk" ||
        packet.type === "sys_error" ||
        (packet.type === "sys_ack" &&
          (Boolean(packet.shell) ||
            typeof packet.stdout === "string" ||
            typeof packet.stderr === "string" ||
            (typeof packet.action === "string" &&
              (packet.action === "SHELL_EXECUTE" || packet.action === "SHELL_EXECUTE_RAW"))));

      if (!isShellResponse) return;

      if (packet.type === "sys_error") {
        setIsExecuting(false);
        const message = typeof packet.message === "string" ? packet.message : "Command failed";
        setHistory((prev) => [
          ...prev,
          { id: Math.random().toString(), text: message, color: "#dc2626" },
        ]);
        setStatus(message);
        return;
      }

      const shellPayload = (packet.shell as Record<string, unknown> | undefined) ?? {};
      const packetShellId = String(shellPayload.shellId || "");
      if (packetShellId && packetShellId !== shellId) {
        return;
      }

      if (typeof shellPayload.username === "string" && shellPayload.username) {
        setUsername(shellPayload.username);
      }
      if (typeof shellPayload.cwd === "string" && shellPayload.cwd) {
        setCwd(shellPayload.cwd);
      }

      if (packet.type === "shell_output_chunk") {
        const chunk = String(shellPayload.chunk || packet.chunk || "");
        if (chunk) {
          setHistory((prev) => [
            ...prev,
            { id: Math.random().toString(), text: chunk, color: "#0f172a" },
          ]);
        }
        return;
      }

      // Ignore dispatch ack — wait for real shell_output with stdout/stderr.
      if (
        packet.type === "sys_ack" &&
        packet.status === "dispatched" &&
        !shellPayload.stdout &&
        !shellPayload.stderr
      ) {
        return;
      }

      setIsExecuting(false);

      // Prefer full original stdout/stderr so line breaks stay exact.
      const stdout =
        typeof shellPayload.stdout === "string"
          ? shellPayload.stdout
          : typeof packet.stdout === "string"
            ? packet.stdout
            : "";
      const stderr =
        typeof shellPayload.stderr === "string"
          ? shellPayload.stderr
          : typeof packet.stderr === "string"
            ? packet.stderr
            : "";

      const lines: TerminalLine[] = [];
      if (stdout) {
        lines.push({ id: Math.random().toString(), text: stdout, color: "#0f172a" });
      }
      if (stderr) {
        lines.push({ id: Math.random().toString(), text: stderr, color: "#dc2626" });
      }
      if (lines.length === 0) {
        lines.push({
          id: Math.random().toString(),
          text: String(packet.message || "[no output]"),
          color: "#64748b",
        });
      }
      setHistory((prev) => [...prev, ...lines]);

      if (shellPayload.timed_out) {
        setHistory((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            text: "[warning] Command timed out on agent",
            color: "#b45309",
          },
        ]);
      }

      setStatus(String(packet.message || "Command completed"));
    });
  }, [subscribe, shellId]);

  const runCommand = (command: string) => {
    if (!command) return;
    setHistory((prev) => [
      ...prev,
      { id: Math.random().toString(), text: command, isCommand: true },
    ]);

    const target = selectedDeviceRef.current || resolveTarget();
    if (!target) {
      setHistory((prev) => [
        ...prev,
        { id: Math.random().toString(), text: "[error] No device selected", color: "#dc2626" },
      ]);
      setIsExecuting(false);
      return;
    }

    setIsExecuting(true);
    const result = dispatch(
      "SHELL_EXECUTE",
      { command, shellId, shell: shellEngine },
      target
    );
    if (!result.ok) {
      setIsExecuting(false);
      setHistory((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          text: "[error] Gateway offline or device unavailable",
          color: "#dc2626",
        },
      ]);
      return;
    }
    setStatus(`Executing (${shellEngine}) on ${target}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const command = input.trim();
      setInput("");
      runCommand(command);
    }
  };

  const handleClear = () => {
    setHistory([
      { id: Math.random().toString(), text: "Zenvora Secure Shell", color: "#2563eb" },
      {
        id: Math.random().toString(),
        text: "Connected to the authenticated gateway.",
        color: "#64748b",
      },
      {
        id: Math.random().toString(),
        text: `Engine: ${shellEngine === "powershell" ? "PowerShell" : "CMD"}`,
        color: "#0ea5e9",
      },
    ]);
  };

  const openNewWindow = () => {
    const device = selectedDeviceRef.current || selectedDevice;
    const id = newShellId();
    const url = `/shell?device=${encodeURIComponent(device)}&shellId=${encodeURIComponent(id)}`;
    window.open(url, `zenvora-shell-${id}`, "noopener,noreferrer,width=980,height=640");
  };

  const handleDeviceSelect = (deviceValue: string) => {
    setSelectedDevice(deviceValue);
    selectedDeviceRef.current = deviceValue;
    const match = devices.find((d) => d.value === deviceValue);
    if (match?.username) setUsername(match.username);
    setStatus(`Target: ${deviceValue}`);
    setShowDevicePicker(false);
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#f5f7fb] text-slate-800">
      <div className="flex flex-1 flex-col p-4">
        <div className="relative flex flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_40px_rgba(15,23,42,0.06)]">
          <div className="fixed right-2 top-2 z-10 flex items-center gap-1.5 shadow-sm backdrop-blur">
            <div className="flex overflow-hidden rounded-md border border-slate-200 bg-white text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setShellEngine("cmd")}
                className={`px-2.5 py-1 transition ${
                  shellEngine === "cmd"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
                title="Run commands in cmd.exe"
              >
                CMD
              </button>
              <button
                type="button"
                onClick={() => setShellEngine("powershell")}
                className={`px-2.5 py-1 transition ${
                  shellEngine === "powershell"
                    ? "bg-blue-700 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
                title="Run commands in PowerShell"
              >
                PowerShell
              </button>
            </div>
            <span
              className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                isExecuting ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"
              }`}
            >
              {isExecuting ? "Running command…" : status}
            </span>
            {isExecuting && (
              <button
                onClick={openNewWindow}
                className="flex h-7 items-center gap-1 rounded-sm px-2 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
                title="Open another terminal window"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                New window
              </button>
            )}
            <button
              onClick={openNewWindow}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-slate-600 transition hover:bg-slate-100"
              aria-label="Open new shell window"
              title="Open new shell window"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-slate-600 transition hover:bg-slate-100"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowDevicePicker((prev) => !prev)}
                className="flex h-7 w-7 items-center justify-center rounded-sm text-slate-600 transition hover:bg-slate-100"
                aria-label="Select device"
              >
                <MonitorSmartphone className="h-4 w-4" />
              </button>
              {showDevicePicker && (
                <div className="absolute right-0 top-9 z-20 min-w-[180px] rounded-md border border-slate-200 bg-white p-2 shadow-lg">
                  {devices.length === 0 ? (
                    <div className="px-2 py-1 text-xs text-slate-500">No devices found</div>
                  ) : (
                    devices.map((device) => (
                      <button
                        key={device.value}
                        onClick={() => handleDeviceSelect(device.value)}
                        className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm transition hover:bg-slate-100 ${
                          selectedDevice === device.value
                            ? "bg-slate-100 text-slate-900"
                            : "text-slate-600"
                        }`}
                      >
                        <span>{device.label || device.value}</span>
                        {selectedDevice === device.value && (
                          <span className="text-[10px]">✓</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              onClick={handleClear}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-slate-600 transition hover:bg-slate-100"
              aria-label="Clear"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <AgentChatPanel />
          </div>

          <div className="w-full overflow-hidden rounded-xl bg-[#f8fafc]">
            <div
              className="h-full w-full overflow-y-auto rounded-lg border border-slate-200 bg-[#f8fafc] p-4 font-mono text-[14px] leading-[1.45] text-[#0f172a] cursor-text"
              onClick={focusInput}
              style={{ fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace' }}
            >
              {history.map((line) => (
                <div key={line.id} className="whitespace-pre-wrap break-words">
                  {line.isCommand ? (
                    <>
                      <span style={{ color: "#2563eb" }}>{promptLabel}</span>
                      <span style={{ color: "#0f766e" }}>{line.text}</span>
                    </>
                  ) : (
                    <span style={{ color: line.color || "#0f172a" }}>{line.text}</span>
                  )}
                </div>
              ))}

              <div className="flex w-full items-center">
                <span style={{ color: "#2563eb" }} className="whitespace-pre">
                  {promptLabel}
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent outline-none border-none text-[#0f172a] caret-[#0ea5e9] shadow-none ring-0 p-0 m-0"
                  autoFocus
                  autoComplete="off"
                  spellCheck="false"
                  disabled={isExecuting}
                />
              </div>
              <div ref={bottomRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
