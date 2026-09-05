/**
 * Route dashboard commands to agents via control plane (/ws/control or TCP)
 * first, then fall back to JSON gateway WebSocket.
 */
const { sendCommandToAgent, getControlAgent } = require('../control/controlHandler');

function getGatewaySocket(deviceId, activeConnections) {
    const id = String(deviceId || '').trim();
    if (!id) return null;
    const agentKey = `AGENT_${id}`;
    const deviceKey = `DEVICE_${id}`;
    const socket = activeConnections.get(agentKey) || activeConnections.get(deviceKey);
    if (!socket || socket.readyState !== 1) return null;
    // Placeholder entry for control-only agents — send() is intentionally a no-op.
    if (socket._placeholder === true) return null;
    return socket;
}

function isCommandReady(deviceId, activeConnections) {
    const id = String(deviceId || '').trim();
    if (!id) return false;
    const control = getControlAgent(id);
    if (control?.socket && !control.socket.destroyed) return true;
    return Boolean(getGatewaySocket(id, activeConnections));
}

function dispatchAgentCommand(deviceId, action, payload = {}, activeConnections) {
    const id = String(deviceId || '').trim();
    const act = String(action || '').trim();
    if (!id || !act) return { ok: false, reason: 'missing' };

    if (sendCommandToAgent(id, act, payload)) {
        return { ok: true, transport: 'control' };
    }

    const socket = getGatewaySocket(id, activeConnections);
    if (socket) {
        try {
            socket.send(JSON.stringify({
                action: act,
                payload: payload || {},
                timestamp: new Date().toISOString(),
            }));
            return { ok: true, transport: 'gateway' };
        } catch (_) {
            // fall through
        }
    }
    return { ok: false, reason: 'offline' };
}

function isAgentCommandReachable(deviceId, isLiveGatewayWs, activeConnections) {
    return isCommandReady(deviceId, activeConnections);
}

module.exports = {
    dispatchAgentCommand,
    getGatewaySocket,
    isAgentCommandReachable,
    isCommandReady,
};
