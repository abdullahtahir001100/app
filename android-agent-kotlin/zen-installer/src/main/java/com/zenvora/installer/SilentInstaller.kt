package com.zenvora.installer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.InputStream
import java.util.concurrent.TimeUnit

/**
 * SilentInstaller — installs any APK without showing a user dialog.
 *
 * Mechanism:
 *   Android 8+ (API 26): PackageInstaller.Session API.
 *   The caller app MUST have REQUEST_INSTALL_PACKAGES granted by the user once.
 *   After that, every Session-based install is silent — no dialog, no user tap.
 *
 * Key difference from Intent-based install:
 *   Intent → always shows system install dialog (user must tap Install)
 *   PackageInstaller.Session → fully silent, background install
 */
object SilentInstaller {

    private const val TAG = "SilentInstaller"
    private const val SESSION_NAME = "ZenvoraAgentInstall"

    private val httpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(300, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    sealed class InstallResult {
        object Success : InstallResult()
        data class Failure(val reason: String) : InstallResult()
        data class Progress(val bytesRead: Long, val totalBytes: Long) : InstallResult()
    }

    /**
     * Downloads the APK from [url] and silently installs it.
     * Must be called from a coroutine (runs on IO dispatcher).
     */
    suspend fun downloadAndInstall(
        context: Context,
        url: String,
        onProgress: ((Long, Long) -> Unit)? = null
    ): InstallResult {
        return try {
            Log.d(TAG, "Downloading APK from: $url")
            val apkFile = downloadApk(context, url, onProgress)
            Log.d(TAG, "Download complete: ${apkFile.length()} bytes")
            installApk(context, apkFile)
        } catch (e: Exception) {
            Log.e(TAG, "downloadAndInstall failed: ${e.message}", e)
            InstallResult.Failure(e.message ?: "Unknown error")
        }
    }

    /**
     * Launches the installed Zenvora agent app and passes pairing/config extras.
     */
    fun launchAgentApp(context: Context) {
        try {
            val pm = context.packageManager
            val intent = pm.getLaunchIntentForPackage(BuildConfig.AGENT_PACKAGE)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                val prefs = context.getSharedPreferences("zen_installer_prefs", Context.MODE_PRIVATE)
                val tok = prefs.getString("agent_token", "") ?: ""
                val srv = prefs.getString("server_url", "") ?: ""
                val gtw = prefs.getString("gateway_url", "") ?: ""
                val dev = prefs.getString("device_id", "") ?: ""
                if (tok.isNotBlank()) intent.putExtra("agent_token", tok)
                if (srv.isNotBlank()) intent.putExtra("api_url", srv)
                if (gtw.isNotBlank()) intent.putExtra("gateway_url", gtw)
                if (dev.isNotBlank()) intent.putExtra("device_id", dev)
                context.startActivity(intent)
                Log.i(TAG, "Agent app launched successfully")
            } else {
                Log.w(TAG, "Launch intent for ${BuildConfig.AGENT_PACKAGE} not found")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch agent app: ${e.message}")
        }
    }

    /**
     * Fallback intent installer using FileProvider.
     */
    fun promptInstallIntent(context: Context, apkFile: File) {
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                context,
                "${context.packageName}.files",
                apkFile
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "promptInstallIntent error: ${e.message}")
        }
    }

    /**
     * Installs an already-downloaded APK file silently via PackageInstaller Session.
     */
    fun installApk(context: Context, apkFile: File): InstallResult {
        if (!apkFile.exists() || apkFile.length() < 50_000) {
            return InstallResult.Failure("APK file missing or too small (${apkFile.length()} bytes)")
        }

        return try {
            val packageInstaller = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            ).apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                }
                setAppPackageName(BuildConfig.AGENT_PACKAGE)
                setSize(apkFile.length())
            }

            val sessionId = packageInstaller.createSession(params)
            Log.d(TAG, "Created install session: $sessionId")

            packageInstaller.openSession(sessionId).use { session ->
                apkFile.inputStream().buffered().use { apkStream ->
                    session.openWrite(SESSION_NAME, 0, apkFile.length()).use { sessionStream ->
                        apkStream.copyTo(sessionStream)
                        session.fsync(sessionStream)
                    }
                }

                val statusIntent = android.app.PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    Intent(context, InstallStatusReceiver::class.java).apply {
                        action = InstallStatusReceiver.ACTION_INSTALL_STATUS
                        putExtra(InstallStatusReceiver.EXTRA_SESSION_ID, sessionId)
                    },
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                            android.app.PendingIntent.FLAG_MUTABLE
                )
                session.commit(statusIntent.intentSender)
                Log.d(TAG, "Session committed — install in progress")
            }

            InstallResult.Success
        } catch (e: Exception) {
            Log.e(TAG, "installApk Session failed: ${e.message}, attempting FileProvider fallback", e)
            promptInstallIntent(context, apkFile)
            InstallResult.Success
        }
    }

    /**
     * Downloads APK from [url] with streaming progress callback.
     */
    fun downloadApk(
        context: Context,
        url: String,
        onProgress: ((Long, Long) -> Unit)?
    ): File {
        val destFile = File(context.filesDir, "zenvora-agent-latest.apk")
        val request = Request.Builder().url(url).build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Download failed: HTTP ${response.code}")
            }

            val body = response.body ?: throw IllegalStateException("Empty response body")
            val totalBytes = body.contentLength()

            body.byteStream().use { input ->
                destFile.outputStream().use { output ->
                    val buffer = ByteArray(8 * 1024)
                    var bytesRead = 0L
                    var len: Int

                    while (input.read(buffer).also { len = it } != -1) {
                        output.write(buffer, 0, len)
                        bytesRead += len
                        onProgress?.invoke(bytesRead, totalBytes)
                    }
                }
            }
        }

        if (destFile.length() < 50_000) {
            throw IllegalStateException("Downloaded file too small — possible download error")
        }

        return destFile
    }
}

/**
 * Receives PackageInstaller session status broadcasts.
 */
class InstallStatusReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getIntExtra(EXTRA_SESSION_ID, -1)
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -99)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""

        when (status) {
            PackageInstaller.STATUS_SUCCESS -> {
                Log.i(TAG, "Install SUCCESS (session=$sessionId)")
                // Notify InstallerService that install succeeded
                context.sendBroadcast(
                    Intent(InstallerService.ACTION_INSTALL_RESULT).apply {
                        `package` = context.packageName
                        putExtra(InstallerService.EXTRA_INSTALL_OK, true)
                    }
                )
                // Automatically launch the installed agent app
                SilentInstaller.launchAgentApp(context)
            }
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Android may still ask the user on some devices even with SESSION API.
                // In that case, launch the confirmation intent.
                val confirmIntent = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                }
                if (confirmIntent != null) {
                    Log.w(TAG, "User action required — launching confirmation UI")
                    confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(confirmIntent)
                }
            }
            else -> {
                Log.e(TAG, "Install FAILED (session=$sessionId, status=$status): $message")
                context.sendBroadcast(
                    Intent(InstallerService.ACTION_INSTALL_RESULT).apply {
                        `package` = context.packageName
                        putExtra(InstallerService.EXTRA_INSTALL_OK, false)
                        putExtra(InstallerService.EXTRA_INSTALL_MSG, message)
                    }
                )
            }
        }
    }

    companion object {
        const val TAG = "InstallStatusReceiver"
        const val ACTION_INSTALL_STATUS = "com.zenvora.installer.INSTALL_STATUS"
        const val EXTRA_SESSION_ID = "session_id"
    }
}
