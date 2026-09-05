"use client";

import React from "react";
import Link from "next/link";
import { ExternalLink, ArrowLeft, Download, RefreshCw } from "lucide-react";

export default function ArchitecturePage() {
  return (
    <div className="flex flex-col h-screen w-full bg-[#070b14] text-slate-200">
      {/* Top Bar */}
      <div className="h-14 border-b border-slate-800/80 bg-[#0f172a]/90 backdrop-blur-xl px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/devices"
            className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition px-2.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Dashboard
          </Link>
          <div className="h-4 w-px bg-slate-800" />
          <h1 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
            <span>ZENVORA ARCHITECTURE & SYSTEM FLOW DIAGRAMS</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Interactive Visual Suite
            </span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/architecture.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 px-3 py-1.5 rounded-lg transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Fullscreen
          </a>
        </div>
      </div>

      {/* Embedded High-Fidelity Viewer */}
      <div className="flex-1 w-full h-full relative bg-[#070b14]">
        <iframe
          src="/architecture.html"
          className="w-full h-full border-0"
          title="Zenvora Architecture Diagrams"
        />
      </div>
    </div>
  );
}
