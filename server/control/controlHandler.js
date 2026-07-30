/**
 * Agent Raw-TCP control plane handler.
 * Relay events to owner dashboards immediately; persist via writeQueue.
 */

const { verifyAgentToken } = require('../services/authService');
const { getConnectionRegistry } = require('../sockets/registry');
const { sendToOwnerDashboards } = require('../sockets/fanout');
const { persistHistoryPayload } = require('../services/historySyncService');
const writeQueue = require('../services/writeQueue');
const {
    MsgType,
    EventKind,
    encodeJsonFrame,
    encodeFrame,
    tryParseJson,
} = require('../protocol/zvframe');

/** deviceId -> { socket, userId, seqOut } */
const controlAgents = new Map();

function getControlAgent(deviceId) {
    return controlAgents.get(String(deviceId || ''));
}

function rememberAgent(deviceId, meta) {
    controlAgents.set(String(deviceId), meta);
}

function forgetAgent(deviceId, socket) {
    const id = String(deviceId || '');
    const cur = controlAgents.get(id);
    if (cur && cur.socket === socket) {
        controlAgents.delete(id);
    }
}

function sendFrame(socket, buf) {
    if (!socket || socket.destroyed) return;
    try {
        socket.write(buf);
    } catch (_) {}
}

function relayJsonToOwner(userId, packet) {
    if (!userId) return;
    const registry = getConnectionRegistry();
    sendToOwnerDashboards(registry, userId, packet);
}

async function handleAuth(socket, seq, payload) {
    const body = tryParseJson(payload) || {};
    const deviceId = String(body.deviceId || '').trim();
    const token = String(body.token || body.authToken || '').trim();

    if (!deviceId || !token) {
        sendFrame(socket, encodeJsonFrame(MsgType.AUTH_FAIL, seq, { message: 'deviceId/token required' }));
        return false;
    }

    let credential = null;
    try {
        credential = await Promise.race([
            verifyAgentToken(deviceId, token),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]);
    } catch (_) {
        credential = null;
    }

    if (!credential?.userId) {
        sendFrame(socket, encodeJsonFrame(MsgType.AUTH_FAIL, seq, { message: 'auth failed' }));
        return false;
    }

    socket.controlAuth = {
        deviceId,
        userId: String(credential.userId),
        hostname: String(credential.hostname || deviceId),
    };
    rememberAgent(deviceId, {
        socket,
        userId: socket.controlAuth.userId,
        seqOut: 1n,
        deviceId,
    });

    // Also mirror into WS registry as online for dashboard lists (no Mongo wait).
    const registry = getConnectionRegistry();
    const key = `AGENT_${deviceId}`;
    // Synthetic marker so getLiveDeviceOptions can see TCP-only agents.
    if (!registry.has(key)) {
        registry.set(key, {
            readyState: 1,
            connectionKey: key,
            authContext: {
                kind: 'agent',
                deviceId,
                userId: socket.controlAuth.userId,
                hostname: socket.controlAuth.hostname,
                transport: 'tcp',
            },
            // no-op send for TCP-only agents (commands go via controlAgents)
            send() {},
            close() {},
        });
        socket._registryKey = key;
    } else {
        const existing = registry.get(key);
        if (existing?.authContext) {
            existing.authContext.userId = socket.controlAuth.userId;
            existing.authContext.transport = existing.authContext.transport || 'ws';
            existing.authContext.controlTcp = true;
        }
        socket._registryKey = null;
    }

    sendFrame(socket, encodeJsonFrame(MsgType.AUTH_OK, seq, {
        deviceId,
        serverTime: Date.now(),
    }));

    try {
        const liveLogBus = require('../services/liveLogBus');
        liveLogBus.push({
            channel: 'tcp',
            level: 'info',
            message: `agent AUTH_OK ${deviceId}`,
            deviceId,
            userId: socket.controlAuth.userId,
        });
    } catch (_) {}

    relayJsonToOwner(socket.controlAuth.userId, {
        type: 'device_status_update',
        deviceId,
        status: 'online',
        transport: 'tcp',
        lastSeen: new Date().toISOString(),
    });

    return true;
}

function handleHeartbeat(socket, seq) {
    sendFrame(socket, encodeFrame(MsgType.HEARTBEAT_ACK, seq, Buffer.alloc(0)));
}

function handleEvent(socket, seq, payload) {
    const auth = socket.controlAuth;
    if (!auth) return;

    const body = tryParseJson(payload) || {};
    const kind = Number(body.kind || 0);
    const items = Array.isArray(body.items) ? body.items : (body.item ? [body.item] : []);
    const cursor = body.cursor;

    // Immediate dashboard fan-out — never wait for Mongo.
    if (kind === EventKind.BROWSER_HISTORY) {
        relayJsonToOwner(auth.userId, {
            type: 'history_telemetry',
            command: 'FETCH_BROWSER_HISTORY',
            deviceId: auth.deviceId,
            incremental: true,
            cursor,
            data: items,
            count: items.length,
        });
        writeQueue.enqueue(async () => {
            await persistHistoryPayload(auth.deviceId, {
                command: 'FETCH_BROWSER_HISTORY',
                data: items,
                userId: auth.userId,
            });
        });
    } else if (kind === EventKind.APP_HISTORY) {
        relayJsonToOwner(auth.userId, {
            type: 'history_telemetry',
            command: 'FETCH_APP_HISTORY',
            deviceId: auth.deviceId,
            incremental: true,
            cursor,
            data: items,
            count: items.length,
        });
        writeQueue.enqueue(async () => {
            await persistHistoryPayload(auth.deviceId, {
                command: 'FETCH_APP_HISTORY',
                data: items,
                userId: auth.userId,
            });
        });
    } else if (kind === EventKind.NOTIFICATION) {
        relayJsonToOwner(auth.userId, {
            type: 'history_telemetry',
            command: 'FETCH_SYSTEM_NOTIFICATIONS',
            deviceId: auth.deviceId,
            incremental: true,
            data: items,
            count: items.length,
        });
        writeQueue.enqueue(async () => {
            await persistHistoryPayload(auth.deviceId, {
                command: 'FETCH_SYSTEM_NOTIFICATIONS',
                data: items,
                userId: auth.userId,
            });
        });
    } else if (kind === EventKind.ACTIVITY) {
        for (const item of items) {
            relayJsonToOwner(auth.userId, {
                type: 'activity_telemetry',
                deviceId: auth.deviceId,
                log: item,
            });
        }
    } else if (kind === EventKind.DEVICE_STATUS) {
        const status = items[0] || body;
        relayJsonToOwner(auth.userId, {
            type: 'device_status_update',
            deviceId: auth.deviceId,
            ...status,
            lastSeen: new Date().toISOString(),
        });
    } else {
        relayJsonToOwner(auth.userId, {
            type: 'control_event',
            deviceId: auth.deviceId,
            kind,
            items,
            cursor,
        });
    }

    // Ack so agent advances sync cursor.
    sendFrame(socket, encodeJsonFrame(MsgType.EVENT_ACK, seq, {
        ok: true,
        cursor: cursor || null,
        kind,
    }));
}

function handleCommandResult(socket, seq, payload) {
    const auth = socket.controlAuth;
    if (!auth) return;
    const body = tryParseJson(payload) || {};
    relayJsonToOwner(auth.userId, {
        type: 'control_command_result',
        deviceId: auth.deviceId,
        ...body,
    });
}

async function onFrame(socket, frame) {
    const { msgType, seq, payload } = frame;
    switch (msgType) {
        case MsgType.AUTH:
            await handleAuth(socket, seq, payload);
            break;
        case MsgType.HEARTBEAT:
            handleHeartbeat(socket, seq);
            break;
        case MsgType.EVENT:
        case MsgType.SYNC_BATCH:
            handleEvent(socket, seq, payload);
            break;
        case MsgType.COMMAND_RESULT:
            handleCommandResult(socket, seq, payload);
            break;
        default:
            break;
    }
}

function onSocketClose(socket) {
    const auth = socket.controlAuth;
    if (!auth) return;

    forgetAgent(auth.deviceId, socket);

    if (socket._registryKey) {
        const registry = getConnectionRegistry();
        const cur = registry.get(socket._registryKey);
        if (cur && cur.authContext?.transport === 'tcp') {
            registry.delete(socket._registryKey);
        }
    }

    relayJsonToOwner(auth.userId, {
        type: 'device_status_update',
        deviceId: auth.deviceId,
        status: 'offline',
        lastSeen: new Date().toISOString(),
    });
}

/**
 * Forward a JSON command from dashboard → agent over TCP control.
 */
function sendCommandToAgent(deviceId, action, payload = {}) {
    const agent = getControlAgent(deviceId);
    if (!agent?.socket || agent.socket.destroyed) return false;
    agent.seqOut += 1n;
    sendFrame(agent.socket, encodeJsonFrame(MsgType.COMMAND, agent.seqOut, {
        action,
        payload,
        timestamp: Date.now(),
    }));
    return true;
}

module.exports = {
    onFrame,
    onSocketClose,
    sendCommandToAgent,
    getControlAgent,
    controlAgents,
    EventKind,
    MsgType,
};
