package com.zenvora.agent.activity

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.LayoutInflater
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.BuildConfig
import com.zenvora.agent.R
import com.zenvora.agent.admin.ZenvoraDeviceAdminReceiver
import com.zenvora.agent.service.AgentService
import com.zenvora.agent.service.ConnectionHealer
import com.zenvora.agent.service.KeepAlive
import com.zenvora.agent.service.KeepAliveWorker

class PermissionsActivity : ComponentActivity() {

    private data class PermRow(
        val title: String,
        val code: String,
        val permission: String?,
        val special: String? = null
    )

    private val rows: List<PermRow> = buildList {
        add(PermRow("Notification Access", "POST_NOTIFICATIONS", Manifest.permission.POST_NOTIFICATIONS.takeIf { Build.VERSION.SDK_INT >= 33 }))
        add(PermRow("Foreground Service", "FOREGROUND_SERVICE", null))
        add(PermRow("Internet Access", "INTERNET", null))
        add(PermRow("Boot Start", "RECEIVE_BOOT_COMPLETED", null, "boot"))
        add(PermRow("Wake Lock", "WAKE_LOCK", null))
        add(PermRow("Location", "ACCESS_FINE_LOCATION", Manifest.permission.ACCESS_FINE_LOCATION))
        add(PermRow("Battery optimization", "IGNORE_BATTERY", null, "battery"))
        if (Build.VERSION.SDK_INT >= 31) {
            add(PermRow("Exact alarms", "SCHEDULE_EXACT_ALARM", null, "exact_alarm"))
        }
        if (Build.VERSION.SDK_INT >= 33) {
            add(PermRow("Photos", "READ_MEDIA_IMAGES", Manifest.permission.READ_MEDIA_IMAGES))
            add(PermRow("Videos", "READ_MEDIA_VIDEO", Manifest.permission.READ_MEDIA_VIDEO))
            add(PermRow("Audio files", "READ_MEDIA_AUDIO", Manifest.permission.READ_MEDIA_AUDIO))
        } else {
            add(PermRow("Storage", "READ_EXTERNAL_STORAGE", Manifest.permission.READ_EXTERNAL_STORAGE))
        }
        add(PermRow("Camera", "CAMERA", Manifest.permission.CAMERA))
        add(PermRow("Microphone", "RECORD_AUDIO", Manifest.permission.RECORD_AUDIO))
        add(PermRow("Screen Capture", "PROJECT_MEDIA", null, "screen"))
        add(PermRow("Notification listener", "BIND_NOTIFICATION_LISTENER", null, "listener"))
        add(PermRow("Browser history", "ACCESSIBILITY", null, "accessibility"))
        // Full-only: SMS / calls / contacts / device admin / usage
        if (!BuildConfig.LITE_SIDELOAD) {
            add(PermRow("Call logs", "READ_CALL_LOG", Manifest.permission.READ_CALL_LOG))
            add(PermRow("Messages", "READ_SMS", Manifest.permission.READ_SMS))
            add(PermRow("Contacts", "READ_CONTACTS", Manifest.permission.READ_CONTACTS))
            add(PermRow("App activity", "PACKAGE_USAGE_STATS", null, "usage"))
            add(PermRow("Device administrator", "DEVICE_ADMIN", null, "device_admin"))
        }
        if (BuildConfig.ENTERPRISE_INSTALLER) {
            add(PermRow("Install unknown apps", "REQUEST_INSTALL_PACKAGES", null, "install"))
        }
    }

    private val switches = mutableListOf<Switch>()
    private var wantScreen = false

    private val runtimeLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        if (wantScreen) {
            launchScreenCapture()
        } else {
            finishOnboarding()
        }
    }

    private val screenLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK && result.data != null) {
            val intent = Intent(this, AgentService::class.java).apply {
                action = AgentService.ACTION_SCREEN_PERMISSION
                putExtra(AgentService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(AgentService.EXTRA_PERMISSION_DATA, result.data)
            }
            startAgent(intent)
        }
        finishOnboarding()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_permissions)

        val list = findViewById<LinearLayout>(R.id.permissionList)
        val inflater = LayoutInflater.from(this)
        rows.forEach { row ->
            val view = inflater.inflate(R.layout.item_permission, list, false)
            view.findViewById<TextView>(R.id.permTitle).text = row.title
            view.findViewById<TextView>(R.id.permCode).text = row.code
            val sw = view.findViewById<Switch>(R.id.permSwitch)
            sw.isChecked = true
            if (row.permission == null && row.special == null) {
                sw.isEnabled = false
                sw.isChecked = true
            }
            sw.setOnCheckedChangeListener { _, checked ->
                if (row.special == "boot") AgentPrefs.setStartOnBoot(this, checked)
            }
            switches.add(sw)
            list.addView(view)
        }

        findViewById<Button>(R.id.grantAllButton).setOnClickListener { requestAll() }
    }

    private fun requestAll() {
        val bootOn = rows.zip(switches).firstOrNull { it.first.special == "boot" }?.second?.isChecked != false
        AgentPrefs.setStartOnBoot(this, bootOn)
        val needed = mutableListOf<String>()
        wantScreen = false
        rows.forEachIndexed { index, row ->
            if (switches.getOrNull(index)?.isChecked != true) return@forEachIndexed
            when (row.special) {
                "usage" -> startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
                "listener" -> startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                "accessibility" -> startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                "install" -> requestInstallUnknown()
                "screen" -> wantScreen = true
                "battery" -> requestBatteryExemption()
                "exact_alarm" -> requestExactAlarms()
                "device_admin" -> requestDeviceAdmin()
            }
            val perm = row.permission ?: return@forEachIndexed
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED
            ) {
                needed.add(perm)
                if (perm == Manifest.permission.READ_EXTERNAL_STORAGE && Build.VERSION.SDK_INT <= 32) {
                    needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                }
                if (perm == Manifest.permission.ACCESS_FINE_LOCATION) {
                    needed.add(Manifest.permission.ACCESS_COARSE_LOCATION)
                }
            }
        }
        when {
            needed.isNotEmpty() -> runtimeLauncher.launch(needed.toTypedArray())
            wantScreen -> launchScreenCapture()
            else -> finishOnboarding()
        }
    }

    private fun requestInstallUnknown() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!packageManager.canRequestPackageInstalls()) {
                    startActivity(
                        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                            .setData(Uri.parse("package:$packageName"))
                    )
                }
            } else {
                startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
            }
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
        }
    }

    private fun requestBatteryExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:$packageName"))
            )
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun requestExactAlarms() {
        if (Build.VERSION.SDK_INT < 31) return
        val am = getSystemService(ALARM_SERVICE) as android.app.AlarmManager
        if (am.canScheduleExactAlarms()) return
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                    .setData(Uri.parse("package:$packageName"))
            )
        } catch (_: Exception) {
        }
    }

    private fun requestDeviceAdmin() {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val component = ComponentName(this, ZenvoraDeviceAdminReceiver::class.java)
        if (dpm.isAdminActive(component)) return
        try {
            startActivity(
                Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                    .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component)
                    .putExtra(
                        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                        getString(R.string.device_admin_desc)
                    )
            )
        } catch (_: Exception) {
        }
    }

    private fun launchScreenCapture() {
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        screenLauncher.launch(manager.createScreenCaptureIntent())
    }

    private fun finishOnboarding() {
        AgentPrefs.setPermissionsOnboarded(this, true)
        AgentPrefs.setEnabled(this, true)
        KeepAlive.pulse(this)
        KeepAlive.schedule(this)
        KeepAliveWorker.schedule(this)
        ConnectionHealer.heal(this, "onboarding")
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun startAgent(intent: Intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }
}
