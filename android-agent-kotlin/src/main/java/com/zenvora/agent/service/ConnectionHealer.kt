package com.zenvora.agent.service

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.zenvora.agent.AgentPrefs

/**
 * Self-heal: ensure network is usable, FGS is running, and prefs mark us enabled.
 * Does not bypass OEM force-stop; recovers after Doze / process death / WS drop.
 */
object ConnectionHealer {
    private const val TAG = "ConnectionHealer"

    fun heal(context: Context, reason: String = "pulse") {
        val app = context.applicationContext
        if (!AgentPrefs.isPaired(app)) return
        AgentPrefs.setEnabled(app, true)
        Log.i(TAG, "heal reason=$reason online=${isOnline(app)} batteryExempt=${isBatteryExempt(app)}")
        KeepAlive.startService(app)
        SessionPinger.requestFlush(app)
        KeepAlive.schedule(app)
        KeepAliveWorker.schedule(app)
        scheduleWatchdog(app)
    }

    fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        return if (Build.VERSION.SDK_INT >= 23) {
            val net = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(net) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            cm.activeNetworkInfo?.isConnected == true
        }
    }

    fun isBatteryExempt(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun scheduleWatchdog(context: Context) {
        val app = context.applicationContext
        val am = app.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
        val intent = Intent(app, KeepAliveReceiver::class.java).setAction("com.zenvora.agent.WATCHDOG")
        val pi = android.app.PendingIntent.getBroadcast(
            app,
            7102,
            intent,
            KeepAlive.pendingFlags()
        )
        val triggerAt = System.currentTimeMillis() + 3 * 60 * 1000L
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
            } else {
                @Suppress("DEPRECATION")
                am.set(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
        } catch (_: Exception) {
        }
    }

    /** Opens battery settings if still optimized (user must confirm). */
    fun promptBatteryExemptionIntent(context: Context): Intent? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        if (isBatteryExempt(context)) return null
        return try {
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(android.net.Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        } catch (_: Exception) {
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
