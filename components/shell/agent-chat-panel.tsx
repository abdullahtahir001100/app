"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { AgentChatMessage, AgentChatSkeleton } from "./agent-chat-message";
import {
  useApiConfig,
  PROVIDER_OPTIONS,
  type ProviderKey,
} from "@/hooks/use-api-config";

type ViewState = "chat" | "settings";

export function AgentChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>("chat");
  const [width, setWidth] = useState(420);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* ── Shell API Multi-Provider Config ─────────────────────── */
  const {
    config: apiConfig,
    activeProvider: shellActiveProvider,
    setActiveProvider,
    setProviderApiKey,
    setProviderModel,
  } = useApiConfig("shell");

  const [editingProviderKey, setEditingProviderKey] = useState<ProviderKey | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    messages,
    draft,
    setDraft,
    sendMessage,
    clearChat,
    settings,
    setSetting,
    capabilities,
    toggleCapability,
    isLoading,
    isHydrated,
    statusLabel,
    stopGeneration,
  } = useAgentChat();

  const handleActivateProvider = (pKey: ProviderKey) => {
    setActiveProvider(pKey);
    setSetting("provider", pKey);
    const provConfig = apiConfig.providers.find((p) => p.provider === pKey);
    if (provConfig) {
      if (provConfig.apiKey) setSetting("apiKey", provConfig.apiKey);
      if (provConfig.model) setSetting("model", provConfig.model);
    }
  };

  const handleUpdateApiKey = (pKey: ProviderKey, keyVal: string) => {
    setProviderApiKey(pKey, keyVal);
    if (settings.provider === pKey) {
      setSetting("apiKey", keyVal);
    }
  };

  const handleUpdateModel = (pKey: ProviderKey, modelVal: string) => {
    setProviderModel(pKey, modelVal);
    if (settings.provider === pKey) {
      setSetting("model", modelVal);
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (event: MouseEvent) => {
      if (dragRef.current === null) return;
      const nextWidth = window.innerWidth - event.clientX;
      const clamped = Math.min(Math.max(nextWidth, 320), 800);
      setWidth(clamped);
    };

    const stop = () => setIsDragging(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", stop);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", stop);
    };
  }, [isDragging]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const panelStyle = useMemo(() => {
    const resolvedWidth =
      isFullscreen && typeof window !== "undefined"
        ? Math.max(window.innerWidth - 24, 320)
        : width;
    return { width: `${resolvedWidth}px` };
  }, [width, isFullscreen]);

  const handleBack = () => {
    if (currentView === "settings") {
      setCurrentView("chat");
      return;
    }
    setIsOpen(false);
  };

  const handleSend = () => {
    const value = draft.trim();
    if (!value) return;
    void sendMessage(value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey) {
      event.preventDefault();
      handleSend();
      return;
    }

    if (event.key === "Enter" && (event.shiftKey || event.ctrlKey)) {
      event.preventDefault();
      setDraft((prev) => `${prev}\n`);
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; }
      `}</style>

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        aria-label="Open Zenvora agent"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7 8.5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M7 12h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M7 15.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="fixed right-0 top-0 z-30 flex h-screen border-l border-gray-200 bg-white shadow-[0_20px_80px_rgba(15,23,42,0.16)]"
          style={panelStyle}
        >
          <div
            className="absolute left-0 top-0 z-40 h-full w-1.5 cursor-col-resize bg-transparent transition hover:bg-gray-200"
            onMouseDown={(event) => {
              event.preventDefault();
              dragRef.current = event.clientX;
              setIsDragging(true);
            }}
            aria-label="Resize agent panel"
          />

          <div className={`${isFullscreen ? 'mwe0' : 'ww'} ml-[2px] flex h-full w-full flex-col overflow-hidden bg-white text-slate-900`}>
            <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 py-3" data-purpose="main-header">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-semibold tracking-wider text-gray-500">
                  {currentView === "settings" ? (
                    <button
                      onClick={handleBack}
                      className="flex items-center transition hover:text-gray-800"
                    >
                      <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      </svg>
                      BACK
                    </button>
                  ) : (
                    <span>CHAT</span>
                  )}
                </div>
                <div className="flex items-center space-x-4 text-gray-400">
                  <button
                    type="button"
                    onClick={clearChat}
                    className="transition hover:text-rose-600"
                    title="Clear chat history"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentView(currentView === "chat" ? "settings" : "chat")}
                    className={`transition hover:text-gray-600 ${currentView === "settings" ? "text-gray-800" : ""}`}
                    title="Agent configuration"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                    </svg>
                  </button>
                  <button onClick={() => setIsFullscreen((prev) => !prev)} title="Toggle fullscreen">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <div className="flex items-center text-sm font-bold tracking-tight text-gray-800 uppercase">
                    {currentView === "chat" ? (
                      <>
                      </>
                    ) : (
                      "AGENT CONFIGURATION"
                    )}
                  </div>
                  {currentView === "chat" && (
                    <div className="mt-1 flex items-center space-x-2">
                    </div>
                  )}
                </div>
              </div>
            </header>

            <main ref={scrollRef} className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-4" data-purpose="scroll-area">
              {currentView === "settings" ? (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="rounded-none border border-slate-300 bg-slate-50 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Centralized AI Configuration
                    </div>
                    <div className="mt-2 text-sm text-slate-800">
                      Active Provider: <span className="font-semibold">{PROVIDER_OPTIONS.find((p) => p.key === settings.provider)?.label || settings.provider}</span> ({settings.model})
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      All AI API keys, models, and variables are centrally managed in Workspace Settings.
                    </p>
                    <a
                      href="/settings"
                      className="mt-4 inline-flex items-center gap-2 rounded-none bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
                    >
                      Open Workspace Settings →
                    </a>
                  </div>

                  {/* Agent Capabilities */}
                  <section className="space-y-3 border-t border-slate-200 pt-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Agent Capabilities
                    </h3>
                    <div className="space-y-2">
                      {[
                        { key: "aiLoop", label: "Use AI Loop (Autonomous iterations)" },
                        { key: "webSocket", label: "WebSocket Streaming (Real-time output)" },
                        { key: "cmdExecution", label: "CMD Execution (Run shell commands)" },
                        { key: "sessionMemory", label: "Session Memory (Context retention)" },
                        { key: "autoRetries", label: "Automatic Retries on failure" },
                        { key: "errorRecovery", label: "Intelligent Error Recovery" },
                        { key: "multiStep", label: "Multi-step Task Execution" },
                      ].map((item) => (
                        <label key={item.key} className="group flex cursor-pointer items-center space-x-3">
                          <div className={`flex h-4 w-4 items-center justify-center border rounded-none ${capabilities[item.key as keyof typeof capabilities] ? "border-slate-900 bg-slate-900" : "border-slate-400 bg-transparent"} transition-colors`}>
                            {capabilities[item.key as keyof typeof capabilities] && (
                              <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="3" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={capabilities[item.key as keyof typeof capabilities]}
                            onChange={() => toggleCapability(item.key as keyof typeof capabilities)}
                          />
                          <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <AgentChatMessage key={message.id} message={message} />
                  ))}
                  {(isLoading || !isHydrated) && <AgentChatSkeleton />}
                </>
              )}
            </main>

            {currentView === "chat" && (
              <footer className="space-y-3 border-t border-gray-100 bg-white p-3" data-purpose="interaction-footer">
                <div className="rounded-lg border border-gray-200 p-2 transition-all focus-within:ring-1 focus-within:ring-gray-300">
                  <div className="mb-2 flex items-center space-x-2">
                    {/* <div className="flex items-center rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5">
                      <svg className="mr-1 h-3 w-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      </svg>
                      <span className="font-mono text-[10px] italic text-gray-500">agent-chat-panel.tsx</span>
                    </div> */}
                  </div>
                  <textarea
                    className="w-full resize-none border-0 p-0 text-sm placeholder-gray-400 outline-none focus:ring-0"
                    placeholder="Describe what to build"
                    rows={Math.min(6, Math.max(2, draft.split("\n").length))}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <div className="mt-1 flex items-center justify-between">
                    <div className="flex items-center space-x-3 text-gray-400">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      </svg>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      </svg>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button className="flex items-center space-x-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">
                        <span>Agent</span>
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                        </svg>
                      </button>
                      <button className="rounded border border-gray-200 bg-gray-50 p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Quick actions">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"></path>
                        </svg>
                      </button>
                      <button className="rounded p-1 text-gray-400 hover:text-gray-600">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                        </svg>
                      </button>
                      {isLoading ? (
                        <button onClick={stopGeneration} className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-600 transition hover:bg-rose-100">
                          Stop
                        </button>
                      ) : (
                        <button onClick={handleSend} className="rounded p-1 text-gray-300 transition hover:text-gray-500">
                          <svg className="h-4 w-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between px-1 pb-2 pt-1 text-[10px] text-gray-500">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center">
                      <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      </svg>
                      {statusLabel}
                    </div>
                    <div className="flex items-center">
                      <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 12l2 2 4-4m5.618-4.016A3.33 3.33 0 0018.333 3H5.667a3.33 3.33 0 00-3.333 3.333v10.667a3.33 3.33 0 003.333 3.333h12.666a3.33 3.33 0 003.333-3.333V6.317c0-.91-.74-1.65-1.65-1.65-.112 0-.223.012-.332.033z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      </svg>
                      Default Approvals
                    </div>
                  </div>
                  <div className="h-2 w-2 rounded-full border border-gray-300"></div>
                </div>
              </footer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
