/**
 * Dedicated Screen Operations Engine (screenHandler.js)
 */
const {
    extractDeviceIdFromAgentSocket,
    extractOwnerUserId,
    sendToOwnerDashboards,
    broadcastOwnerBinary,
} = require('./fanout');
const { dispatchAgentCommand } = require('./dispatchAgent');

const FRAME_SCREEN_STREAM = 0x04;
const FRAME_SCREEN_SNAPSHOT = 0x05;

function parseDisplayIndex(payload = {}) {
    if (typeof payload.display_index === 'number' && Number.isFinite(payload.display_index)) {
        return payload.display_index;
    }

    const raw = payload.display ?? payload.targetDisplay ?? payload.target_display;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
    }

    if (typeof raw === 'string') {
        if (raw.startsWith('display-')) {
            const parsed = Number(raw.replace('display-', ''));
            if (!Number.isNaN(parsed)) return parsed;
        }

        const numeric = Number(raw);
        if (!Number.isNaN(numeric)) return numeric;
    }

    return 0;
}

function handleScreenCommand(ws, packet, activeConnections) {
    const { action, targetDeviceId, payload } = packet;
    const isRemoteInput = typeof action === 'string' && action.startsWith('REMOTE_');

    if (!targetDeviceId) {
        ws.send(JSON.stringify({
            type: 'sys_error',
            message: 'Select a live agent node before sending screen controls.'
        }));
        return;
    }

    const targetKey = activeConnections.has(`AGENT_${targetDeviceId}`)
        ? `AGENT_${targetDeviceId}`
        : `DEVICE_${targetDeviceId}`;

    const outboundPacket = {
        action,
        payload: {}
    };

        if (action === 'SWITCH_DISPLAY') {
            outboundPacket.payload = {
                display_index: parseDisplayIndex(payload),
                display: payload?.display
            };
        } else if (
            action === 'LIST_DISPLAYS'
            || action === 'PROBE_DISPLAYS'
            || action === 'STOP_SCREEN_STREAM'
            || action === 'LOCK_SCREEN'
            || action === 'OPEN_SETTINGS'
        ) {
            outboundPacket.payload = {};
        } else if (action === 'START_SCREEN_STREAM' || action === 'SET_SCREEN_QUALITY') {
            outboundPacket.payload = {
                quality: String(payload?.quality ?? 'medium'),
            };
            // Forward an explicit frame-rate request when the dashboard sends one.
            // Older agents ignore unknown fields; upgraded agents honor these overrides
            // (see zenvora_agent screen stream loop) for AnyDesk-like fast + sharp output.
            if (payload?.target_fps !== undefined && payload?.target_fps !== null) {
                const fps = Number(payload.target_fps);
                if (Number.isFinite(fps) && fps > 0) {
                    outboundPacket.payload.target_fps = Math.max(1, Math.min(60, Math.round(fps)));
                }
            }
            // Optional fine-grained overrides (resolution / JPEG quality) for upgraded agents.
            if (payload?.max_width !== undefined && payload?.max_width !== null) {
                const w = Number(payload.max_width);
                if (Number.isFinite(w) && w >= 240) {
                    outboundPacket.payload.max_width = Math.max(240, Math.min(3840, Math.round(w)));
                }
            }
            if (payload?.jpeg_quality !== undefined && payload?.jpeg_quality !== null) {
                const q = Number(payload.jpeg_quality);
                if (Number.isFinite(q) && q >= 10) {
                    outboundPacket.payload.jpeg_quality = Math.max(10, Math.min(95, Math.round(q)));
                }
            }
        } else if (action === 'SET_DISPLAY_BRIGHTNESS' || action === 'SET_SYSTEM_VOLUME') {
            outboundPacket.payload = {
                degree_value: Number(payload?.value ?? payload?.degree_value ?? 50)
            };
        } else if (action === 'SEND_TEXT_INPUT') {
            outboundPacket.payload = {
                text: String(payload?.text ?? '')
            };
        } else if (
            action === 'REMOTE_MOUSE_MOVE'
            || action === 'REMOTE_MOUSE_DOWN'
            || action === 'REMOTE_MOUSE_UP'
            || action === 'REMOTE_MOUSE_WHEEL'
            || action === 'REMOTE_KEY_DOWN'
            || action === 'REMOTE_KEY_UP'
        ) {
            outboundPacket.payload = {
                x: Number(payload?.x ?? 0),
                y: Number(payload?.y ?? 0),
                button: payload?.button ?? 'left',
                delta: Number(payload?.delta ?? 0),
                code: payload?.code ?? '',
                text: payload?.text ?? '',
                screen_width: Number(payload?.screen_width ?? 1920),
                screen_height: Number(payload?.screen_height ?? 1080),
            };
        } else if (action === 'CAPTURE_SCREENSHOT' || action === 'FETCH_SCREEN_TELEMETRY') {
            outboundPacket.payload = {
                display_index: parseDisplayIndex(payload),
                display: payload?.display,
                include_frame: action === 'FETCH_SCREEN_TELEMETRY'
                    ? !!payload?.include_frame
                    : true
            };
        }

    const result = dispatchAgentCommand(
        targetDeviceId,
        outboundPacket.action,
        outboundPacket.payload,
        activeConnections
    );

    if (result.ok) {
        if (!isRemoteInput) {
            ws.send(JSON.stringify({
                type: 'sys_ack',
                status: `Screen operation [${action}] piped downstream safely.`,
                transport: result.transport,
            }));
        }
    } else {
        ws.send(JSON.stringify({
            type: 'sys_error',
            message: `Node [${targetDeviceId}] is not command-ready — open Zenvora on the phone and wait for green online (not heartbeat-only).`,
        }));
    }
}

function handleScreenTelemetry(ws, packet, activeConnections) {
    if (packet.silent === true) return;
    if (typeof packet.last_action === 'string' && packet.last_action.startsWith('REMOTE_')) {
        return;
    }

    const ownerUserId = extractOwnerUserId(ws);
    if (!ownerUserId) return;

    const metrics = { ...(packet.hardware_metrics || {}) };
    delete metrics.live_frame;
    delete metrics.live_frame_b64;

    sendToOwnerDashboards(activeConnections, ownerUserId, {
        type: 'screen_telemetry_stream',
        senderAgentId: extractDeviceIdFromAgentSocket(ws) || 'UNKNOWN',
        metrics,
        message: packet.message || null,
        action: packet.last_action,
        status: packet.status || 'RUNNING',
        has_binary_frame: !!packet.has_binary_frame,
        frame_bytes: packet.frame_bytes || 0,
    });
}

function broadcastScreenBinaryFrame(frameBuffer, activeConnections, sourceWs = null) {
    if (sourceWs) {
        return broadcastOwnerBinary(sourceWs, frameBuffer, activeConnections);
    }
    return 0;
}

function isScreenBinaryFrame(frameType) {
    return frameType === FRAME_SCREEN_STREAM || frameType === FRAME_SCREEN_SNAPSHOT;
}

module.exports = {
    handleScreenCommand,
    handleScreenTelemetry,
    broadcastScreenBinaryFrame,
    isScreenBinaryFrame,
    FRAME_SCREEN_STREAM,
    FRAME_SCREEN_SNAPSHOT
};
