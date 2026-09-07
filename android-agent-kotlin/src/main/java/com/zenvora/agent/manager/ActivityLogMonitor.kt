package com.zenvora.agent.manager

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Foreground-app changes → activity_log packets, same shape as the Windows agent.
 */
class ActivityLogMonitor(
    private val context: Context,
    private val deviceId: String,
    private val onLog: (JSONObject) -> Unit
) {
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private var job: Job? = null
    private var lastPackage = ""
    private var lastEventAt = 0L
    private val appActivity = AppActivityManager(context)
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> emit("screen_locked", "session", "Screen locked")
                Intent.ACTION_SCREEN_ON -> emit("screen_unlocked", "session", "Screen unlocked")
                Intent.ACTION_POWER_CONNECTED -> emit("power_connected", "power", "Charger connected")
                Intent.ACTION_POWER_DISCONNECTED -> emit("power_disconnected", "power", "Charger disconnected")
            }
        }
    }

    fun start() {
        if (job != null) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(screenReceiver, filter)
        }
        lastEventAt = System.currentTimeMillis() - 15_000
        // No 60s poll — app sessions are captured by Accessibility.
    }

    fun stop() {
        job?.cancel()
        job = null
        try {
            context.unregisterReceiver(screenReceiver)
        } catch (_: Exception) {
        }
    }

    private fun pollUsage() {
        if (!appActivity.hasUsageAccess()) return
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
        val now = System.currentTimeMillis()
        val events = usm.queryEvents(lastEventAt, now)
        lastEventAt = now
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType != UsageEvents.Event.MOVE_TO_FOREGROUND) continue
            val pkg = event.packageName ?: continue
            if (pkg == context.packageName || pkg == lastPackage) continue
            lastPackage = pkg
            val label = appLabel(pkg)
            val browser = isBrowser(pkg)
            emit(
                action = if (browser) "browser_opened" else "app_opened",
                category = if (browser) "browser" else "application",
                details = label,
                extra = JSONObject()
                    .put("app", label)
                    .put("appName", label)
                    .put("process", pkg)
                    .put("processName", pkg)
                    .put("executablePath", pkg)
                    .put("windowTitle", label)
            )
        }
    }

    fun emit(action: String, category: String, details: String, extra: JSONObject = JSONObject()) {
        onLog(
            JSONObject().apply {
                put("type", "activity_log")
                put("deviceId", deviceId)
                put("action", action)
                put("category", category)
                put("status", "success")
                put("device", deviceId)
                put("details", details)
                put("metadata", extra)
                put("createdAt", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                    timeZone = java.util.TimeZone.getTimeZone("UTC")
                }.format(java.util.Date()))
            }
        )
    }

    private fun appLabel(packageName: String): String {
        return try {
            val pm = context.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
        } catch (_: Exception) {
            packageName
        }
    }

    private fun isBrowser(pkg: String): Boolean {
        val p = pkg.lowercase()
        return p.contains("chrome") || p.contains("firefox") || p.contains("browser") ||
            p.contains("opera") || p.contains("brave") || p.contains("edge") || p.contains("samsung.android.sbrowser")
    }
}
