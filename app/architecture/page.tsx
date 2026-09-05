"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Printer,
  ShieldAlert,
  ArrowLeft,
  Download,
  FileText,
  Layers,
  ChevronRight,
  ExternalLink,
  Code2,
  CheckCircle2,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { ARCHITECTURE_DIAGRAMS, DiagramDef } from "@/lib/architecture-diagrams";

let mermaidInitialized = false;

// Safe dynamic loader for Mermaid via CDN script
function loadMermaid(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject("SSR");
  if ((window as any).mermaid) return Promise.resolve((window as any).mermaid);

  return new Promise((resolve, reject) => {
    const existing = document.getElementById("zenvora-mermaid-script");
    if (existing) {
      if ((window as any).mermaid) {
        resolve((window as any).mermaid);
      } else {
        existing.addEventListener("load", () => resolve((window as any).mermaid));
        existing.addEventListener("error", (e) => reject(e));
      }
      return;
    }

    const script = document.createElement("script");
    script.id = "zenvora-mermaid-script";
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
    script.async = true;
    script.onload = () => {
      if ((window as any).mermaid) {
        resolve((window as any).mermaid);
      } else {
        reject(new Error("Mermaid object not attached to window"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load Mermaid from CDN"));
    document.head.appendChild(script);
  });
}

// Dedicated, crash-safe SVG viewer using dangerouslySetInnerHTML on an empty leaf node
const MermaidSvgViewer = React.memo(function MermaidSvgViewer({
  diagramId,
  mermaidCode,
  zoom = 1,
  className = "",
}: {
  diagramId: string;
  mermaidCode: string;
  zoom?: number;
  className?: string;
}) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const render = async () => {
      try {
        const mermaid = await loadMermaid();
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "default",
            themeVariables: {
              fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
              fontSize: "13px",
              primaryColor: "#e0f2fe",
              primaryTextColor: "#0369a1",
              primaryBorderColor: "#38bdf8",
              lineColor: "#64748b",
              secondaryColor: "#f1f5f9",
              tertiaryColor: "#f8fafc",
              background: "#ffffff",
              mainBkg: "#ffffff",
              nodeBorder: "#cbd5e1",
              clusterBkg: "#f8fafc",
              clusterBorder: "#cbd5e1",
            },
            securityLevel: "loose",
            flowchart: { curve: "basis", useMaxWidth: true, htmlLabels: true },
            sequence: { useMaxWidth: true, showSequenceNumbers: true },
          });
          mermaidInitialized = true;
        }

        const renderId = `zen-svg-${diagramId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { svg } = await mermaid.render(renderId, mermaidCode);

        if (!cancelled) {
          setSvgContent(svg);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.warn("Mermaid render error for " + diagramId, err);
          setError(err?.message || "Failed to render vector diagram");
          setLoading(false);
        }
      }
    };

    render();

    return () => {
      cancelled = true;
    };
  }, [diagramId, mermaidCode]);

  return (
    <div className={`relative flex flex-col items-center justify-center w-full min-h-[360px] ${className}`}>
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-500 font-mono text-xs">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
          <span>Generating High-DPI Vector SVG…</span>
        </div>
      )}

      {error && !loading && (
        <div className="p-6 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm text-center my-auto max-w-lg">
          <p className="font-bold mb-1">Rendering Notice</p>
          <p className="text-xs">{error}</p>
          <a
            href="/architecture.html"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-50 transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in Standalone Viewer
          </a>
        </div>
      )}

      {!loading && !error && svgContent && (
        <div
          id={`mermaid-container-${diagramId}`}
          style={{
            transform: zoom !== 1 ? `scale(${zoom})` : undefined,
            transformOrigin: "top center",
            transition: "transform 0.15s ease-out",
            width: "100%",
          }}
          className="flex items-center justify-center w-full overflow-visible"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      )}
    </div>
  );
});

export default function ArchitecturePage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<"canvas" | "document">("canvas");
  const [activeTab, setActiveTab] = useState<string>("diagram-1");
  const [zoomMap, setZoomMap] = useState<Record<string, number>>({});

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

  const downloadSvg = (targetId = activeTab) => {
    const container = document.getElementById(`mermaid-container-${targetId}`);
    const svg = container?.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zenvora_${targetId}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadPng = (targetId = activeTab) => {
    const container = document.getElementById(`mermaid-container-${targetId}`);
    const svg = container?.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    const bbox = svg.getBoundingClientRect();
    const scale = 2;
    canvas.width = (bbox.width || 1200) * scale;
    canvas.height = (bbox.height || 800) * scale;

    img.onload = () => {
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pngUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `zenvora_${targetId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  // 3. Access Denied (Non-Admin)
  if (isAdmin === false) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 mb-4 shadow-sm">
          <ShieldAlert className="w-12 h-12 stroke-[1.5]" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">
          Administrator Access Required
        </h1>
        <p className="text-sm text-gray-600 max-w-md mb-6 leading-relaxed">
          The Zenvora System Architecture Suite contains proprietary network topology, dual-routing protocols,
          and security specifications restricted strictly to Administrator credentials.
        </p>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 shadow-sm transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // 4. Loading State
  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-600 font-mono text-sm">
          <div className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
          <span>Verifying Administrator Credentials…</span>
        </div>
      </div>
    );
  }

  const activeDiagram = ARCHITECTURE_DIAGRAMS.find((d) => d.id === activeTab) || ARCHITECTURE_DIAGRAMS[0];

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900 flex flex-col font-sans">
      {/* Top Application Bar - Clean Light Aesthetics */}
      <header className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between sticky top-0 z-50 shadow-sm no-print">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200/80 px-3 py-1.5 rounded-lg border border-gray-300 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>

          <div className="h-4 w-px bg-gray-300" />

          <div className="flex items-center gap-2">
            <h1 className="text-sm font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
              <span>ZENVORA ARCHITECTURE & FLOW SUITE</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Verified Admin
              </span>
            </h1>
          </div>
        </div>

        {/* View Switcher & Actions */}
        <div className="flex items-center gap-3">
          {/* Mode Switcher: Canvas vs Document */}
          <div className="flex items-center bg-gray-100 border border-gray-200 rounded-lg p-1">
            <button
              onClick={() => setViewMode("canvas")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === "canvas"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Interactive Canvas</span>
            </button>

            <button
              onClick={() => setViewMode("document")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === "document"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Full Project Specs</span>
            </button>
          </div>

          {/* Canvas Zoom Controls (Only in Canvas mode) */}
          {viewMode === "canvas" && (
            <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
              <button
                onClick={() => handleZoom(-0.2)}
                className="p-1 rounded text-gray-600 hover:bg-gray-100 transition"
                title="Zoom Out (-20%)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-bold px-2 text-gray-700 min-w-[48px] text-center select-none">
                {Math.round(currentZoom * 100)}%
              </span>
              <button
                onClick={() => handleZoom(0.2)}
                className="p-1 rounded text-gray-600 hover:bg-gray-100 transition"
                title="Zoom In (+20%)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={handleResetZoom}
                className="p-1 rounded text-gray-600 hover:bg-gray-100 transition ml-0.5"
                title="Reset Zoom"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Export & Print */}
          {viewMode === "canvas" && (
            <>
              <button
                onClick={() => downloadSvg(activeTab)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg shadow-sm transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>SVG</span>
              </button>
              <button
                onClick={() => downloadPng(activeTab)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg shadow-sm transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PNG</span>
              </button>
            </>
          )}

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg shadow-sm transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print A4 / PDF</span>
          </button>
        </div>
      </header>

      {/* VIEW 1: INTERACTIVE DIAGRAM CANVAS WITH TABS (NO SIDEBAR) */}
      {viewMode === "canvas" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs Navigation Strip */}
          <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-2 overflow-x-auto no-print shadow-sm">
            {ARCHITECTURE_DIAGRAMS.map((diag) => {
              const isActive = activeTab === diag.id;
              return (
                <button
                  key={diag.id}
                  onClick={() => setActiveTab(diag.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                    isActive
                      ? "bg-blue-600 text-white font-bold shadow-sm"
                      : "text-gray-700 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded text-[10px] flex items-center justify-center font-bold ${
                      isActive ? "bg-white/20 text-white" : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {diag.number}
                  </span>
                  <span>{diag.title}</span>
                </button>
              );
            })}
          </div>

          {/* Diagram Canvas Card */}
          <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-slate-50">
            <div className="w-full max-w-6xl bg-white border border-gray-200 rounded-xl shadow-sm p-6 sm:p-8 flex flex-col min-h-[600px]">
              {/* Diagram Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-200 mb-6 gap-3">
                <div>
                  <span className="text-[11px] font-mono font-bold text-blue-600 uppercase tracking-wider">
                    DIAGRAM {activeDiagram.number} OF {ARCHITECTURE_DIAGRAMS.length}
                  </span>
                  <h2 className="text-xl font-bold text-gray-900 mt-0.5">
                    {activeDiagram.fullTitle}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2.5 py-1 rounded border border-gray-200">
                    Vector High-DPI
                  </span>
                </div>
              </div>

              {/* Diagram Canvas Viewport */}
              <div className="diagram-viewport overflow-auto p-4 flex items-center justify-center min-h-[460px]">
                <MermaidSvgViewer
                  key={activeDiagram.id}
                  diagramId={activeDiagram.id}
                  mermaidCode={activeDiagram.mermaid}
                  zoom={currentZoom}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: FULL PROJECT ARCHITECTURE SPECIFICATION & DOCUMENTATION */}
      {viewMode === "document" && (
        <div className="flex-1 overflow-auto bg-slate-50 py-8 px-4 sm:px-12">
          <div className="max-w-5xl mx-auto space-y-12">
            {/* Document Header */}
            <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">
                Zenvora Enterprise System Architecture & Specifications
              </h1>
              <p className="text-sm text-gray-600 leading-relaxed">
                Comprehensive technical architecture, dual-routing protocols, binary framing pipelines,
                and multi-tier autonomous self-healing engines.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-gray-200 text-xs font-mono">
                <div>
                  <span className="text-gray-500 block">Agent Core:</span>
                  <span className="font-bold text-gray-900">Rust 1.80 (Tokio / Async)</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Web Cockpit:</span>
                  <span className="font-bold text-gray-900">Next.js 14 + React 18</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Media Streaming:</span>
                  <span className="font-bold text-gray-900">MozJPEG + Binary 0x04</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Routing Protocol:</span>
                  <span className="font-bold text-gray-900">WAN IP Dual-Routing</span>
                </div>
              </div>
            </div>

            {/* Sequential Diagram Sections */}
            {ARCHITECTURE_DIAGRAMS.map((diag) => (
              <div
                key={diag.id}
                id={diag.id}
                className="bg-white border border-gray-200 rounded-xl p-6 sm:p-10 shadow-sm space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-200 gap-3">
                  <div>
                    <span className="text-xs font-mono font-bold text-blue-600">
                      Section {diag.number}
                    </span>
                    <h2 className="text-xl font-bold text-gray-900 mt-0.5">{diag.fullTitle}</h2>
                  </div>
                  <div className="flex items-center gap-2 no-print">
                    <button
                      onClick={() => downloadSvg(diag.id)}
                      className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition"
                    >
                      Download SVG
                    </button>
                    <button
                      onClick={() => downloadPng(diag.id)}
                      className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition"
                    >
                      Download PNG
                    </button>
                  </div>
                </div>

                {/* Embedded Diagram */}
                <div className="diagram-viewport overflow-auto p-4 flex items-center justify-center bg-white min-h-[300px]">
                  <MermaidSvgViewer
                    diagramId={`doc-${diag.id}`}
                    mermaidCode={diag.mermaid}
                    zoom={1}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PRINT STYLES FOR CRISP A4 PDF EXPORT */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm;
          }
          body {
            background: #ffffff !important;
            color: #000000 !important;
          }
          .no-print {
            display: none !important;
          }
          .diagram-viewport {
            overflow: visible !important;
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
