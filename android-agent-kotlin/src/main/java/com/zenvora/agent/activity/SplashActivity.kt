package com.zenvora.agent.activity

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.R

class SplashActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        findViewById<TextView>(R.id.deviceIdText).text = AgentPrefs.deviceId(this)
        findViewById<TextView>(R.id.versionText).text = "v1.7.1"
        val progress = findViewById<ProgressBar>(R.id.initProgress)
        val percent = findViewById<TextView>(R.id.progressPercent)

        val handler = Handler(Looper.getMainLooper())
        var value = 0
        val tick = object : Runnable {
            override fun run() {
                value += 8
                if (value > 61) value = 61
                progress.progress = value
                percent.text = "$value%"
                if (value < 61) {
                    handler.postDelayed(this, 80)
                } else {
                    continueFlow()
                }
            }
        }
        handler.post(tick)
    }

    private fun continueFlow() {
        val next = when {
            !AgentPrefs.isPaired(this) -> Intent(this, PairActivity::class.java)
            !AgentPrefs.permissionsOnboarded(this) -> Intent(this, PermissionsActivity::class.java)
            else -> Intent(this, MainActivity::class.java)
        }
        if (AgentPrefs.isPaired(this)) {
            com.zenvora.agent.service.KeepAlive.pulse(this)
            com.zenvora.agent.service.KeepAlive.schedule(this)
        }
        startActivity(next)
        finish()
    }
}
