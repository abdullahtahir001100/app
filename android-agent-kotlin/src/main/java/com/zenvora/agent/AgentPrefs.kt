package com.zenvora.agent

import android.content.Context
import android.os.Build
import android.provider.Settings

object AgentPrefs {
    private const val FILE = "zenvora_agent"
    const val DEFAULT_API_URL = "https://www.zenvora.abdullahtahir.me"

    private const val KEY_API = "api_url"
    private const val KEY_GATEWAY = "gateway_url"
    private const val KEY_TOKEN = "agent_token"
    private const val KEY_DEVICE = "device_id"
    private const val KEY_ENABLED = "user_enabled"
    private const val KEY_BOOT = "start_on_boot"
    private const val KEY_ONBOARDED = "permissions_onboarded"
    private const val KEY_CONNECTED = "connected"

    private const val KEY_STEALTH = "stealth_mode"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /**
     * Checks external Downloads directory and assets for pre-packaged or downloaded `zenvora_config.json`.
     * Automatically applies pre-paired tokens & URLs if present.
     */
    fun checkAndLoadEmbeddedConfig(context: Context): Boolean {
        if (isPaired(context)) return true
        val app = context.applicationContext

        // 1. Try public Download directories & common paths
        val candidateFiles = buildList {
            try {
                add(java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS), "zenvora_config.json"))
            } catch (_: Exception) {}
            add(java.io.File("/storage/emulated/0/Download/zenvora_config.json"))
            add(java.io.File("/sdcard/Download/zenvora_config.json"))
            try {
                app.getExternalFilesDir(null)?.let { add(java.io.File(it, "zenvora_config.json")) }
            } catch (_: Exception) {}
        }

        for (file in candidateFiles) {
            try {
                if (file.exists() && file.canRead()) {
                    val jsonStr = file.readText()
                    if (applyConfigJson(app, jsonStr)) return true
                }
            } catch (_: Exception) {}
        }

        // 2. Try assets/zenvora_config.json
        return try {
            val stream = app.assets.open("zenvora_config.json")
            val jsonStr = stream.bufferedReader().use { it.readText() }
            applyConfigJson(app, jsonStr)
        } catch (_: Exception) {
            false
        }
    }

    private fun applyConfigJson(app: Context, jsonStr: String): Boolean {
        return try {
            val obj = org.json.JSONObject(jsonStr)
            val token = obj.optString("agent_token", "").ifBlank { obj.optString("token", "") }.trim()
            val gateway = obj.optString("gateway_url", "").ifBlank { obj.optString("gateway", "") }.trim()
            val api = obj.optString("api_url", DEFAULT_API_URL).ifBlank { obj.optString("api", DEFAULT_API_URL) }.trim()
            val device = obj.optString("device_id", "").ifBlank { obj.optString("deviceId", "") }.trim()

            if (token.isNotBlank()) {
                setAgentToken(app, token)
                if (gateway.isNotBlank()) setGatewayUrl(app, gateway)
                if (api.isNotBlank()) setApiUrl(app, api)
                if (device.isNotBlank()) {
                    prefs(app).edit().putString(KEY_DEVICE, device).commit()
                }
                setEnabled(app, true)
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    fun apiUrl(context: Context): String =
        prefs(context).getString(KEY_API, DEFAULT_API_URL)?.trim().orEmpty()
            .ifBlank { DEFAULT_API_URL }

    fun setApiUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_API, url.trim()).apply()
    }

    fun gatewayUrl(context: Context): String =
        prefs(context).getString(KEY_GATEWAY, "") ?: ""

    fun setGatewayUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_GATEWAY, url).commit()
    }

    fun agentToken(context: Context): String =
        prefs(context).getString(KEY_TOKEN, "") ?: ""

    fun setAgentToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_TOKEN, token).commit()
    }

    fun isPaired(context: Context): Boolean =
        agentToken(context).isNotBlank() && deviceId(context).isNotBlank()

    fun deviceId(context: Context): String {
        val stored = prefs(context).getString(KEY_DEVICE, "") ?: ""
        if (stored.isNotBlank()) return stored
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            ?: "unknown"
        val id = "AND-$androidId"
        prefs(context).edit().putString(KEY_DEVICE, id).apply()
        return id
    }

    fun hostname(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    fun isEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).commit()
    }

    fun startOnBoot(context: Context): Boolean =
        prefs(context).getBoolean(KEY_BOOT, true)

    fun setStartOnBoot(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_BOOT, enabled).apply()
    }

    fun isStealthMode(context: Context): Boolean =
        prefs(context).getBoolean(KEY_STEALTH, false)

    fun setStealthMode(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_STEALTH, enabled).apply()
    }

    fun permissionsOnboarded(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ONBOARDED, false)

    fun setPermissionsOnboarded(context: Context, done: Boolean) {
        prefs(context).edit().putBoolean(KEY_ONBOARDED, done).apply()
    }

    fun isConnected(context: Context): Boolean =
        prefs(context).getBoolean(KEY_CONNECTED, false)

    fun setConnected(context: Context, connected: Boolean) {
        prefs(context).edit().putBoolean(KEY_CONNECTED, connected).apply()
    }

    fun clearPairing(context: Context) {
        prefs(context).edit()
            .remove(KEY_TOKEN)
            .remove(KEY_GATEWAY)
            .putBoolean(KEY_ENABLED, false)
            .putBoolean(KEY_CONNECTED, false)
            .apply()
    }
}
