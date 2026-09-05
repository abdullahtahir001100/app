"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Printer,
  ShieldAlert,
  ArrowLeft,
  ExternalLink,
  Layers,
  Cpu,
  Wifi,
  Radio,
  FileCode,
  Download,
  Lock,
  ChevronRight,
} from "lucide-react";
import { ARCHITECTURE_DIAGRAMS, DiagramDef } from "@/lib/architecture-diagrams";

export default function ArchitecturePage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<string>("diagram-1");
  const [zoomMap, setZoomMap] = useState<Record<string, number>>({});
  const [isRendering, setIsRendering] = useState(false);
  const mermaidInitialized = useRef(false);

  // 1. Strict Admin Authorization Check
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include" });
        if (!res.ok) {
          if (mounted) setIsAdmin(false);
          return;
        }
        const data = await res.json();
        const adminRole =
          data?.user?.role === "admin" ||
          (Array.isArray(data?.user?.pages) && data.user.pages.includes("architecture"));
        if (mounted) setIsAdmin(Boolean(adminRole));
      } catch {
        if (mounted) setIsAdmin(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 2. Initialize Mermaid and Render Diagram SVGs
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const renderDiagram = async () => {
      try {
        setIsRendering(true);
        const mermaid = (await import("mermaid")).default;

        if (!mermaidInitialized.current) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            themeVariables: {
              darkMode: true,
              background: "#0b101d",
              primaryColor: "#1e293b",
              primaryTextColor: "#f8fafc",
              primaryBorderColor: "#334155",
              lineColor: "#38bdf8",
              secondaryColor: "#0f172a",
              tertiaryColor: "#1e1b4b",
              textColor: "#f1f5f9",
              mainBkg: "#0f172a",
              nodeBorder: "#3b82f6",
              clusterBkg: "#0b101d",
              clusterBorder: "#1e293b",
            },
            fontFamily: "Inter, sans-serif",
            securityLevel: "loose",
            flowchart: {
              useMaxWidth: true,
              htmlLabels: true,
              curve: "basis",
            },
            sequence: {
              useMaxWidth: true,
              actorMargin: 50,
              showSequenceNumbers: true,
            },
          });
          mermaidInitialized.current = true;
        }

        // Render current active tab diagram
        const targetDiagram = ARCHITECTURE_DIAGRAMS.find((d) => d.id === activeTab);
        if (!targetDiagram) return;

        const container = document.getElementById(`mermaid-container-${targetDiagram.id}`);
        if (!container || cancelled) return;

        const renderId = `mermaid-svg-${targetDiagram.id}-${Date.now()}`;
        const { svg } = await mermaid.render(renderId, targetDiagram.mermaid);

        if (!cancelled && container) {
          container.innerHTML = svg;
          const svgElem = container.querySelector("svg");
          if (svgElem) {
            svgElem.style.maxWidth = "100%";
            svgElem.style.height = "auto";
            svgElem.style.margin = "0 auto";
          }
        }
      } catch (err) {
        console.error("Mermaid render error:", err);
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, activeTab]);

  const currentZoom = zoomMap[activeTab] || 1;

  const handleZoom = (delta: number) => {
    setZoomMap((prev) => {
      const cur = prev[activeTab] || 1;
      const next = Math.min(2.5, Math.max(0.4, Number((cur + delta).toFixed(1))));
      return { ...prev, [activeTab]: next };
    });
  };

  const handleResetZoom = () => {
    setZoomMap((prev) => ({ ...prev, [activeTab]: 1 }));
  };

  const handlePrint = () => {
    window.print();
  };

  const downloadSvg = () => {
    const container = document.getElementById(`mermaid-container-${activeTab}`);
    const svg = container?.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zenvora-${activeTab}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 3. Access Denied / Non-Admin Fallback
  if (isAdmin === false) {
    return (
      <div className="flex h-screen bg-[#070b14] text-slate-200">
        <AppSidebar />
        <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/30 text-destructive mb-4">
            <ShieldAlert className="w-12 h-12 stroke-[1.5]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Administrator Access Required</h1>
          <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
            The Zenvora System Architecture & Flow Suite contains proprietary topology diagrams, dual-routing protocols,
            and security specifications restricted to Administrator accounts.
          </p>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </main>
      </div>
    );
  }

  // 4. Loading State
  if (isAdmin === null) {
    return (
      <div className="flex h-screen bg-[#070b14] text-slate-200">
        <AppSidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3 text-slate-400 font-mono text-sm">
            <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <span>Verifying Administrator Credentials…</span>
          </div>
        </main>
      </div>
    );
  }

  const activeDiagram = ARCHITECTURE_DIAGRAMS.find((d) => d.id === activeTab) || ARCHITECTURE_DIAGRAMS[0];

  return (
    <div className="flex h-screen bg-[#070b14] text-slate-200 overflow-hidden print:bg-white print:text-black">
      <div className="no-print">
        <AppSidebar />
      </div>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Control Bar (Hidden during Print) */}
        <header className="h-16 border-b border-slate-800/80 bg-[#0f172a]/90 backdrop-blur-xl px-6 flex items-center justify-between shrink-0 no-print">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold text-white tracking-wide">
                  SYSTEM ARCHITECTURE & FLOW SUITE
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Admin Verified
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                9 Deep Architecture Flowcharts &bull; Public IP Dual-Routing &bull; AI Self-Healing Protocols
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Zoom Controls */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1">
              <button
                onClick={() => handleZoom(-0.2)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-xs flex items-center gap-1"
                title="Zoom Out (-20%)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-mono px-2 text-slate-300 font-semibold select-none">
                {Math.round(currentZoom * 100)}%
              </span>
              <button
                onClick={() => handleZoom(0.2)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-xs flex items-center gap-1"
                title="Zoom In (+20%)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={handleResetZoom}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-xs"
                title="Reset Zoom (100%)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* SVG Export */}
            <button
              onClick={downloadSvg}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 px-3 py-2 rounded-xl transition"
              title="Download Vector SVG"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export SVG</span>
            </button>

            {/* Print A4 / Export PDF */}
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3.5 py-2 rounded-xl transition"
              title="Print to A4 / Save as PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print A4 / PDF</span>
            </button>
          </div>
        </header>

        {/* Tab Strip (Hidden during Print) */}
        <div className="border-b border-slate-800/80 bg-[#070b14] px-6 py-2 flex items-center gap-2 overflow-x-auto no-print scrollbar-none">
          {ARCHITECTURE_DIAGRAMS.map((diag) => {
            const isActive = activeTab === diag.id;
            return (
              <button
                key={diag.id}
                onClick={() => setActiveTab(diag.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-blue-600 text-white font-bold shadow-md shadow-blue-600/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {diag.number}
                </span>
                <span className="max-w-[170px] truncate">{diag.title}</span>
              </button>
            );
          })}
        </div>

        {/* Diagram Canvas & Viewport */}
        <div className="flex-1 overflow-auto p-6 bg-[#070b14] relative print:p-0 print:overflow-visible">
          {/* Active Diagram Display Card */}
          <div className="max-w-7xl mx-auto rounded-2xl border border-slate-800/80 bg-[#0b101d] p-6 shadow-xl relative min-h-[600px] print:border-none print:shadow-none print:p-0 print:bg-white">
            {/* Title & Metadata Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800/80 mb-6 gap-3 print:border-black">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-blue-400 font-bold">
                  Diagram #{activeDiagram.number} OF {ARCHITECTURE_DIAGRAMS.length}
                </span>
                <h2 className="text-lg font-bold text-white tracking-tight print:text-black mt-0.5">
                  {activeDiagram.fullTitle}
                </h2>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400 no-print">
                <span className="px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60">
                  Mermaid v11
                </span>
                <span className="px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60">
                  Vector Scalable
                </span>
              </div>
            </div>

            {/* Mermaid Render Container */}
            <div className="overflow-auto min-h-[460px] flex items-center justify-center p-2">
              <div
                style={{
                  transform: `scale(${currentZoom})`,
                  transformOrigin: "top center",
                  transition: "transform 0.15s ease-out",
                  width: "100%",
                }}
                className="text-center"
              >
                <div
                  id={`mermaid-container-${activeDiagram.id}`}
                  className="mermaid-render-box flex items-center justify-center"
                />
              </div>
            </div>
          </div>
        </div>

        {/* PRINT ONLY: Render ALL 9 diagrams sequentially for clean A4 PDF export */}
        <div className="hidden print:block print:w-full">
          {ARCHITECTURE_DIAGRAMS.map((diag) => (
            <div key={diag.id} className="print-diagram-page my-6">
              <div className="border-b-2 border-black pb-2 mb-4">
                <h2 className="text-xl font-bold text-black">{diag.fullTitle}</h2>
                <p className="text-xs text-gray-600 font-mono">Zenvora Autonomous Systems Architecture Suite</p>
              </div>
              <pre className="mermaid text-center">{diag.mermaid}</pre>
            </div>
          ))}
        </div>
      </main>

      {/* Embedded Print Styles for Crisp A4 Export */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body {
            background: #ffffff !important;
            color: #000000 !important;
          }
          .no-print {
            display: none !important;
          }
          .print-diagram-page {
            page-break-after: always;
            break-after: page;
            background: #ffffff !important;
            color: #000000 !important;
            padding: 0 !important;
            border: none !important;
          }
          .mermaid svg {
            max-width: 100% !important;
            height: auto !important;
          }
        }
      `}</style>
    </div>
  );
}
