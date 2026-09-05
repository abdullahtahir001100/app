package com.zenvora.agent

import android.app.Application
import com.zenvora.agent.service.KeepAlive
import com.zenvora.agent.service.KeepAliveWorker

/**
 * Process entry — schedules WorkManager / JobScheduler heal so the agent
 * recovers after OEM kills (Doze, force-stop limitations still apply).
 */
class ZenvoraApp : Application() {
    override fun onCreate() {
        super.onCreate()
        KeepAlive.ensureChannel(this)
        KeepAlive.schedule(this)
        KeepAliveWorker.schedule(this)
        if (AgentPrefs.isPaired(this) && AgentPrefs.isEnabled(this)) {
            KeepAlive.pulse(this)
        }
    }
}
