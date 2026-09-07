package com.zenvora.agent.models

import org.json.JSONObject

data class DeviceInfo(
    val deviceId: String,
    val platform: String = "android",
    val osVersion: Int,
    val manufacturer: String,
    val model: String,
    val battery: Int,
    val isCharging: Boolean,
    val storage: Long,
    val ram: Long,
    val screen: String
) {
    fun toJSON(): JSONObject = JSONObject().apply {
        put("deviceId", deviceId)
        put("platform", platform)
        put("osVersion", osVersion)
        put("manufacturer", manufacturer)
        put("model", model)
        put("battery", battery)
        put("isCharging", isCharging)
        put("storage", storage)
        put("ram", ram)
        put("screen", screen)
    }
}
