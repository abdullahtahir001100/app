"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DispatchFn = (
  action: string,
  payload?: Record<string, unknown>,
  target?: string
) => { ok: boolean; reason?: string };

type SubscribeFn = (
  listener: (event: { type: string; data?: ArrayBuffer | Blob; packet?: Record<string, unknown> }) => void
) => () => void;

type Line = { id: string; text: string; color?: string; isCommand?: boolean };
type ShellEngine = "cmd" | "powershell";

function newId() {
  return Math.random().toString(36).slice(2);
}

export function ShellPanel({
  deviceId,
  subscribe,
  dispatch,
}: {
  deviceId: string;
  subscribe: SubscribeFn;
  dispatch: DispatchFn;
}) {
  const shellId = useMemo(() => `cockpit-${Date.now().toString(36)}-${newId().slice(0, 6)}`, []);
  const [engine, setEngine] = useState<ShellEngine>("cmd");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("User");
  const [cwd, setCwd] = useState("C:\\");
  const [lines, setLines] = useState<Line[]>([
    { id: "init", text: "Zenvora Secure Shell — output is returned exactly as the agent produced it.", color: "#0ea5e9" },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = engine === "powershell" ? `PS ${cwd}> ` : `${username}@${cwd}> `;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json" || !event.packet) return;
      const packet = event.packet as Record<string, unknown>;
      const isShell =
        packet.type === "shell_output" ||
        packet.type === "shell_output_chunk" ||
        packet.type === "sys_error" ||
        (packet.type === "sys_ack" &&
          (Boolean(packet.shell) ||
            typeof packet.stdout === "string" ||
            typeof packet.stderr === "string" ||
            packet.action === "SHELL_EXECUTE"));
      if (!isShell) return;

      if (packet.type === "sys_error") {
        setBusy(false);
        setLines((p) => [...p, { id: newId(), text: String(packet.message || "Command failed"), color: "#dc2626" }]);
        return;
      }

      const shell = (packet.shell as Record<string, unknown> | undefined) ?? {};
      const pShellId = String(shell.shellId || "");
      if (pShellId && pShellId !== shellId) return;
      if (typeof shell.username === "string" && shell.username) setUsername(shell.username);
      if (typeof shell.cwd === "string" && shell.cwd) setCwd(shell.cwd);

      if (packet.type === "shell_output_chunk") {
        const chunk = String(shell.chunk || packet.chunk || "");
        if (chunk) setLines((p) => [...p, { id: newId(), text: chunk, color: "#0f172a" }]);
        return;
      }
      if (packet.type === "sys_ack" && packet.status === "dispatched" && !shell.stdout && !shell.stderr) return;

      setBusy(false);
      const stdout = typeof shell.stdout === "string" ? shell.stdout : typeof packet.stdout === "string" ? packet.stdout : "";
      const stderr = typeof shell.stderr === "string" ? shell.stderr : typeof packet.stderr === "string" ? packet.stderr : "";
      const out: Line[] = [];
      if (stdout) out.push({ id: newId(), text: stdout, color: "#0f172a" });
      if (stderr) out.push({ id: newId(), text: stderr, color: "#dc2626" });
      if (out.length === 0) out.push({ id: newId(), text: String(packet.message || "[no output]"), color: "#64748b" });
      setLines((p) => [...p, ...out]);
    });
  }, [subscribe, shellId]);

  const run = (command: string) => {
    if (!command) return;
    setLines((p) => [...p, { id: newId(), text: command, isCommand: true }]);
    const res = dispatch("SHELL_EXECUTE", { command, shellId, shell: engine }, deviceId);
    if (!res.ok) {
      setLines((p) => [...p, { id: newId(), text: "[error] Gateway offline or device unavailable", color: "#dc2626" }]);
      return;
    }
    setBusy(true);
  };

  return (
    <div className="flex h-full flex-col bg-[#f8fafc]">
      <div className="flex items-center gap-1.5 border-b border-border bg-background/60 px-2 py-1.5 text-xs">
        <div className="flex overflow-hidden rounded-md border border-border">
          <button onClick={() => setEngine("cmd")} className={`px-2 py-0.5 font-medium ${engine === "cmd" ? "bg-slate-900 text-white" : "text-muted-foreground"}`}>
            CMD
          </button>
          <button onClick={() => setEngine("powershell")} className={`px-2 py-0.5 font-medium ${engine === "powershell" ? "bg-blue-700 text-white" : "text-muted-foreground"}`}>
            PowerShell
          </button>
        </div>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${busy ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"}`}>
          {busy ? "running…" : "ready"}
        </span>
      </div>
      <div
        className="flex-1 min-h-0 cursor-text overflow-y-auto p-2.5 font-mono text-[12.5px] leading-[1.5] text-[#0f172a]"
        onClick={() => inputRef.current?.focus()}
        style={{ fontFamily: '"JetBrains Mono","Fira Code",Consolas,monospace' }}
      >
        {lines.map((l) => (
          <div key={l.id} className="whitespace-pre-wrap break-words">
            {l.isCommand ? (
              <>
                <span style={{ color: "#2563eb" }}>{prompt}</span>
                <span style={{ color: "#0f766e" }}>{l.text}</span>
              </>
            ) : (
              <span style={{ color: l.color || "#0f172a" }}>{l.text}</span>
            )}
          </div>
        ))}
        <div className="flex w-full items-center">
          <span style={{ color: "#2563eb" }} className="whitespace-pre">
            {prompt}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const c = input.trim();
                setInput("");
                run(c);
              }
            }}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 border-none bg-transparent p-0 text-[#0f172a] caret-[#0ea5e9] shadow-none outline-none ring-0"
          />
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
