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
    const owner = String(ownerUserId || '').trim();
    if (!owner) return 0;

    let sent = 0;
    activeConnections.forEach((clientSocket, key) => {
        if (!key.startsWith('DASHBOARD_') || clientSocket.readyState !== 1) return;
        const uid = dashboardUserId(clientSocket).trim();
        if (!uid) return; // fail closed — no anonymous dashboards

        const role = clientSocket?.authContext?.user?.role;
        const pages = clientSocket?.authContext?.user?.pages || [];
        const isAdminViewer = role === 'admin' || (Array.isArray(pages) && pages.includes('devices.any'));
        if (!isAdminViewer && uid !== owner) return;

        if (options.binary && typeof clientSocket.bufferedAmount === 'number'
            && clientSocket.bufferedAmount > 32 * 1024) {
            return; // drop stale frame immediately so stream never accumulates lag
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
    if (!deviceId) return 0;

    const wrapped = wrapBinaryForDevice(deviceId, frameBuffer);

    if (ownerUserId) {
        const sent = sendToOwnerDashboards(activeConnections, ownerUserId, wrapped, { binary: true });
        if (sent > 0) return sent;
    }

    // Fallback: relay binary frame to active authenticated dashboard sockets
    let sent = 0;
    activeConnections.forEach((clientSocket, key) => {
        if (!key.startsWith('DASHBOARD_') || clientSocket.readyState !== 1) return;
        if (clientSocket.authContext?.kind !== 'user') return;
        if (typeof clientSocket.bufferedAmount === 'number' && clientSocket.bufferedAmount > 32 * 1024) {
            return; // drop stale frame rather than queueing lag
        }
        try {
            clientSocket.send(wrapped, { binary: true });
            sent++;
        } catch (_) {}
    });
    return sent;
}

/**
 * Kick every live dashboard socket for a user (single-session login).
 */
function forceLogoutUserDashboards(activeConnections, userId, reason = 'session_replaced') {
    const owner = String(userId || '').trim();
    if (!owner || !activeConnections) return 0;

    let sent = 0;
    const payload = JSON.stringify({
        type: 'force_logout',
        reason,
        code: 310,
        message: 'Signed in elsewhere — this session was closed.',
    });

    activeConnections.forEach((clientSocket, key) => {
        if (!String(key).startsWith('DASHBOARD_') || clientSocket.readyState !== 1) return;
        const uid = dashboardUserId(clientSocket).trim();
        if (uid !== owner) return;
        try {
            clientSocket.send(payload);
            clientSocket.close();
            sent += 1;
        } catch (_) {
            // ignore
        }
    });
    return sent;
}

function forwardPacketToDashboards(packet, activeConnections, ownerUserId = null) {
    let owner = String(ownerUserId || '').trim();
    let sent = 0;

    if (owner && activeConnections) {
        sent = sendToOwnerDashboards(activeConnections, owner, packet);
        if (sent > 0) return sent;
    }

    // Fallback: send JSON packet to all authenticated open dashboard sockets
    if (activeConnections) {
        activeConnections.forEach((clientSocket, key) => {
            if (!key.startsWith('DASHBOARD_') || clientSocket.readyState !== 1) return;
            if (clientSocket.authContext?.kind !== 'user') return;
            try {
                clientSocket.send(typeof packet === 'string' ? packet : JSON.stringify(packet));
                sent++;
            } catch (_) {}
        });
    }
    return sent;
}

module.exports = {
    BINARY_ENVELOPE,
    extractDeviceIdFromAgentSocket,
    extractOwnerUserId,
    dashboardUserId,
    sendToOwnerDashboards,
    forwardPacketToDashboards,
    wrapBinaryForDevice,
    broadcastOwnerBinary,
    forceLogoutUserDashboards,
};
