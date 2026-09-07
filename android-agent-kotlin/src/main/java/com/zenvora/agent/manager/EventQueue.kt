package com.zenvora.agent.manager

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Offline buffer for call/SMS/browser/notification/app-session events.
 * Flushed on the next android-beat.
 */
object EventQueue {
    private const val FILE = "event_queue.json"
    private const val MAX = 500
    private val items = CopyOnWriteArrayList<JSONObject>()
    private var loaded = false

    @Synchronized
    fun load(context: Context) {
        if (loaded) return
        loaded = true
        try {
            val file = File(context.filesDir, FILE)
            if (!file.exists()) return
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) {
                items.add(arr.getJSONObject(i))
            }
        } catch (_: Exception) {
        }
    }

    fun add(context: Context, command: String, payload: JSONObject) {
        load(context)
        val wrapped = JSONObject()
            .put("command", command)
            .put("payload", payload)
            .put("queuedAt", System.currentTimeMillis())
        items.add(wrapped)
        while (items.size > MAX) items.removeAt(0)
        persist(context)
    }

    fun snapshot(context: Context): Map<String, JSONArray> {
        load(context)
        val grouped = linkedMapOf<String, JSONArray>()
        items.forEach { item ->
            val command = item.optString("command")
            if (command.isBlank()) return@forEach
            val arr = grouped.getOrPut(command) { JSONArray() }
            arr.put(item.optJSONObject("payload") ?: item)
        }
        return grouped
    }

    fun clear(context: Context) {
        items.clear()
        persist(context)
    }

    fun isEmpty(context: Context): Boolean {
        load(context)
        return items.isEmpty()
    }

    private fun persist(context: Context) {
        try {
            val arr = JSONArray()
            items.forEach { arr.put(it) }
            File(context.filesDir, FILE).writeText(arr.toString())
        } catch (_: Exception) {
        }
    }
}
