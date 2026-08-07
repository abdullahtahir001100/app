/**
 * Multi-user safe dashboard fan-out helpers.
 * Never broadcast agent media/telemetry to dashboards of other users.
 */

const BINARY_ENVELOPE = 0xfe;

function extractDeviceIdFromAgentSocket(ws) {
    const key = String(ws?.connectionKey || '');
    if (key.startsWith('AGENT_')) return key.slice('AGENT_'.length);
    if (key.startsWith('DEVICE_')) return key.slice('DEVICE_'.length);
    return String(ws?.authContext?.deviceId || '');
}

function extractOwnerUserId(ws) {
    return String(
        ws?.authContext?.userId
        || ws?.authContext?.user?.id
        || ''
    );
}

function dashboardUserId(clientSocket) {
    return String(
        clientSocket?.authContext?.user?.id
        || clientSocket?.authContext?.userId
        || ''
    );
}

/**
 * Send JSON/text to dashboards owned by ownerUserId only.
 * If ownerUserId is empty, send nothing (fail closed for multi-user isolation).
 */
function sendToOwnerDashboards(activeConnections, ownerUserId, data, options = {}) {
    const owner = String(ownerUserId || '');
    if (!owner) return 0;

    let sent = 0;
    activeConnections.forEach((clientSocket, key) => {
        if (!key.startsWith('DASHBOARD_') || clientSocket.readyState !== 1) return;
        const uid = dashboardUserId(clientSocket);
        const role = clientSocket?.authContext?.user?.role;
        const pages = clientSocket?.authContext?.user?.pages || [];
        const isAdminViewer = role === 'admin' || (Array.isArray(pages) && pages.includes('devices.any'));
        if (!isAdminViewer && uid !== owner) return;

        // Drop binary under backpressure instead of stalling the event loop.
        if (options.binary && typeof clientSocket.bufferedAmount === 'number'
            && clientSocket.bufferedAmount > 1024 * 1024) {
            return;
        }

        try {
            if (options.binary) {
                clientSocket.send(data, { binary: true });
            } else {
                clientSocket.send(typeof data === 'string' ? data : JSON.stringify(data));
            }
            sent += 1;
        } catch (_) {
            // ignore broken sockets
        }
    });
    return sent;
}

/**
 * Wrap agent binary frame so dashboards can filter by device:
 * [0xFE][idLen:u8][deviceId utf8][original frame...]
 */
function wrapBinaryForDevice(deviceId, frameBuffer) {
    const id = Buffer.from(String(deviceId || ''), 'utf8');
    const idLen = Math.min(id.length, 255);
    const out = Buffer.allocUnsafe(2 + idLen + frameBuffer.length);
    out[0] = BINARY_ENVELOPE;
    out[1] = idLen;
    if (idLen > 0) id.copy(out, 2, 0, idLen);
    Buffer.from(frameBuffer).copy(out, 2 + idLen);
    return out;
}

/**
 * Broadcast binary only to the agent's owner dashboards, with device envelope.
 */
function broadcastOwnerBinary(ws, frameBuffer, activeConnections) {
    const ownerUserId = extractOwnerUserId(ws);
    const deviceId = extractDeviceIdFromAgentSocket(ws);
    if (!ownerUserId || !deviceId) {
        return 0;
    }
    const wrapped = wrapBinaryForDevice(deviceId, frameBuffer);
    return sendToOwnerDashboards(activeConnections, ownerUserId, wrapped, { binary: true });
}

module.exports = {
    BINARY_ENVELOPE,
    extractDeviceIdFromAgentSocket,
    extractOwnerUserId,
    dashboardUserId,
    sendToOwnerDashboards,
    wrapBinaryForDevice,
    broadcastOwnerBinary,
};
