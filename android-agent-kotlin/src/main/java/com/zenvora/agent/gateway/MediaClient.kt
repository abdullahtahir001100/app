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
import java.util.concurrent.atomic.AtomicLong

/**
 * Binary media plane on /ws/media — drops stale frames, keeps only latest (low latency).
 */
class MediaClient(
    private val mediaUrl: String,
    private val deviceId: String,
    private val agentToken: String,
    private val channel: String
) {
    private val TAG = "MediaClient"
    private val client = OkHttpClient.Builder()
        .pingInterval(12, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private val seq = AtomicLong(0)
    private val authed = AtomicBoolean(false)
    private val sending = AtomicBoolean(false)
    private var webSocket: WebSocket? = null
    private var shouldReconnect = true
    private var heartbeatJob: Job? = null
    @Volatile private var latestFrame: ByteArray? = null

    fun connect() {
        shouldReconnect = true
        if (authed.get()) return
        openSocket()
    }

    fun ensureConnected() {
        shouldReconnect = true
        if (!authed.get()) openSocket()
    }

    private fun openSocket() {
        try {
            webSocket?.cancel()
        } catch (_: Exception) {
        }
        val request = Request.Builder().url(mediaUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                val auth = JSONObject().apply {
                    put("deviceId", deviceId)
                    put("token", agentToken)
                    put("channel", channel)
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
                val frame = ZVProtocol.parseFrame(bytes.toByteArray()) ?: return
                when (frame.msgType) {
                    ZVProtocol.MSG_AUTH_OK -> {
                        authed.set(true)
                        startHeartbeat()
                        latestFrame?.let { flush(it) }
                        Log.i(TAG, "AUTH_OK ($channel)")
                    }
                    ZVProtocol.MSG_AUTH_FAIL -> {
                        Log.e(TAG, "AUTH_FAIL ($channel)")
                        shouldReconnect = false
                        authed.set(false)
                    }
                    ZVProtocol.MSG_HEARTBEAT -> {
                        val ack = ZVProtocol.encodeFrame(ZVProtocol.MSG_HEARTBEAT_ACK, frame.seq)
                        webSocket.send(ByteString.of(*ack))
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                Log.e(TAG, "Media failure ($channel): ${t.message}")
                markDown()
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                markDown()
                scheduleReconnect()
            }
        })
    }

    fun sendFrame(payload: ByteArray) {
        latestFrame = payload
        if (!authed.get()) {
            ensureConnected()
            return
        }
        if (!sending.compareAndSet(false, true)) return
        scope.launch {
            try {
                while (true) {
                    val data = latestFrame ?: break
                    latestFrame = null
                    flush(data)
                    if (latestFrame == null) break
                }
            } finally {
                sending.set(false)
                if (latestFrame != null) sendFrame(latestFrame!!)
            }
        }
    }

    private fun flush(payload: ByteArray) {
        val ws = webSocket ?: return
        if (!authed.get()) return
        val frame = ZVProtocol.encodeFrame(
            ZVProtocol.MSG_MEDIA_FRAME,
            seq.incrementAndGet(),
            payload
        )
        try {
            ws.send(ByteString.of(*frame))
        } catch (e: Exception) {
            Log.w(TAG, "Send failed ($channel): ${e.message}")
            markDown()
            scheduleReconnect()
        }
    }

    fun isReady(): Boolean = authed.get()

    fun disconnect() {
        shouldReconnect = false
        heartbeatJob?.cancel()
        markDown()
        try {
            webSocket?.close(1000, "Client disconnect")
        } catch (_: Exception) {
        }
        webSocket = null
        latestFrame = null
    }

    private fun markDown() {
        authed.set(false)
    }

    private fun startHeartbeat() {
        if (heartbeatJob?.isActive == true) return
        heartbeatJob = scope.launch {
            while (shouldReconnect && authed.get()) {
                delay(12_000)
                if (!shouldReconnect || !authed.get()) break
                val frame = ZVProtocol.encodeFrame(
                    ZVProtocol.MSG_HEARTBEAT,
                    seq.incrementAndGet()
                )
                try {
                    webSocket?.send(ByteString.of(*frame))
                } catch (_: Exception) {
                    markDown()
                    scheduleReconnect()
                }
            }
        }
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        scope.launch {
            delay(350)
            if (shouldReconnect && !authed.get()) openSocket()
        }
    }
}
