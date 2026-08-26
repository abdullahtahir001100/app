"use client";

import type { AgentMessage } from "@/hooks/use-agent-chat";

interface AgentChatMessageProps {
  message: AgentMessage;
}

export function AgentChatMessage({ message }: AgentChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  
  const isThinking = message.status === "thinking" || message.metadata?.step === "thinking";
  const isExecuting = message.status === "executing" || message.metadata?.kind === "terminal";

  // Clean raw tool_call tags for visual display if any model outputted them raw
  const cleanDisplayText = (text: string) => {
    if (!text) return "";
    return text
      .replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/gi, "")
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .trim();
  };

  const formattedText = cleanDisplayText(message.text || "");

  // Check if message contains markdown images or base64 image data URLs
  const imgMatches = formattedText.match(/!\[(.*?)\]\((data:image\/[^;]+;base64,[^\)]+)\)/i) ||
                     formattedText.match(/(data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+)/i);

  const base64Src = imgMatches?.[2] || imgMatches?.[1];

  return (
    <div className="flex items-start space-x-3 text-zinc-300 py-2.5 border-b border-zinc-800/30 font-sans">
      {/* Left Column SVG Icons */}
      <div className="mt-0.5 flex-shrink-0">
        {isUser ? (
          <div className="flex h-5 w-5 items-center justify-center rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        ) : isSystem ? (
          <div className="flex h-5 w-5 items-center justify-center rounded bg-amber-950/20 text-amber-500 border border-amber-900/30">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
        ) : (
          <div className="flex h-5 w-5 items-center justify-center text-zinc-400">
            <svg className="h-4 w-4 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.904-4.473L21 9l-3.382-3.382-7.805 10.286zm0 0L6.618 7.382M3 21h3.535" />
            </svg>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            {isUser ? "USER" : isSystem ? "SYSTEM" : "COPILOT"}
          </span>
          
          {/* Thinking Status Badge */}
          {isThinking && (
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 font-mono bg-zinc-800/60 px-1.5 py-0.5 rounded border border-zinc-700/30">
              <svg className="animate-spin h-2.5 w-2.5 text-zinc-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              thinking...
            </span>
          )}

          {/* Executing Status Badge */}
          {isExecuting && message.status === "executing" && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-mono bg-amber-950/20 border border-amber-900/40 px-1.5 py-0.5 rounded">
              <svg className="h-2.5 w-2.5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              executing
            </span>
          )}
        </div>

        {/* Text / Terminal Output / Image Presentation Block */}
        <div className="text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap selection:bg-zinc-700">
          {message.metadata?.kind === "terminal" || message.metadata?.command ? (
            <div className="my-2 overflow-hidden rounded border border-zinc-800 bg-[#141414]">
              <div className="flex items-center justify-between bg-[#1a1a1a] px-3 py-1 border-b border-zinc-900 text-[10px] font-mono text-zinc-500">
                <span>Terminal Session</span>
                {message.metadata.exitCode !== undefined && (
                  <span className={message.metadata.exitCode === 0 ? "text-emerald-500" : "text-rose-500"}>
                    exit: {message.metadata.exitCode}
                  </span>
                )}
              </div>
              <pre className="p-3 overflow-x-auto font-mono text-[11px] text-zinc-400 bg-black/10">
                <code>{message.text}</code>
              </pre>
            </div>
          ) : (
            <>
              {formattedText || (isThinking ? <span className="text-zinc-600 italic">Planning action items...</span> : "")}
              {base64Src && (
                <div className="mt-2.5 overflow-hidden rounded-lg border border-zinc-700/60 bg-black/40 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={base64Src}
                    alt="Visual Output"
                    className="max-h-80 w-auto rounded object-contain shadow-md"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

{/* Loading Skeleton */}
export function AgentChatSkeleton() {
  return (
    <div className="flex items-start space-x-3 py-3 opacity-40">
      <div className="flex h-5 w-5 items-center justify-center text-zinc-600 mt-0.5">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.904-4.473L21 9l-3.382-3.382-7.805 10.286zm0 0L6.618 7.382M3 21h3.535" /></svg>
      </div>
      <div className="flex-1 space-y-2">
        <div className="h-3 w-16 bg-zinc-800 rounded animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-2.5 w-full bg-zinc-800 rounded animate-pulse" />
          <div className="h-2.5 w-4/5 bg-zinc-800 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}