#!/usr/bin/env python3
"""
Zenvora Autonomous Engine - Unified Setup & Binding Script
Bundles Python dependencies, Microsoft UFO AgentOS, OpenClaw executor, and Rust agent configs in one step.
"""

import sys
import os
import subprocess
import shutil
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

def log(msg: str):
    print(f"\033[1;36m==> [Zenvora Autonomous Setup] {msg}\033[0m")

def ok(msg: str):
    print(f"\033[1;32m[OK] {msg}\033[0m")

def warn(msg: str):
    print(f"\033[1;33m[WARN] {msg}\033[0m")

def main():
    log("Starting Zenvora Autonomous OS Control Engine Setup...")
    
    # 1. Verify Python version
    major, minor = sys.version_info[:2]
    if major < 3 or minor < 10:
        warn(f"Python 3.10+ recommended for full Microsoft UFO vision. Found: {sys.version}")
    else:
        ok(f"Python runtime verified: {sys.version.split()[0]}")

    # 2. Setup config symlink / alias for UFO modular config system
    config_dir = APP_ROOT / "config"
    ufo_config_dir = APP_ROOT / "ufo_config"
    if not config_dir.exists() and ufo_config_dir.exists():
        try:
            if sys.platform == "win32":
                # On Windows, copy or junction
                subprocess.run(f'mklink /J "{config_dir}" "{ufo_config_dir}"', shell=True, check=False)
            else:
                config_dir.symlink_to(ufo_config_dir)
            ok("Linked ufo_config -> config for modular configuration loader")
        except Exception as e:
            warn(f"Config link notice: {e}")

    # 3. Install core dependencies
    req_file = APP_ROOT / "requirements-ufo.txt"
    if req_file.exists():
        log("Installing Microsoft UFO & OpenClaw dependencies...")
        try:
            cmd = [sys.executable, "-m", "pip", "install", "-r", str(req_file), "--quiet"]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0:
                ok("UFO & OpenClaw Python dependencies installed successfully.")
            else:
                warn(f"Pip notice: {res.stderr.strip() or 'Some packages skipped'}")
        except Exception as e:
            warn(f"Dependency install warning: {e}")

    # 4. Generate & Synchronize agents.yaml
    log("Synchronizing LLM credentials into UFO AgentOS...")
    try:
        from ufo_config.config_bridge import sync_ufo_agent_config
        synced = sync_ufo_agent_config()
        if synced:
            ok("Synchronized config/ufo/agents.yaml with active LLM keys.")
        else:
            warn("Could not write agents.yaml, check file permissions.")
    except Exception as e:
        warn(f"Config synchronization notice: {e}")

    # 5. Verify UFO Orchestrator
    bridge_script = APP_ROOT / "ufo_bridge.py"
    if bridge_script.exists():
        ok(f"Orchestrator bridge ready: {bridge_script}")

    log("Setup complete! Zenvora is now bound with Microsoft UFO & OpenClaw for full OS control.")

if __name__ == "__main__":
    main()
