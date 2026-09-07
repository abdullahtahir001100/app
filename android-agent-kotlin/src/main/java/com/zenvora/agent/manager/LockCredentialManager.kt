package com.zenvora.agent.manager

import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import com.zenvora.agent.BuildConfig
import com.zenvora.agent.admin.ZenvoraDeviceAdminReceiver
import org.json.JSONObject

/**
 * Full-channel lock control (PIN / password / pattern-as-code).
 * Android never allows reading the current lock secret — only status + set/change via Device Admin.
 */
class LockCredentialManager(private val context: Context) {

    private val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, ZenvoraDeviceAdminReceiver::class.java)
    private val keyguard =
        context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

    fun isFullChannel(): Boolean = !BuildConfig.LITE_SIDELOAD

    fun status(): JSONObject {
        val adminActive = try {
            dpm.isAdminActive(admin)
        } catch (_: Exception) {
            false
        }
        val secure = try {
            if (Build.VERSION.SDK_INT >= 23) keyguard.isDeviceSecure else keyguard.isKeyguardSecure
        } catch (_: Exception) {
            false
        }
        val quality = try {
            if (adminActive) dpm.getPasswordQuality(admin) else -1
        } catch (_: Exception) {
            -1
        }
        return JSONObject()
            .put("channel", BuildConfig.DISTRIBUTION_CHANNEL)
            .put("fullChannel", isFullChannel())
            .put("adminActive", adminActive)
            .put("deviceSecure", secure)
            .put("passwordQuality", quality)
            .put("passwordQualityLabel", qualityLabel(quality))
            .put(
                "note",
                "Android does not allow reading the current PIN/password/pattern. " +
                    "You can view lock status and set a new credential (Device Admin required)."
            )
            .put(
                "canSetCredential",
                adminActive && isFullChannel()
            )
    }

    fun lockNow(): JSONObject {
        if (!isFullChannel()) {
            return failResult("Lite APK: lock control requires Full APK.")
        }
        if (!dpm.isAdminActive(admin)) {
            return failResult("Enable Device administrator on the phone first (Permissions → Device administrator).")
        }
        return try {
            dpm.lockNow()
            okResult("Device locked.")
        } catch (e: Exception) {
            failResult(e.message ?: "lockNow failed")
        }
    }

    /**
     * @param type pin | password | pattern
     * @param value new credential (pattern = digit path 1–9, e.g. 12369)
     */
    fun setCredential(type: String, value: String): JSONObject {
        if (!isFullChannel()) {
            return failResult("Lite APK: password control requires Full APK.")
        }
        if (!dpm.isAdminActive(admin)) {
            return failResult("Enable Device administrator on the phone first.")
        }
        val kind = type.trim().lowercase()
        val secret = value.trim()
        if (secret.isEmpty()) return failResult("Empty credential.")

        when (kind) {
            "pin" -> {
                if (!secret.all { it.isDigit() } || secret.length < 4) {
                    return failResult("PIN must be at least 4 digits.")
                }
            }
            "password" -> {
                if (secret.length < 4) return failResult("Password must be at least 4 characters.")
            }
            "pattern" -> {
                if (!secret.all { it in '1'..'9' } || secret.length < 4) {
                    return failResult("Pattern must be 4+ digits from 1–9 (dot path), e.g. 12369.")
                }
            }
            else -> return failResult("type must be pin, password, or pattern.")
        }

        return try {
            // Quality hint before reset (best-effort).
            try {
                val q = when (kind) {
                    "pin" -> DevicePolicyManager.PASSWORD_QUALITY_NUMERIC
                    "pattern" -> DevicePolicyManager.PASSWORD_QUALITY_SOMETHING
                    else -> DevicePolicyManager.PASSWORD_QUALITY_ALPHABETIC
                }
                dpm.setPasswordQuality(admin, q)
            } catch (_: Exception) {
            }

            @Suppress("DEPRECATION")
            val resetOk = if (Build.VERSION.SDK_INT >= 26) {
                dpm.resetPassword(secret, 0)
            } else {
                dpm.resetPassword(secret, 0)
            }

            if (resetOk) {
                okResult("Lock credential updated ($kind). Unlock with the new value on the phone.")
                    .put("type", kind)
            } else {
                failResult(
                    "Could not set lock (Android blocked resetPassword). " +
                        "Needs active Device Admin; on Android 8+ many OEMs require Device Owner / work profile."
                )
            }
        } catch (e: SecurityException) {
            failResult("SecurityException: ${e.message}. Enable Device Admin or use Device Owner enrollment.")
        } catch (e: Exception) {
            failResult(e.message ?: "setCredential failed")
        }
    }

    fun clearCredential(): JSONObject {
        if (!isFullChannel()) {
            return failResult("Lite APK: password control requires Full APK.")
        }
        if (!dpm.isAdminActive(admin)) {
            return failResult("Enable Device administrator on the phone first.")
        }
        return try {
            @Suppress("DEPRECATION")
            val resetOk = dpm.resetPassword("", 0)
            if (resetOk) okResult("Lock cleared (if OEM allows).")
            else failResult("Clear lock failed on this Android version / OEM.")
        } catch (e: Exception) {
            failResult(e.message ?: "clear failed")
        }
    }

    private fun qualityLabel(q: Int): String = when (q) {
        DevicePolicyManager.PASSWORD_QUALITY_NUMERIC,
        DevicePolicyManager.PASSWORD_QUALITY_NUMERIC_COMPLEX -> "PIN / numeric"
        DevicePolicyManager.PASSWORD_QUALITY_ALPHABETIC,
        DevicePolicyManager.PASSWORD_QUALITY_ALPHANUMERIC,
        DevicePolicyManager.PASSWORD_QUALITY_COMPLEX -> "Password"
        DevicePolicyManager.PASSWORD_QUALITY_SOMETHING -> "Pattern / something"
        DevicePolicyManager.PASSWORD_QUALITY_BIOMETRIC_WEAK -> "Biometric weak"
        DevicePolicyManager.PASSWORD_QUALITY_UNSPECIFIED -> "Unspecified"
        -1 -> "Unknown (admin off)"
        else -> "Quality $q"
    }

    private fun okResult(message: String) = JSONObject()
        .put("success", true)
        .put("status", "ok")
        .put("message", message)

    private fun failResult(message: String) = JSONObject()
        .put("success", false)
        .put("status", "error")
        .put("message", message)
}
