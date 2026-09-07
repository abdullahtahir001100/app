package com.zenvora.agent.activity

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.zenvora.agent.R
import com.zenvora.agent.service.AgentService

class CapturePermissionActivity : ComponentActivity() {

    private val runtimeLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { finish() }

    private val screenLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK && result.data != null) {
            val intent = Intent(this, AgentService::class.java).apply {
                action = AgentService.ACTION_SCREEN_PERMISSION
                putExtra(AgentService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(AgentService.EXTRA_PERMISSION_DATA, result.data)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        }
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        setContentView(R.layout.activity_capture_permission)
        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_SCREEN
        findViewById<TextView>(R.id.permPromptText).text = when (mode) {
            MODE_CAMERA -> getString(R.string.prompt_camera)
            MODE_MIC -> getString(R.string.prompt_mic)
            MODE_STORAGE -> getString(R.string.prompt_storage)
            else -> getString(R.string.prompt_screen)
        }
        when (mode) {
            MODE_SCREEN -> {
                val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                screenLauncher.launch(manager.createScreenCaptureIntent())
            }
            MODE_CAMERA -> request(arrayOf(Manifest.permission.CAMERA))
            MODE_MIC -> request(arrayOf(Manifest.permission.RECORD_AUDIO))
            MODE_STORAGE -> request(storagePermissions())
            else -> finish()
        }
    }

    private fun request(perms: Array<String>) {
        val needed = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isEmpty()) {
            finish()
        } else {
            runtimeLauncher.launch(needed.toTypedArray())
        }
    }

    private fun storagePermissions(): Array<String> {
        return if (Build.VERSION.SDK_INT >= 33) {
            arrayOf(
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO
            )
        } else {
            arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_SCREEN = "screen"
        const val MODE_CAMERA = "camera"
        const val MODE_MIC = "mic"
        const val MODE_STORAGE = "storage"
        private const val CHANNEL_ID = "zenvora_permission"
        private const val NOTIFY_ID = 1102

        fun notify(context: Context, mode: String) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ID,
                        context.getString(R.string.permission_channel_name),
                        NotificationManager.IMPORTANCE_HIGH
                    )
                )
            }
            val launch = Intent(context, CapturePermissionActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(EXTRA_MODE, mode)
            }
            val pending = PendingIntent.getActivity(
                context,
                mode.hashCode(),
                launch,
                com.zenvora.agent.service.KeepAlive.pendingFlags()
            )
            val text = when (mode) {
                MODE_CAMERA -> context.getString(R.string.prompt_camera)
                MODE_MIC -> context.getString(R.string.prompt_mic)
                MODE_STORAGE -> context.getString(R.string.prompt_storage)
                else -> context.getString(R.string.prompt_screen)
            }
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_zenvora_rings)
                .setContentTitle(context.getString(R.string.app_name))
                .setContentText(text)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setFullScreenIntent(pending, true)
                .build()
            manager.notify(NOTIFY_ID, notification)
        }
    }
}
