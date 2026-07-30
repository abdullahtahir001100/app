/**
 * Dedicated Camera Operations Engine (cameraHandler.js)
 */
const {
    extractDeviceIdFromAgentSocket,
    extractOwnerUserId,
    sendToOwnerDashboards,
    broadcastOwnerBinary,
} = require('./fanout');

const FRAME_STREAM = 0x01;
const FRAME_SNAPSHOT = 0x02;

function parseCameraIndex(payload = {}) {
    if (typeof payload.camera_index === 'number' && Number.isFinite(payload.camera_index)) {
        return payload.camera_index;
    }

    const raw = payload.camera ?? payload.targetLens ?? payload.target_lens;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
    }

    if (typeof raw === 'string') {
        if (raw.startsWith('cam-')) {
            const parsed = Number(raw.replace('cam-', ''));
            if (!Number.isNaN(parsed)) return parsed;
        }

        const numeric = Number(raw);
        if (!Number.isNaN(numeric)) return numeric;

        if (raw === 'front') return 0;
        if (raw === 'rear' || raw === 'back') return 1;
    }

    return 0;
}

function handleCameraCommand(ws, packet, activeConnections) {
    const { action, targetDeviceId, payload } = packet;

    if (!targetDeviceId) {
        ws.send(JSON.stringify({
            type: 'sys_error',
            message: 'Select a live camera node before sending camera controls.'
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

        if (action === 'SWITCH_CAMERA') {
            outboundPacket.payload = {
                camera_index: parseCameraIndex(payload),
                camera: payload?.camera
            };
        } else if (action === 'LIST_CAMERAS' || action === 'PROBE_HARDWARE' || action === 'START_STREAM' || action === 'STOP_STREAM') {
            outboundPacket.payload = {};
        } else if (action === 'SET_HARDWARE_PARAMETER') {
            const paramName = String(payload?.param || payload?.parameter || 'BRIGHTNESS').toUpperCase();
            outboundPacket.payload = {
                param: paramName,
                degree_value: Number(payload?.value ?? payload?.degree_value ?? 50)
            };
        } else if (action === 'SET_FLASH_STATE') {
            outboundPacket.payload = {
                enabled: !!payload?.enabled
            };
        } else if (action === 'START_RECORDING' || action === 'STOP_RECORDING') {
            outboundPacket.payload = {
                camera_index: parseCameraIndex({ camera: payload?.camera }),
                camera: payload?.camera
            };
        } else if (action === 'CAPTURE_SNAPSHOT' || action === 'FETCH_TELEMETRY' || action === 'FETCH_LATEST_MEDIA') {
            outboundPacket.payload = {
                camera_index: parseCameraIndex({ camera: payload?.camera }),
                camera: payload?.camera,
                flash: !!payload?.flash,
                include_frame: action === 'FETCH_TELEMETRY'
                    ? !!payload?.include_frame
                    : true
            };
        }

        targetAgentSocket.send(JSON.stringify(outboundPacket));

        ws.send(JSON.stringify({
            type: 'sys_ack',
            status: `Camera operation [${action}] piped downstream safely.`
        }));
    } else {
        ws.send(JSON.stringify({
            type: 'sys_error',
            message: `Native Camera Node [${targetDeviceId}] is offline or unreachable.`
        }));
    }
}

function handleCameraTelemetry(ws, packet, activeConnections) {
    if (packet.last_action === 'STREAM_TICK') {
        return;
    }

    const ownerUserId = extractOwnerUserId(ws);
    const senderAgentId = extractDeviceIdFromAgentSocket(ws) || 'UNKNOWN';
    if (!ownerUserId) return;

    const metrics = { ...(packet.hardware_metrics || {}) };
    delete metrics.live_frame;
    delete metrics.live_frame_b64;

    sendToOwnerDashboards(activeConnections, ownerUserId, {
        type: 'camera_telemetry_stream',
        senderAgentId,
        metrics,
        message: packet.message || metrics.camera_status_message || null,
        action: packet.last_action,
        last_action: packet.last_action,
        status: packet.status || 'RUNNING',
        camera_blocked: !!metrics.camera_blocked || packet.status === 'CAMERA_BLOCKED',
        has_binary_frame: !!packet.has_binary_frame,
        frame_bytes: packet.frame_bytes || 0
    });
}

function broadcastBinaryFrame(frameBuffer, activeConnections, _frameType, sourceWs = null) {
    if (sourceWs) {
        return broadcastOwnerBinary(sourceWs, frameBuffer, activeConnections);
    }
    // Fail closed — never blast to all users without an owner context.
    console.warn('[CAMERA] Binary frame dropped — missing source agent socket');
    return 0;
}

module.exports = {
    handleCameraCommand,
    handleCameraTelemetry,
    broadcastBinaryFrame,
    FRAME_STREAM,
    FRAME_SNAPSHOT
};
