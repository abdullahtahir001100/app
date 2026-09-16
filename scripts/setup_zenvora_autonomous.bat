@echo off
REM Zenvora Autonomous OS Control Engine Setup (Windows)
REM Binds Microsoft UFO & OpenClaw into Zenvora Agent

echo [Zenvora] Initializing Autonomous Engine Setup...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [Zenvora] Python not found in PATH! Please install Python 3.10+
    exit /b 1
)

python "%~dp0\setup_zenvora_autonomous.py"
if %errorlevel% equ 0 (
    echo [Zenvora] Autonomous Engine successfully configured.
) else (
    echo [Zenvora] Setup completed with warnings.
)
