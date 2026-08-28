const { getConnectionRegistry } = require('./registry');
const { dispatchAgentCommand } = require('./dispatchAgent');

const SHELL_ACTION_TOKENS = ['SHELL_EXECUTE', 'SHELL_EXECUTE_RAW'];

function getAgentSocket(targetDeviceId, activeConnections) {
    const agentKey = `AGENT_${targetDeviceId}`;
    const deviceKey = `DEVICE_${targetDeviceId}`;
    return activeConnections.get(agentKey) || activeConnections.get(deviceKey);
}

function handleShellCommand(ws, packet, activeConnections) {
    const { action, targetDeviceId, payload = {} } = packet;
    const command = String(payload.command || '').trim();

    if (!targetDeviceId) {
        ws.send(JSON.stringify({ type: 'sys_error', message: 'Select a live device before running shell commands.' }));
        return;
    }

    if (!command) {
        ws.send(JSON.stringify({ type: 'sys_error', message: 'Shell command cannot be empty.' }));
        return;
    }

    const result = dispatchAgentCommand(
        targetDeviceId,
        action,
        { ...payload, targetDeviceId },
        activeConnections
    );
    if (!result.ok) {
        ws.send(JSON.stringify({ type: 'sys_error', message: 'Target agent is offline.' }));
        return;
    }

    ws.send(JSON.stringify({
        type: 'sys_ack',
        status: 'dispatched',
        message: `Shell command queued for ${targetDeviceId}`,
        transport: result.transport,
    }));
}

module.exports = {
    SHELL_ACTION_TOKENS,
    handleShellCommand,
};
