package com.zenvora.agent.manager

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import org.json.JSONArray
import org.json.JSONObject

class AppActivityManager(private val context: Context) {
    fun hasUsageAccess(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun fetch(hours: Int = 24): JSONArray {
        val out = JSONArray()
        if (!hasUsageAccess()) return out
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return out
        val end = System.currentTimeMillis()
        val start = end - hours * 3600_000L
        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_BEST, start, end) ?: return out
        stats.filter { it.totalTimeInForeground > 0 }
            .sortedByDescending { it.lastTimeUsed }
            .take(200)
            .forEach { stat ->
                out.put(JSONObject().apply {
                    put("appName", appLabel(stat.packageName))
                    put("executablePath", stat.packageName)
                    put("lastOpened", iso(dayStart(stat.lastTimeUsed)))
                    put("duration", stat.totalTimeInForeground / 1000)
                    put("appType", "app")
                    put("category", "usagestats")
                    put("windowsUser", "android")
                })
            }
        return out
    }

    private fun appLabel(packageName: String): String {
        return try {
            val pm = context.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
        } catch (_: Exception) {
            packageName
        }
    }

    private fun dayStart(ms: Long): Long {
        val day = 24L * 60L * 60L * 1000L
        return ms - (ms % day)
    }

    private fun iso(ms: Long): String {
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
        fmt.timeZone = java.util.TimeZone.getTimeZone("UTC")
        return fmt.format(java.util.Date(ms))
    }
}
