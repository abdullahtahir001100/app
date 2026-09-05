package com.zenvora.agent.activity

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.R
import com.zenvora.agent.gateway.PairingClient
import kotlinx.coroutines.launch

class PairActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pair)

        val tokenInput = findViewById<EditText>(R.id.pairTokenInput)
        val userInput = findViewById<EditText>(R.id.pairUserIdInput)
        val errorView = findViewById<TextView>(R.id.pairError)
        val connect = findViewById<Button>(R.id.connectButton)

        connect.setOnClickListener {
            val token = tokenInput.text.toString().trim()
            val userId = userInput.text.toString().trim()
            if (token.length != 6 || userId.length != 6) {
                errorView.visibility = View.VISIBLE
                errorView.setText(R.string.pair_error)
                return@setOnClickListener
            }
            connect.isEnabled = false
            errorView.visibility = View.GONE
            lifecycleScope.launch {
                try {
                    val result = PairingClient(AgentPrefs.apiUrl(this@PairActivity)).pair(
                        pairingToken = token,
                        pairingUserId = userId,
                        deviceId = AgentPrefs.deviceId(this@PairActivity),
                        hostname = AgentPrefs.hostname()
                    )
                    AgentPrefs.setAgentToken(this@PairActivity, result.agentToken)
                    AgentPrefs.setGatewayUrl(this@PairActivity, result.gatewayUrl)
                    AgentPrefs.setEnabled(this@PairActivity, true)
                    startActivity(Intent(this@PairActivity, PermissionsActivity::class.java))
                    finish()
                } catch (e: Exception) {
                    errorView.visibility = View.VISIBLE
                    errorView.text = e.message ?: getString(R.string.pair_error)
                    connect.isEnabled = true
                }
            }
        }
    }
}
