const WebSocket = require('ws');
const { handleSocketMessage, handleSocketClose } = require('./handler');
const { verifyUserTokenFast, verifyWsTicket, AUTH_COOKIE } = require('../services/authService');
const { createConnectionRateLimiter, createAuditLogger } = require('./abuseControl');

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
        // Prefer short-lived WS ticket, then full session JWT.
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

    // Pending peer (agent). Real auth happens on register_channel.
    return { ok: true, kind: 'pending', ip: clientIp(req) };
}

function rejectUpgrade(socket, statusCode, message) {
    try {
        socket.write(
            `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
        );
    } catch (_) {
        // ignore
    }
    try {
        socket.destroy();
    } catch (_) {
        // ignore
    }
}

function initWebSocketGateway(server, nextUpgradeHandler) {
    const wss = new WebSocket.Server({ noServer: true });
    // Higher limits — reconnect storms + multi-agent must not 429 the dashboard.
    const gatewayRateLimiter = createConnectionRateLimiter(300, 60 * 1000);
    const auditLogger = createAuditLogger();

    server.on('upgrade', (req, socket, head) => {
        const pathOnly = String(req.url || '').split('?')[0];
        if (pathOnly !== '/ws/gateway') {
            if (typeof nextUpgradeHandler === 'function') {
                nextUpgradeHandler(req, socket, head);
            } else {
                socket.destroy();
            }
            return;
        }

        socket.setTimeout(20000);
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

        const clientKey = auth.kind === 'user'
            ? `user:${auth.user.id}`
            : `pending:${auth.ip || clientIp(req)}`;

        if (!gatewayRateLimiter.allow(clientKey)) {
            auditLogger.log({ event: 'gateway_rate_limited', clientKey });
            rejectUpgrade(socket, 429, 'Too Many Requests');
            return;
        }

        try {
            wss.handleUpgrade(req, socket, head, (ws) => {
                ws.authContext = auth;
                wss.emit('connection', ws, req);
            });
        } catch (error) {
            rejectUpgrade(socket, 500, 'Internal Server Error');
        }
    });

    wss.on('connection', (ws, req) => {
        ws.upgradeReq = req;

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
            // No per-frame audit logging — that alone can starve the event loop.
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
