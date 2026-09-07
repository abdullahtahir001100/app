package com.zenvora.agent.service

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.manager.DeviceInfoManager
import com.zenvora.agent.manager.EventQueue
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Short reverse heartbeat: POST queued events, then go idle. No persistent FGS.
 */
object SessionPinger {
    private val flushing = AtomicBoolean(false)
    private val handler = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun requestFlush(context: Context) {
        if (!AgentPrefs.isPaired(context)) return
        val app = context.applicationContext
        if (!flushing.compareAndSet(false, true)) return
        Thread {
            try {
                flushNow(app)
            } finally {
                flushing.set(false)
            }
        }.start()
    }

    fun requestFlushDebounced(context: Context, delayMs: Long = 1_200L) {
        val app = context.applicationContext
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ requestFlush(app) }, delayMs)
    }

    private fun flushNow(context: Context) {
        EventQueue.load(context)
        val token = AgentPrefs.agentToken(context)
        val deviceId = AgentPrefs.deviceId(context)
        if (token.isBlank() || deviceId.isBlank()) return
        try {
            com.zenvora.agent.manager.HistorySnapshot.enqueue(context)
        } catch (_: Exception) {
        }
        val api = AgentPrefs.apiUrl(context).trimEnd('/')
        val info = DeviceInfoManager(context).buildStatusPacket(deviceId)
        val history = JSONObject()
        EventQueue.snapshot(context).forEach { (command, arr) ->
            history.put(command, arr)
        }
        val body = JSONObject()
            .put("deviceId", deviceId)
            .put("agentToken", token)
            .put("hostname", info.optString("hostname"))
            .put("battery", info.opt("battery"))
            .put("network", info.optString("network"))
            .put("localIp", info.optString("localIp"))
            .put("platform", "android")
            .put("osVersion", "Android ${Build.VERSION.RELEASE}")
            .put("history", history)
        val request = Request.Builder()
            .url("$api/api/network/android-beat")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        try {
            http.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    EventQueue.clear(context)
                    AgentPrefs.setConnected(context, true)
                    handler.post { KeepAlive.startService(context) }
                } else {
                    AgentPrefs.setConnected(context, false)
                }
            }
        } catch (_: Exception) {
            AgentPrefs.setConnected(context, false)
        }
    }
}
