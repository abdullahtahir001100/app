const fs = require('fs');
const path = require('path');

const mdPath = path.join(__dirname, '..', 'SYSTEM_ARCHITECTURE_AND_FLOW.md');
const outHtmlPath = path.join(__dirname, '..', 'public', 'architecture.html');

const md = fs.readFileSync(mdPath, 'utf8');
const parts = md.split('```mermaid');

console.log(`Found ${parts.length - 1} mermaid blocks.`);

const diagramTitles = [
  "1. Master All-to-All Component Architecture",
  "2. Public IP Detection & Topology Decision Flow",
  "3. Public IP Dual-Routing Sequence (Direct LAN vs Cloud Relay)",
  "4. End-to-End AI Architecture & Multi-Tier Pipeline",
  "5. On-Device AI Self-Healing & Diagnostic Sequence",
  "6. WebSocket Binary Frame Dispatch Pipeline (0x01–0x07)",
  "7. Desktop Screen Streaming & AnyDesk-Style Hash Diffing Flow",
  "8. Pairing & Bootstrap Lifecycle: CLI vs GUI",
  "9. Dual-Process Mutual Watchdog & Boot Persistence"
];

let diagramCardsHtml = '';

for (let i = 1; i < parts.length; i++) {
  const code = parts[i].split('```')[0].trim();
  const title = diagramTitles[i - 1] || `Diagram ${i}`;
  const id = `diagram-${i}`;

  diagramCardsHtml += `
    <div id="${id}" class="diagram-section bg-white border border-gray-200 rounded-xl shadow-sm p-6 sm:p-10 mb-10 transition-all hover:shadow-md">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-200 mb-6 gap-3">
        <h2 class="text-xl font-bold text-gray-900">${title}</h2>
        <div class="flex items-center gap-2">
          <button onclick="zoomDiagram('${id}', 1.2)" class="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition">Zoom +</button>
          <button onclick="zoomDiagram('${id}', 0.8)" class="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition">Zoom -</button>
          <button onclick="resetZoom('${id}')" class="px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition">Reset</button>
          <button onclick="downloadSvg('${id}', '${title}')" class="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition">Download SVG</button>
          <button onclick="downloadPng('${id}', '${title}')" class="px-3 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition">Download PNG</button>
        </div>
      </div>
      <div class="diagram-viewport overflow-x-auto p-4 flex items-center justify-center bg-white min-h-[260px]">
        <div id="wrapper-${id}" class="diagram-wrapper transition-transform duration-200 origin-top text-center w-full">
          <pre class="mermaid text-center">
${code}
          </pre>
        </div>
      </div>
    </div>
  `;
}

const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zenvora System Architecture Diagrams</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
    }
    .mermaid {
      background-color: #ffffff !important;
    }
    .mermaid svg {
      max-width: 100% !important;
      height: auto !important;
      margin: 0 auto;
    }
  </style>
</head>
<body class="bg-slate-50 min-h-screen py-8 px-4 sm:px-8">

  <div class="max-w-6xl mx-auto">
    <!-- Clean Minimal Header -->
    <header class="mb-8 flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-gray-200 gap-4">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">Zenvora Architecture & Flow Diagrams</h1>
        <p class="text-sm text-gray-500 mt-1">Complete System Architecture &bull; Public IP Routing &bull; AI Self-Healing Engine</p>
      </div>
      <div class="flex items-center gap-3">
        <button onclick="window.print()" class="px-4 py-2 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 rounded-lg border border-gray-300 shadow-sm transition">
          Print / Save PDF
        </button>
      </div>
    </header>

    <!-- Clean White Diagrams List -->
    <main class="space-y-8">
      ${diagramCardsHtml}
    </main>
  </div>

  <!-- Local Mermaid.js Engine -->
  <script src="/mermaid.min.js"></script>
  <script>
    if (typeof mermaid === 'undefined') {
      document.write('<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"><\\/script>');
    }
  </script>

  <script>
    document.addEventListener("DOMContentLoaded", function() {
      if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
          startOnLoad: true,
          theme: 'default',
          themeVariables: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '13px',
            primaryColor: '#e0f2fe',
            primaryTextColor: '#0369a1',
            primaryBorderColor: '#38bdf8',
            lineColor: '#64748b',
            secondaryColor: '#f1f5f9',
            tertiaryColor: '#f8fafc',
            background: '#ffffff',
            mainBkg: '#ffffff',
            nodeBorder: '#cbd5e1',
            clusterBkg: '#f8fafc',
            clusterBorder: '#cbd5e1'
          },
          securityLevel: 'loose',
          flowchart: { curve: 'basis', useMaxWidth: true, htmlLabels: true },
          sequence: { useMaxWidth: true, showSequenceNumbers: true }
        });
      }
    });

    const zoomState = {};

    function zoomDiagram(id, factor) {
      const el = document.getElementById('wrapper-' + id);
      if (!el) return;
      zoomState[id] = (zoomState[id] || 1) * factor;
      el.style.transform = 'scale(' + zoomState[id] + ')';
    }

    function resetZoom(id) {
      const el = document.getElementById('wrapper-' + id);
      if (!el) return;
      zoomState[id] = 1;
      el.style.transform = 'scale(1)';
    }

    function downloadSvg(id, title) {
      const container = document.getElementById('wrapper-' + id);
      const svg = container ? container.querySelector('svg') : null;
      if (!svg) {
        alert('Diagram SVG is rendering. Please wait a second.');
        return;
      }
      const svgData = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = title.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.svg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function downloadPng(id, title) {
      const container = document.getElementById('wrapper-' + id);
      const svg = container ? container.querySelector('svg') : null;
      if (!svg) {
        alert('Diagram SVG is rendering. Please wait a second.');
        return;
      }
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      const bbox = svg.getBoundingClientRect();
      const scale = 2; // High DPI crispness
      canvas.width = (bbox.width || 1200) * scale;
      canvas.height = (bbox.height || 800) * scale;
      
      img.onload = function() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = title.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    }
  </script>
</body>
</html>`;

fs.writeFileSync(outHtmlPath, fullHtml);
console.log(`[✓] Generated clean white-theme architecture diagrams at ${outHtmlPath}`);
