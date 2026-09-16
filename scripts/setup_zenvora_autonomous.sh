#!/usr/bin/env bash
# Zenvora Autonomous OS Control Engine Setup (macOS / Linux)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_CMD="python3"

if ! command -v "$PYTHON_CMD" &> /dev/null; then
    echo "[Zenvora Error] python3 is not installed or not in PATH."
    exit 1
fi

"$PYTHON_CMD" "$SCRIPT_DIR/setup_zenvora_autonomous.py"
