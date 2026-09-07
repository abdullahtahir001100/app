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

    // Append a dedicated listener — do NOT removeAllListeners (that races with /ws/gateway + /ws/media).
    server.on('upgrade', (req, socket, head) => {
        const pathOnly = String(req.url || '').split('?')[0];
        if (pathOnly !== '/ws/control') {
            return;
        }

        socket.setTimeout(0);
        try {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } catch (_) {
            try { socket.destroy(); } catch (__) {}
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
