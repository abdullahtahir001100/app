package com.zenvora.agent.manager

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Builds the same device_status_update fields the Windows agent sends.
 */
class DeviceInfoManager(private val context: Context) {

    private val TAG = "DeviceInfo"
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()
    @Volatile private var geoCache: JSONObject? = null
    @Volatile private var geoAt = 0L

    fun buildStatusPacket(deviceId: String): JSONObject {
        val battery = getBatteryLevel()
        val storage = getStorageUsedPercent()
        val ramMb = getTotalRamMb()
        val geo = geolocation()
        val gps = lastGps()
        val lat = gps?.first ?: geo.optDouble("lat", Double.NaN).takeIf { !it.isNaN() }
        val lon = gps?.second ?: geo.optDouble("lon", Double.NaN).takeIf { !it.isNaN() }
        return JSONObject().apply {
            put("deviceId", deviceId)
            put("status", "online")
            put("platform", "android")
            put("hostname", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            put("username", getUsername())
            put("osVersion", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            put("architecture", Build.SUPPORTED_ABIS.firstOrNull() ?: "arm")
            put("cpu", getCpuName())
            put("ram", ramMb)
            put("battery", battery)
            put("storage", storage)
            put("network", getNetworkLabel())
            put("localIp", getLocalIp())
            put("publicIp", geo.optString("query"))
            put("isp", geo.optString("isp"))
            put("timezone", geo.optString("timezone").ifBlank { TimeZone.getDefault().id })
            put("country", geo.optString("country"))
            put("region", geo.optString("regionName"))
            put("city", geo.optString("city"))
            if (lat != null && lon != null) {
                put("geolocation", JSONObject().put("latitude", lat).put("longitude", lon))
                put("latitude", lat)
                put("longitude", lon)
            }
            put("timestamp", System.currentTimeMillis() / 1000)
        }
    }

    fun getBatteryLevel(): Int {
        return try {
            val status = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (status != null) {
                val level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                if (scale > 0) ((level / scale.toFloat()) * 100).toInt() else -1
            } else -1
        } catch (_: Exception) {
            -1
        }
    }

    private fun getStorageUsedPercent(): Int {
        return try {
            val path = Environment.getDataDirectory()
            val stat = StatFs(path.path)
            val total = stat.totalBytes.toDouble()
            val avail = stat.availableBytes.toDouble()
            if (total <= 0) 0 else (((total - avail) / total) * 100).toInt().coerceIn(0, 100)
        } catch (_: Exception) {
            0
        }
    }

    private fun getTotalRamMb(): Long {
        return try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val info = ActivityManager.MemoryInfo()
            am.getMemoryInfo(info)
            info.totalMem / (1024 * 1024)
        } catch (_: Exception) {
            0L
        }
    }

    private fun getCpuName(): String {
        val fromProc = readCpuInfo()
        if (fromProc.isNotBlank()) return fromProc
        return listOf(
            Build.HARDWARE,
            Build.BOARD,
            if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL else null
        )
            .filterNotNull()
            .filter { it.isNotBlank() && it != "unknown" }
            .distinct()
            .joinToString(" ")
            .ifBlank { Build.HARDWARE }
    }

    private fun readCpuInfo(): String {
        return try {
            val lines = java.io.File("/proc/cpuinfo").readLines()
            val model = lines.firstOrNull { it.startsWith("model name") || it.startsWith("Hardware") }
                ?.substringAfter(":")
                ?.trim()
            model.orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    private fun getUsername(): String {
        val names = mutableListOf<String>()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
                Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
                    ?.let { names.add(it) }
            }
        } catch (_: Exception) {
        }
        try {
            Settings.Secure.getString(context.contentResolver, "bluetooth_name")?.let { names.add(it) }
        } catch (_: Exception) {
        }
        names.add(Build.USER)
        return names.firstOrNull { it.isNotBlank() && it != "unknown" } ?: "android"
    }

    @Suppress("DEPRECATION")
    private fun getNetworkLabel(): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (Build.VERSION.SDK_INT >= 23) {
            val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "offline"
            return when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> {
                    val ssid = wifiSsid()
                    if (ssid.isNotBlank()) ssid else "Wi-Fi"
                }
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Cellular"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
                else -> "Unknown"
            }
        }
        val info = cm.activeNetworkInfo ?: return "offline"
        return when (info.type) {
            ConnectivityManager.TYPE_WIFI -> wifiSsid().ifBlank { "Wi-Fi" }
            ConnectivityManager.TYPE_MOBILE -> "Cellular"
            ConnectivityManager.TYPE_ETHERNET -> "Ethernet"
            else -> info.typeName ?: "Unknown"
        }
    }

    @Suppress("DEPRECATION")
    private fun wifiSsid(): String {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) return ""
        return try {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            wm.connectionInfo?.ssid?.trim('"')?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }.orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    private fun getLocalIp(): String {
        try {
            NetworkInterface.getNetworkInterfaces()?.toList()?.forEach { nif ->
                nif.inetAddresses.toList().forEach { addr ->
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        return addr.hostAddress ?: ""
                    }
                }
            }
        } catch (_: Exception) {
        }
        return ""
    }

    private fun lastGps(): Pair<Double, Double>? {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) return null
        return try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
            val providers = listOf(
                android.location.LocationManager.GPS_PROVIDER,
                android.location.LocationManager.NETWORK_PROVIDER
            )
            var best: android.location.Location? = null
            for (p in providers) {
                val loc = lm.getLastKnownLocation(p) ?: continue
                if (best == null || loc.accuracy < best.accuracy) best = loc
            }
            best?.let { Pair(it.latitude, it.longitude) }
        } catch (e: Exception) {
            Log.w(TAG, "GPS: ${e.message}")
            null
        }
    }

    private fun geolocation(): JSONObject {
        val now = System.currentTimeMillis()
        geoCache?.let { if (now - geoAt < 5 * 60_000) return it }
        return try {
            val req = Request.Builder().url("http://ip-api.com/json/?fields=status,query,isp,timezone,country,regionName,city,lat,lon").build()
            http.newCall(req).execute().use { resp ->
                val json = JSONObject(resp.body?.string().orEmpty())
                if (json.optString("status") == "success") {
                    geoCache = json
                    geoAt = now
                    json
                } else JSONObject()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Geo lookup: ${e.message}")
            geoCache ?: JSONObject()
        }
    }
}
