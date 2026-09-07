package com.zenvora.agent.manager

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Reports whether the device is online, and over wifi or cellular.
 */
class NetworkMonitor(private val context: Context) {

    private val TAG = "NetworkMonitor"
    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE)
        as ConnectivityManager

    private var monitorJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private var isMonitoring = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var onStatus: ((Map<String, Any?>) -> Unit)? = null

    fun setStatusCallback(callback: (Map<String, Any?>) -> Unit) {
        onStatus = callback
    }

    fun start(interval: Long = 10000) {
        if (isMonitoring) return
        isMonitoring = true
        registerNetworkCallback()
        monitorJob = scope.launch {
            while (isMonitoring) {
                try {
                    reportNetworkStatus()
                    delay(interval)
                } catch (e: Exception) {
                    Log.e(TAG, "Monitor error: ${e.message}")
                }
            }
        }
    }

    fun stop() {
        isMonitoring = false
        monitorJob?.cancel()
        unregisterNetworkCallback()
    }

    private fun registerNetworkCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    scope.launch { reportNetworkStatus() }
                }

                override fun onLost(network: Network) {
                    scope.launch { reportNetworkStatus() }
                }
            }
            networkCallback = callback
            connectivityManager.registerDefaultNetworkCallback(callback)
        }
    }

    private fun unregisterNetworkCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            networkCallback?.let {
                try {
                    connectivityManager.unregisterNetworkCallback(it)
                } catch (_: Exception) {
                    // Already unregistered.
                }
            }
            networkCallback = null
        }
    }

    private suspend fun reportNetworkStatus() {
        withContext(Dispatchers.IO) {
            try {
                val activeNetwork = connectivityManager.activeNetwork
                if (activeNetwork != null) {
                    val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork)
                    onStatus?.invoke(
                        mapOf(
                            "connected" to true,
                            "type" to getNetworkType(capabilities)
                        )
                    )
                } else {
                    onStatus?.invoke(mapOf("connected" to false))
                }
            } catch (e: Exception) {
                Log.e(TAG, "Status report error: ${e.message}")
            }
        }
    }

    private fun getNetworkType(capabilities: NetworkCapabilities?): String {
        return when {
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "WIFI"
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "CELLULAR"
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ETHERNET"
            else -> "UNKNOWN"
        }
    }
}
