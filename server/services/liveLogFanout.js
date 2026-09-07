/**
 * Fan live ops logs to all connected dashboard WebSockets.
 */
const liveLogBus = require('../services/liveLogBus');
const { getConnectionRegistry } = require('../sockets/registry');

let started = false;

function startLiveLogFanout() {
    if (started) return;
    started = true;

    liveLogBus.subscribe((entry) => {
        const registry = getConnectionRegistry();
        const packet = JSON.stringify({ type: 'live_log', log: entry });
        registry.forEach((socket, key) => {
            if (!key.startsWith('DASHBOARD_') || socket.readyState !== 1) return;
            try {
                socket.send(packet);
            } catch (_) {}
        });
    });

    liveLogBus.push({
        channel: 'system',
        level: 'info',
        message: 'Live log bus online',
    });
}

module.exports = { startLiveLogFanout };
