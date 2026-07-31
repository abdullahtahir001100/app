/**
 * Zenvora binary control-plane framing (agent ⇄ Node).
 *
 * Layout (little-endian):
 *   magic[2]=0x5A 0x56 ("ZV")
 *   version u8 = 1
 *   msgType u8
 *   flags u8
 *   seq u64
 *   payloadLen u32
 *   payload[payloadLen]
 */

const MAGIC0 = 0x5a;
const MAGIC1 = 0x56;
const VERSION = 1;
const HEADER_SIZE = 17;

const MsgType = Object.freeze({
    HEARTBEAT: 0x01,
    HEARTBEAT_ACK: 0x02,
    AUTH: 0x03,
    AUTH_OK: 0x04,
    AUTH_FAIL: 0x05,
    EVENT: 0x10,
    EVENT_ACK: 0x11,
    COMMAND: 0x20,
    COMMAND_RESULT: 0x21,
    SYNC_CURSOR: 0x30,
    SYNC_BATCH: 0x31,
    MEDIA_FRAME: 0x40,
    MEDIA_ACK: 0x41,
});

const EventKind = Object.freeze({
    BROWSER_HISTORY: 1,
    APP_HISTORY: 2,
    NOTIFICATION: 3,
    ACTIVITY: 4,
    CLIPBOARD: 5,
    USB: 6,
    PROCESS: 7,
    DEVICE_STATUS: 8,
    WINDOW: 9,
});

function encodeFrame(msgType, seq, payloadBuf, flags = 0) {
    const payload = Buffer.isBuffer(payloadBuf) ? payloadBuf : Buffer.from(payloadBuf || []);
    const out = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
    out[0] = MAGIC0;
    out[1] = MAGIC1;
    out[2] = VERSION;
    out[3] = msgType & 0xff;
    out[4] = flags & 0xff;
    out.writeBigUInt64LE(BigInt(seq || 0), 5);
    out.writeUInt32LE(payload.length, 13);
    if (payload.length) payload.copy(out, HEADER_SIZE);
    return out;
}

function encodeJsonFrame(msgType, seq, obj, flags = 0) {
    return encodeFrame(msgType, seq, Buffer.from(JSON.stringify(obj || {})), flags);
}

/**
 * Incremental parser for TCP streams.
 */
class FrameParser {
    constructor() {
        this.buf = Buffer.alloc(0);
    }

    push(chunk) {
        const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.buf = this.buf.length ? Buffer.concat([this.buf, next]) : next;
        const frames = [];
        while (this.buf.length >= HEADER_SIZE) {
            if (this.buf[0] !== MAGIC0 || this.buf[1] !== MAGIC1) {
                // Resync: drop until next magic.
                const idx = this.buf.indexOf(MAGIC0, 1);
                if (idx < 0) {
                    this.buf = Buffer.alloc(0);
                    break;
                }
                this.buf = this.buf.subarray(idx);
                continue;
            }
            if (this.buf[2] !== VERSION) {
                this.buf = this.buf.subarray(1);
                continue;
            }
            const payloadLen = this.buf.readUInt32LE(13);
            if (payloadLen > 8 * 1024 * 1024) {
                this.buf = this.buf.subarray(1);
                continue;
            }
            const total = HEADER_SIZE + payloadLen;
            if (this.buf.length < total) break;
            const msgType = this.buf[3];
            const flags = this.buf[4];
            const seq = this.buf.readBigUInt64LE(5);
            const payload = this.buf.subarray(HEADER_SIZE, total);
            this.buf = this.buf.subarray(total);
            frames.push({ msgType, flags, seq, payload });
        }
        return frames;
    }
}

function tryParseJson(payload) {
    try {
        return JSON.parse(payload.toString('utf8'));
    } catch {
        return null;
    }
}

module.exports = {
    MAGIC0,
    MAGIC1,
    VERSION,
    HEADER_SIZE,
    MsgType,
    EventKind,
    encodeFrame,
    encodeJsonFrame,
    FrameParser,
    tryParseJson,
};
