package com.zenvora.installer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean

/**
 * InstallerService — long-running foreground service that:
 *
 *  1. On start: checks if Zenvora agent is installed.
 *     If NOT installed → downloads from server + installs silently.
 *  2. Watchdog loop: every 30 minutes re-checks agent presence.
 *     If removed → re-installs automatically.
 *  3. Listens for ACTION_INSTALL_RESULT broadcasts from [InstallStatusReceiver].
 */
class InstallerService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val installing = AtomicBoolean(false)

    // Receives install result from PackageInstaller session
    private val installResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val ok = intent.getBooleanExtra(EXTRA_INSTALL_OK, false)
            val msg = intent.getStringExtra(EXTRA_INSTALL_MSG) ?: ""
            if (ok) {
                Log.i(TAG, "Agent installed successfully!")
                updateNotification("Zenvora Agent installed ✓")
            } else {
                Log.e(TAG, "Agent install failed: $msg")
                updateNotification("Install failed — will retry")
                installing.set(false)
                // Retry after 5 minutes
                scope.launch {
                    delay(5 * 60 * 1000L)
                    ensureAgentInstalled()
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Zenvora Device Manager active"))

        // Register install result receiver
        val filter = IntentFilter(ACTION_INSTALL_RESULT)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(installResultReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(installResultReceiver, filter)
        }

        Log.d(TAG, "InstallerService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand action=${intent?.action}")

        when (intent?.action) {
            ACTION_INSTALL_NOW -> {
                scope.launch { ensureAgentInstalled() }
            }
            ACTION_CHECK_ONLY -> {
                scope.launch { ensureAgentInstalled() }
            }
            else -> {
                // Normal start: begin watchdog loop
                scope.launch { watchdogLoop() }
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        try { unregisterReceiver(installResultReceiver) } catch (_: Exception) {}
        Log.d(TAG, "InstallerService destroyed — will restart via START_STICKY")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ─────────────────────────────────────────────────────────
    //  Core logic
    // ─────────────────────────────────────────────────────────

    /** Runs forever: check agent every 30 min, install if missing. */
    private suspend fun watchdogLoop() {
        Log.d(TAG, "Watchdog loop started")
        while (true) {
            ensureAgentInstalled()
            delay(WATCHDOG_INTERVAL_MS)
        }
    }

    /** Check if agent is installed; if not, download + install silently. */
    private suspend fun ensureAgentInstalled() {
        if (installing.get()) {
            Log.d(TAG, "Install already in progress — skipping")
            return
        }

        val agentPackage = BuildConfig.AGENT_PACKAGE
        if (isPackageInstalled(agentPackage)) {
            Log.d(TAG, "Agent ($agentPackage) is installed — nothing to do")
            updateNotification("Zenvora Agent is running ✓")
            return
        }

        // Agent not present → install it
        Log.i(TAG, "Agent not found — starting silent install")
        installing.set(true)
        updateNotification("Installing Zenvora Agent…")

        val prefs = applicationContext.getSharedPreferences("zen_installer_prefs", Context.MODE_PRIVATE)
        val customUrl = prefs.getString("agent_apk_url", null)
        val downloadUrl = if (!customUrl.isNullOrBlank()) customUrl else BuildConfig.AGENT_APK_URL
        Log.i(TAG, "Downloading agent full APK from: $downloadUrl")

        val result = SilentInstaller.downloadAndInstall(
            context = applicationContext,
            url = downloadUrl,
            onProgress = { read, total ->
                if (total > 0) {
                    val pct = (read * 100 / total).toInt()
                    updateNotification("Downloading… $pct%")
                }
            }
        )

        when (result) {
            is SilentInstaller.InstallResult.Success -> {
                Log.i(TAG, "Install session committed — waiting for STATUS broadcast")
                // Actual result arrives via InstallStatusReceiver broadcast
            }
            is SilentInstaller.InstallResult.Failure -> {
                Log.e(TAG, "Install failed: ${result.reason}")
                updateNotification("Install error — will retry")
                installing.set(false)
            }
            else -> {}
        }
    }

    private fun isPackageInstalled(packageName: String): Boolean {
        return try {
            packageManager.getPackageInfo(packageName, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Notification helpers
    // ─────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Zenvora Device Manager",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps Zenvora agent installed and running"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Zenvora Device Manager")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID, buildNotification(text))
    }

    companion object {
        private const val TAG = "InstallerService"
        private const val CHANNEL_ID = "zen_installer"
        private const val NOTIF_ID = 9901
        private const val WATCHDOG_INTERVAL_MS = 30 * 60 * 1000L // 30 minutes

        const val ACTION_INSTALL_NOW = "com.zenvora.installer.INSTALL_NOW"
        const val ACTION_CHECK_ONLY = "com.zenvora.installer.CHECK_ONLY"
        const val ACTION_INSTALL_RESULT = "com.zenvora.installer.INSTALL_RESULT"
        const val EXTRA_INSTALL_OK = "install_ok"
        const val EXTRA_INSTALL_MSG = "install_msg"

        fun start(context: Context) {
            val intent = Intent(context, InstallerService::class.java)
            context.startForegroundService(intent)
        }

        fun triggerInstall(context: Context) {
            val intent = Intent(context, InstallerService::class.java).apply {
                action = ACTION_INSTALL_NOW
            }
            context.startForegroundService(intent)
        }
    }
}
