package com.zenvora.installer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.RelativeLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * MainActivity — Official Zenvora Agent Auto-Installer.
 *
 * Flow:
 *  1. Checks if Zenvora Agent is already installed.
 *     If yes -> auto-launches agent.
 *  2. Checks REQUEST_INSTALL_PACKAGES permission.
 *     If needed -> guides user to grant one-time unknown apps permission.
 *  3. Once permission is granted:
 *     Automatically streams live download of the agent APK with real-time percentage, MBs, and progress bar.
 *  4. On download complete -> automatically executes installation via PackageInstaller session API.
 *  5. On install success -> automatically opens Zenvora Agent with configured tokens for instant onboarding.
 *  6. Manual mode -> allows one-step Token verification without needing server URL configurations.
 */
class MainActivity : AppCompatActivity() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val isDownloading = AtomicBoolean(false)
    private var waitingForPermission = false

    // Views
    private lateinit var tvStatus: TextView
    private lateinit var tvSubStatus: TextView
    private lateinit var layoutProgressDetails: RelativeLayout
    private lateinit var tvProgressPercent: TextView
    private lateinit var tvBytesProgress: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var btnAction: Button

    // Manual setup views
    private lateinit var btnToggleManual: TextView
    private lateinit var layoutManual: LinearLayout
    private lateinit var etPairToken: EditText
    private lateinit var tvManualError: TextView
    private lateinit var btnVerifyToken: Button

    private val httpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    // Broadcast receiver for install completion
    private val installStatusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                InstallerService.ACTION_INSTALL_RESULT -> {
                    val ok = intent.getBooleanExtra(InstallerService.EXTRA_INSTALL_OK, false)
                    val msg = intent.getStringExtra(InstallerService.EXTRA_INSTALL_MSG) ?: ""
                    if (ok) {
                        onAgentInstallFinished(true, "Installation Completed ✓")
                    } else {
                        onAgentInstallFinished(false, "Install failed: $msg")
                    }
                }
                Intent.ACTION_PACKAGE_ADDED, Intent.ACTION_PACKAGE_REPLACED -> {
                    val data = intent.dataString ?: ""
                    if (data.contains(BuildConfig.AGENT_PACKAGE)) {
                        onAgentInstallFinished(true, "Zenvora Agent Installed ✓")
                    }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        detectAndLoadBundledConfig()
        setupManualSetup()
        registerInstallReceivers()

        checkAndProceed()
    }

    private fun initViews() {
        tvStatus = findViewById(R.id.tvStatus)
        tvSubStatus = findViewById(R.id.tvSubStatus)
        layoutProgressDetails = findViewById(R.id.layoutProgressDetails)
        tvProgressPercent = findViewById(R.id.tvProgressPercent)
        tvBytesProgress = findViewById(R.id.tvBytesProgress)
        progressBar = findViewById(R.id.progressBar)
        btnAction = findViewById(R.id.btnAction)

        btnToggleManual = findViewById(R.id.btnToggleManual)
        layoutManual = findViewById(R.id.layoutManual)
        etPairToken = findViewById(R.id.etPairToken)
        tvManualError = findViewById(R.id.tvManualError)
        btnVerifyToken = findViewById(R.id.btnVerifyToken)
    }

    private fun registerInstallReceivers() {
        val filter = IntentFilter().apply {
            addAction(InstallerService.ACTION_INSTALL_RESULT)
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addDataScheme("package")
        }
        val appFilter = IntentFilter(InstallerService.ACTION_INSTALL_RESULT)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(installStatusReceiver, appFilter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(installStatusReceiver, appFilter)
        }
    }

    private fun setupManualSetup() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val savedToken = prefs.getString("agent_token", "")
        if (!savedToken.isNullOrBlank()) {
            etPairToken.setText(savedToken)
        }

        btnToggleManual.setOnClickListener {
            val isVisible = layoutManual.visibility == View.VISIBLE
            layoutManual.visibility = if (isVisible) View.GONE else View.VISIBLE
            btnToggleManual.text = if (isVisible) "⚙ Enter Token Manually" else "▲ Hide Manual Setup"
        }

        btnVerifyToken.setOnClickListener {
            val token = etPairToken.text.toString().trim()
            if (token.isBlank()) {
                tvManualError.visibility = View.VISIBLE
                tvManualError.text = "Please enter your pairing token"
                return@setOnClickListener
            }

            btnVerifyToken.isEnabled = false
            btnVerifyToken.text = "Verifying..."
            tvManualError.visibility = View.GONE

            scope.launch {
                val serverUrl = getServerBaseUrl()
                val deviceId = getOrGenerateDeviceId()
                val hostname = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

                try {
                    val result = verifyTokenWithServer(serverUrl, token, deviceId, hostname)
                    if (result != null) {
                        prefs.edit()
                            .putString("server_url", serverUrl)
                            .putString("agent_token", result.agentToken)
                            .putString("gateway_url", result.gatewayUrl)
                            .putString("device_id", deviceId)
                            .putString("agent_apk_url", "$serverUrl/api/agent/download?platform=android&flavor=full")
                            .apply()

                        writeLocalConfig(serverUrl, result.agentToken, result.gatewayUrl, deviceId)

                        Toast.makeText(this@MainActivity, "Token verified successfully ✓", Toast.LENGTH_SHORT).show()
                        layoutManual.visibility = View.GONE
                        btnToggleManual.text = "⚙ Enter Token Manually"

                        checkAndProceed()
                    } else {
                        tvManualError.visibility = View.VISIBLE
                        tvManualError.text = "Invalid pairing token. Please check your dashboard."
                    }
                } catch (e: Exception) {
                    tvManualError.visibility = View.VISIBLE
                    tvManualError.text = e.message ?: "Verification failed. Check network connection."
                } finally {
                    btnVerifyToken.isEnabled = true
                    btnVerifyToken.text = "Verify Token & Install"
                }
            }
        }
    }

    private suspend fun verifyTokenWithServer(
        serverUrl: String,
        token: String,
        deviceId: String,
        hostname: String
    ): TokenVerifyResult? = withContext(Dispatchers.IO) {
        val payload = JSONObject().apply {
            put("pairingToken", token)
            put("deviceId", deviceId)
            put("hostname", hostname)
            put("platform", "android")
        }

        val request = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/auth/agent/pair")
            .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()

        httpClient.newCall(request).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val errJson = try { JSONObject(responseBody) } catch (_: Exception) { null }
                val errMsg = errJson?.optString("message")?.ifBlank { errJson.optString("error") }
                    ?: "Server returned HTTP ${response.code}"
                throw IllegalStateException(errMsg)
            }

            val json = JSONObject(responseBody)
            val agentToken = json.optString("agentToken")
            val gatewayUrl = json.optString("gatewayUrl")
            if (agentToken.isNotBlank()) {
                TokenVerifyResult(agentToken, gatewayUrl)
            } else {
                null
            }
        }
    }

    private data class TokenVerifyResult(val agentToken: String, val gatewayUrl: String)

    private fun detectAndLoadBundledConfig() {
        val candidates = listOf(
            File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS), "zenvora_config.json"),
            File("/sdcard/Download/zenvora_config.json"),
            File(getExternalFilesDir(null), "zenvora_config.json"),
            File(filesDir, "zenvora_config.json")
        )

        for (file in candidates) {
            if (file.exists() && file.isFile) {
                try {
                    val jsonStr = file.readText()
                    val json = JSONObject(jsonStr)
                    val srv = json.optString("server_url", json.optString("api_url", "")).trimEnd('/')
                    val tok = json.optString("agent_token", json.optString("token", ""))
                    val gtw = json.optString("gateway_url", "")
                    val dev = json.optString("device_id", "")
                    if (srv.isNotBlank() || tok.isNotBlank()) {
                        val finalSrv = srv.ifBlank { DEFAULT_SERVER_URL }
                        val apkUrl = "$finalSrv/api/agent/download?platform=android&flavor=full"
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                            .putString("server_url", finalSrv)
                            .putString("agent_token", tok)
                            .putString("gateway_url", gtw)
                            .putString("device_id", dev)
                            .putString("agent_apk_url", apkUrl)
                            .apply()
                        Log.i(TAG, "Bundled config detected from: ${file.absolutePath}")
                        break
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Error parsing ${file.absolutePath}: ${e.message}")
                }
            }
        }
    }

    private fun writeLocalConfig(serverUrl: String, token: String, gatewayUrl: String, deviceId: String) {
        try {
            val json = JSONObject().apply {
                put("server_url", serverUrl)
                put("api_url", serverUrl)
                put("agent_token", token)
                put("token", token)
                put("gateway_url", gatewayUrl)
                put("device_id", deviceId)
            }
            val content = json.toString(2)
            val targets = listOf(
                File(filesDir, "zenvora_config.json"),
                File(getExternalFilesDir(null), "zenvora_config.json"),
                File("/sdcard/Download/zenvora_config.json")
            )
            for (f in targets) {
                try { f.writeText(content) } catch (_: Exception) {}
            }
        } catch (e: Exception) {
            Log.w(TAG, "writeLocalConfig failed: ${e.message}")
        }
    }

    override fun onResume() {
        super.onResume()
        if (waitingForPermission) {
            waitingForPermission = false
            checkAndProceed()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        try { unregisterReceiver(installStatusReceiver) } catch (_: Exception) {}
    }

    // ─────────────────────────────────────────────────────────
    //  Core Flow
    // ─────────────────────────────────────────────────────────

    private fun checkAndProceed() {
        // 1. If agent is already installed, launch it directly!
        if (isAgentInstalled()) {
            tvStatus.text = "Zenvora Agent Ready ✓"
            tvSubStatus.text = "Zenvora Agent is installed. Launching…"
            progressBar.visibility = View.GONE
            layoutProgressDetails.visibility = View.GONE
            btnAction.visibility = View.VISIBLE
            btnAction.text = "Open Zenvora Agent"
            btnAction.setOnClickListener {
                SilentInstaller.launchAgentApp(this)
                finish()
            }

            scope.launch {
                delay(1200)
                SilentInstaller.launchAgentApp(this@MainActivity)
                finish()
            }
            return
        }

        // 2. Check install unknown package permission
        if (!hasInstallPermission()) {
            showRequestPermissionUI()
            return
        }

        // 3. Permission granted -> start download and install
        startDownloadAndInstall()
    }

    private fun isAgentInstalled(): Boolean {
        return try {
            packageManager.getPackageInfo(BuildConfig.AGENT_PACKAGE, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun hasInstallPermission(): Boolean {
        return packageManager.canRequestPackageInstalls()
    }

    private fun showRequestPermissionUI() {
        tvStatus.text = "Permission Required"
        tvSubStatus.text = "To install the Zenvora Agent automatically, allow \"Install unknown apps\" for Zenvora Installer."
        progressBar.visibility = View.GONE
        layoutProgressDetails.visibility = View.GONE

        btnAction.text = "Grant Installation Permission"
        btnAction.visibility = View.VISIBLE
        btnAction.setOnClickListener {
            waitingForPermission = true
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        }
    }

    private fun startDownloadAndInstall() {
        if (isDownloading.getAndSet(true)) {
            Log.d(TAG, "Download already in progress")
            return
        }

        tvStatus.text = "Downloading Zenvora Agent…"
        tvSubStatus.text = "Connecting to repository…"
        btnAction.visibility = View.GONE
        progressBar.visibility = View.VISIBLE
        progressBar.isIndeterminate = false
        progressBar.progress = 0
        layoutProgressDetails.visibility = View.VISIBLE
        tvProgressPercent.text = "0%"
        tvBytesProgress.text = "Connecting…"

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val customUrl = prefs.getString("agent_apk_url", "") ?: ""
        val serverUrl = getServerBaseUrl()
        val downloadUrl = if (customUrl.isNotBlank()) customUrl else "$serverUrl/api/agent/download?platform=android&flavor=full"

        Log.i(TAG, "Starting live download from: $downloadUrl")

        scope.launch {
            try {
                val apkFile = withContext(Dispatchers.IO) {
                    SilentInstaller.downloadApk(
                        context = applicationContext,
                        url = downloadUrl,
                        onProgress = { bytesRead, totalBytes ->
                            scope.launch(Dispatchers.Main) {
                                if (totalBytes > 0) {
                                    val pct = ((bytesRead * 100) / totalBytes).toInt().coerceIn(0, 100)
                                    val curMb = bytesRead / (1024f * 1024f)
                                    val totalMb = totalBytes / (1024f * 1024f)

                                    progressBar.progress = pct
                                    tvProgressPercent.text = "$pct%"
                                    tvBytesProgress.text = String.format(Locale.US, "%.1f MB / %.1f MB", curMb, totalMb)
                                    tvSubStatus.text = "Downloading agent package ($pct%)"
                                } else {
                                    val curMb = bytesRead / (1024f * 1024f)
                                    tvBytesProgress.text = String.format(Locale.US, "%.1f MB", curMb)
                                    tvSubStatus.text = "Downloading agent package…"
                                }
                            }
                        }
                    )
                }

                // Download completed -> trigger install
                tvStatus.text = "Installing Zenvora Agent…"
                tvSubStatus.text = "Verifying package and applying permissions…"
                progressBar.isIndeterminate = true
                tvBytesProgress.text = "Download finished ✓"

                withContext(Dispatchers.IO) {
                    SilentInstaller.installApk(applicationContext, apkFile)
                    // Start background watchdog service
                    InstallerService.start(applicationContext)
                }

            } catch (e: Exception) {
                Log.e(TAG, "Download/Install failed: ${e.message}", e)
                isDownloading.set(false)
                tvStatus.text = "Installation Interrupted"
                tvSubStatus.text = e.message ?: "Could not complete download"
                progressBar.visibility = View.GONE
                layoutProgressDetails.visibility = View.GONE

                btnAction.text = "Retry Download"
                btnAction.visibility = View.VISIBLE
                btnAction.setOnClickListener {
                    startDownloadAndInstall()
                }
            }
        }
    }

    private fun onAgentInstallFinished(success: Boolean, message: String) {
        isDownloading.set(false)
        if (success) {
            tvStatus.text = "Installation Completed ✓"
            tvSubStatus.text = "Opening Zenvora Agent and setting up permissions…"
            progressBar.visibility = View.GONE
            layoutProgressDetails.visibility = View.GONE

            btnAction.text = "Open Zenvora Agent"
            btnAction.visibility = View.VISIBLE
            btnAction.setOnClickListener {
                SilentInstaller.launchAgentApp(this)
                finish()
            }

            scope.launch {
                delay(1200)
                SilentInstaller.launchAgentApp(this@MainActivity)
                delay(800)
                finishAndRemoveTask()
            }
        } else {
            tvStatus.text = "Install Error"
            tvSubStatus.text = message
            btnAction.text = "Retry"
            btnAction.visibility = View.VISIBLE
            btnAction.setOnClickListener {
                checkAndProceed()
            }
        }
    }

    private fun getServerBaseUrl(): String {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val saved = prefs.getString("server_url", "")?.trimEnd('/')
        return if (!saved.isNullOrBlank()) saved else DEFAULT_SERVER_URL
    }

    private fun getOrGenerateDeviceId(): String {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val stored = prefs.getString("device_id", "")
        if (!stored.isNullOrBlank()) return stored
        val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"
        val id = "AND-$androidId"
        prefs.edit().putString("device_id", id).apply()
        return id
    }

    companion object {
        private const val TAG = "ZenMainActivity"
        private const val PREFS_NAME = "zen_installer_prefs"
        private const val DEFAULT_SERVER_URL = "https://www.zenvora.abdullahtahir.me"
    }
}
