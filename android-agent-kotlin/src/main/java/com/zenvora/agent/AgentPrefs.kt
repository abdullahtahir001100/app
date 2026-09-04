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

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

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
