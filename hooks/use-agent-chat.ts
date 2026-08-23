"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGateway } from "@/hooks/use-gateway";
import { toast } from "sonner";
import { alertMsg, Z } from "@/lib/messages";


export type AgentMessageRole = "assistant" | "user" | "system";
export type AgentMessageStatus = "idle" | "thinking" | "streaming" | "executing" | "completed" | "success" | "warning" | "error";
export type AgentMessageKind = "normal" | "thinking" | "command" | "terminal" | "warning" | "error" | "success" | "system";

export type AgentMessageMetadata = {
  kind?: AgentMessageKind;
  step?: "thinking" | "planning" | "generating" | "executing" | "receiving" | "analyzing" | "completed";
  command?: string;
  exitCode?: number;
  durationMs?: number;
  provider?: string;
  model?: string;
};

export type AgentMessage = {
  id: string;
  role: AgentMessageRole;
  text: string;
  status: AgentMessageStatus;
  timestamp: string;
  metadata?: AgentMessageMetadata;
};

export type AgentCapabilities = {
  aiLoop: boolean;
  webSocket: boolean;
  cmdExecution: boolean;
  sessionMemory: boolean;
  autoRetries: boolean;
  errorRecovery: boolean;
  multiStep: boolean;
};

export type AgentSettings = {
  provider: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  agentMode: string;
  autoApproval: boolean;
  manualApproval: boolean;
};

import { getShellApiConfig, getActiveProviderConfig } from "@/hooks/use-api-config";

const STORAGE_KEY = "zenvora_agent_chat_messages";
const SETTINGS_KEY = "zenvora_agent_chat_settings";
const CAPABILITIES_KEY = "zenvora_agent_chat_capabilities";

const DEFAULT_SETTINGS: AgentSettings = {
  provider: "gemini",
  apiKey: "",
  model: "gemini-2.0-flash",
  temperature: 0.2,
  maxTokens: 1024,
  streaming: true,
  agentMode: "autonomous",
  autoApproval: true,
  manualApproval: false,
};

function getInitialSettings(): AgentSettings {
  const stored = getStoredState<AgentSettings | null>(SETTINGS_KEY, null);
  const shellConfig = getShellApiConfig();
  const targetProvider = (stored?.provider || shellConfig.activeProvider || "gemini") as string;
  const provCfg = shellConfig.providers.find((p) => p.provider === targetProvider);

  if (stored) {
    const effectiveKey = stored.apiKey || provCfg?.apiKey || "";
    const effectiveModel = stored.model && stored.model !== DEFAULT_SETTINGS.model ? stored.model : (provCfg?.model || DEFAULT_SETTINGS.model);
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      provider: targetProvider,
      apiKey: effectiveKey,
      model: effectiveModel,
    };
  }

  return {
    ...DEFAULT_SETTINGS,
    provider: targetProvider,
    apiKey: provCfg?.apiKey || "",
    model: provCfg?.model || "gemini-2.0-flash",
  };
}

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  aiLoop: true,
  webSocket: true,
  cmdExecution: true,
  sessionMemory: true,
  autoRetries: true,
  errorRecovery: true,
  multiStep: true,
};

const createTimestamp = () => new Date().toISOString();

const DIRECT_SHELL_PATTERN =
  /^(?:pwd|ls|dir|cd|mkdir|rmdir|touch|del|rm|cp|copy|mv|move|cat|type|echo|git|npm|pnpm|yarn|bun|cargo|python|node|curl|wget|ipconfig|cls|clear|find|grep|sed|awk|uname|whoami|tasklist|taskkill|powershell|bash|sh|start|explorer|code|notepad|explorer\.exe)\b/i;

function extractShellCommand(text: string): string | null {
  if (!text) return null;

  const cleaned = text.trim();

  // 1. Execute block
  const executeMatch = cleaned.match(
    /```(?:execute|cmd|powershell|bash|shell)?\s*([\s\S]*?)```/i
  );

  if (executeMatch?.[1]) {
    const cmd = executeMatch[1].trim();
    if (cmd) return cmd;
  }

  // 2. Windows prompt
  const promptMatch = cleaned.match(
    /(?:[A-Z]:\\.*?>|\$|#)\s*(.+)$/im
  );

  if (promptMatch?.[1]) {
    return promptMatch[1].trim();
  }

  // 3. Plain shell command
  if (DIRECT_SHELL_PATTERN.test(cleaned)) {
    return cleaned;
  }

  // 4. Search line by line
  const lines = cleaned
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (DIRECT_SHELL_PATTERN.test(line)) {
      return line;
    }

    const idx = line.indexOf("&&");
    if (idx > 0) {
      const left = line.substring(0, idx).trim();
      if (DIRECT_SHELL_PATTERN.test(left)) {
        return line;
      }
    }
  }

  // 5. Open/fetch/clone natural language
  const lower = cleaned.toLowerCase();

  if (lower.startsWith("open ")) {
    return cleaned.replace(/^open\s+/i, "explorer ");
  }

  if (lower.startsWith("clone ")) {
    const repo = cleaned.replace(/^clone\s+/i, "").trim();
    return `git clone ${repo}`;
  }

  if (lower.startsWith("fetch ")) {
    return `curl "${cleaned.replace(/^fetch\s+/i, "").trim()}"`;
  }

  if (lower.startsWith("check ")) {
    return cleaned.replace(/^check\s+/i, "");
  }

  if (lower.startsWith("transfer ")) {
    return cleaned.replace(/^transfer\s+/i, "");
  }

  return null;
}
const initialMessages = (): AgentMessage[] => {
  const now = createTimestamp();
  return [
    {
      id: "system-ready",
      role: "system",
      text: "Agent ready. Send a task and I will plan, execute, and report back live.",
      status: "success",
      timestamp: now,
      metadata: { kind: "system", step: "completed" },
    },
  ];
};

function getStoredState<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function storeState<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function useAgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>(() => getStoredState(STORAGE_KEY, initialMessages()));
  const [settings, setSettings] = useState<AgentSettings>(getInitialSettings);
  const [capabilities, setCapabilities] = useState<AgentCapabilities>(() => getStoredState(CAPABILITIES_KEY, DEFAULT_CAPABILITIES));
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [connectionState, setConnectionState] = useState<"ready" | "streaming" | "reconnecting" | "error">("ready");
  const [isLoading, setIsLoading] = useState(false);
  const streamStartRef = useRef<number | null>(null);

  const { dispatch: gatewayDispatch, resolveTarget, isConnected } = useGateway();
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<AgentMessage[]>(messages);
  const currentDirectoryRef = useRef<string>("");
const lastCommandRef = useRef<string>("");
  const settingsRef = useRef<AgentSettings>(settings);
  const capabilitiesRef = useRef<AgentCapabilities>(capabilities);

  useEffect(() => {
    messagesRef.current = messages;
    storeState(STORAGE_KEY, messages);
  }, [messages]);

  useEffect(() => {
    settingsRef.current = settings;
    storeState(SETTINGS_KEY, settings);
  }, [settings]);

  useEffect(() => {
    capabilitiesRef.current = capabilities;
    storeState(CAPABILITIES_KEY, capabilities);
  }, [capabilities]);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const updateMessage = useCallback((messageId: string, updater: (message: AgentMessage) => AgentMessage) => {
    setMessages((prev) => prev.map((message) => (message.id === messageId ? updater(message) : message)));
  }, []);

  const appendMessage = useCallback((message: AgentMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const setSetting = useCallback(<K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleCapability = useCallback((key: keyof AgentCapabilities) => {
    setCapabilities((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const abortStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setConnectionState("reconnecting");
    setIsLoading(false);
  }, []);

  const runShellCommand = useCallback(
    async (command: string, source: "input" | "response") => {
      const trimmed = command.trim();
      if (!trimmed) return false;

      lastCommandRef.current = trimmed;
      if (/^cd\s+/i.test(trimmed)) {
        currentDirectoryRef.current = trimmed.replace(/^cd\s+/i, "").trim() || trimmed;
      }

      const target = resolveTarget();
      if (!isConnected || !target) {
        appendMessage({
          id: `system-${Date.now()}`,
          role: "system",
          text: "No live agent is connected to the gateway yet. Connect an agent first to run terminal commands.",
          status: "warning",
          timestamp: createTimestamp(),
          metadata: { kind: "warning", step: "completed" },
        });
        return false;
      }

      appendMessage({
        id: `terminal-${Date.now()}`,
        role: "assistant",
        text: `Executing in terminal: ${trimmed}${
          currentDirectoryRef.current
            ? ` (context: ${currentDirectoryRef.current})`
            : ""
        }`,
        status: "executing",
        timestamp: createTimestamp(),
        metadata: {
          kind: "terminal",
          step: source === "input" ? "executing" : "receiving",
          command: trimmed,
        },
      });

      const looksPs =
        /^(?:powershell|pwsh)\b/i.test(trimmed) ||
        /^(?:Get-|Set-|Write-|Select-|Where-|ForEach-|Invoke-|Import-|Export-|New-|Remove-|Start-|Stop-|Test-|ConvertTo-|ConvertFrom-)/i.test(
          trimmed
        ) ||
        trimmed.includes("$_");
      const result = gatewayDispatch(
        "SHELL_EXECUTE",
        { command: trimmed, shell: looksPs ? "powershell" : "cmd" },
        target
      );
      if (!result.ok) {
        appendMessage({
          id: `system-${Date.now() + 1}`,
          role: "system",
          text: "The shell command could not be dispatched. The gateway is currently unavailable.",
          status: "error",
          timestamp: createTimestamp(),
          metadata: { kind: "error", step: "completed" },
        });
        return false;
      }

      return true;
    },
    [appendMessage, gatewayDispatch, isConnected, resolveTarget]
  );

  const sendMessage = useCallback(async (input: string) => {
    const value = input.trim();
    if (!value) return;
    if (isStreaming) {
      abortStreaming();
    }

    const directCommand = extractShellCommand(value);

    if (directCommand) {
      const userMessage: AgentMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        text: value,
        status: "completed",
        timestamp: createTimestamp(),
        metadata: { kind: "terminal" },
      };

      appendMessage(userMessage);
      setDraft("");
      setConnectionState("streaming");
      await runShellCommand(directCommand, "input");
      setConnectionState("ready");
      setIsLoading(false);
      setIsStreaming(false);
      return;
    }

    setIsLoading(true);
    setConnectionState("streaming");
    setIsStreaming(true);
    setDraft("");
    streamStartRef.current = Date.now();

    const userMessage: AgentMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: value,
      status: "completed",
      timestamp: createTimestamp(),
      metadata: { kind: "normal" },
    };

    const assistantId = `assistant-${Date.now() + 1}`;
    const assistantMessage: AgentMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      status: "thinking",
      timestamp: createTimestamp(),
      metadata: {
        kind: "thinking",
        step: "thinking",
        provider: settingsRef.current.provider,
        model: settingsRef.current.model,
      },
    };

    appendMessage(userMessage);
    appendMessage(assistantMessage);

    const controller = new AbortController();
    abortRef.current = controller;

    const effectiveSettings = { ...settingsRef.current };
    const shellCfg = getShellApiConfig();
    const activeProvCfg = shellCfg.providers.find((p) => p.provider === effectiveSettings.provider);
    if (!effectiveSettings.apiKey && activeProvCfg?.apiKey) {
      effectiveSettings.apiKey = activeProvCfg.apiKey;
    }
    if ((!effectiveSettings.model || (effectiveSettings.provider !== "gemini" && effectiveSettings.model.startsWith("gemini"))) && activeProvCfg?.model) {
      effectiveSettings.model = activeProvCfg.model;
    }

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: value,
          messages: [...messagesRef.current, userMessage],
          settings: effectiveSettings,
          capabilities: capabilitiesRef.current,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const errData = await response.json();
          if (errData?.error) {
            errorMsg = typeof errData.error === "string" ? errData.error : JSON.stringify(errData.error);
          } else if (errData?.message) {
            errorMsg = String(errData.message);
          }
        } catch {
          try {
            const rawText = await response.text();
            if (rawText) errorMsg = rawText;
          } catch (_) {}
        }
        throw new Error(errorMsg);
      }

      if (!response.body) {
        throw new Error("Empty response body received from agent backend.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let lastFrameAt = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const now = Date.now();
        const shouldUpdate = now - lastFrameAt > 45 || accumulated.trim().length === 0 || accumulated.endsWith("\n");
        if (shouldUpdate) {
          lastFrameAt = now;
          updateMessage(assistantId, (message) => ({
            ...message,
            text: accumulated,
            status: "streaming",
            metadata: {
              ...message.metadata,
              kind: "normal",
              step: "generating",
              provider: settingsRef.current.provider,
              model: settingsRef.current.model,
            },
          }));
        }
      }

      const finalText = accumulated + decoder.decode();
      if (
  finalText.includes("Directory not found") &&
  currentDirectoryRef.current &&
  lastCommandRef.current
) {
  const retryCommand =
    currentDirectoryRef.current +
    " && " +
    lastCommandRef.current;

  appendMessage({
    id: `retry-${Date.now()}`,
    role: "assistant",
    text: `Retrying with context: ${retryCommand}`,
    status: "executing",
    timestamp: createTimestamp(),
    metadata: {
      kind: "terminal",
      step: "executing",
      command: retryCommand,
    },
  });

  await runShellCommand(retryCommand, "response");
}
      updateMessage(assistantId, (message) => ({
        ...message,
        text: finalText,
        status: "completed",
        metadata: {
          ...message.metadata,
          kind: "success",
          step: "completed",
          provider: settingsRef.current.provider,
          model: settingsRef.current.model,
        },
      }));

      const autoCommand = extractShellCommand(finalText);
      if (autoCommand) {
        try {
          await runShellCommand(autoCommand, "response");
        } catch (shellErr) {
          console.warn("[agent-chat] shell auto-exec failed:", shellErr);
          appendMessage({
            id: `system-${Date.now()}`,
            role: "system",
            text: shellErr instanceof Error ? shellErr.message : "Shell auto-exec failed.",
            status: "warning",
            timestamp: createTimestamp(),
            metadata: { kind: "warning", step: "completed" },
          });
        }
      }

      setConnectionState("ready");
      toast.success("Agent response completed.");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        updateMessage(assistantId, (message) => ({
          ...message,
          text: message.text || "The stream was interrupted.",
          status: "warning",
          metadata: { ...message.metadata, kind: "warning", step: "completed" },
        }));
        setConnectionState("reconnecting");
        alertMsg(Z.STREAM_INTERRUPTED);
      } else {
        updateMessage(assistantId, (message) => ({
          ...message,
          text:
            message.text?.trim() ||
            (error instanceof Error
              ? `Agent request failed: ${error.message}`
              : "The agent backend could not complete the request. Please verify your connection and try again."),
          status: "error",
          metadata: { ...message.metadata, kind: "error", step: "completed" },
        }));
        setConnectionState("error");
        alertMsg(Z.COMMAND_FAILED, error instanceof Error ? error.message : undefined);
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);
      streamStartRef.current = null;
    }
  }, [abortStreaming, appendMessage, isStreaming, runShellCommand, updateMessage]);

  const statusLabel = useMemo(() => {
    if (connectionState === "streaming") return "Streaming";
    if (connectionState === "reconnecting") return "Reconnecting";
    if (connectionState === "error") return "Error";
    return "Ready";
  }, [connectionState]);

  const stopGeneration = useCallback(() => {
    abortStreaming();
  }, [abortStreaming]);

  const clearChat = useCallback(() => {
    const init = initialMessages();
    setMessages(init);
    storeState(STORAGE_KEY, init);
    toast.success("Chat history cleared.");
  }, []);

  return {
    messages,
    draft,
    setDraft,
    sendMessage,
    clearChat,
    abortStreaming,
    settings,
    setSetting,
    capabilities,
    toggleCapability,
    isStreaming,
    isLoading,
    isHydrated,
    connectionState,
    statusLabel,
    stopGeneration,
  };
}
