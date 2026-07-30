"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, MonitorSmartphone } from "lucide-react";
import { useGateway } from "@/hooks/use-gateway";
import { AgentChatPanel } from "@/components/shell/agent-chat-panel";

// Custom type for our terminal history lines
type TerminalLine = {
  id: string;
  text: string;
  color?: string;
  isCommand?: boolean;
};

export default function ShellPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const selectedDeviceRef = useRef("");
  
  const [selectedDevice, setSelectedDevice] = useState("");
  const [status, setStatus] = useState("Secure terminal ready");
  const [isExecuting, setIsExecuting] = useState(false);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [input, setInput] = useState("");
  
  // Initialize standard terminal history without xterm/ANSI
  const [history, setHistory] = useState<TerminalLine[]>([
    { id: "init-1", text: "Zenvora Secure Shell", color: "#2563eb" }, // blue
    { id: "init-2", text: "Connected to the authenticated gateway.", color: "#64748b" }, // gray
    { id: "init-3", text: "Run commands here. Output will stream back live.", color: "#0ea5e9" }, // light blue
  ]);

  const { devices, dispatch, resolveTarget, subscribe } = useGateway();

  // Auto-scroll to bottom whenever history changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  // Keep device refs synced — never force devices[0] over an existing selection.
  useEffect(() => {
    if (devices.length === 0) return;
    const knownIds = devices.map((d) => d.value);
    if (selectedDeviceRef.current && knownIds.includes(selectedDeviceRef.current)) {
      return;
    }
    const online = devices.find((d) => d.status === "online");
    const next = (online || devices[0]).value;
    selectedDeviceRef.current = next;
    setSelectedDevice(next);
  }, [devices]);

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  // Handle incoming gateway responses
  useEffect(() => {
    const handleTerminalCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string; target?: string }>).detail;
      const command = detail?.command?.trim();
      if (!command) return;

      const target = selectedDeviceRef.current || resolveTarget();
      if (!target) {
        setHistory((prev) => [
          ...prev,
          { id: Math.random().toString(), text: "[error] No device selected", color: "#dc2626" },
        ]);
        return;
      }

      setHistory((prev) => [
        ...prev,
        { id: Math.random().toString(), text: command, isCommand: true },
      ]);
      dispatch("SHELL_EXECUTE", { command }, target);
      setStatus(`Executing on ${target}`);
    };

    window.addEventListener("zenvora:terminal-command", handleTerminalCommand as EventListener);
    return () => {
      window.removeEventListener("zenvora:terminal-command", handleTerminalCommand as EventListener);
    };
  }, [dispatch, resolveTarget]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json") return;
      const packet = event.packet as Record<string, unknown>;
      console.debug("[SHELL] gateway packet", packet);
      const isShellResponse =
        packet.type === "shell_output" ||
        packet.type === "sys_error" ||
        (packet.type === "sys_ack" && (
          Boolean(packet.shell) ||
          typeof packet.stdout === "string" ||
          typeof packet.stderr === "string" ||
          (typeof packet.action === "string" && (packet.action === "SHELL_EXECUTE" || packet.action === "SHELL_EXECUTE_RAW"))
        ));

      if (!isShellResponse) return;
      setIsExecuting(false);

      if (packet.type === "sys_error") {
        const message = typeof packet.message === "string" ? packet.message : "Command failed";
        setHistory((prev) => [
          ...prev,
          { id: Math.random().toString(), text: message, color: "#dc2626" }, // red
        ]);
        setStatus(message);
        return;
      }

      const shellPayload = (packet.shell as Record<string, unknown> | undefined) ?? {};
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
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      const message = combined || String(packet.message || "[no output]");

      setHistory((prev) => [
        ...prev,
        { id: Math.random().toString(), text: message, color: "#0f172a" }, // foreground
      ]);
      setStatus(String(packet.message || "Command completed"));
    });
  }, [subscribe]);

  // Handle user executing a command
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const command = input.trim();
      setInput(""); // Clear input immediately
      
      // Echo the command in the history
      setHistory((prev) => [
        ...prev,
        { id: Math.random().toString(), text: command, isCommand: true }
      ]);

      if (!command) {
        return;
      }

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
      const result = dispatch("SHELL_EXECUTE", { command }, target);
      if (!result.ok) {
        setIsExecuting(false);
        setHistory((prev) => [
          ...prev,
          { id: Math.random().toString(), text: "[error] Gateway offline or device unavailable", color: "#dc2626" },
        ]);
        return;
      }
      setStatus(`Executing on ${target}`);
    }
  };

  const handleClear = () => {
    setHistory([
      { id: Math.random().toString(), text: "Zenvora Secure Shell", color: "#2563eb" },
      { id: Math.random().toString(), text: "Connected to the authenticated gateway.", color: "#64748b" },
      { id: Math.random().toString(), text: "Run commands here. Output will stream back live.", color: "#0ea5e9" },
    ]);
  };

  const handleDeviceSelect = (deviceValue: string) => {
    setSelectedDevice(deviceValue);
    selectedDeviceRef.current = deviceValue;
    setStatus(`Target: ${deviceValue}`);
    setShowDevicePicker(false);
  };

  // Clicking anywhere in the terminal window focuses the hidden input
  const focusInput = () => {
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-screen w-screen flex-col overfw-hidden bg-[#f5f7fb] text-slate-800">
      <div className="flex flex-1 flex-col p4">
        <div className="relative flex flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_40px_rgba(15,23,42,0.06)]">
          
          {/* Header Controls */}
          <div className="fixed right-2 top-2 z-10 flex items-center gap-1.5 shadow-sm backdrop-blur">
            <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${isExecuting ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>
              {isExecuting ? "Running command…" : status}
            </span>
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
                          selectedDevice === device.value ? "bg-slate-100 text-slate-900" : "text-slate-600"
                        }`}
                      >
                        <span>{device.label || device.value}</span>
                        {selectedDevice === device.value && <span className="text-[10px]">✓</span>}
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

          {/* Simple Terminal Render */}
          <div className="w-full overflow-hidden rounded-xl bg-[#f8fafc] -2">
            <div 
              className="h-full w-full overflow-y-auto rounded-lg border border-slate-200 bg-[#f8fafc] p-4 font-mono text-[14px] leading-[1.45] text-[#0f172a] cursor-text"
              onClick={focusInput}
              style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}
            >
              {history.map((line) => (
                <div key={line.id} className="whitespace-pre-wrap break-words">
                  {line.isCommand ? (
                    <>
                      <span style={{ color: "#2563eb" }}>C:\Users\ZenCode&gt; </span>
                      <span style={{ color: "#0f766e" }}>{line.text}</span>
                    </>
                  ) : (
                    <span style={{ color: line.color || "#0f172a" }}>{line.text}</span>
                  )}
                </div>
              ))}
              
              {/* Active Input Line */}
              <div className="flex w-full items-center">
                <span style={{ color: "#2563eb" }} className="whitespace-pre">
                  C:\Users\ZenCode&gt;{" "}
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
                />
              </div>
              {/* Invisible div to scroll to the bottom */}
              <div ref={bottomRef} />
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}