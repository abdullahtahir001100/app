package com.zenvora.agent.manager

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.activity.SplashActivity

/**
 * Manages enterprise launcher icon visibility / stealth mode.
 */
object StealthManager {

    fun setLauncherIconVisible(context: Context, visible: Boolean) {
        val app = context.applicationContext
        val component = ComponentName(app, SplashActivity::class.java)
        val state = if (visible) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }
        try {
            app.packageManager.setComponentEnabledSetting(
                component,
                state,
                PackageManager.DONT_KILL_APP
            )
            AgentPrefs.setStealthMode(app, !visible)
        } catch (_: Exception) {
        }
    }

    fun isLauncherIconVisible(context: Context): Boolean {
        val app = context.applicationContext
        val component = ComponentName(app, SplashActivity::class.java)
        return try {
            val state = app.packageManager.getComponentEnabledSetting(component)
            state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        } catch (_: Exception) {
            true
        }
    }
}
