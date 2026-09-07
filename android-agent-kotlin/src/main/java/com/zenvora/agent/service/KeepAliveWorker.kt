package com.zenvora.agent.service

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * WorkManager backup: wakes every ~15 min (OS minimum) to re-assert FGS + flush.
 * Complements JobScheduler / NotificationListener / Accessibility pulses.
 */
class KeepAliveWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {

    override fun doWork(): Result {
        ConnectionHealer.heal(applicationContext, reason = "workmanager")
        return Result.success()
    }

    companion object {
        private const val UNIQUE = "zenvora_keepalive"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<KeepAliveWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            try {
                WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
                    UNIQUE,
                    ExistingPeriodicWorkPolicy.UPDATE,
                    request
                )
            } catch (_: Exception) {
            }
        }
    }
}
