"use client";

import { useCallback, useRef, useState } from "react";
import { useGateway } from "@/hooks/use-gateway";
import { toast } from "sonner";

export type OpsMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
  actions?: Array<{ action: string; payload?: Record<string, unknown> }>;
};

export type OpsWindowType =
  | "screen"
  | "camera"
  | "usage"
  | "browser"
  | "notifications"
  | "activity"
  | "shell"
  | "note";

export type OpsCanvasWindow = {
  id: string;
  type: OpsWindowType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  data: Record<string, unknown>;
  bornAt: number;
};

export type OpsMonitorChannel = "screen" | "camera" | "off";

const UI_ONLY = new Set(["SHOW_MONITOR", "OPEN_PAGE", "OPEN_WINDOW"]);

const LAYOUT: Record<
  OpsWindowType,
  { w: number; h: number; ox: number; oy: number }
> = {
  note: { w: 320, h: 160, ox: 24, oy: 24 },
  usage: { w: 380, h: 340, ox: 360, oy: 24 },
  browser: { w: 420, h: 360, ox: 24, oy: 220 },
  notifications: { w: 360, h: 320, ox: 460, oy: 220 },
  activity: { w: 440, h: 360, ox: 160, oy: 280 },
  screen: { w: 640, h: 400, ox: 520, oy: 40 },
  camera: { w: 420, h: 320, ox: 720, oy: 280 },
  shell: { w: 400, h: 220, ox: 40, oy: 480 },
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asWindowType(raw: string): OpsWindowType {
  const t = String(raw || "").toLowerCase();
  if (
    t === "screen" ||
    t === "camera" ||
    t === "usage" ||
    t === "browser" ||
    t === "notifications" ||
    t === "activity" ||
    t === "shell" ||
    t === "note"
  ) {
    return t;
  }
  return "note";
}

export function useAgentOps(deviceId: string) {
  const { dispatch, isConnected } = useGateway();
  const [messages, setMessages] = useState<OpsMessage[]>([
    {
      id: "welcome",
      role: "system",
      text: "Bol do — AI canvas pe windows khud open karke data dikhayegi (Stitch style).",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [monitor, setMonitor] = useState<OpsMonitorChannel>("off");
  const [windows, setWindows] = useState<OpsCanvasWindow[]>([]);
  const [zTop, setZTop] = useState(10);
  const [lastActions, setLastActions] = useState<
    Array<{ action: string; payload?: Record<string, unknown> }>
  >([]);
  const deviceRef = useRef(deviceId);
  deviceRef.current = deviceId;
  const slotRef = useRef(0);

  const focusWindow = useCallback((id: string) => {
    setZTop((z) => {
      const next = z + 1;
      setWindows((list) =>
        list.map((w) => (w.id === id ? { ...w, z: next } : w))
      );
      return next;
    });
  }, []);

  const closeWindow = useCallback(
    async (id: string) => {
      setWindows((list) => {
        const closing = list.find((w) => w.id === id);
        if (closing?.type === "screen") {
          dispatch("STOP_SCREEN_STREAM", {}, deviceRef.current);
          setMonitor((m) => (m === "screen" ? "off" : m));
        }
        if (closing?.type === "camera") {
          dispatch("STOP_STREAM", {}, deviceRef.current);
          setMonitor((m) => (m === "camera" ? "off" : m));
        }
        return list.filter((w) => w.id !== id);
      });
    },
    [dispatch]
  );

  const moveWindow = useCallback((id: string, x: number, y: number) => {
    setWindows((list) =>
      list.map((w) => (w.id === id ? { ...w, x: Math.max(0, x), y: Math.max(0, y) } : w))
    );
  }, []);

  const openWindowsFromPlan = useCallback(
    (plan: Array<{ type?: string; title?: string; data?: Record<string, unknown> }>) => {
      if (!Array.isArray(plan) || !plan.length) return;

      setZTop((baseZ) => {
        let z = baseZ;
        const created: OpsCanvasWindow[] = [];
        const stagger = slotRef.current;

        plan.forEach((raw, i) => {
          const type = asWindowType(String(raw.type || "note"));
          const layout = LAYOUT[type];
          const offset = ((stagger + i) % 5) * 28;
          z += 1;
          created.push({
            id: uid(),
            type,
            title: String(raw.title || type),
            x: layout.ox + offset,
            y: layout.oy + offset,
            w: layout.w,
            h: layout.h,
            z,
            data: raw.data && typeof raw.data === "object" ? raw.data : {},
            bornAt: Date.now(),
          });
          if (type === "screen") setMonitor("screen");
          if (type === "camera") setMonitor("camera");
        });

        slotRef.current = stagger + plan.length;
        setWindows((prev) => {
          // Replace same-type data windows; keep unique media.
          const keep = prev.filter((p) => {
            if (p.type === "screen" || p.type === "camera") {
              return !created.some((c) => c.type === p.type);
            }
            if (p.type === "note") return true;
            return !created.some((c) => c.type === p.type);
          });
          return [...keep, ...created];
        });
        return z;
      });
    },
    []
  );

  const runActions = useCallback(
    async (
      actions: Array<{ action: string; payload?: Record<string, unknown> }>
    ): Promise<{ openPath?: string }> => {
      let openPath: string | undefined;
      for (const item of actions) {
        const action = String(item.action || "").toUpperCase();
        const payload = item.payload && typeof item.payload === "object" ? item.payload : {};
        if (!action) continue;

        if (action === "SHOW_MONITOR") {
          const ch = String((payload as { channel?: string }).channel || "screen").toLowerCase();
          setMonitor(ch === "camera" ? "camera" : "screen");
          continue;
        }
        if (action === "OPEN_WINDOW") {
          openWindowsFromPlan([
            {
              type: String((payload as { type?: string }).type || "note"),
              title: String((payload as { title?: string }).title || ""),
              data: (payload as { data?: Record<string, unknown> }).data || {},
            },
          ]);
          continue;
        }
        if (action === "OPEN_PAGE") {
          openPath = String((payload as { path?: string }).path || "");
          continue;
        }
        if (UI_ONLY.has(action)) continue;

        try {
          await dispatch(action, payload, deviceRef.current);
        } catch (err) {
          console.warn("[OPS] dispatch failed", action, err);
          toast.error(`Failed: ${action}`);
        }
      }
      return { openPath };
    },
    [dispatch, openWindowsFromPlan]
  );

  const send = useCallback(
    async (fileContent?: string, apiConfig?: any) => {
      const text = draft.trim();
      if (!text || !deviceId || busy) return;

      setDraft("");
      setBusy(true);
      const userMsg: OpsMessage = {
        id: uid(),
        role: "user",
        text: fileContent
          ? `${text}\n\n[Attached File Content]:\n${fileContent}`
          : text,
        timestamp: new Date().toISOString(),
      };
      setMessages((m) => [...m, userMsg]);

      try {
        const activeProvider = apiConfig?.providers?.find(
          (p: any) => p.provider === apiConfig.activeProvider
        );
        const res = await fetch("/api/agent/ops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            deviceId,
            message: text,
            fileContent: fileContent || null,
            settings: activeProvider
              ? {
                  provider: activeProvider.provider,
                  apiKey: activeProvider.apiKey,
                  model: activeProvider.model,
                }
              : undefined,
            messages: [...messages, userMsg]
              .filter((x) => x.role === "user" || x.role === "assistant")
              .slice(-10)
              .map((x) => ({ role: x.role, text: x.text })),
          }),
        });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      }

      const actions = Array.isArray(data.actions) ? data.actions : [];
      const plan = Array.isArray(data.windows) ? data.windows : [];
      setLastActions(actions);
      openWindowsFromPlan(plan);

      const assistant: OpsMessage = {
        id: uid(),
        role: "assistant",
        text: String(data.reply || "Done."),
        timestamp: new Date().toISOString(),
        actions,
      };
      setMessages((m) => [...m, assistant]);

      const { openPath } = await runActions(actions);
      if (openPath && typeof window !== "undefined") {
        window.location.href = `${openPath}?device=${encodeURIComponent(deviceId)}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ops failed";
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          text: msg,
          timestamp: new Date().toISOString(),
        },
      ]);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, deviceId, draft, messages, openWindowsFromPlan, runActions]);

  const stopMonitor = useCallback(async () => {
    if (!deviceId) return;
    try {
      if (monitor === "screen") await dispatch("STOP_SCREEN_STREAM", {}, deviceId);
      if (monitor === "camera") await dispatch("STOP_STREAM", {}, deviceId);
    } catch {
      /* ignore */
    }
    setMonitor("off");
    setWindows((list) => list.filter((w) => w.type !== "screen" && w.type !== "camera"));
  }, [deviceId, dispatch, monitor]);

  const startMonitor = useCallback(
    async (channel: "screen" | "camera") => {
      if (!deviceId) return;
      try {
        if (channel === "screen") {
          await dispatch(
            "START_SCREEN_STREAM",
            { quality: 70, target_fps: 12 },
            deviceId
          );
          openWindowsFromPlan([{ type: "screen", title: "Live screen", data: {} }]);
        } else {
          await dispatch("START_STREAM", {}, deviceId);
          openWindowsFromPlan([{ type: "camera", title: "Live camera", data: {} }]);
        }
        setMonitor(channel);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Stream failed");
      }
    },
    [deviceId, dispatch, openWindowsFromPlan]
  );

  const clearCanvas = useCallback(() => {
    void stopMonitor();
    setWindows([]);
  }, [stopMonitor]);

  return {
    messages,
    draft,
    setDraft,
    busy,
    send,
    monitor,
    setMonitor,
    startMonitor,
    stopMonitor,
    windows,
    focusWindow,
    closeWindow,
    moveWindow,
    clearCanvas,
    lastActions,
    gatewayStatus: isConnected ? "online" : "offline",
  };
}
