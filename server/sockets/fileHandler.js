/**
 * File Explorer Engine (fileHandler.js)
 */
const { randomUUID } = require('crypto');
const { getConnectionRegistry } = require('./registry');
const { dispatchAgentCommand } = require('./dispatchAgent');
const {
    extractDeviceIdFromAgentSocket,
    extractOwnerUserId,
    sendToOwnerDashboards,
    broadcastOwnerBinary,
} = require('./fanout');

const FRAME_FILE_BINARY = 0x06;

const FILE_ACTION_TOKENS = [
    'FILE_GET_ROOTS',
    'FILE_LIST_DIR',
    'FILE_READ_TEXT',
    'FILE_WRITE_TEXT',
    'FILE_DOWNLOAD',
    'FILE_UPLOAD',
    'FILE_DELETE',
    'FILE_RENAME',
    'FILE_MOVE',
    'FILE_COPY',
    'FILE_MKDIR',
    'FILE_SEARCH',
    'FILE_COMPRESS',
    'FILE_DECOMPRESS',
    'FILE_GET_METADATA',
    'FILE_SET_METADATA',
    'FILE_GET_PERMISSIONS',
    'FILE_SET_PERMISSIONS'
];

const fileOpWaiters = [];

function removeFileOpWaiter(requestId) {
    const idx = fileOpWaiters.findIndex((w) => w.requestId === requestId);
    if (idx < 0) return null;
    const waiter = fileOpWaiters.splice(idx, 1)[0];
    if (waiter.timer) clearTimeout(waiter.timer);
    return waiter;
}

function waitForFileOp(requestId, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const entry = { requestId, resolve, reject, timer: null, settled: false };
        entry.timer = setTimeout(() => {
            if (entry.settled) return;
            entry.settled = true;
            removeFileOpWaiter(requestId);
            reject(new Error('Timed out waiting for agent file response'));
        }, timeoutMs);
        fileOpWaiters.push(entry);
    });
}

function resolveFileOpWaiters(packet) {
    const fileResult = packet.file_result || {};
    const requestId = fileResult.request_id || packet.request_id;
    if (!requestId) return;

    const waiter = removeFileOpWaiter(requestId);
    if (!waiter || waiter.settled) return;
    waiter.settled = true;
    waiter.resolve(packet);
}

function rejectFileOpWaiter(requestId, error) {
    const waiter = removeFileOpWaiter(requestId);
    if (!waiter || waiter.settled) return;
    waiter.settled = true;
    waiter.reject(error instanceof Error ? error : new Error(String(error || 'File operation failed')));
}

function getAgentSocket(targetDeviceId, activeConnections) {
    const agentKey = `AGENT_${targetDeviceId}`;
    const deviceKey = `DEVICE_${targetDeviceId}`;
    return activeConnections.get(agentKey) || activeConnections.get(deviceKey);
}

function forwardFileCommandToAgent(action, targetDeviceId, payload, activeConnections) {
    if (!targetDeviceId) {
        throw new Error('Select a live agent before file operations.');
    }

    const result = dispatchAgentCommand(targetDeviceId, action, payload || {}, activeConnections);
    if (!result.ok) {
        throw new Error(`Agent [${targetDeviceId}] is offline. Start the agent and keep permissions granted.`);
    }
}

function execFileCommand(action, targetDeviceId, payload = {}) {
    const activeConnections = getConnectionRegistry();
    const requestId = payload._requestId || randomUUID();
    const outboundPayload = { ...payload, _requestId: requestId };

    const waitPromise = waitForFileOp(requestId);
    // Prevent unhandledRejection if caller forgets .catch — still surface via returned promise.
    waitPromise.catch(() => {});
    try {
        forwardFileCommandToAgent(action, targetDeviceId, outboundPayload, activeConnections);
    } catch (error) {
        rejectFileOpWaiter(requestId, error);
        return Promise.reject(error);
    }
    return waitPromise;
}

function handleFileCommand(ws, packet, activeConnections) {
    const { action, targetDeviceId, payload } = packet;

    try {
        forwardFileCommandToAgent(action, targetDeviceId, payload, activeConnections);
        ws.send(JSON.stringify({
            type: 'sys_ack',
            status: `File operation [${action}] piped downstream safely.`
        }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'sys_error',
            message: error.message
        }));
    }
}

function handleFileTelemetry(ws, packet, activeConnections) {
    const fileResult = packet.file_result || {};
    const senderId = extractDeviceIdFromAgentSocket(ws) || 'UNKNOWN';
    const ownerUserId = extractOwnerUserId(ws);
    const action = packet.last_action || packet.action || null;

    resolveFileOpWaiters(packet);

    if (!ownerUserId) return;

    sendToOwnerDashboards(activeConnections, ownerUserId, {
        type: 'file_telemetry_stream',
        senderAgentId: senderId,
        action,
        status: packet.status || 'OK',
        message: packet.message || null,
        request_id: fileResult.request_id || packet.request_id || null,
        file_result: fileResult
    });
}

function isFileBinaryFrame(frameType) {
    return frameType === FRAME_FILE_BINARY;
}

function broadcastFileBinaryFrame(frameBuffer, activeConnections, sourceWs = null) {
    if (sourceWs) {
        return broadcastOwnerBinary(sourceWs, frameBuffer, activeConnections);
    }
    console.warn('[FILE] Binary frame dropped — missing source agent socket');
    return 0;
}

module.exports = {
    FILE_ACTION_TOKENS,
    FRAME_FILE_BINARY,
    handleFileCommand,
    handleFileTelemetry,
    execFileCommand,
    isFileBinaryFrame,
    broadcastFileBinaryFrame
};
