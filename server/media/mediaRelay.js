const { MsgType, encodeJsonFrame } = require('../protocol/zvframe');
const { getConnectionRegistry } = require('../sockets/registry');

// Registry for media TCP sockets: deviceId -> { screen: socket, camera: socket, ... }
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
    
    // Close old socket if exists
    if (entry[channel] && entry[channel] !== socket && !entry[channel].destroyed) {
        entry[channel].destroy();
    }

    socket.mediaAuth = { deviceId, userId, channel };
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
    // Wrap in 0xFE envelope for backward compatibility
    const idBuf = Buffer.from(deviceId, 'utf8');
    const envelope = Buffer.allocUnsafe(2 + idBuf.length + payloadBuf.length);
    envelope[0] = 0xFE;
    envelope[1] = idBuf.length;
    idBuf.copy(envelope, 2);
    payloadBuf.copy(envelope, 2 + idBuf.length);

    for (const [key, client] of registry.entries()) {
        if (!key.startsWith('DASHBOARD_')) continue;
        const ctx = client.authContext;
        
        // We only broadcast to the owner
        if (!ctx || String(ctx.userId) !== String(getOwnerId(deviceId))) continue;
        
        // If client connected via dedicated media WS, they have mediaSubscription
        if (client.mediaSubscription && 
            client.mediaSubscription.deviceId === deviceId && 
            client.mediaSubscription.channel === channel) {
            
            // Server-side backpressure: drop frame if bufferedAmount > 1MB
            if (client.ws && client.ws.bufferedAmount > 1024 * 1024) {
                continue;
            }
            
            client.send(envelope);
        }
    }
}

function getOwnerId(deviceId) {
    const entry = mediaRegistry.get(String(deviceId));
    if (entry) {
        for (const channel in entry) {
            return entry[channel].mediaAuth.userId;
        }
    }
    return null;
}

function sendMediaAckToAgent(deviceId, channel, ackPayload) {
    const entry = mediaRegistry.get(String(deviceId));
    if (entry && entry[channel]) {
        const socket = entry[channel];
        if (!socket.destroyed) {
            const seq = 0n; 
            const buf = encodeJsonFrame(MsgType.MEDIA_ACK, seq, ackPayload);
            socket.write(buf);
        }
    }
}

module.exports = {
    registerMediaSocket,
    unregisterMediaSocket,
    handleMediaFrame,
    sendMediaAckToAgent
};
