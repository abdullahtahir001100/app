"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { AgentChatMessage, AgentChatSkeleton } from "./agent-chat-message";

type ViewState = "chat" | "settings";

const PROVIDERS = [
  { id: "gemini", label: "Google Gemini", icon: "M12 2L2 22h20L12 2z" },
  { id: "chatgpt", label: "OpenAI ChatGPT", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16z" },
  { id: "openrouter", label: "OpenRouter", icon: "M4 4h16v16H4V4zm2 2v12h12V6H6z" },
  { id: "grok", label: "xAI Grok", icon: "M3 3l18 18M21 3L3 21" },
  { id: "claude", label: "Anthropic Claude", icon: "M12 2L2 12l10 10 10-10L12 2z" },
];

export function AgentChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>("chat");
  const [width, setWidth] = useState(420);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const {
    messages,
    draft,
    setDraft,
    sendMessage,
    settings,
    setSetting,
    capabilities,
    toggleCapability,
    isLoading,
    isHydrated,
    statusLabel,
    stopGeneration,
  } = useAgentChat();

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
    const resolvedWidth = isFullscreen ? Math.max(window.innerWidth - 24, 320) : width;
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
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 0px; }
      `}</style>

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-8 w-8 items-center justify-center rounded-none border border-slate-300 bg-white text-slate-800 transition hover:border-slate-500 hover:bg-slate-50"
        aria-label="Open Zenvora agent"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
          <rect x="3.5" y="4.5" width="17" height="15" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 8.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          <path d="M7 12h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          <path d="M7 15.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="fixed right-0 top-0 z-30 flex h-screen border-l border-slate-300 bg-[#fafafa] shadow-none"
          style={panelStyle}
        >
          <div
            className="absolute left-0 top-0 z-40 h-full w-1.5 cursor-col-resize bg-transparent transition hover:bg-slate-300"
            onMouseDown={(event) => {
              event.preventDefault();
              dragRef.current = event.clientX;
              setIsDragging(true);
            }}
            aria-label="Resize agent panel"
          />

          <div className="ml-[2px] flex h-full w-full flex-col overflow-hidden bg-[#fafafa] text-slate-900">
            <header className="sticky top-0 z-10 border-b border-slate-200 bg-[#fafafa] px-4 py-3" data-purpose="main-header">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-semibold tracking-wider text-slate-500">
                  {currentView === "settings" ? (
                    <button
                      onClick={handleBack}
                      className="flex items-center transition-colors hover:text-slate-800"
                    >
                      <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="2"></path>
                      </svg>
                      BACK
                    </button>
                  ) : (
                    <span>CHAT</span>
                  )}
                </div>
                <div className="flex items-center space-x-4 text-slate-400">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="transition-colors hover:text-slate-800"
                    aria-label="Close"
                    title="Close"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M6 18L18 6M6 6l12 12" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="2"></path>
                    </svg>
                  </button>
                  <button
                    onClick={() => setCurrentView(currentView === "chat" ? "settings" : "chat")}
                    className={`transition-colors hover:text-slate-800 ${currentView === "settings" ? "text-slate-800" : ""}`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="2"></path>
                      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="2"></path>
                    </svg>
                  </button>
                  <button onClick={() => setIsFullscreen((prev) => !prev)} className="transition-colors hover:text-slate-800">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="2"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <div className="flex items-center text-sm font-bold tracking-tight text-slate-800 uppercase">
                    {currentView === "chat" ? "AGENT INTERFACE" : "AGENT CONFIGURATION"}
                  </div>
                </div>
              </div>
            </header>

            <main ref={scrollRef} className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-4" data-purpose="scroll-area">
              {currentView === "settings" ? (
                <div className="space-y-8 animate-in fade-in duration-200">
                  <section className="space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Connected Providers</h3>
                    <div className="grid max-h-[40vh] grid-cols-2 gap-3 overflow-y-auto pr-1 custom-scrollbar">
                      {PROVIDERS.map((p) => {
                        const isActive = settings.provider === p.id;
                        return (
                          <button
                            key={p.id}
                            onClick={() => setSetting("provider", p.id)}
                            className={`group flex flex-col items-start justify-between rounded-none border p-3 transition-colors ${isActive
                                ? "border-slate-800 bg-slate-100"
                                : "border-slate-300 bg-white hover:border-slate-400"
                              }`}
                          >
                            <div className="flex w-full items-center justify-between mb-3">
                              <svg className={`h-5 w-5 ${isActive ? "text-slate-800" : "text-slate-400 group-hover:text-slate-600"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d={p.icon} strokeLinecap="square" strokeLinejoin="miter" />
                              </svg>
                              <div className={`h-2 w-2 rounded-none ${isActive ? "bg-slate-800" : "bg-transparent"}`} />
                            </div>
                            <div className="text-left">
                              <span className={`block text-xs font-semibold ${isActive ? "text-slate-800" : "text-slate-600 group-hover:text-slate-800"}`}>
                                {p.label}
                              </span>
                              <span className="text-[10px] text-slate-400 mt-0.5 block">
                                {isActive ? "Connected" : "Select to connect"}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-3 pt-4 border-t border-slate-200">
                      <input
                        type="text"
                        placeholder="Model Override (optional)"
                        value={settings.model}
                        onChange={(event) => setSetting("model", event.target.value)}
                        className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-800 placeholder-slate-400 shadow-none outline-none transition-colors focus:border-slate-800"
                      />
                      <input
                        type="password"
                        placeholder="Paste your API Key here (sk-...)"
                        value={settings.apiKey}
                        onChange={(event) => setSetting("apiKey", event.target.value)}
                        className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-800 placeholder-slate-400 shadow-none outline-none transition-colors focus:border-slate-800"
                      />
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Agent Capabilities</h3>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { key: "aiLoop", label: "Use AI Loop (Autonomous iterations)" },
                        { key: "webSocket", label: "WebSocket Streaming (Real-time output)" },
                        { key: "cmdExecution", label: "CMD Execution (Run shell commands)" },
                        { key: "sessionMemory", label: "Session Memory (Context retention)" },
                        { key: "autoRetries", label: "Automatic Retries on failure" },
                        { key: "errorRecovery", label: "Intelligent Error Recovery" },
                        { key: "multiStep", label: "Multi-step Task Execution" },
                      ].map((item) => (
                        <label key={item.key} className="group flex cursor-pointer items-center space-x-3 rounded-none border border-slate-200 bg-white p-2.5 transition-colors hover:border-slate-300">
                          <div className={`flex h-4 w-4 items-center justify-center border rounded-none ${capabilities[item.key as keyof typeof capabilities] ? "border-slate-800 bg-slate-800" : "border-slate-300 bg-white"} transition-colors`}>
                            {capabilities[item.key as keyof typeof capabilities] && (
                              <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={capabilities[item.key as keyof typeof capabilities]}
                            onChange={() => toggleCapability(item.key as keyof typeof capabilities)}
                          />
                          <span className="text-[12px] font-medium text-slate-600 transition-colors group-hover:text-slate-800">{item.label}</span>
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
                  {(isLoading || !isHydrated) && (
                    <div className="flex w-full items-center justify-center py-4">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 animate-spin text-slate-800" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-[11px] font-semibold tracking-widest text-slate-500 uppercase">Processing</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </main>

            {currentView === "chat" && (
              <footer className="space-y-3 border-t border-slate-200 bg-[#fafafa] p-3" data-purpose="interaction-footer">
                <div className="rounded-none border border-slate-300 bg-white p-2 transition-colors focus-within:border-slate-800">
                  <textarea
                    className="w-full resize-none border-0 p-1 text-sm text-slate-800 placeholder-slate-400 outline-none focus:ring-0"
                    placeholder="Describe what to build..."
                    rows={Math.min(6, Math.max(2, draft.split("\n").length))}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                    <div className="flex items-center space-x-3 text-slate-400">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M12 4v16m8-8H4" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.5"></path>
                      </svg>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.5"></path>
                      </svg>
                    </div>
                    <div className="flex items-center space-x-2">
                      {isLoading ? (
                        <button onClick={stopGeneration} className="rounded-none border border-slate-800 bg-slate-800 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-slate-700">
                          Stop
                        </button>
                      ) : (
                        <button onClick={handleSend} className="rounded-none bg-slate-800 p-1.5 text-white transition-colors hover:bg-slate-700">
                          <svg className="h-4 w-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.5"></path>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between px-1 pb-1 pt-1 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center">
                      <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.5"></path>
                      </svg>
                      {statusLabel}
                    </div>
                    <div className="flex items-center">
                      <svg className="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M9 12l2 2 4-4m5.618-4.016A3.33 3.33 0 0018.333 3H5.667a3.33 3.33 0 00-3.333 3.333v10.667a3.33 3.33 0 003.333 3.333h12.666a3.33 3.33 0 003.333-3.333V6.317c0-.91-.74-1.65-1.65-1.65-.112 0-.223.012-.332.033z" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.5"></path>
                      </svg>
                      Default Approvals
                    </div>
                  </div>
                  <div className="h-1.5 w-1.5 bg-slate-800"></div>
                </div>
              </footer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}