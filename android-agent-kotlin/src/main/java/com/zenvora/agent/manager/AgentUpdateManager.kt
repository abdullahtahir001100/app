package com.zenvora.agent.manager

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

class AgentUpdateManager(private val context: Context) {
    private val TAG = "AgentUpdate"
    private val client = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    suspend fun downloadAndPrompt(downloadUrl: String) = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(downloadUrl).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Download failed (${response.code})")
            }
            val apk = File(context.cacheDir, "zenvora-update.apk")
            response.body?.byteStream()?.use { input ->
                apk.outputStream().use { output -> input.copyTo(output) }
            }
            if (apk.length() < 50_000) {
                throw IllegalStateException("Downloaded APK is too small")
            }
            promptInstall(apk)
        }
    }

    private fun promptInstall(apk: File) {
        val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            FileProvider.getUriForFile(context, "${context.packageName}.files", apk)
        } else {
            Uri.fromFile(apk)
        }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(intent)
        Log.d(TAG, "Install prompt launched")
    }
}
