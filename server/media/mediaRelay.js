const { MsgType, encodeJsonFrame } = require('../protocol/zvframe');
const { getConnectionRegistry } = require('../sockets/registry');
const { dashboardUserId, wrapBinaryForDevice } = require('../sockets/fanout');

// Registry for media agent sockets: deviceId -> { screen: socket, camera: socket, ... }
const mediaRegistry = new Map();

function getMediaRegistryEntry(deviceId) {
    let entry = mediaRegistry.get(String(deviceId));
    if (!entry) {
        entry = {};
        mediaRegistry.set(String(deviceId), entry);
    }
    return entry;
}

function registerMediaSocket(socket, deviceId, userId, channel) {
    const entry = getMediaRegistryEntry(deviceId);

    if (entry[channel] && entry[channel] !== socket && !entry[channel].destroyed) {
        try {
            entry[channel].destroy?.();
            entry[channel].close?.();
        } catch (_) {}
    }

    socket.mediaAuth = { deviceId: String(deviceId), userId: String(userId), channel: String(channel) };
    entry[channel] = socket;
}

function unregisterMediaSocket(socket) {
    const auth = socket.mediaAuth;
    if (!auth) return;
    const entry = mediaRegistry.get(auth.deviceId);
    if (entry && entry[auth.channel] === socket) {
        delete entry[auth.channel];
        if (Object.keys(entry).length === 0) {
            mediaRegistry.delete(auth.deviceId);
        }
    }
}

function handleMediaFrame(socket, frame) {
    const auth = socket.mediaAuth;
    if (!auth) return;

    if (frame.msgType === MsgType.MEDIA_FRAME) {
        broadcastMediaFrame(auth.deviceId, auth.channel, frame.payload);
    }
}

function broadcastMediaFrame(deviceId, channel, payloadBuf) {
    const registry = getConnectionRegistry();
    const ownerId = getOwnerId(deviceId);
    const envelope = wrapBinaryForDevice(deviceId, payloadBuf);

    let sent = 0;
    let considered = 0;
    for (const [key, client] of registry.entries()) {
        if (!key.startsWith('DASHBOARD_')) continue;
        considered += 1;
        const uid = dashboardUserId(client).trim();
        if (!uid) continue;

        const role = client?.authContext?.user?.role || client?.authContext?.role;
        const pages = client?.authContext?.user?.pages || client?.authContext?.pages || [];
        const isAdminViewer = role === 'admin' || (Array.isArray(pages) && pages.includes('devices.any'));
        if (!isAdminViewer && (!ownerId || uid !== String(ownerId))) continue;

        const sub = client.mediaSubscription;
        const wantsChannel = !sub
            || (String(sub.deviceId) === String(deviceId)
                && (!sub.channel || String(sub.channel) === String(channel)));

        if (!wantsChannel && sub) continue;

        const ws = client.ws || client;
        if (ws && typeof ws.bufferedAmount === 'number' && ws.bufferedAmount > 1024 * 1024) {
            continue;
        }

        try {
            if (typeof client.send === 'function') {
                client.send(envelope);
            } else if (ws && typeof ws.send === 'function') {
                ws.send(envelope, { binary: true });
            }
            sent += 1;
        } catch (_) {}
    }
    if (sent === 0) {
        console.log(
            `[MEDIA-DEBUG] frame dropped device=${deviceId} channel=${channel} owner=${ownerId || 'none'} dashboards=${considered}`
        );
    }
    return sent;
}

function getOwnerId(deviceId) {
    const entry = mediaRegistry.get(String(deviceId));
    if (entry) {
        for (const channel of Object.keys(entry)) {
            const auth = entry[channel]?.mediaAuth;
            if (auth?.userId) return String(auth.userId);
        }
    }
    // Fallback: agent gateway registry
    try {
        const registry = getConnectionRegistry();
        const agent = registry.get(`AGENT_${deviceId}`) || registry.get(`DEVICE_${deviceId}`);
        const uid = agent?.authContext?.userId || agent?.authContext?.user?.id;
        if (uid) return String(uid);
    } catch (_) {}
    return null;
}

function sendMediaAckToAgent(deviceId, channel, ackPayload) {
    const entry = mediaRegistry.get(String(deviceId));
    if (entry && entry[channel]) {
        const socket = entry[channel];
        if (!socket.destroyed) {
            const seq = 0n;
            const buf = encodeJsonFrame(MsgType.MEDIA_ACK, seq, ackPayload);
            try {
                socket.write(buf);
            } catch (_) {}
        }
    }
}

module.exports = {
    registerMediaSocket,
    unregisterMediaSocket,
    handleMediaFrame,
    sendMediaAckToAgent,
    broadcastMediaFrame,
};
