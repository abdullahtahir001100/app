package com.zenvora.agent.activity

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.R
import com.zenvora.agent.service.ConnectionHealer
import com.zenvora.agent.service.KeepAlive

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!AgentPrefs.isPaired(this)) {
            startActivity(Intent(this, PairActivity::class.java))
            finish()
            return
        }
        if (!AgentPrefs.permissionsOnboarded(this)) {
            startActivity(Intent(this, PermissionsActivity::class.java))
            finish()
            return
        }

        setContentView(R.layout.activity_main)
        findViewById<TextView>(R.id.modelText).text = AgentPrefs.hostname()
        refreshStatus()

        if (AgentPrefs.isPaired(this)) {
            KeepAlive.pulse(this)
            KeepAlive.schedule(this)
        }

        findViewById<Button>(R.id.doneButton).setOnClickListener { moveTaskToBack(true) }
    }

    override fun onResume() {
        super.onResume()
        if (AgentPrefs.isPaired(this)) {
            KeepAlive.pulse(this)
            if (!ConnectionHealer.isBatteryExempt(this)) {
                ConnectionHealer.promptBatteryExemptionIntent(this)?.let { startActivity(it) }
            }
        }
        if (findViewById<TextView>(R.id.onlineBadge) != null) {
            refreshStatus()
        }
    }

    private fun refreshStatus() {
        val badge = findViewById<TextView>(R.id.onlineBadge)
        badge.setText(
            if (AgentPrefs.isConnected(this)) R.string.online else R.string.offline
        )
    }
}
