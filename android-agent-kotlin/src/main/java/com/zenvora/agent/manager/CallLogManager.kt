package com.zenvora.agent.manager

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

class CallLogManager(private val context: Context) {
    fun fetch(limit: Int = 100): JSONArray {
        val out = JSONArray()
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG)
            != PackageManager.PERMISSION_GRANTED
        ) return out
        val cursor = context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(
                CallLog.Calls.NUMBER,
                CallLog.Calls.CACHED_NAME,
                CallLog.Calls.TYPE,
                CallLog.Calls.DURATION,
                CallLog.Calls.DATE
            ),
            null,
            null,
            "${CallLog.Calls.DATE} DESC"
        ) ?: return out
        cursor.use {
            var count = 0
            while (it.moveToNext() && count < limit) {
                out.put(JSONObject().apply {
                    put("number", it.getString(0) ?: "")
                    put("name", it.getString(1) ?: "")
                    put("type", it.getInt(2))
                    put("duration", it.getLong(3))
                    put("timestamp", it.getLong(4))
                })
                count++
            }
        }
        return out
    }
}
