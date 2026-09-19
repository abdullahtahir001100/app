package com.zenvora.installer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BootReceiver — restarts InstallerService after device reboot.
 * Also triggers on MY_PACKAGE_REPLACED (ZenInstaller self-update).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "Boot/replace received: ${intent.action} — starting InstallerService")
        InstallerService.start(context)
    }

    companion object {
        private const val TAG = "ZenBootReceiver"
    }
}

/**
 * AgentWatchReceiver — listens for the Zenvora agent being uninstalled.
 * Fires InstallerService immediately to re-install.
 */
class AgentWatchReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pkg = intent.data?.schemeSpecificPart ?: return
        Log.d(TAG, "Package event: ${intent.action} for $pkg")

        if (pkg == BuildConfig.AGENT_PACKAGE) {
            val action = intent.action
            if (action == Intent.ACTION_PACKAGE_REMOVED ||
                action == Intent.ACTION_PACKAGE_FULLY_REMOVED
            ) {
                // Don't reinstall if it's being replaced (update scenario)
                val replacing = intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)
                if (!replacing) {
                    Log.i(TAG, "Agent ($pkg) was removed — triggering reinstall")
                    InstallerService.triggerInstall(context)
                }
            }
        }
    }

    companion object {
        private const val TAG = "AgentWatchReceiver"
    }
}
