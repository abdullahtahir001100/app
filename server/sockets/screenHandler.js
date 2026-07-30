/**
 * Dedicated Screen Operations Engine (screenHandler.js)
 */
const {
    extractDeviceIdFromAgentSocket,
    extractOwnerUserId,
    sendToOwnerDashboards,
    broadcastOwnerBinary,
} = require('./fanout');

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

    const targetAgentSocket = activeConnections.get(targetKey);

    if (targetAgentSocket && targetAgentSocket.readyState === 1) {
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

        targetAgentSocket.send(JSON.stringify(outboundPacket));

        if (!isRemoteInput) {
            ws.send(JSON.stringify({
                type: 'sys_ack',
                status: `Screen operation [${action}] piped downstream safely.`
            }));
        }
    } else {
        ws.send(JSON.stringify({
            type: 'sys_error',
            message: `Native Screen Node [${targetDeviceId}] is offline or unreachable.`
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
    console.warn('[SCREEN] Binary frame dropped — missing source agent socket');
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
