package com.zenvora.agent.gateway

import android.util.Log
import com.zenvora.agent.protocol.ZVProtocol
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
 * Binary control plane on /ws/control — same ZV AUTH as Windows.
 */
class ControlClient(
    private val controlUrl: String,
    private val deviceId: String,
    private val agentToken: String
) {
    private val TAG = "ControlClient"
    private val client = OkHttpClient.Builder()
        .pingInterval(12, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private val seq = AtomicLong(0)
    private val connected = AtomicBoolean(false)
    private val reconnecting = AtomicBoolean(false)
    private val socketGen = AtomicInteger(0)
    private val lastInboundMs = AtomicLong(System.currentTimeMillis())
    private val lastAttemptMs = AtomicLong(0)
    private var webSocket: WebSocket? = null
    private var shouldReconnect = true
    private var onCommand: ((ZVProtocol.ZVFrame) -> Unit)? = null
    private var heartbeatJob: Job? = null

    fun connect(onCommand: (ZVProtocol.ZVFrame) -> Unit) {
        this.onCommand = onCommand
        shouldReconnect = true
        openSocket()
        startHeartbeat()
    }

    fun reconnectNow() {
        ensureConnected()
    }

    fun ensureConnected() {
        if (!shouldReconnect) return
        val now = System.currentTimeMillis()
        if (connected.get() && now - lastInboundMs.get() < 35_000L) return
        if (!connected.get() && now - lastAttemptMs.get() < 800L) return
        reconnecting.set(false)
        openSocket()
    }

    private fun openSocket() {
        if (!shouldReconnect) return
        val now = System.currentTimeMillis()
        if (now - lastAttemptMs.get() < 800L) return
        lastAttemptMs.set(now)
        val gen = socketGen.incrementAndGet()
        val previous = webSocket
        webSocket = null
        try {
            previous?.cancel()
        } catch (_: Exception) {
        }
        val request = Request.Builder().url(controlUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                if (gen != socketGen.get()) {
                    webSocket.cancel()
                    return
                }
                val auth = JSONObject().apply {
                    put("deviceId", deviceId)
                    put("token", agentToken)
                    put("platform", "android")
                }
                val frame = ZVProtocol.encodeJsonFrame(
                    ZVProtocol.MSG_AUTH,
                    seq.incrementAndGet(),
                    auth.toString()
                )
                webSocket.send(ByteString.of(*frame))
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (gen != socketGen.get()) return
                lastInboundMs.set(System.currentTimeMillis())
                val frame = ZVProtocol.parseFrame(bytes.toByteArray()) ?: return
                when (frame.msgType) {
                    ZVProtocol.MSG_AUTH_OK -> {
                        connected.set(true)
                    }
                    ZVProtocol.MSG_AUTH_FAIL -> {
                        shouldReconnect = false
                        connected.set(false)
                    }
                    ZVProtocol.MSG_HEARTBEAT -> {
                        val ack = ZVProtocol.encodeFrame(
                            ZVProtocol.MSG_HEARTBEAT_ACK,
                            frame.seq
                        )
                        webSocket.send(ByteString.of(*ack))
                    }
                    ZVProtocol.MSG_COMMAND -> onCommand?.invoke(frame)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                if (gen != socketGen.get()) return
                Log.e(TAG, "Control failure: ${t.message}")
                connected.set(false)
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (gen != socketGen.get()) return
                connected.set(false)
                scheduleReconnect()
            }
        })
    }

    fun sendEvent(kind: Int, data: JSONObject) {
        val body = JSONObject().apply {
            put("kind", kind)
            put("items", data.optJSONArray("items") ?: org.json.JSONArray().put(data))
            if (data.has("incremental")) put("incremental", data.optBoolean("incremental"))
        }
        val frame = ZVProtocol.encodeJsonFrame(
            ZVProtocol.MSG_EVENT,
            seq.incrementAndGet(),
            body.toString()
        )
        webSocket?.send(ByteString.of(*frame))
    }

    fun sendItems(kind: Int, items: org.json.JSONArray) {
        val body = JSONObject().apply {
            put("kind", kind)
            put("items", items)
        }
        val frame = ZVProtocol.encodeJsonFrame(
            ZVProtocol.MSG_EVENT,
            seq.incrementAndGet(),
            body.toString()
        )
        webSocket?.send(ByteString.of(*frame))
    }

    fun disconnect() {
        shouldReconnect = false
        connected.set(false)
        socketGen.incrementAndGet()
        heartbeatJob?.cancel()
        try {
            webSocket?.close(1000, "Client disconnect")
        } catch (_: Exception) {
        }
        webSocket = null
    }

    private fun startHeartbeat() {
        if (heartbeatJob?.isActive == true) return
        heartbeatJob = scope.launch {
            while (shouldReconnect) {
                delay(12_000)
                if (!shouldReconnect) break
                if (!connected.get()) {
                    openSocket()
                    continue
                }
                if (System.currentTimeMillis() - lastInboundMs.get() > 90_000L) {
                    connected.set(false)
                    openSocket()
                    continue
                }
                val frame = ZVProtocol.encodeFrame(
                    ZVProtocol.MSG_HEARTBEAT,
                    seq.incrementAndGet()
                )
                webSocket?.send(ByteString.of(*frame))
            }
        }
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        if (!reconnecting.compareAndSet(false, true)) return
        scope.launch {
            try {
                delay(500)
                if (shouldReconnect && !connected.get()) openSocket()
            } finally {
                reconnecting.set(false)
            }
        }
    }
}
