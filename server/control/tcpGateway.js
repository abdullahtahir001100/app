/**
 * Raw TCP control gateway for Rust agents.
 * Browser never connects here — dashboards stay on WebSocket.
 */

const net = require('net');
const { FrameParser } = require('../protocol/zvframe');
const { onFrame, onSocketClose } = require('./controlHandler');

function initTcpControlGateway(options = {}) {
    const port = Number(options.port || process.env.CONTROL_TCP_PORT || 9443);
    const host = options.host || process.env.CONTROL_TCP_HOST || '0.0.0.0';

    const server = net.createServer((socket) => {
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 10000);
        const parser = new FrameParser();
        let closed = false;

        socket.on('data', (chunk) => {
            const frames = parser.push(chunk);
            for (const frame of frames) {
                void onFrame(socket, frame);
            }
        });

        const cleanup = () => {
            if (closed) return;
            closed = true;
            onSocketClose(socket);
        };

        socket.on('close', cleanup);
        socket.on('error', cleanup);
    });

    server.maxConnections = 2000;

    server.listen(port, host, () => {
        console.log(`> Control TCP : tcp://${host === '0.0.0.0' ? '0.0.0.0' : host}:${port}`);
    });

    server.on('error', (err) => {
        console.error('[CONTROL TCP] listen failed:', err.message);
    });

    return { server, port, host };
}

module.exports = { initTcpControlGateway };
