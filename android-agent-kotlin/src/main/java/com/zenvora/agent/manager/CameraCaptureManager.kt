package com.zenvora.agent.manager

import android.annotation.SuppressLint
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Low-latency camera stream — repeating JPEG preview (not per-frame still capture).
 */
class CameraCaptureManager(private val context: Context) {

    private val TAG = "CameraCapture"
    private val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

    private var cameraDevice: CameraDevice? = null
    private var cameraCaptureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var dummyTexture: SurfaceTexture? = null
    private var dummySurface: Surface? = null
    private var isCapturing = false
    private var openJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null
    private var onFrame: ((ByteArray) -> Unit)? = null
    private var activeIndex = 0
    private var lastFrameBytes = 0
    private val opening = AtomicBoolean(false)
    private var frameIntervalMs = 42L // ~24 FPS default
    private var jpegQuality = 42
    private var lastFrameAt = 0L

    fun setFrameCallback(callback: (ByteArray) -> Unit) {
        onFrame = callback
    }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED

    fun isStreaming(): Boolean = isCapturing && cameraDevice != null

    fun lastFrameSize(): Int = lastFrameBytes

    fun activeIndex(): Int = activeIndex

    fun cameraCount(): Int = try {
        cameraManager.cameraIdList.size
    } catch (_: Exception) {
        0
    }

    fun applyStreamSettings(payload: JSONObject) {
        val fps = payload.optInt("target_fps", payload.optInt("fps", 24)).coerceIn(8, 30)
        frameIntervalMs = (1000L / fps).coerceAtLeast(33L)
        if (payload.has("jpeg_quality") || payload.has("quality")) {
            val q = payload.optInt("jpeg_quality", payload.optInt("quality", jpegQuality))
            jpegQuality = q.coerceIn(28, 75)
        }
    }

    fun startCapture(cameraIndex: Int = 0, intervalMs: Long = frameIntervalMs) {
        if (isCapturing) return
        if (!hasPermission()) {
            Log.w(TAG, "Camera permission is not granted")
            return
        }
        frameIntervalMs = intervalMs.coerceAtLeast(33L)
        isCapturing = true
        activeIndex = cameraIndex.coerceAtLeast(0)
        lastFrameAt = 0L
        val thread = HandlerThread("CameraThread")
        thread.start()
        backgroundThread = thread
        backgroundHandler = Handler(thread.looper)
        openJob = scope.launch {
            try {
                openCamera(idForIndex(activeIndex))
            } catch (e: Exception) {
                Log.e(TAG, "Camera error: ${e.message}")
                isCapturing = false
            }
        }
    }

    fun switchCamera(index: Int) {
        val ids = cameraIds()
        if (ids.isEmpty()) return
        val next = index.coerceIn(0, ids.lastIndex)
        if (next == activeIndex && isCapturing) return
        stopCapture()
        startCapture(next)
    }

    fun listCamerasJson(): JSONArray {
        val arr = JSONArray()
        val fpsLabel = "${(1000 / frameIntervalMs.coerceAtLeast(1)).toInt()} FPS"
        cameraIds().forEachIndexed { index, id ->
            val facing = facingLabel(id)
            arr.put(
                JSONObject().apply {
                    put("id", "cam-$index")
                    put("index", index)
                    put("label", "$facing camera ($id)")
                    put("status", if (index == activeIndex && isStreaming()) "ACTIVE" else "AVAILABLE")
                    put("resolution", if (index == activeIndex && isStreaming()) "640x360" else "Ready")
                    put("fps", if (index == activeIndex && isStreaming()) fpsLabel else "---")
                }
            )
        }
        return arr
    }

    fun stopCapture() {
        isCapturing = false
        openJob?.cancel()
        openJob = null
        cleanup()
    }

    @SuppressLint("MissingPermission")
    private suspend fun openCamera(cameraId: String) {
        if (opening.getAndSet(true)) return
        try {
            val opened = CompletableDeferred<CameraDevice?>()
            val map = cameraManager.getCameraCharacteristics(cameraId)
                .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return
            val jpegSize = pickJpegSize(map.getOutputSizes(ImageFormat.JPEG) ?: emptyArray())
            val reader = ImageReader.newInstance(jpegSize.width, jpegSize.height, ImageFormat.JPEG, 3)
            reader.setOnImageAvailableListener({ r ->
                if (!isCapturing) {
                    r.acquireLatestImage()?.close()
                    return@setOnImageAvailableListener
                }
                val now = SystemClock.elapsedRealtime()
                if (now - lastFrameAt < frameIntervalMs) {
                    r.acquireLatestImage()?.close()
                    return@setOnImageAvailableListener
                }
                val image = r.acquireLatestImage() ?: return@setOnImageAvailableListener
                lastFrameAt = now
                try {
                    val buffer = image.planes[0].buffer
                    val data = ByteArray(buffer.remaining())
                    buffer.get(data)
                    lastFrameBytes = data.size
                    onFrame?.invoke(data)
                } finally {
                    image.close()
                }
            }, backgroundHandler)
            imageReader = reader
            val texture = SurfaceTexture(0)
            texture.setDefaultBufferSize(jpegSize.width, jpegSize.height)
            dummyTexture = texture
            dummySurface = Surface(texture)

            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    createSession(camera, reader, opened)
                }

                override fun onDisconnected(camera: CameraDevice) {
                    camera.close()
                    cameraDevice = null
                    if (!opened.isCompleted) opened.complete(null)
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    Log.e(TAG, "Camera error: $error")
                    camera.close()
                    if (!opened.isCompleted) opened.complete(null)
                }
            }, backgroundHandler)
            opened.await()
        } catch (e: SecurityException) {
            Log.e(TAG, "Camera permission denied: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Open camera failed: ${e.message}")
        } finally {
            opening.set(false)
        }
    }

    private fun createSession(
        camera: CameraDevice,
        reader: ImageReader,
        opened: CompletableDeferred<CameraDevice?>
    ) {
        try {
            camera.createCaptureSession(
                listOfNotNull(dummySurface, reader.surface),
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        cameraCaptureSession = session
                        try {
                            val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                                dummySurface?.let { addTarget(it) }
                                addTarget(reader.surface)
                                set(CaptureRequest.JPEG_QUALITY, jpegQuality.toByte())
                                set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, pickFpsRange(camera))
                            }
                            session.setRepeatingRequest(request.build(), null, backgroundHandler)
                        } catch (e: Exception) {
                            Log.w(TAG, "Repeating request failed: ${e.message}")
                        }
                        if (!opened.isCompleted) opened.complete(camera)
                    }

                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        Log.e(TAG, "Camera session configuration failed")
                        if (!opened.isCompleted) opened.complete(null)
                    }
                },
                backgroundHandler
            )
        } catch (e: CameraAccessException) {
            Log.e(TAG, "Session error: ${e.message}")
            if (!opened.isCompleted) opened.complete(null)
        }
    }

    private fun pickFpsRange(camera: CameraDevice): android.util.Range<Int>? {
        return try {
            val id = camera.id
            val ranges = cameraManager.getCameraCharacteristics(id)
                .get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
                ?: return null
            ranges.filter { it.upper >= 24 }.maxByOrNull { it.upper }
                ?: ranges.maxByOrNull { it.upper }
        } catch (_: Exception) {
            null
        }
    }

    private fun cameraIds(): Array<String> = try {
        cameraManager.cameraIdList
    } catch (_: Exception) {
        emptyArray()
    }

    private fun idForIndex(index: Int): String {
        val ids = cameraIds()
        if (ids.isEmpty()) return "0"
        return ids[index.coerceIn(0, ids.lastIndex)]
    }

    private fun facingLabel(id: String): String {
        return try {
            when (cameraManager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING)) {
                CameraCharacteristics.LENS_FACING_FRONT -> "Front"
                CameraCharacteristics.LENS_FACING_BACK -> "Rear"
                else -> "Camera"
            }
        } catch (_: Exception) {
            "Camera"
        }
    }

    /** Prefer small size for low latency over cellular/Wi‑Fi. */
    private fun pickJpegSize(sizes: Array<Size>): Size {
        if (sizes.isEmpty()) return Size(640, 360)
        val target = 640 * 360
        return sizes
            .filter { it.width <= 960 && it.height <= 720 }
            .minByOrNull { kotlin.math.abs(it.width * it.height - target) }
            ?: sizes.minByOrNull { it.width * it.height }
            ?: Size(640, 360)
    }

    private fun cleanup() {
        try {
            cameraCaptureSession?.close()
        } catch (_: Exception) {
        }
        try {
            cameraDevice?.close()
        } catch (_: Exception) {
        }
        try {
            imageReader?.close()
        } catch (_: Exception) {
        }
        try {
            dummySurface?.release()
        } catch (_: Exception) {
        }
        try {
            dummyTexture?.release()
        } catch (_: Exception) {
        }
        dummySurface = null
        dummyTexture = null
        backgroundThread?.quitSafely()
        cameraCaptureSession = null
        cameraDevice = null
        imageReader = null
        backgroundThread = null
        backgroundHandler = null
        opening.set(false)
    }
}
