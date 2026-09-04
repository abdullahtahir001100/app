package com.zenvora.agent.gateway

import com.zenvora.agent.AgentPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class PairingClient(
    private val apiUrl: String = AgentPrefs.DEFAULT_API_URL
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    data class PairResult(
        val agentToken: String,
        val gatewayUrl: String
    )

    suspend fun pair(
        pairingToken: String,
        pairingUserId: String,
        deviceId: String,
        hostname: String
    ): PairResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("pairingToken", pairingToken.trim())
            put("pairingUserId", pairingUserId.trim())
            put("deviceId", deviceId)
            put("hostname", hostname)
            put("platform", "android")
        }
        val base = apiUrl.trimEnd('/')
        val request = Request.Builder()
            .url("$base/api/auth/agent/pair")
            .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val json = try {
                JSONObject(text)
            } catch (_: Exception) {
                JSONObject()
            }
            if (!response.isSuccessful) {
                val message = json.optString("message")
                    .ifBlank { json.optString("error") }
                    .ifBlank { "Pairing failed (${response.code})" }
                throw IllegalStateException(message)
            }
            val token = json.optString("agentToken")
            val gateway = json.optString("gatewayUrl")
            if (token.isBlank()) {
                throw IllegalStateException("Server did not return an agent token")
            }
            PairResult(token, gateway)
        }
    }
}
