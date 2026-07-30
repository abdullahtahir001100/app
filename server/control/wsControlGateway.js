/**
 * Binary WebSocket control plane at /ws/control.
 * Same ZV framing as Raw TCP — used when TCP port is not exposed (e.g. Railway HTTP-only).
 * Browsers should NOT use this; agents only.
 */

const WebSocket = require('ws');
const { FrameParser } = require('../protocol/zvframe');
const { onFrame, onSocketClose } = require('./controlHandler');

function adaptWsSocket(ws) {
    ws.write = (buf) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(buf, { binary: true });
            } catch (_) {}
        }
    };
    Object.defineProperty(ws, 'destroyed', {
        get() {
            return ws.readyState !== WebSocket.OPEN;
        },
    });
    return ws;
}

function initWsControlGateway(server) {
    const wss = new WebSocket.Server({ noServer: true });

    const prevListeners = server.listeners('upgrade').slice();
    server.removeAllListeners('upgrade');

    server.on('upgrade', (req, socket, head) => {
        const pathOnly = String(req.url || '').split('?')[0];
        if (pathOnly === '/ws/control') {
            socket.setTimeout(20000);
            try {
                wss.handleUpgrade(req, socket, head, (ws) => {
                    wss.emit('connection', ws, req);
                });
            } catch (_) {
                try { socket.destroy(); } catch (__) {}
            }
            return;
        }

        // Re-dispatch to previously registered upgrade handlers (gateway + Next).
        for (const listener of prevListeners) {
            listener.call(server, req, socket, head);
        }
    });

    wss.on('connection', (ws) => {
        adaptWsSocket(ws);
        const parser = new FrameParser();

        ws.on('message', (data) => {
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const frames = parser.push(chunk);
            for (const frame of frames) {
                void onFrame(ws, frame);
            }
        });

        ws.on('close', () => onSocketClose(ws));
        ws.on('error', () => onSocketClose(ws));
    });

    return { wss };
}

module.exports = { initWsControlGateway };
