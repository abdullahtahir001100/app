#!/usr/bin/env python3
import os
import re
import base64
import json
import urllib.request
import urllib.parse
import sys

DIAGRAM_NAMES = [
    ("01_master_all_to_all_architecture", "Master All-to-All Component Architecture"),
    ("02_public_ip_decision_flow", "Public IP Detection & Topology Decision Flow"),
    ("03_public_ip_sequence_dual_routing", "Public IP Dual-Routing Sequence (Direct LAN vs Cloud Relay)"),
    ("04_end_to_end_ai_architecture", "End-to-End AI Architecture & Multi-Tier Pipeline"),
    ("05_ai_self_healing_sequence", "On-Device AI Self-Healing & Diagnostic Sequence"),
    ("06_binary_framing_pipeline", "WebSocket Binary Frame Dispatch Pipeline"),
    ("07_desktop_screen_hash_diffing", "Screen Streaming & FNV-1a Hash Diffing Flow"),
    ("08_pairing_lifecycle_cli_vs_gui", "Pairing & Bootstrap Lifecycle (CLI vs GUI)"),
    ("09_dual_process_watchdog_lifecycle", "Dual-Process Mutual Watchdog Lifecycle"),
]

def encode_mermaid(code: str, theme: str = "neutral") -> str:
    data = {
        "code": code,
        "mermaid": {
            "theme": theme
        }
    }
    json_bytes = json.dumps(data).encode("utf-8")
    return base64.b64encode(json_bytes).decode("ascii")

def download_diagram(code: str, out_svg_path: str, out_png_path: str, title: str):
    print(f"[*] Processing: {title}...")
    encoded = encode_mermaid(code.strip())
    
    # SVG URL
    svg_url = f"https://mermaid.ink/svg/{encoded}"
    # PNG URL
    png_url = f"https://mermaid.ink/img/{encoded}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
    }
    
    # Fetch SVG
    try:
        req = urllib.request.Request(svg_url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            svg_data = resp.read()
            with open(out_svg_path, "wb") as f:
                f.write(svg_data)
            print(f"  [+] Saved SVG: {out_svg_path} ({len(svg_data)} bytes)")
    except Exception as e:
        print(f"  [-] Failed to fetch SVG for {title}: {e}")

    # Fetch PNG
    try:
        req = urllib.request.Request(png_url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            png_data = resp.read()
            with open(out_png_path, "wb") as f:
                f.write(png_data)
            print(f"  [+] Saved PNG: {out_png_path} ({len(png_data)} bytes)")
    except Exception as e:
        print(f"  [-] Failed to fetch PNG for {title}: {e}")

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    md_file = os.path.join(root_dir, "SYSTEM_ARCHITECTURE_AND_FLOW.md")
    
    out_dir_docs = os.path.join(root_dir, "docs", "diagrams")
    out_dir_public = os.path.join(root_dir, "public", "diagrams")
    os.makedirs(out_dir_docs, exist_ok=True)
    os.makedirs(out_dir_public, exist_ok=True)

    with open(md_file, "r", encoding="utf-8") as f:
        md_content = f.read()

    # Match ```mermaid blocks
    blocks = []
    lines = md_content.splitlines()
    in_mermaid = False
    current_block = []

    for line in lines:
        if line.strip() == "```mermaid":
            in_mermaid = True
            current_block = []
            continue
        elif in_mermaid and line.strip() == "```":
            in_mermaid = False
            blocks.append("\n".join(current_block))
            current_block = []
            continue
        elif in_mermaid:
            current_block.append(line)

    print(f"Found {len(blocks)} Mermaid diagram blocks in {md_file}")

    for idx, block in enumerate(blocks):
        if idx < len(DIAGRAM_NAMES):
            name, title = DIAGRAM_NAMES[idx]
        else:
            name = f"diagram_{idx+1}"
            title = f"Diagram {idx+1}"

        svg_docs = os.path.join(out_dir_docs, f"{name}.svg")
        png_docs = os.path.join(out_dir_docs, f"{name}.png")
        svg_public = os.path.join(out_dir_public, f"{name}.svg")
        png_public = os.path.join(out_dir_public, f"{name}.png")

        download_diagram(block, svg_docs, png_docs, title)
        
        # Copy to public for web dashboard access
        if os.path.exists(svg_docs):
            with open(svg_docs, "rb") as sf, open(svg_public, "wb") as pf:
                pf.write(sf.read())
        if os.path.exists(png_docs):
            with open(png_docs, "rb") as sf, open(png_public, "wb") as pf:
                pf.write(sf.read())

    print("\n[✓] All diagrams generated successfully!")

if __name__ == "__main__":
    main()
