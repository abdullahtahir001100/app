package com.zenvora.agent.gateway

import android.os.Build
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * JSON gateway — stays connected for the life of the process.
 * Dropped sockets are reopened immediately; only auth failure stops retries.
 */
class GatewayClient(
    private val gatewayUrl: String,
    private val deviceId: String,
    private val agentToken: String
) {
    private val TAG = "GatewayClient"
    private val client = OkHttpClient.Builder()
        .pingInterval(12, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private var webSocket: WebSocket? = null
    private val connected = AtomicBoolean(false)
    private val supervisorStarted = AtomicBoolean(false)
    private val opening = AtomicBoolean(false)
    private val socketGen = AtomicInteger(0)
    private val lastInboundMs = AtomicLong(System.currentTimeMillis())
    private val lastAttemptMs = AtomicLong(0)
    private var commandCallback: ((String, JSONObject) -> Unit)? = null
    private var connectionCallback: ((Boolean) -> Unit)? = null
    private var shouldReconnect = true
    private var heartbeatJob: Job? = null

    fun connect(
        onCommand: (String, JSONObject) -> Unit,
        onConnectionChange: (Boolean) -> Unit
    ) {
        commandCallback = onCommand
        connectionCallback = onConnectionChange
        shouldReconnect = true
        startSupervisor()
        startHeartbeat()
        openSocket()
    }

    fun reconnectNow() {
        ensureConnected()
    }

    fun ensureConnected() {
        if (!shouldReconnect) return
        if (connected.get()) return
        openSocket()
    }

    private fun startSupervisor() {
        if (!supervisorStarted.compareAndSet(false, true)) return
        scope.launch {
            var backoffMs = 1_000L
            while (shouldReconnect) {
                delay(15_000)
                if (!shouldReconnect) break
                val stale = System.currentTimeMillis() - lastInboundMs.get() > STALE_MS
                if (!connected.get() || stale) {
                    Log.w(TAG, "Supervisor heal connected=${connected.get()} stale=$stale backoff=${backoffMs}ms")
                    openSocket()
                    delay(backoffMs)
                    backoffMs = (backoffMs * 2).coerceAtMost(15_000L)
                } else {
                    backoffMs = 500L
                }
            }
        }
    }

    private fun openSocket() {
        if (!shouldReconnect) return
        val now = System.currentTimeMillis()
        if (now - lastAttemptMs.get() < 800L && opening.get()) return
        if (!opening.compareAndSet(false, true)) return
        lastAttemptMs.set(now)
        val gen = socketGen.incrementAndGet()
        val previous = webSocket
        webSocket = null
        try {
            previous?.cancel()
        } catch (_: Exception) {
        }
        val url = normalizeGatewayUrl(gatewayUrl)
        val request = Request.Builder().url(url).build()
        try {
            webSocket = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                    opening.set(false)
                    if (gen != socketGen.get()) {
                        webSocket.cancel()
                        return
                    }
                    val register = JSONObject().apply {
                        put("type", "register_channel")
                        put("role", "AGENT")
                        put("id", deviceId)
                        put("authToken", agentToken)
                    }
                    webSocket.send(register.toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (gen != socketGen.get()) return
                    handleText(text)
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    if (gen != socketGen.get()) return
                    handleText(bytes.utf8())
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                    if (gen != socketGen.get()) return
                    opening.set(false)
                    Log.e(TAG, "Gateway failure: ${t.message}")
                    markDisconnected()
                    scheduleReconnect()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (gen != socketGen.get()) return
                    opening.set(false)
                    markDisconnected()
                    scheduleReconnect()
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Gateway open: ${e.message}")
            scheduleReconnect()
        } finally {
            opening.set(false)
        }
    }

    private fun handleText(text: String) {
        lastInboundMs.set(System.currentTimeMillis())
        try {
            val json = JSONObject(text)
            when (json.optString("type")) {
                "sys_ack" -> {
                    val status = json.optString("status")
                    if (status == "ready") {
                        connected.set(true)
                        connectionCallback?.invoke(true)
                    } else if (status == "retry" || status == "duplicate") {
                        markDisconnected()
                        scope.launch {
                            delay(2_000)
                            if (shouldReconnect && !connected.get()) openSocket()
                        }
                    } else if (status == "auth_failed" || status == "auth_timeout") {
                        shouldReconnect = false
                        markDisconnected()
                    }
                }
                "agent_pong" -> Unit
            }
            val action = json.optString("action")
            val incomingType = json.optString("type")
            if (action.isNotBlank()) {
                commandCallback?.invoke(action, mergePayload(json))
            } else if (incomingType.isNotBlank() && incomingType != "agent_pong" && incomingType != "sys_ack") {
                // Some relays wrap commands as { type, payload }.
                val nested = json.optJSONObject("payload") ?: JSONObject()
                val nestedAction = nested.optString("action").ifBlank { incomingType }
                if (nestedAction.isNotBlank()) {
                    commandCallback?.invoke(nestedAction, nested)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Parse error: ${e.message}")
        }
    }

    fun sendDeviceStatus(extra: JSONObject = JSONObject()) {
        val packet = JSONObject().apply {
            put("type", "device_status_update")
            put("deviceId", deviceId)
            put("status", "online")
            put("platform", "android")
            put("hostname", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            put("osVersion", "Android ${Build.VERSION.RELEASE}")
            extra.keys().forEach { key -> put(key, extra.opt(key)) }
        }
        sendJson(packet)
    }

    fun sendJson(obj: JSONObject): Boolean {
        val ws = webSocket ?: return false
        return try {
            ws.send(obj.toString())
        } catch (_: Exception) {
            false
        }
    }

    private fun mergePayload(json: JSONObject): JSONObject {
        val payload = json.optJSONObject("payload") ?: JSONObject()
        val skip = setOf("type", "action", "payload", "timestamp")
        json.keys().forEach { key ->
            if (key !in skip && !payload.has(key)) {
                payload.put(key, json.opt(key))
            }
        }
        return payload
    }

    fun isConnected(): Boolean = connected.get()

    fun disconnect() {
        shouldReconnect = false
        heartbeatJob?.cancel()
        connected.set(false)
        socketGen.incrementAndGet()
        try {
            webSocket?.close(1000, "Client disconnect")
        } catch (_: Exception) {
        }
        webSocket = null
        opening.set(false)
    }

    private fun markDisconnected() {
        if (connected.getAndSet(false)) {
            connectionCallback?.invoke(false)
        }
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        scope.launch {
            var wait = 500L
            for (attempt in 0 until 8) {
                delay(wait)
                if (!shouldReconnect || connected.get()) return@launch
                openSocket()
                wait = (wait * 2).coerceAtMost(20_000L)
            }
        }
    }

    /** Keep server lastAliveAt fresh — matches Windows agent (20s). */
    private fun startHeartbeat() {
        if (heartbeatJob?.isActive == true) return
        heartbeatJob = scope.launch {
            while (shouldReconnect) {
                delay(HEARTBEAT_MS)
                if (!shouldReconnect) break
                if (!connected.get()) {
                    openSocket()
                    continue
                }
                if (System.currentTimeMillis() - lastInboundMs.get() > STALE_MS) {
                    Log.w(TAG, "Heartbeat stale — reopen gateway")
                    openSocket()
                    continue
                }
                sendJson(JSONObject().put("type", "agent_ping"))
            }
        }
    }

    companion object {
        private const val STALE_MS = 90_000L
        private const val HEARTBEAT_MS = 12_000L

        fun normalizeGatewayUrl(raw: String): String {
            var url = raw.trim()
            if (url.startsWith("https://")) url = "wss://" + url.removePrefix("https://")
            if (url.startsWith("http://")) url = "ws://" + url.removePrefix("http://")
            if (!url.contains("/ws/")) {
                url = url.trimEnd('/') + "/ws/gateway"
            }
            return url
        }

        fun controlUrlFromGateway(gatewayUrl: String): String {
            return normalizeGatewayUrl(gatewayUrl).replace("/ws/gateway", "/ws/control")
        }

        fun mediaUrlFromGateway(gatewayUrl: String): String {
            return normalizeGatewayUrl(gatewayUrl).replace("/ws/gateway", "/ws/media")
        }
    }
}
