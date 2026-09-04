#!/bin/bash
# Setup script for Zenvora Android Agent
# Installs APK and grants all required permissions

set -e

APK_PATH="${1:-build/outputs/apk/release/app-release.apk}"

if [ ! -f "$APK_PATH" ]; then
    echo "Error: APK not found at $APK_PATH"
    echo "Build first with: ./gradlew assembleRelease"
    exit 1
fi

echo "=== Zenvora Android Agent Setup ==="
echo ""

# Check if adb is available
if ! command -v adb &> /dev/null; then
    echo "Error: adb command not found. Install Android SDK Tools."
    exit 1
fi

# Install APK
echo "[1/3] Installing APK..."
adb install -r "$APK_PATH"

echo "[1/3] ✅ APK installed successfully"
echo ""

# Grant permissions
echo "[2/3] Granting permissions..."

# Core device access permissions
echo "  - Camera, Audio, Files..."
adb shell pm grant com.zenvora.agent android.permission.CAMERA
adb shell pm grant com.zenvora.agent android.permission.RECORD_AUDIO
adb shell pm grant com.zenvora.agent android.permission.READ_EXTERNAL_STORAGE
adb shell pm grant com.zenvora.agent android.permission.WRITE_EXTERNAL_STORAGE

# Network permissions
echo "  - Network access..."
adb shell pm grant com.zenvora.agent android.permission.INTERNET
adb shell pm grant com.zenvora.agent android.permission.ACCESS_NETWORK_STATE
adb shell pm grant com.zenvora.agent android.permission.CHANGE_NETWORK_STATE
adb shell pm grant com.zenvora.agent android.permission.ACCESS_WIFI_STATE
adb shell pm grant com.zenvora.agent android.permission.CHANGE_WIFI_STATE

# Android-specific permissions
echo "  - Call logs, SMS, Contacts..."
adb shell pm grant com.zenvora.agent android.permission.READ_CALL_LOG
adb shell pm grant com.zenvora.agent android.permission.READ_SMS
adb shell pm grant com.zenvora.agent android.permission.READ_CONTACTS
adb shell pm grant com.zenvora.agent android.permission.READ_PHONE_STATE

# App activity and notifications
echo "  - App activity, Notifications..."
adb shell pm grant com.zenvora.agent android.permission.POST_NOTIFICATIONS

# PACKAGE_USAGE_STATS is special app access and cannot be granted with pm grant.
echo "  - Usage access must be enabled manually in Settings > Special app access > Usage access"

# Location (optional)
echo "  - Location (optional)..."
adb shell pm grant com.zenvora.agent android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.zenvora.agent android.permission.ACCESS_COARSE_LOCATION

echo "[2/3] ✅ All permissions granted"
echo ""

# Start service
echo "[3/3] Starting service..."
adb shell am startservice com.zenvora.agent/.service.AgentService

echo "[3/3] ✅ Service started"
echo ""

# Check status
echo "=== Checking Status ==="
echo ""

echo "Service running:"
adb shell dumpsys activity services | grep -i "AgentService" || echo "  (checking...)"

echo ""
echo "Permissions granted:"
adb shell pm list permissions -g com.zenvora.agent | grep -c "android.permission" || echo "  (checking...)"

echo ""
echo "Logcat output (last 20 lines):"
adb logcat -d | tail -20

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Service should now be running on the device."
echo "Check logs with: adb logcat | grep 'zenvora\\|AgentService\\|GatewayClient'"
echo ""
