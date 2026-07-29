const User = require('../models/User');

/** @type {Map<string, { logs: any[], updatedAt: number, pairingUserId: string }>} */
const sessionsByUser = new Map();
const MAX_LOGS = 200;
const TTL_MS = 30 * 60 * 1000;

function prune() {
    const now = Date.now();
    for (const [key, value] of sessionsByUser.entries()) {
        if (now - value.updatedAt > TTL_MS) sessionsByUser.delete(key);
    }
}

async function resolveUserId(pairingToken, pairingUserId) {
    const token = String(pairingToken || '').trim();
    const uid = String(pairingUserId || '').trim();
    if (!token || !uid) return null;

    const asNumToken = Number(token);
    const asNumUid = Number(uid);
    const query = {
        $or: [
            { pairingToken: token, pairingUserId: uid },
            ...(Number.isFinite(asNumToken) && Number.isFinite(asNumUid)
                ? [{ pairingToken: asNumToken, pairingUserId: asNumUid }]
                : []),
        ],
    };

    const user = await User.findOne(query).select('_id').lean();
    return user?._id ? String(user._id) : null;
}

function appendLog(userId, entry) {
    prune();
    const key = String(userId);
    const bucket = sessionsByUser.get(key) || { logs: [], updatedAt: Date.now(), pairingUserId: '' };
    bucket.logs.push({
        ...entry,
        at: entry.at || new Date().toISOString(),
    });
    if (bucket.logs.length > MAX_LOGS) {
        bucket.logs = bucket.logs.slice(-MAX_LOGS);
    }
    bucket.updatedAt = Date.now();
    sessionsByUser.set(key, bucket);
    return bucket.logs;
}

function getLogs(userId, sessionId = null) {
    prune();
    const bucket = sessionsByUser.get(String(userId));
    if (!bucket) return [];
    if (!sessionId) return bucket.logs;
    return bucket.logs.filter((l) => !l.sessionId || l.sessionId === sessionId);
}

function broadcastInstallLog(userId, entry, activeConnections) {
    const message = JSON.stringify({
        type: 'install_telemetry',
        userId: String(userId),
        ...entry,
    });

    activeConnections.forEach((clientSocket, key) => {
        if (!(key.startsWith('DASHBOARD_') && clientSocket.readyState === 1)) return;
        const dashUserId = clientSocket?.authContext?.user?.id || clientSocket?.authContext?.userId;
        if (String(dashUserId || '') !== String(userId)) return;
        try {
            clientSocket.send(message);
        } catch (_) {
            // ignore
        }
    });
}

module.exports = {
    resolveUserId,
    appendLog,
    getLogs,
    broadcastInstallLog,
};
