package com.zenvora.agent.manager

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Microphone capture after the user grants RECORD_AUDIO in the app UI.
 */
class AudioCapture(private val context: Context) {

    private val TAG = "AudioCapture"
    private var audioRecord: AudioRecord? = null
    private var isRecording = false
    private var recordingJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private var onAudio: ((ByteArray) -> Unit)? = null

    private val sampleRate = 44100
    private val bufferSize = AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT
    )

    fun setAudioCallback(callback: (ByteArray) -> Unit) {
        onAudio = callback
    }

    fun startCapture() {
        if (isRecording) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "Microphone permission is not granted")
            return
        }

        isRecording = true
        recordingJob = scope.launch {
            try {
                initializeAudioRecord()
                captureAudio()
            } catch (e: Exception) {
                Log.e(TAG, "Audio capture error: ${e.message}")
                isRecording = false
            }
        }
    }

    fun stopCapture() {
        isRecording = false
        recordingJob?.cancel()
        audioRecord?.release()
        audioRecord = null
    }

    private fun initializeAudioRecord() {
        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )
            audioRecord?.startRecording()
        } catch (e: SecurityException) {
            Log.e(TAG, "Microphone permission needed: ${e.message}")
        }
    }

    private suspend fun captureAudio() {
        val audioData = ByteArray(bufferSize)
        while (isRecording) {
            withContext(Dispatchers.IO) {
                try {
                    val bytesRead = audioRecord?.read(audioData, 0, audioData.size) ?: 0
                    if (bytesRead > 0) {
                        onAudio?.invoke(audioData.copyOf(bytesRead))
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Read error: ${e.message}")
                }
                Unit
            }
            delay(100)
        }
    }
}
