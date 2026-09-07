package com.zenvora.agent.manager

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import com.zenvora.agent.service.SessionPinger
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Records third-party app foreground sessions and pings after 15 minutes in the same app.
 */
class AppSessionTracker(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    private var currentPkg = ""
    private var currentName = ""
    private var sessionStart = 0L
    private val pingTick = object : Runnable {
        override fun run() {
            if (currentPkg.isNotBlank()) {
                val elapsed = ((System.currentTimeMillis() - sessionStart) / 1000L).coerceAtLeast(1L)
                EventQueue.add(
                    context,
                    "FETCH_APP_HISTORY",
                    JSONObject()
                        .put("appName", currentName.ifBlank { currentPkg })
                        .put("executablePath", currentPkg)
                        .put("lastOpened", iso.format(Date(sessionStart)))
                        .put("appType", "app")
                        .put("category", "session")
                        .put("duration", elapsed)
                        .put("windowsUser", "android")
                )
                SessionPinger.requestFlush(context)
                handler.postDelayed(this, SAME_APP_PING_MS)
            }
        }
    }

    fun onForeground(packageName: String) {
        val pkg = packageName.trim()
        if (pkg.isBlank() || pkg == context.packageName) return
        if (isSystemPackage(pkg)) return
        if (pkg == currentPkg) return
        closeSession()
        currentPkg = pkg
        currentName = appLabel(pkg)
        sessionStart = System.currentTimeMillis()
        EventQueue.add(
            context,
            "FETCH_ACTIVITY_LOG",
            JSONObject()
                .put("action", "app_opened")
                .put("category", "application")
                .put("appName", currentName)
                .put("processName", pkg)
                .put("executablePath", pkg)
                .put("device", "Android")
                .put("details", currentName)
                .put("status", "success")
                .put("duration", 0)
        )
        handler.removeCallbacks(pingTick)
        handler.postDelayed(pingTick, SAME_APP_PING_MS)
        SessionPinger.requestFlushDebounced(context)
    }

    fun closeSession() {
        handler.removeCallbacks(pingTick)
        if (currentPkg.isBlank() || sessionStart <= 0L) {
            currentPkg = ""
            return
        }
        val duration = ((System.currentTimeMillis() - sessionStart) / 1000L).coerceAtLeast(1L)
        EventQueue.add(
            context,
            "FETCH_APP_HISTORY",
            JSONObject()
                .put("appName", currentName.ifBlank { currentPkg })
                .put("executablePath", currentPkg)
                .put("lastOpened", iso.format(Date(sessionStart)))
                .put("appType", "app")
                .put("category", "session")
                .put("duration", duration)
                .put("windowsUser", "android")
        )
        EventQueue.add(
            context,
            "FETCH_ACTIVITY_LOG",
            JSONObject()
                .put("action", "app_closed")
                .put("category", "application")
                .put("appName", currentName.ifBlank { currentPkg })
                .put("processName", currentPkg)
                .put("executablePath", currentPkg)
                .put("device", "Android")
                .put("details", currentName.ifBlank { currentPkg })
                .put("status", "success")
                .put("duration", duration)
                .put("lastOpened", iso.format(Date(sessionStart)))
                .put("metadata", JSONObject().put("duration", duration))
        )
        currentPkg = ""
        currentName = ""
        sessionStart = 0L
        SessionPinger.requestFlushDebounced(context)
    }

    private fun appLabel(pkg: String): String {
        return try {
            val pm = context.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (_: Exception) {
            pkg.substringAfterLast('.')
        }
    }

    private fun isSystemPackage(pkg: String): Boolean {
        val p = pkg.lowercase(Locale.US)
        if (SYSTEM_PREFIXES.any { p.startsWith(it) }) return true
        if (SYSTEM_EXACT.contains(p)) return true
        return try {
            val info = context.packageManager.getApplicationInfo(pkg, 0)
            val flags = info.flags
            val system = flags and ApplicationInfo.FLAG_SYSTEM != 0
            val updated = flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP != 0
            system && !updated && !THIRD_PARTY_OVERRIDE.any { p.contains(it) }
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        private const val SAME_APP_PING_MS = 15 * 60 * 1000L
        private val SYSTEM_PREFIXES = listOf(
            "com.android.",
            "android.",
            "com.google.android.",
            "com.qualcomm.",
            "com.samsung.android.lool",
            "com.sec.android.app.launcher",
            "com.miui.home",
            "com.oppo.launcher",
            "com.android.launcher",
            "com.huawei.android.launcher"
        )
        private val SYSTEM_EXACT = setOf(
            "com.android.settings",
            "com.android.systemui",
            "com.android.phone",
            "com.android.dialer",
            "com.android.contacts",
            "com.android.mms",
            "com.google.android.permissioncontroller",
            "com.google.android.inputmethod.latin",
            "com.android.inputmethod.latin"
        )
        private val THIRD_PARTY_OVERRIDE = listOf(
            "chrome", "youtube", "maps", "gmail", "photos", "drive", "whatsapp",
            "instagram", "facebook", "telegram", "twitter", "tiktok"
        )
    }
}
