package com.zenvora.agent.manager

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

class ContactsManager(private val context: Context) {
    fun fetch(limit: Int = 300): JSONArray {
        val out = JSONArray()
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS)
            != PackageManager.PERMISSION_GRANTED
        ) return out
        val cursor = context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            ),
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
        ) ?: return out
        cursor.use {
            var count = 0
            while (it.moveToNext() && count < limit) {
                out.put(JSONObject().apply {
                    put("name", it.getString(0) ?: "")
                    put("phone", it.getString(1) ?: "")
                })
                count++
            }
        }
        return out
    }
}
