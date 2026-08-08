const WebSocket = require('ws');
const { handleSocketMessage, handleSocketClose } = require('./handler');
const { verifyUserTokenFast, verifyWsTicket, AUTH_COOKIE } = require('../services/authService');
const { createConnectionRateLimiter, createAuditLogger } = require('./abuseControl');
const liveLogBus = require('../services/liveLogBus');
const { FrameParser } = require('../protocol/zvframe');
const { onFrame, onSocketClose } = require('../control/controlHandler');
const { getConnectionRegistry } = require('./registry');

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    String(header).split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx <= 0) return;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        out[key] = decodeURIComponent(value);
    });
    return out;
}

function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

function tokenFromUrl(req) {
    try {
        const raw = String(req.url || '');
        const qIndex = raw.indexOf('?');
        if (qIndex < 0) return null;
        const params = new URLSearchParams(raw.slice(qIndex + 1));
        return params.get('token') || params.get('ticket') || null;
    } catch {
        return null;
    }
}

/**
 * WebSocket upgrade auth MUST be sync + fast.
 * Prefer ?token= ticket (browser) or Cookie; never await Mongo here.
 */
function authenticateGatewayRequest(req) {
    const authHeader = req.headers?.authorization || req.headers?.get?.('authorization');
    const cookieHeader = req.headers?.cookie || req.headers?.get?.('cookie');
    const cookies = parseCookies(cookieHeader);

    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const tokenFromCookie = cookies[AUTH_COOKIE] || null;
    const tokenFromQuery = tokenFromUrl(req);
    const token = tokenFromQuery || tokenFromHeader || tokenFromCookie;

    if (token) {
        const ticketUser = verifyWsTicket(token);
        const user = ticketUser || verifyUserTokenFast(token);
        if (user?.sub) {
            return {
                ok: true,
                kind: 'user',
                user: {
                    id: String(user.sub),
                    email: user.email,
                    role: user.role,
                    name: user.name,
                },
            };
        }
    }

    // Pending peer (agent). Real auth happens on register_channel / ZV AUTH.
    return { ok: true, kind: 'pending', ip: clientIp(req) };
}

function rejectUpgrade(socket, statusCode, message) {
    try {
        socket.write(
            `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
        );
    } catch (_) {}
    try {
        socket.destroy();
    } catch (_) {}
}

function adaptAgentMediaSocket(ws) {
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

function registerDashboardMediaClient(ws, auth, mediaSubscription) {
    const registry = getConnectionRegistry();
    const panelId = `media-${auth.user.id}-${mediaSubscription.deviceId || 'any'}-${mediaSubscription.channel || 'all'}-${Date.now()}`;
    const key = `DASHBOARD_${panelId}`;
    ws.connectionKey = key;
    ws.authContext = {
        kind: 'user',
        user: auth.user,
        userId: auth.user.id,
    };
    ws.mediaSubscription = mediaSubscription;
    registry.set(key, {
        readyState: WebSocket.OPEN,
        ws,
        authContext: ws.authContext,
        mediaSubscription,
        connectionKey: key,
        send(data) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data, { binary: Buffer.isBuffer(data) || data instanceof ArrayBuffer });
            }
        },
        close() {
            try { ws.close(); } catch (_) {}
        },
    });
    return key;
}

function initWebSocketGateway(server, nextUpgradeHandler) {
    const wss = new WebSocket.Server({ noServer: true });
    const gatewayRateLimiter = createConnectionRateLimiter(300, 60 * 1000);
    const mediaRateLimiter = createConnectionRateLimiter(400, 60 * 1000);
    const auditLogger = createAuditLogger();

    server.on('upgrade', (req, socket, head) => {
        const urlObj = new URL(String(req.url || ''), 'http://localhost');
        const pathOnly = urlObj.pathname;

        if (pathOnly !== '/ws/gateway' && pathOnly !== '/ws/media') {
            if (typeof nextUpgradeHandler === 'function') {
                nextUpgradeHandler(req, socket, head);
            } else {
                socket.destroy();
            }
            return;
        }

        // Do not idle-kill long-lived WS upgrades.
        socket.setTimeout(0);
        socket.on('error', () => {
            try { socket.destroy(); } catch (_) {}
        });

        let auth;
        try {
            auth = authenticateGatewayRequest(req);
        } catch (error) {
            auditLogger.log({
                event: 'gateway_auth_failed',
                url: pathOnly,
                message: error?.message || String(error),
            });
            rejectUpgrade(socket, 503, 'Service Unavailable');
            return;
        }

        if (!auth?.ok) {
            auditLogger.log({ event: 'gateway_unauthorized', url: pathOnly });
            rejectUpgrade(socket, 401, 'Unauthorized');
            return;
        }

        // /ws/media: users (ticket required) OR pending agents (ZV auth after connect)
        if (pathOnly === '/ws/media' && auth.kind === 'user') {
            // ok
        } else if (pathOnly === '/ws/media' && auth.kind === 'pending') {
            // agent media — ok
        } else if (pathOnly === '/ws/media') {
            rejectUpgrade(socket, 403, 'Forbidden');
            return;
        }

        const clientKey = auth.kind === 'user'
            ? `user:${auth.user.id}`
            : `pending:${auth.ip || clientIp(req)}`;

        const limiter = pathOnly === '/ws/media' ? mediaRateLimiter : gatewayRateLimiter;
        if (!limiter.allow(clientKey)) {
            auditLogger.log({ event: 'gateway_rate_limited', clientKey });
            rejectUpgrade(socket, 429, 'Too Many Requests');
            return;
        }

        try {
            wss.handleUpgrade(req, socket, head, (ws) => {
                ws.authContext = auth;
                ws.isMediaSocket = pathOnly === '/ws/media';
                if (pathOnly === '/ws/media' && auth.kind === 'user') {
                    ws.mediaSubscription = {
                        channel: urlObj.searchParams.get('channel') || '',
                        deviceId: urlObj.searchParams.get('deviceId') || '',
                    };
                }
                liveLogBus.push({
                    channel: 'ws',
                    level: 'info',
                    message: `upgrade ${pathOnly} kind=${auth.kind}`,
                    route: pathOnly,
                    userId: auth.kind === 'user' ? auth.user?.id : null,
                    meta: { kind: auth.kind },
                });
                wss.emit('connection', ws, req);
            });
        } catch (error) {
            liveLogBus.push({
                channel: 'ws',
                level: 'error',
                message: `upgrade failed: ${error?.message || error}`,
                route: pathOnly,
            });
            rejectUpgrade(socket, 500, 'Internal Server Error');
        }
    });

    wss.on('connection', (ws, req) => {
        ws.upgradeReq = req;

        // Dedicated media path
        if (ws.isMediaSocket) {
            if (ws.authContext?.kind === 'user') {
                registerDashboardMediaClient(ws, ws.authContext, ws.mediaSubscription || {});
                ws.on('close', () => {
                    const registry = getConnectionRegistry();
                    if (ws.connectionKey) registry.delete(ws.connectionKey);
                });
                ws.on('error', () => {
                    const registry = getConnectionRegistry();
                    if (ws.connectionKey) registry.delete(ws.connectionKey);
                });
                // Keepalive: ignore client text pings
                ws.on('message', (message) => {
                    if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 0x7b)) {
                        try {
                            const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message);
                            const packet = JSON.parse(text);
                            if (packet.type === 'dashboard_ping' || packet.type === 'media_ping') {
                                ws.send(JSON.stringify({ type: 'dashboard_pong', status: 'ok' }));
                            }
                        } catch (_) {}
                    }
                });
                return;
            }

            // Agent media: ZV framing — must AUTH within 5s or drop (browsers must use ticket).
            adaptAgentMediaSocket(ws);
            const parser = new FrameParser();
            ws.mediaAuthTimer = setTimeout(() => {
                if (!ws.mediaAuth && !ws.controlAuth && ws.readyState === WebSocket.OPEN) {
                    try { ws.close(); } catch (_) {}
                }
            }, 5000);
            ws.on('message', (data) => {
                const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
                const frames = parser.push(chunk);
                for (const frame of frames) {
                    void onFrame(ws, frame);
                }
                if (ws.mediaAuth || ws.controlAuth) {
                    if (ws.mediaAuthTimer) {
                        clearTimeout(ws.mediaAuthTimer);
                        ws.mediaAuthTimer = null;
                    }
                }
            });
            ws.on('close', () => {
                if (ws.mediaAuthTimer) {
                    clearTimeout(ws.mediaAuthTimer);
                    ws.mediaAuthTimer = null;
                }
                onSocketClose(ws);
            });
            ws.on('error', () => {
                if (ws.mediaAuthTimer) {
                    clearTimeout(ws.mediaAuthTimer);
                    ws.mediaAuthTimer = null;
                }
                onSocketClose(ws);
            });
            return;
        }

        // Pending peers must register quickly or get dropped.
        if (ws.authContext?.kind === 'pending') {
            ws.registrationTimer = setTimeout(() => {
                if (ws.authContext?.kind === 'pending' && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({
                            type: 'sys_ack',
                            status: 'auth_timeout',
                            message: 'register_channel required',
                        }));
                    } catch (_) {}
                    ws.close();
                }
            }, 10000);
        }

        ws.on('message', (message) => {
            void handleSocketMessage(ws, message);
        });

        ws.on('close', () => {
            if (ws.registrationTimer) {
                clearTimeout(ws.registrationTimer);
                ws.registrationTimer = null;
            }
            handleSocketClose(ws);
        });
    });

    return {
        wss,
        auditLogger,
        gatewayRateLimiter,
    };
}

module.exports = { initWebSocketGateway };
