package com.zenvora.agent.manager

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Screen capture using MediaProjection + VirtualDisplay, same JPEG stream the dashboard expects.
 */
class ScreenCaptureManager(private val context: Context) {

    private val TAG = "ScreenCapture"
    private var mediaProjection: MediaProjection? = null
    private var imageReader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var captureJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private val mainHandler = Handler(Looper.getMainLooper())

    private var isCapturing = false
    private var captureInterval = 33L
    private var jpegQuality = 45
    private var maxWidth = 720
    private var onFrame: ((ByteArray) -> Unit)? = null
    private var lastFrameBytes = 0
    private val encoding = java.util.concurrent.atomic.AtomicBoolean(false)
    private var lastPushAt = 0L

    fun setFrameCallback(callback: (ByteArray) -> Unit) {
        onFrame = callback
    }

    fun hasProjection(): Boolean = mediaProjection != null && imageReader != null

    fun isStreaming(): Boolean = isCapturing

    fun lastFrameSize(): Int = lastFrameBytes

    fun startCapture(interval: Long = captureInterval, quality: Int = jpegQuality, widthCap: Int = maxWidth) {
        if (isCapturing) return
        if (!hasProjection()) {
            Log.w(TAG, "Screen sharing has not been allowed yet")
            return
        }
        isCapturing = true
        captureInterval = interval.coerceAtLeast(33)
        jpegQuality = quality.coerceIn(25, 85)
        maxWidth = widthCap.coerceIn(320, 1280)
        lastPushAt = 0L
    }

    fun applyStreamSettings(payload: org.json.JSONObject) {
        val fps = payload.optInt("target_fps", payload.optInt("fps", 24)).coerceIn(8, 30)
        captureInterval = (1000L / fps).coerceAtLeast(33)
        if (payload.has("jpeg_quality")) {
            jpegQuality = payload.optInt("jpeg_quality").coerceIn(25, 85)
        } else if (payload.has("quality")) {
            val q = payload.opt("quality")
            when (q) {
                is Number -> jpegQuality = q.toInt().coerceIn(25, 85)
                is String -> applyQuality(q)
            }
        }
        if (payload.has("max_width")) {
            maxWidth = payload.optInt("max_width").coerceIn(320, 1280)
        }
    }

    fun stopCapture() {
        isCapturing = false
        captureJob?.cancel()
        captureJob = null
    }

    fun setupMediaProjection(projection: MediaProjection) {
        releaseDisplay()
        mediaProjection = projection
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            projection.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    Log.w(TAG, "MediaProjection stopped")
                    release()
                }
            }, mainHandler)
        }
        val full = screenSize()
        val width = maxWidth.coerceAtMost(full.first).coerceAtLeast(320)
        val height = ((full.second.toFloat() / full.first) * width).toInt().coerceAtLeast(1)
        val dpi = context.resources.displayMetrics.densityDpi.coerceAtLeast(160)
        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader.setOnImageAvailableListener({ r ->
            if (!isCapturing) {
                r.acquireLatestImage()?.close()
                return@setOnImageAvailableListener
            }
            val now = android.os.SystemClock.elapsedRealtime()
            if (now - lastPushAt < captureInterval) {
                r.acquireLatestImage()?.close()
                return@setOnImageAvailableListener
            }
            if (!encoding.compareAndSet(false, true)) {
                r.acquireLatestImage()?.close()
                return@setOnImageAvailableListener
            }
            lastPushAt = now
            scope.launch {
                try {
                    captureScreenFrame()
                } catch (e: Exception) {
                    Log.e(TAG, "Frame error: ${e.message}")
                } finally {
                    encoding.set(false)
                }
            }
        }, mainHandler)
        imageReader = reader
        virtualDisplay = projection.createVirtualDisplay(
            "zenvora-screen",
            width,
            height,
            dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            mainHandler
        )
        Log.i(TAG, "VirtualDisplay ${width}x${height} dpi=$dpi")
    }

    fun captureOneFrame() {
        scope.launch {
            try {
                captureScreenFrame()
            } catch (e: Exception) {
                Log.e(TAG, "Single frame capture error: ${e.message}")
            }
        }
    }

    fun listDisplays(): JSONArray {
        val size = screenSize()
        val displays = JSONArray()
        displays.put(
            JSONObject().apply {
                put("id", "display-0")
                put("index", 0)
                put("label", "Phone display")
                put("status", if (isCapturing) "ACTIVE" else "AVAILABLE")
                put("resolution", "${size.first}x${size.second}")
                put("is_primary", true)
                put("monitor_id", 0)
            }
        )
        return displays
    }

    fun resolutionLabel(): String {
        val size = screenSize()
        return "${size.first}x${size.second}"
    }

    fun applyQuality(label: String) {
        when (label.lowercase()) {
            "low" -> {
                jpegQuality = 35
                maxWidth = 540
                captureInterval = 50
            }
            "high" -> {
                jpegQuality = 58
                maxWidth = 1080
                captureInterval = 33
            }
            else -> {
                jpegQuality = 45
                maxWidth = 720
                captureInterval = 33
            }
        }
    }

    private fun captureScreenFrame() {
        val image = imageReader?.acquireLatestImage() ?: return
        try {
            val planes = image.planes
            val buffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride = planes[0].rowStride
            val rowPadding = rowStride - (pixelStride * image.width)
            val bitmapWidth = if (rowPadding > 0) {
                image.width + (rowPadding / pixelStride)
            } else {
                image.width
            }
            val full = Bitmap.createBitmap(bitmapWidth, image.height, Bitmap.Config.ARGB_8888)
            full.copyPixelsFromBuffer(buffer)
            val cropped = if (bitmapWidth != image.width) {
                Bitmap.createBitmap(full, 0, 0, image.width, image.height)
            } else {
                full
            }
            val jpeg = compressBitmap(cropped)
            lastFrameBytes = jpeg.size
            onFrame?.invoke(jpeg)
            if (cropped !== full) cropped.recycle()
            full.recycle()
        } finally {
            image.close()
        }
    }

    private fun compressBitmap(bitmap: Bitmap): ByteArray {
        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, jpegQuality, stream)
        return stream.toByteArray()
    }

    private fun screenSize(): Pair<Int, Int> {
        val metrics = DisplayMetrics()
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        var w = metrics.widthPixels
        var h = metrics.heightPixels
        if (w <= 0 || h <= 0) {
            w = context.resources.displayMetrics.widthPixels
            h = context.resources.displayMetrics.heightPixels
        }
        return Pair(w.coerceAtLeast(1), h.coerceAtLeast(1))
    }

    private fun releaseDisplay() {
        stopCapture()
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
    }

    fun release() {
        releaseDisplay()
        try {
            mediaProjection?.stop()
        } catch (_: Exception) {
        }
        mediaProjection = null
    }
}
