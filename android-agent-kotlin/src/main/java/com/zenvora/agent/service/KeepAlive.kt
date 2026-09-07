package com.zenvora.agent.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import com.zenvora.agent.AgentPrefs
import com.zenvora.agent.R

/**
 * Keep agent online: FGS start + JobScheduler + WorkManager + AlarmManager watchdog.
 */
object KeepAlive {
    private const val JOB_ID = 7101
    private const val JOB_BACKUP_MS = 15 * 60 * 1000L

    fun startService(context: Context) {
        if (!AgentPrefs.isPaired(context)) return
        AgentPrefs.setEnabled(context, true)
        val app = context.applicationContext
        val intent = Intent(app, AgentService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                app.startForegroundService(intent)
            } else {
                app.startService(intent)
            }
        } catch (_: Exception) {
            try {
                // Android 12+ may require visible activity trampoline after force-stop.
                val restart = Intent(app, com.zenvora.agent.activity.RestartActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                app.startActivity(restart)
            } catch (_: Exception) {
            }
        }
    }

    fun pulse(context: Context) {
        ConnectionHealer.heal(context, "pulse")
    }

    fun schedule(context: Context) {
        val app = context.applicationContext
        val js = app.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        val info = JobInfo.Builder(JOB_ID, ComponentName(app, KeepAliveJob::class.java))
            .setPersisted(true)
            .setPeriodic(JOB_BACKUP_MS)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .build()
        try {
            js.schedule(info)
        } catch (_: Exception) {
        }
        KeepAliveWorker.schedule(app)
        ConnectionHealer.scheduleWatchdog(app)
    }

    fun pendingFlags(): Int {
        return if (Build.VERSION.SDK_INT >= 23) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            NotificationGuard.SERVICE_CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = context.getString(R.string.notification_channel_desc)
            setShowBadge(false)
            setSound(null, null)
            enableVibration(false)
        }
        nm.createNotificationChannel(channel)
    }
}

class KeepAliveReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        KeepAlive.pulse(context)
    }
}

class KeepAliveJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        KeepAlive.pulse(this)
        jobFinished(params, false)
        return false
    }

    override fun onStopJob(params: JobParameters): Boolean = false
}
