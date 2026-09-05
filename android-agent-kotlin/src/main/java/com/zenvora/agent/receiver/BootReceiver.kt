package com.zenvora.agent.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.service.KeepAlive
import com.zenvora.agent.service.KeepAliveWorker

/**
 * Starts the foreground agent after boot, update, or unlock (Android 5–15).
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val boot = action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.LOCKED_BOOT_COMPLETED" ||
            action == "android.intent.action.QUICKBOOT_POWERON"
        if (boot && !AgentPrefs.startOnBoot(context)) return
        if (!boot &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != Intent.ACTION_USER_PRESENT
        ) return
        KeepAlive.pulse(context)
        KeepAlive.schedule(context)
        KeepAliveWorker.schedule(context)
    }
}
