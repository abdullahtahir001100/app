package com.zenvora.agent.manager

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CopyOnWriteArrayList

object BrowserHistoryStore {
    private const val FILE = "browser_visits.json"
    private const val MAX = 1500
    private val visits = CopyOnWriteArrayList<JSONObject>()
    @Volatile var listener: ((JSONObject) -> Unit)? = null
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun load(context: Context) {
        if (visits.isNotEmpty()) return
        try {
            val file = File(context.filesDir, FILE)
            if (!file.exists()) return
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) {
                visits.add(arr.getJSONObject(i))
            }
        } catch (_: Exception) {
        }
    }

    fun all(): JSONArray {
        val arr = JSONArray()
        visits.forEach { arr.put(it) }
        return arr
    }

    fun recent(limit: Int): JSONArray {
        val arr = JSONArray()
        visits.takeLast(limit).forEach { arr.put(it) }
        return arr
    }

    fun add(context: Context, browser: String, url: String, title: String, packageName: String): JSONObject? {
        val clean = url.trim().trimEnd('/', '#')
        if (clean.isBlank() || !clean.startsWith("http")) return null
        val now = System.currentTimeMillis()
        val last = visits.lastOrNull()
        if (last != null && last.optString("url") == clean) {
            val sameWindow = now - last.optLong("epoch") < 45_000
            if (sameWindow) return null
        }
        val entry = JSONObject()
            .put("browser", browser)
            .put("url", clean)
            .put("title", title.ifBlank { clean })
            .put("visitTime", iso.format(Date(now)))
            .put("visitCount", 1)
            .put("windowsUser", "android")
            .put("browserProfile", packageName)
            .put("epoch", now)
        visits.add(entry)
        while (visits.size > MAX) visits.removeAt(0)
        persist(context)
        listener?.invoke(entry)
        return entry
    }

    private fun persist(context: Context) {
        try {
            val arr = JSONArray()
            visits.takeLast(800).forEach { arr.put(it) }
            File(context.filesDir, FILE).writeText(arr.toString())
        } catch (_: Exception) {
        }
    }
}
