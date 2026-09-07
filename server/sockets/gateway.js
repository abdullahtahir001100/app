// const WebSocket = require('ws');
// const { handleSocketMessage, handleSocketClose } = require('./handler');
// const { verifyUserTokenFast, verifyWsTicket, AUTH_COOKIE } = require('../services/authService');
// const { createConnectionRateLimiter, createAuditLogger } = require('./abuseControl');
// const liveLogBus = require('../services/liveLogBus');
// const { FrameParser } = require('../protocol/zvframe');
// const { onFrame, onSocketClose } = require('../control/controlHandler');
// const { getConnectionRegistry } = require('./registry');

// function parseCookies(header) {
//     const out = {};
//     if (!header) return out;
//     String(header).split(';').forEach((part) => {
//         const idx = part.indexOf('=');
//         if (idx <= 0) return;
//         const key = part.slice(0, idx).trim();
//         const value = part.slice(idx + 1).trim();
//         out[key] = decodeURIComponent(value);
//     });
//     return out;
// }

// function clientIp(req) {
//     const forwarded = req.headers['x-forwarded-for'];
//     if (typeof forwarded === 'string' && forwarded.length > 0) {
//         return forwarded.split(',')[0].trim();
//     }
//     return req.socket?.remoteAddress || 'unknown';
// }

// function tokenFromUrl(req) {
//     try {
//         const raw = String(req.url || '');
//         const qIndex = raw.indexOf('?');
//         if (qIndex < 0) return null;
//         const params = new URLSearchParams(raw.slice(qIndex + 1));
//         return params.get('token') || params.get('ticket') || null;
//     } catch {
//         return null;
//     }
// }

// /**
//  * WebSocket upgrade auth MUST be sync + fast.
//  * Prefer ?token= ticket (browser) or Cookie; never await Mongo here.
//  */
// function authenticateGatewayRequest(req) {
//     const authHeader = req.headers?.authorization || req.headers?.get?.('authorization');
//     const cookieHeader = req.headers?.cookie || req.headers?.get?.('cookie');
//     const cookies = parseCookies(cookieHeader);

//     const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
//     const tokenFromCookie = cookies[AUTH_COOKIE] || null;
//     const tokenFromQuery = tokenFromUrl(req);
//     const token = tokenFromQuery || tokenFromHeader || tokenFromCookie;
//     const pathOnly = String(req.url || '').split('?')[0];

//     if (token) {
//         const ticketUser = verifyWsTicket(token);
//         const user = ticketUser || verifyUserTokenFast(token);
//         if (user?.sub) {
//             return {
//                 ok: true,
//                 kind: 'user',
//                 user: {
//                     id: String(user.sub),
//                     email: user.email,
//                     role: user.role,
//                     name: user.name,
//                 },
//             };
//         }
//         // Browser sent a token but it is expired/invalid.
//         // NEVER fall through to pending — that causes "dashboard authentication required".
//         if (tokenFromQuery || pathOnly === '/ws/media') {
//             return {
//                 ok: false,
//                 kind: 'reject',
//                 reason: 'invalid_or_expired_ticket',
//                 ip: clientIp(req),
//             };
//         }
//     }

//     // Pending peer (agent). Real auth happens on register_channel / ZV AUTH.
//     return { ok: true, kind: 'pending', ip: clientIp(req) };
// }

// function rejectUpgrade(socket, statusCode, message) {
//     console.warn(`[GATEWAY-DEBUG] rejectUpgrade status=${statusCode} message=${message}`);
//     try {
//         socket.write(
//             `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
//         );
//     } catch (_) {}
//     try {
//         socket.destroy();
//     } catch (_) {}
// }

// function adaptAgentMediaSocket(ws) {
//     ws.write = (buf) => {
//         if (ws.readyState === WebSocket.OPEN) {
//             try {
//                 ws.send(buf, { binary: true });
//             } catch (_) {}
//         }
//     };
//     Object.defineProperty(ws, 'destroyed', {
//         get() {
//             return ws.readyState !== WebSocket.OPEN;
//         },
//     });
//     return ws;
// }

// function registerDashboardMediaClient(ws, auth, mediaSubscription) {
//     const registry = getConnectionRegistry();
//     const panelId = `media-${auth.user.id}-${mediaSubscription.deviceId || 'any'}-${mediaSubscription.channel || 'all'}-${Date.now()}`;
//     const key = `DASHBOARD_${panelId}`;
//     ws.connectionKey = key;
//     ws.authContext = {
//         kind: 'user',
//         user: auth.user,
//         userId: auth.user.id,
//     };
//     ws.mediaSubscription = mediaSubscription;
//     registry.set(key, {
//         readyState: WebSocket.OPEN,
//         ws,
//         authContext: ws.authContext,
//         mediaSubscription,
//         connectionKey: key,
//         send(data) {
//             if (ws.readyState === WebSocket.OPEN) {
//                 ws.send(data, { binary: Buffer.isBuffer(data) || data instanceof ArrayBuffer });
//             }
//         },
//         close() {
//             try { ws.close(); } catch (_) {}
//         },
//     });
//     return key;
// }

// function initWebSocketGateway(server, nextUpgradeHandler) {
//     const wss = new WebSocket.Server({ noServer: true });
//     const gatewayRateLimiter = createConnectionRateLimiter(300, 60 * 1000);
//     const mediaRateLimiter = createConnectionRateLimiter(400, 60 * 1000);
//     const auditLogger = createAuditLogger();

//     server.on('upgrade', (req, socket, head) => {
//         const urlObj = new URL(String(req.url || ''), 'http://localhost');
//         const pathOnly = urlObj.pathname;

//         if (pathOnly !== '/ws/gateway' && pathOnly !== '/ws/media') {
//             // Leave /ws/control for the control gateway listener; everything else → Next.
//             if (pathOnly === '/ws/control') return;
//             if (typeof nextUpgradeHandler === 'function') {
//                 nextUpgradeHandler(req, socket, head);
//             } else {
//                 socket.destroy();
//             }
//             return;
//         }

//         // Do not idle-kill long-lived WS upgrades.
//         socket.setTimeout(0);
//         socket.on('error', () => {
//             try { socket.destroy(); } catch (_) {}
//         });

//         console.log(`[GATEWAY-DEBUG] upgrade request path=${pathOnly} url=${String(req.url)} host=${String(req.headers.host)}`);

//         let auth;
//         try {
//             auth = authenticateGatewayRequest(req);
//         } catch (error) {
//             auditLogger.log({
//                 event: 'gateway_auth_failed',
//                 url: pathOnly,
//                 message: error?.message || String(error),
//             });
//             console.warn(`[GATEWAY-DEBUG] auth error path=${pathOnly} message=${String(error?.message || error)}`);
//             rejectUpgrade(socket, 503, 'Service Unavailable');
//             return;
//         }

//         if (!auth?.ok) {
//             auditLogger.log({ event: 'gateway_unauthorized', url: pathOnly });
//             rejectUpgrade(socket, 401, 'Unauthorized');
//             return;
//         }

//         // /ws/media: users (ticket required) OR pending agents (ZV auth after connect)
//         if (pathOnly === '/ws/media' && auth.kind === 'user') {
//             // ok
//         } else if (pathOnly === '/ws/media' && auth.kind === 'pending') {
//             // agent media — ok
//         } else if (pathOnly === '/ws/media') {
//             rejectUpgrade(socket, 403, 'Forbidden');
//             return;
//         }

//         const clientKey = auth.kind === 'user'
//             ? `user:${auth.user.id}`
//             : `pending:${auth.ip || clientIp(req)}`;

//         const limiter = pathOnly === '/ws/media' ? mediaRateLimiter : gatewayRateLimiter;
//         if (!limiter.allow(clientKey)) {
//             auditLogger.log({ event: 'gateway_rate_limited', clientKey });
//             rejectUpgrade(socket, 429, 'Too Many Requests');
//             return;
//         }

//         try {
//             wss.handleUpgrade(req, socket, head, (ws) => {
//                 ws.authContext = auth;
//                 ws.isMediaSocket = pathOnly === '/ws/media';
//                 if (pathOnly === '/ws/media' && auth.kind === 'user') {
//                     ws.mediaSubscription = {
//                         channel: urlObj.searchParams.get('channel') || '',
//                         deviceId: urlObj.searchParams.get('deviceId') || '',
//                     };
//                 }
//                 console.log(`[GATEWAY-DEBUG] handleUpgrade OK path=${pathOnly} kind=${auth.kind} deviceId=${ws.mediaSubscription?.deviceId || ''} channel=${ws.mediaSubscription?.channel || ''}`);
//                 liveLogBus.push({
//                     channel: 'ws',
//                     level: 'info',
//                     message: `upgrade ${pathOnly} kind=${auth.kind}`,
//                     route: pathOnly,
//                     userId: auth.kind === 'user' ? auth.user?.id : null,
//                     meta: { kind: auth.kind },
//                 });
//                 wss.emit('connection', ws, req);
//             });
//         } catch (error) {
//             liveLogBus.push({
//                 channel: 'ws',
//                 level: 'error',
//                 message: `upgrade failed: ${error?.message || error}`,
//                 route: pathOnly,
//             });
//             rejectUpgrade(socket, 500, 'Internal Server Error');
//         }
//     });

//     wss.on('connection', (ws, req) => {
//         ws.upgradeReq = req;
//         console.log(`[GATEWAY-DEBUG] wss connection event path=${ws.isMediaSocket ? '/ws/media' : '/ws/gateway'} kind=${ws.authContext?.kind || 'unknown'} connectionKey=${ws.connectionKey || 'none'}`);

//         // Dedicated media path
//         if (ws.isMediaSocket) {
//             if (ws.authContext?.kind === 'user') {
//                 console.log(`[GATEWAY-DEBUG] media dashboard client connected deviceId=${ws.mediaSubscription?.deviceId || ''} channel=${ws.mediaSubscription?.channel || ''}`);
//                 registerDashboardMediaClient(ws, ws.authContext, ws.mediaSubscription || {});
//                 ws.on('close', () => {
//                     const registry = getConnectionRegistry();
//                     if (ws.connectionKey) registry.delete(ws.connectionKey);
//                     console.log(`[GATEWAY-DEBUG] media dashboard client closed connectionKey=${ws.connectionKey || 'unknown'}`);
//                 });
//                 ws.on('error', () => {
//                     const registry = getConnectionRegistry();
//                     if (ws.connectionKey) registry.delete(ws.connectionKey);
//                     console.warn(`[GATEWAY-DEBUG] media dashboard client error connectionKey=${ws.connectionKey || 'unknown'}`);
//                 });
//                 // Keepalive: ignore client text pings
//                 ws.on('message', (message) => {
//                     if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 0x7b)) {
//                         try {
//                             const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message);
//                             const packet = JSON.parse(text);
//                             if (packet.type === 'dashboard_ping' || packet.type === 'media_ping') {
//                                 ws.send(JSON.stringify({ type: 'dashboard_pong', status: 'ok' }));
//                             }
//                         } catch (_) {}
//                     }
//                 });
//                 return;
//             }

//             // Agent media: ZV framing — must start AUTH quickly; verify may take longer (bcrypt/Mongo).
//             adaptAgentMediaSocket(ws);
//             const parser = new FrameParser();
//             ws.mediaAuthTimer = setTimeout(() => {
//                 if (
//                     !ws.mediaAuth &&
//                     !ws.controlAuth &&
//                     !ws.mediaAuthPending &&
//                     ws.readyState === WebSocket.OPEN
//                 ) {
//                     console.warn('[MEDIA-DEBUG] agent media auth idle timeout — closing socket');
//                     try { ws.close(); } catch (_) {}
//                 }
//             }, 20000);
//             ws.on('message', (data) => {
//                 const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
//                 const frames = parser.push(chunk);
//                 for (const frame of frames) {
//                     void onFrame(ws, frame);
//                 }
//                 if (ws.mediaAuth || ws.controlAuth) {
//                     if (ws.mediaAuthTimer) {
//                         clearTimeout(ws.mediaAuthTimer);
//                         ws.mediaAuthTimer = null;
//                     }
//                 }
//             });
//             ws.on('close', () => {
//                 if (ws.mediaAuthTimer) {
//                     clearTimeout(ws.mediaAuthTimer);
//                     ws.mediaAuthTimer = null;
//                 }
//                 console.warn('[MEDIA-DEBUG] agent media socket closed before auth');
//                 onSocketClose(ws);
//             });
//             ws.on('error', () => {
//                 if (ws.mediaAuthTimer) {
//                     clearTimeout(ws.mediaAuthTimer);
//                     ws.mediaAuthTimer = null;
//                 }
//                 console.warn('[MEDIA-DEBUG] agent media socket error before auth');
//                 onSocketClose(ws);
//             });
//             return;
//         }

//         // Pending peers must register quickly or get dropped.
//         if (ws.authContext?.kind === 'pending') {
//             ws.registrationTimer = setTimeout(() => {
//                 if (ws.authContext?.kind === 'pending' && ws.readyState === WebSocket.OPEN) {
//                     try {
//                         ws.send(JSON.stringify({
//                             type: 'sys_ack',
//                             status: 'auth_timeout',
//                             message: 'register_channel required',
//                         }));
//                     } catch (_) {}
//                     ws.close();
//                 }
//             }, 30000);
//         }

//         ws.on('message', (message) => {
//             void handleSocketMessage(ws, message);
//         });

//         ws.on('close', () => {
//             if (ws.registrationTimer) {
//                 clearTimeout(ws.registrationTimer);
//                 ws.registrationTimer = null;
//             }
//             handleSocketClose(ws);
//         });
//     });

//     return {
//         wss,
//         auditLogger,
//         gatewayRateLimiter,
//     };
// }

// module.exports = { initWebSocketGateway };

const WebSocket = require('ws');

const { handleSocketMessage, handleSocketClose } = require('./handler');
const {
    verifyUserTokenFast,
    verifyWsTicket,
    isAdminUnlocked,
    AUTH_COOKIE,
} = require('../services/authService');

const {
    createConnectionRateLimiter,
    createAuditLogger,
} = require('./abuseControl');

const liveLogBus = require('../services/liveLogBus');
const { FrameParser } = require('../protocol/zvframe');
const {
    onFrame,
    onSocketClose,
} = require('../control/controlHandler');

const {
    getConnectionRegistry,
} = require('./registry');

/* =========================================================
 * DEBUG CONFIG
 * ========================================================= */

const DEBUG = process.env.WS_DEBUG !== '0';

const DEBUG_MESSAGES = process.env.WS_DEBUG_MESSAGES !== '0';

const DEBUG_FRAMES = process.env.WS_DEBUG_FRAMES === '1';

const HEARTBEAT_MS = Number(
    process.env.WS_HEARTBEAT_MS || 25000
);

const CONNECTION_TIMEOUT_MS = Number(
    process.env.WS_CONNECTION_TIMEOUT_MS || 30000
);

let connectionCounter = 0;

function wsDebug(scope, message, meta = null) {
    if (!DEBUG) return;

    const time = new Date().toISOString();

    let suffix = '';

    if (meta !== null && meta !== undefined) {
        try {
            suffix = ` ${JSON.stringify(meta)}`;
        } catch {
            suffix = ' [meta-unserializable]';
        }
    }

    console.log(
        `[WS-DEBUG ${time}] [${scope}] ${message}${suffix}`
    );
}

function wsWarn(scope, message, meta = null) {
    const time = new Date().toISOString();

    let suffix = '';

    if (meta !== null && meta !== undefined) {
        try {
            suffix = ` ${JSON.stringify(meta)}`;
        } catch {
            suffix = '';
        }
    }

    console.warn(
        `[WS-WARN ${time}] [${scope}] ${message}${suffix}`
    );
}

function wsError(scope, message, error = null, meta = null) {
    const time = new Date().toISOString();

    let details = '';

    if (error) {
        details =
            ` error=${error?.message || String(error)}` +
            (error?.stack ? ` stack=${error.stack}` : '');
    }

    if (meta !== null && meta !== undefined) {
        try {
            details += ` ${JSON.stringify(meta)}`;
        } catch {}
    }

    console.error(
        `[WS-ERROR ${time}] [${scope}] ${message}${details}`
    );
}

function pushLiveLog(level, message, meta = {}) {
    try {
        liveLogBus.push({
            channel: 'ws',
            level,
            message,
            meta,
        });
    } catch (error) {
        wsError(
            'LIVELOG',
            'liveLogBus.push failed',
            error
        );
    }
}

/* =========================================================
 * HELPERS
 * ========================================================= */

function connectionId(ws) {
    if (!ws) return 'no-ws';

    if (!ws.__zvConnectionId) {
        connectionCounter += 1;

        Object.defineProperty(ws, '__zvConnectionId', {
            value: `ws-${Date.now().toString(36)}-${connectionCounter}`,
            writable: false,
            enumerable: false,
            configurable: false,
        });
    }

    return ws.__zvConnectionId;
}

function wsState(ws) {
    if (!ws) return 'NO_WS';

    switch (ws.readyState) {
        case WebSocket.CONNECTING:
            return 'CONNECTING';

        case WebSocket.OPEN:
            return 'OPEN';

        case WebSocket.CLOSING:
            return 'CLOSING';

        case WebSocket.CLOSED:
            return 'CLOSED';

        default:
            return String(ws.readyState);
    }
}

function wsInfo(ws) {
    if (!ws) {
        return {
            id: 'no-ws',
            state: 'NO_WS',
        };
    }

    return {
        id: connectionId(ws),
        state: wsState(ws),
        kind: ws.authContext?.kind || 'unknown',
        path: ws.isMediaSocket
            ? '/ws/media'
            : '/ws/gateway',
        userId:
            ws.authContext?.user?.id ||
            ws.mediaAuth?.userId ||
            null,
        deviceId:
            ws.mediaSubscription?.deviceId ||
            ws.mediaAuth?.deviceId ||
            null,
        channel:
            ws.mediaSubscription?.channel ||
            ws.mediaAuth?.channel ||
            null,
        connectionKey: ws.connectionKey || null,
        bufferedAmount: ws.bufferedAmount ?? null,
        mediaAuthed: Boolean(ws.mediaAuth),
    };
}

function parseCookies(header) {
    const out = {};

    if (!header) return out;

    String(header)
        .split(';')
        .forEach((part) => {
            const idx = part.indexOf('=');

            if (idx <= 0) return;

            const key = part.slice(0, idx).trim();
            const value = part.slice(idx + 1).trim();

            try {
                out[key] = decodeURIComponent(value);
            } catch {
                out[key] = value;
            }
        });

    return out;
}

function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];

    if (
        typeof forwarded === 'string' &&
        forwarded.length > 0
    ) {
        return forwarded.split(',')[0].trim();
    }

    return req.socket?.remoteAddress || 'unknown';
}

function tokenFromUrl(req) {
    try {
        const raw = String(req.url || '');
        const qIndex = raw.indexOf('?');

        if (qIndex < 0) return null;

        const params = new URLSearchParams(
            raw.slice(qIndex + 1)
        );

        return (
            params.get('token') ||
            params.get('ticket') ||
            null
        );
    } catch (error) {
        wsError(
            'AUTH',
            'tokenFromUrl failed',
            error
        );

        return null;
    }
}

function safePreview(value, max = 160) {
    try {
        const str = Buffer.isBuffer(value)
            ? value.toString('utf8')
            : String(value);

        if (str.length <= max) return str;

        return `${str.slice(0, max)}...`;
    } catch {
        return '[unprintable]';
    }
}

function describeMessage(message) {
    try {
        if (Buffer.isBuffer(message)) {
            return {
                type: 'Buffer',
                bytes: message.length,
                preview: DEBUG_MESSAGES
                    ? safePreview(message)
                    : undefined,
            };
        }

        if (ArrayBuffer.isView(message)) {
            return {
                type: message.constructor?.name || 'TypedArray',
                bytes: message.byteLength,
            };
        }

        if (message instanceof ArrayBuffer) {
            return {
                type: 'ArrayBuffer',
                bytes: message.byteLength,
            };
        }

        return {
            type: typeof message,
            bytes: String(message).length,
            preview: DEBUG_MESSAGES
                ? safePreview(message)
                : undefined,
        };
    } catch {
        return {
            type: 'unknown',
        };
    }
}

function clearTimer(ws, name) {
    if (!ws?.[name]) return;

    clearTimeout(ws[name]);
    ws[name] = null;
}

function clearIntervalSafe(ws, name) {
    if (!ws?.[name]) return;

    clearInterval(ws[name]);
    ws[name] = null;
}

function clearAllTimers(ws) {
    if (!ws) return;

    clearTimer(ws, 'mediaAuthTimer');
    clearTimer(ws, 'registrationTimer');
    clearTimer(ws, 'connectionTimer');

    clearIntervalSafe(ws, 'heartbeatTimer');
}

/* =========================================================
 * AUTH
 * ========================================================= */

function authenticateGatewayRequest(req) {
    const authHeader =
        req.headers?.authorization ||
        req.headers?.get?.('authorization');

    const cookieHeader =
        req.headers?.cookie ||
        req.headers?.get?.('cookie');

    const cookies = parseCookies(cookieHeader);

    const tokenFromHeader =
        authHeader?.startsWith('Bearer ')
            ? authHeader.slice(7).trim()
            : null;

    const tokenFromCookie =
        cookies[AUTH_COOKIE] || null;

    const tokenFromQuery =
        tokenFromUrl(req);

    const token =
        tokenFromQuery ||
        tokenFromHeader ||
        tokenFromCookie;

    const pathOnly =
        String(req.url || '').split('?')[0];

    wsDebug(
        'AUTH',
        'authentication attempt',
        {
            path: pathOnly,
            ip: clientIp(req),
            hasAuthorization: Boolean(authHeader),
            hasCookie: Boolean(tokenFromCookie),
            hasQueryToken: Boolean(tokenFromQuery),
            tokenSource: tokenFromQuery
                ? 'query'
                : tokenFromHeader
                    ? 'header'
                    : tokenFromCookie
                        ? 'cookie'
                        : 'none',
        }
    );

    if (token) {
        let ticketUser = null;
        let normalUser = null;

        try {
            ticketUser = verifyWsTicket(token);
        } catch (error) {
            wsError(
                'AUTH',
                'verifyWsTicket threw',
                error
            );
        }

        try {
            normalUser = verifyUserTokenFast(token);
        } catch (error) {
            wsError(
                'AUTH',
                'verifyUserTokenFast threw',
                error
            );
        }

        const user =
            ticketUser ||
            normalUser;

        if (user?.sub) {
            if (!isAdminUnlocked(user)) {
                return {
                    ok: false,
                    kind: 'reject',
                    reason: 'admin_pin_required',
                    ip: clientIp(req),
                };
            }

            wsDebug(
                'AUTH',
                'authentication successful',
                {
                    method: ticketUser
                        ? 'ws-ticket'
                        : 'user-token',
                    userId: String(user.sub),
                    path: pathOnly,
                }
            );

            return {
                ok: true,
                kind: 'user',
                user: {
                    id: String(user.sub),
                    email: user.email,
                    role: user.role,
                    name: user.name,
                    adminUnlocked: true,
                },
            };
        }

        wsWarn(
            'AUTH',
            'token supplied but authentication failed',
            {
                path: pathOnly,
                tokenSource: tokenFromQuery
                    ? 'query'
                    : tokenFromHeader
                        ? 'header'
                        : 'cookie',
            }
        );

        if (
            tokenFromQuery ||
            pathOnly === '/ws/media'
        ) {
            return {
                ok: false,
                kind: 'reject',
                reason: 'invalid_or_expired_ticket',
                ip: clientIp(req),
            };
        }
    }

    wsDebug(
        'AUTH',
        'no authenticated dashboard user; allowing pending peer',
        {
            path: pathOnly,
            ip: clientIp(req),
        }
    );

    return {
        ok: true,
        kind: 'pending',
        ip: clientIp(req),
    };
}

/* =========================================================
 * HTTP UPGRADE
 * ========================================================= */

function rejectUpgrade(
    socket,
    statusCode,
    message
) {
    wsWarn(
        'UPGRADE',
        'rejecting websocket upgrade',
        {
            statusCode,
            message,
        }
    );

    try {
        socket.write(
            `HTTP/1.1 ${statusCode} ${message}\r\n` +
            `Connection: close\r\n` +
            `Content-Length: 0\r\n\r\n`
        );
    } catch (error) {
        wsError(
            'UPGRADE',
            'failed writing rejection response',
            error
        );
    }

    try {
        socket.destroy();
    } catch (error) {
        wsError(
            'UPGRADE',
            'failed destroying rejected socket',
            error
        );
    }
}

/* =========================================================
 * HEARTBEAT
 * ========================================================= */

function startHeartbeat(ws) {
    if (!ws) return;

    clearIntervalSafe(ws, 'heartbeatTimer');

    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;

        ws.__lastPongAt = Date.now();

        wsDebug(
            'HEARTBEAT',
            'pong received',
            {
                ...wsInfo(ws),
                lastPongAt: new Date(
                    ws.__lastPongAt
                ).toISOString(),
            }
        );
    });

    ws.heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            wsDebug(
                'HEARTBEAT',
                'heartbeat stopped because socket is not OPEN',
                wsInfo(ws)
            );

            clearIntervalSafe(
                ws,
                'heartbeatTimer'
            );

            return;
        }

        if (ws.isAlive === false) {
            wsWarn(
                'HEARTBEAT',
                'no pong since previous heartbeat; terminating socket',
                wsInfo(ws)
            );

            try {
                ws.terminate();
            } catch (error) {
                wsError(
                    'HEARTBEAT',
                    'terminate failed',
                    error,
                    wsInfo(ws)
                );
            }

            return;
        }

        ws.isAlive = false;

        try {
            ws.ping();

            wsDebug(
                'HEARTBEAT',
                'ping sent',
                wsInfo(ws)
            );
        } catch (error) {
            wsError(
                'HEARTBEAT',
                'ping failed',
                error,
                wsInfo(ws)
            );
        }
    }, HEARTBEAT_MS);

    if (typeof ws.heartbeatTimer.unref === 'function') {
        ws.heartbeatTimer.unref();
    }
}

/* =========================================================
 * AGENT MEDIA ADAPTER
 * ========================================================= */

function adaptAgentMediaSocket(ws) {
    ws.write = (buf) => {
        if (ws.readyState !== WebSocket.OPEN) {
            wsWarn(
                'MEDIA-WRITE',
                'write skipped because socket is not OPEN',
                {
                    ...wsInfo(ws),
                    bytes: Buffer.isBuffer(buf)
                        ? buf.length
                        : null,
                }
            );

            return;
        }

        try {
            const data = Buffer.isBuffer(buf)
                ? buf
                : Buffer.from(buf);

            ws.send(
                data,
                {
                    binary: true,
                },
                (error) => {
                    if (error) {
                        wsError(
                            'MEDIA-WRITE',
                            'ws.send callback returned error',
                            error,
                            {
                                ...wsInfo(ws),
                                bytes: data.length,
                            }
                        );
                    }
                }
            );

            if (DEBUG_FRAMES) {
                wsDebug(
                    'MEDIA-WRITE',
                    'binary data sent',
                    {
                        ...wsInfo(ws),
                        bytes: data.length,
                    }
                );
            }
        } catch (error) {
            wsError(
                'MEDIA-WRITE',
                'ws.send threw',
                error,
                wsInfo(ws)
            );
        }
    };

    Object.defineProperty(ws, 'destroyed', {
        get() {
            return ws.readyState !== WebSocket.OPEN;
        },
    });

    return ws;
}

/* =========================================================
 * DASHBOARD MEDIA
 * ========================================================= */

function registerDashboardMediaClient(
    ws,
    auth,
    mediaSubscription
) {
    const registry =
        getConnectionRegistry();

    const panelId =
        `media-${auth.user.id}-` +
        `${mediaSubscription.deviceId || 'any'}-` +
        `${mediaSubscription.channel || 'all'}-` +
        `${Date.now()}`;

    const key =
        `DASHBOARD_${panelId}`;

    ws.connectionKey = key;

    ws.authContext = {
        kind: 'user',
        user: auth.user,
        userId: auth.user.id,
    };

    ws.mediaSubscription =
        mediaSubscription;

    registry.set(key, {
        readyState: WebSocket.OPEN,
        ws,
        authContext: ws.authContext,
        mediaSubscription,
        connectionKey: key,

        send(data) {
            if (ws.readyState !== WebSocket.OPEN) {
                wsWarn(
                    'REGISTRY',
                    'dashboard media send skipped; socket not open',
                    wsInfo(ws)
                );

                return false;
            }

            try {
                ws.send(
                    data,
                    {
                        binary:
                            Buffer.isBuffer(data) ||
                            data instanceof ArrayBuffer,
                    }
                );

                return true;
            } catch (error) {
                wsError(
                    'REGISTRY',
                    'dashboard media send failed',
                    error,
                    wsInfo(ws)
                );

                return false;
            }
        },

        close() {
            try {
                ws.close();
            } catch (error) {
                wsError(
                    'REGISTRY',
                    'dashboard media close failed',
                    error,
                    wsInfo(ws)
                );
            }
        },
    });

    wsDebug(
        'REGISTRY',
        'dashboard media registered',
        {
            ...wsInfo(ws),
            connectionKey: key,
        }
    );

    return key;
}

/* =========================================================
 * INIT
 * ========================================================= */

function initWebSocketGateway(
    server,
    nextUpgradeHandler
) {
    const wss =
        new WebSocket.Server({
            noServer: true,
        });

    const gatewayRateLimiter =
        createConnectionRateLimiter(
            300,
            60 * 1000
        );

    const mediaRateLimiter =
        createConnectionRateLimiter(
            400,
            60 * 1000
        );

    const auditLogger =
        createAuditLogger();

    /* -----------------------------------------------------
     * SERVER UPGRADE
     * ----------------------------------------------------- */

    server.on(
        'upgrade',
        (req, socket, head) => {
            const upgradeStartedAt =
                Date.now();

            let urlObj;

            try {
                urlObj = new URL(
                    String(req.url || ''),
                    'http://localhost'
                );
            } catch (error) {
                wsError(
                    'UPGRADE',
                    'invalid upgrade URL',
                    error,
                    {
                        url: req.url,
                        ip: clientIp(req),
                    }
                );

                rejectUpgrade(
                    socket,
                    400,
                    'Bad Request'
                );

                return;
            }

            const pathOnly =
                urlObj.pathname;

            const upgradeMeta = {
                path: pathOnly,
                url: String(req.url || ''),
                host: String(req.headers.host || ''),
                ip: clientIp(req),
                method: req.method,
                upgrade: req.headers.upgrade,
                connection: req.headers.connection,
                origin: req.headers.origin || null,
                userAgent:
                    req.headers['user-agent'] || null,
                version:
                    req.headers['sec-websocket-version'] || null,
                protocol:
                    req.headers['sec-websocket-protocol'] || null,
                extensions:
                    req.headers['sec-websocket-extensions'] || null,
            };

            wsDebug(
                'UPGRADE',
                'incoming upgrade request',
                upgradeMeta
            );

            pushLiveLog(
                'info',
                `upgrade request ${pathOnly}`,
                upgradeMeta
            );

            if (
                pathOnly !== '/ws/gateway' &&
                pathOnly !== '/ws/media'
            ) {
                wsDebug(
                    'UPGRADE',
                    'path not handled by this gateway',
                    {
                        path: pathOnly,
                    }
                );

                if (pathOnly === '/ws/control') {
                    wsDebug(
                        'UPGRADE',
                        'passing /ws/control to control listener'
                    );

                    return;
                }

                if (
                    typeof nextUpgradeHandler ===
                    'function'
                ) {
                    wsDebug(
                        'UPGRADE',
                        'passing upgrade to next handler'
                    );

                    nextUpgradeHandler(
                        req,
                        socket,
                        head
                    );
                } else {
                    wsDebug(
                        'UPGRADE',
                        'no next handler; destroying socket'
                    );

                    socket.destroy();
                }

                return;
            }

            socket.setTimeout(0);

            socket.on(
                'error',
                (error) => {
                    wsError(
                        'RAW-SOCKET',
                        'upgrade socket error',
                        error,
                        upgradeMeta
                    );

                    try {
                        socket.destroy();
                    } catch {}
                }
            );

            socket.on(
                'timeout',
                () => {
                    wsWarn(
                        'RAW-SOCKET',
                        'raw socket timeout',
                        upgradeMeta
                    );
                }
            );

            wsDebug(
                'UPGRADE',
                'gateway path accepted',
                {
                    path: pathOnly,
                    elapsedMs:
                        Date.now() -
                        upgradeStartedAt,
                }
            );

            /* -------------------------------------------------
             * AUTH
             * ------------------------------------------------- */

            let auth;

            try {
                auth =
                    authenticateGatewayRequest(
                        req
                    );
            } catch (error) {
                auditLogger.log({
                    event:
                        'gateway_auth_failed',
                    url: pathOnly,
                    message:
                        error?.message ||
                        String(error),
                });

                wsError(
                    'AUTH',
                    'authentication threw',
                    error,
                    {
                        path: pathOnly,
                        ip: clientIp(req),
                    }
                );

                rejectUpgrade(
                    socket,
                    503,
                    'Service Unavailable'
                );

                return;
            }

            wsDebug(
                'AUTH',
                'authentication result',
                {
                    path: pathOnly,
                    ok: auth?.ok,
                    kind: auth?.kind,
                    reason: auth?.reason,
                    ip: auth?.ip,
                    userId:
                        auth?.user?.id || null,
                    elapsedMs:
                        Date.now() -
                        upgradeStartedAt,
                }
            );

            if (!auth?.ok) {
                auditLogger.log({
                    event:
                        'gateway_unauthorized',
                    url: pathOnly,
                });

                rejectUpgrade(
                    socket,
                    401,
                    'Unauthorized'
                );

                return;
            }

            /* -------------------------------------------------
             * MEDIA AUTH POLICY
             * ------------------------------------------------- */

            if (
                pathOnly === '/ws/media' &&
                auth.kind === 'user'
            ) {
                wsDebug(
                    'AUTH',
                    'dashboard media request accepted',
                    {
                        userId:
                            auth.user?.id,
                    }
                );
            } else if (
                pathOnly === '/ws/media' &&
                auth.kind === 'pending'
            ) {
                wsDebug(
                    'AUTH',
                    'pending agent media request accepted'
                );
            } else if (
                pathOnly === '/ws/media'
            ) {
                wsWarn(
                    'AUTH',
                    'media request rejected',
                    {
                        kind: auth.kind,
                        reason: auth.reason,
                    }
                );

                rejectUpgrade(
                    socket,
                    403,
                    'Forbidden'
                );

                return;
            }

            /* -------------------------------------------------
             * RATE LIMIT
             * ------------------------------------------------- */

            const clientKey =
                auth.kind === 'user'
                    ? `user:${auth.user.id}`
                    : `pending:${auth.ip || clientIp(req)}`;

            const limiter =
                pathOnly === '/ws/media'
                    ? mediaRateLimiter
                    : gatewayRateLimiter;

            let allowed = false;

            try {
                allowed =
                    limiter.allow(
                        clientKey
                    );
            } catch (error) {
                wsError(
                    'RATE',
                    'rate limiter threw',
                    error,
                    {
                        clientKey,
                        path: pathOnly,
                    }
                );

                rejectUpgrade(
                    socket,
                    503,
                    'Service Unavailable'
                );

                return;
            }

            wsDebug(
                'RATE',
                'rate limiter result',
                {
                    allowed,
                    clientKey,
                    path: pathOnly,
                }
            );

            if (!allowed) {
                auditLogger.log({
                    event:
                        'gateway_rate_limited',
                    clientKey,
                });

                rejectUpgrade(
                    socket,
                    429,
                    'Too Many Requests'
                );

                return;
            }

            /* -------------------------------------------------
             * HANDLE UPGRADE
             * ------------------------------------------------- */

            try {
                wss.handleUpgrade(
                    req,
                    socket,
                    head,
                    (ws) => {
                        ws.__upgradeStartedAt =
                            upgradeStartedAt;

                        ws.authContext =
                            auth;

                        ws.isMediaSocket =
                            pathOnly ===
                            '/ws/media';

                        ws.__path =
                            pathOnly;

                        ws.__remoteIp =
                            clientIp(req);

                        ws.__connectedAt =
                            Date.now();

                        ws.__lastMessageAt =
                            Date.now();

                        ws.__lastPongAt =
                            Date.now();

                        ws.isAlive = true;

                        if (
                            pathOnly ===
                                '/ws/media' &&
                            auth.kind === 'user'
                        ) {
                            ws.mediaSubscription = {
                                channel:
                                    urlObj.searchParams.get(
                                        'channel'
                                    ) || '',

                                deviceId:
                                    urlObj.searchParams.get(
                                        'deviceId'
                                    ) || '',
                            };
                        }

                        const info =
                            wsInfo(ws);

                        wsDebug(
                            'UPGRADE',
                            'handleUpgrade OK',
                            {
                                ...info,
                                elapsedMs:
                                    Date.now() -
                                    upgradeStartedAt,
                            }
                        );

                        pushLiveLog(
                            'info',
                            `upgrade ${pathOnly} kind=${auth.kind}`,
                            {
                                ...info,
                                elapsedMs:
                                    Date.now() -
                                    upgradeStartedAt,
                            }
                        );

                        wss.emit(
                            'connection',
                            ws,
                            req
                        );
                    }
                );
            } catch (error) {
                pushLiveLog(
                    'error',
                    `upgrade failed: ${error?.message || error}`,
                    {
                        route: pathOnly,
                    }
                );

                wsError(
                    'UPGRADE',
                    'handleUpgrade failed',
                    error,
                    {
                        path: pathOnly,
                        elapsedMs:
                            Date.now() -
                            upgradeStartedAt,
                    }
                );

                rejectUpgrade(
                    socket,
                    500,
                    'Internal Server Error'
                );
            }
        }
    );

    /* =====================================================
     * CONNECTION
     * ===================================================== */

    wss.on(
        'connection',
        (ws, req) => {
            ws.upgradeReq = req;

            const id =
                connectionId(ws);

            wsDebug(
                'CONNECTION',
                'WebSocket connection established',
                {
                    ...wsInfo(ws),
                    id,
                    remoteAddress:
                        req.socket?.remoteAddress ||
                        null,
                    host:
                        req.headers?.host ||
                        null,
                    origin:
                        req.headers?.origin ||
                        null,
                    upgradeMs:
                        ws.__upgradeStartedAt
                            ? Date.now() -
                              ws.__upgradeStartedAt
                            : null,
                }
            );

            pushLiveLog(
                'info',
                `connection open ${id}`,
                wsInfo(ws)
            );

            /* -----------------------------------------------
             * COMMON SOCKET EVENTS
             * ----------------------------------------------- */

            ws.on(
                'error',
                (error) => {
                    wsError(
                        'WS',
                        'WebSocket error event',
                        error,
                        wsInfo(ws)
                    );

                    pushLiveLog(
                        'error',
                        `ws error ${id}: ${error?.message || error}`,
                        wsInfo(ws)
                    );
                }
            );

            ws.on(
                'unexpected-response',
                (request, response) => {
                    wsWarn(
                        'WS',
                        'unexpected-response',
                        {
                            ...wsInfo(ws),
                            statusCode:
                                response?.statusCode,
                            statusMessage:
                                response?.statusMessage,
                        }
                    );
                }
            );

            ws.on(
                'ping',
                (data) => {
                    wsDebug(
                        'HEARTBEAT',
                        'ping received from peer',
                        {
                            ...wsInfo(ws),
                            bytes:
                                data?.length || 0,
                        }
                    );
                }
            );

            ws.on(
                'pong',
                () => {
                    wsDebug(
                        'HEARTBEAT',
                        'pong event',
                        wsInfo(ws)
                    );
                }
            );

            ws.on(
                'close',
                (code, reason) => {
                    const duration =
                        ws.__connectedAt
                            ? Date.now() -
                              ws.__connectedAt
                            : null;

                    const reasonText =
                        Buffer.isBuffer(reason)
                            ? reason.toString(
                                'utf8'
                            )
                            : String(
                                reason || ''
                            );

                    wsDebug(
                        'CLOSE',
                        'WebSocket closed',
                        {
                            ...wsInfo(ws),
                            closeCode: code,
                            closeReason:
                                reasonText,
                            durationMs:
                                duration,
                            hadMediaAuth:
                                Boolean(
                                    ws.mediaAuth
                                ),
                            hadControlAuth:
                                Boolean(
                                    ws.controlAuth
                                ),
                            lastMessageAt:
                                ws.__lastMessageAt
                                    ? new Date(
                                        ws.__lastMessageAt
                                    ).toISOString()
                                    : null,
                            lastPongAt:
                                ws.__lastPongAt
                                    ? new Date(
                                        ws.__lastPongAt
                                    ).toISOString()
                                    : null,
                        }
                    );

                    pushLiveLog(
                        'warn',
                        `connection closed ${id} code=${code} reason=${reasonText}`,
                        {
                            ...wsInfo(ws),
                            closeCode: code,
                            closeReason:
                                reasonText,
                            durationMs:
                                duration,
                        }
                    );

                    clearAllTimers(ws);
                }
            );

            /* -----------------------------------------------
             * HEARTBEAT
             * ----------------------------------------------- */

            startHeartbeat(ws);

            /* -----------------------------------------------
             * MEDIA SOCKET
             * ----------------------------------------------- */

            if (ws.isMediaSocket) {
                /* -------------------------------------------
                 * DASHBOARD MEDIA
                 * ------------------------------------------- */

                if (
                    ws.authContext?.kind ===
                    'user'
                ) {
                    wsDebug(
                        'MEDIA-DASHBOARD',
                        'dashboard media client connected',
                        {
                            ...wsInfo(ws),
                            deviceId:
                                ws.mediaSubscription
                                    ?.deviceId ||
                                '',
                            channel:
                                ws.mediaSubscription
                                    ?.channel ||
                                '',
                        }
                    );

                    registerDashboardMediaClient(
                        ws,
                        ws.authContext,
                        ws.mediaSubscription ||
                            {}
                    );

                    ws.on(
                        'message',
                        (message, isBinary) => {
                            ws.__lastMessageAt =
                                Date.now();

                            wsDebug(
                                'MEDIA-DASHBOARD',
                                'message received',
                                {
                                    ...wsInfo(ws),
                                    isBinary:
                                        Boolean(
                                            isBinary
                                        ),
                                    ...describeMessage(
                                        message
                                    ),
                                }
                            );

                            if (
                                typeof message ===
                                    'string' ||
                                Buffer.isBuffer(
                                    message
                                )
                            ) {
                                try {
                                    const text =
                                        Buffer.isBuffer(
                                            message
                                        )
                                            ? message.toString(
                                                'utf8'
                                            )
                                            : String(
                                                message
                                            );

                                    if (
                                        !text.trim()
                                    ) {
                                        return;
                                    }

                                    const packet =
                                        JSON.parse(
                                            text
                                        );

                                    wsDebug(
                                        'MEDIA-DASHBOARD',
                                        'JSON packet',
                                        {
                                            ...wsInfo(ws),
                                            type:
                                                packet?.type ||
                                                null,
                                        }
                                    );

                                    if (
                                        packet.type ===
                                            'dashboard_ping' ||
                                        packet.type ===
                                            'media_ping'
                                    ) {
                                        wsDebug(
                                            'MEDIA-DASHBOARD',
                                            'sending dashboard pong',
                                            wsInfo(ws)
                                        );

                                        ws.send(
                                            JSON.stringify({
                                                type:
                                                    'dashboard_pong',
                                                status:
                                                    'ok',
                                            })
                                        );
                                    }
                                } catch (error) {
                                    wsDebug(
                                        'MEDIA-DASHBOARD',
                                        'non-JSON/bad JSON message ignored',
                                        {
                                            ...wsInfo(ws),
                                            error:
                                                error?.message ||
                                                String(
                                                    error
                                                ),
                                        }
                                    );
                                }
                            }
                        }
                    );

                    ws.on(
                        'close',
                        () => {
                            const registry =
                                getConnectionRegistry();

                            if (
                                ws.connectionKey
                            ) {
                                registry.delete(
                                    ws.connectionKey
                                );
                            }

                            wsDebug(
                                'MEDIA-DASHBOARD',
                                'dashboard media client closed; registry removed',
                                {
                                    ...wsInfo(ws),
                                    connectionKey:
                                        ws.connectionKey ||
                                        null,
                                }
                            );
                        }
                    );

                    return;
                }

                /* -------------------------------------------
                 * AGENT MEDIA
                 * ------------------------------------------- */

                wsDebug(
                    'MEDIA-AGENT',
                    'agent media socket connected; waiting for ZV AUTH',
                    wsInfo(ws)
                );

                adaptAgentMediaSocket(ws);

                const parser =
                    new FrameParser();

                ws.__frameCount = 0;
                ws.__byteCount = 0;

                ws.mediaAuthTimer =
                    setTimeout(() => {
                        if (
                            !ws.mediaAuth &&
                            !ws.controlAuth &&
                            !ws.mediaAuthPending &&
                            ws.readyState ===
                                WebSocket.OPEN
                        ) {
                            wsWarn(
                                'MEDIA-AUTH',
                                'agent media AUTH timeout; closing',
                                {
                                    ...wsInfo(ws),
                                    waitMs:
                                        20000,
                                }
                            );

                            pushLiveLog(
                                'warn',
                                `media auth timeout ${connectionId(ws)}`,
                                wsInfo(ws)
                            );

                            try {
                                ws.close(
                                    4001,
                                    'auth timeout'
                                );
                            } catch (
                                error
                            ) {
                                wsError(
                                    'MEDIA-AUTH',
                                    'close after auth timeout failed',
                                    error,
                                    wsInfo(ws)
                                );
                            }
                        }
                    }, 20000);

                ws.on(
                    'message',
                    (data, isBinary) => {
                        ws.__lastMessageAt =
                            Date.now();

                        const messageInfo =
                            describeMessage(
                                data
                            );

                        wsDebug(
                            'MEDIA-AGENT',
                            'message received',
                            {
                                ...wsInfo(ws),
                                isBinary:
                                    Boolean(
                                        isBinary
                                    ),
                                ...messageInfo,
                            }
                        );

                        let chunk;

                        try {
                            chunk =
                                Buffer.isBuffer(
                                    data
                                )
                                    ? data
                                    : Buffer.from(
                                        data
                                    );
                        } catch (error) {
                            wsError(
                                'MEDIA-FRAME',
                                'failed converting message to Buffer',
                                error,
                                wsInfo(ws)
                            );

                            return;
                        }

                        ws.__byteCount +=
                            chunk.length;

                        let frames;

                        try {
                            frames =
                                parser.push(
                                    chunk
                                );
                        } catch (error) {
                            wsError(
                                'MEDIA-FRAME',
                                'FrameParser.push failed',
                                error,
                                {
                                    ...wsInfo(ws),
                                    bytes:
                                        chunk.length,
                                    totalBytes:
                                        ws.__byteCount,
                                }
                            );

                            pushLiveLog(
                                'error',
                                `media parser error ${connectionId(ws)}`,
                                {
                                    error:
                                        error?.message ||
                                        String(
                                            error
                                        ),
                                    ...wsInfo(
                                        ws
                                    ),
                                }
                            );

                            try {
                                ws.close(
                                    4002,
                                    'frame parse error'
                                );
                            } catch {}

                            return;
                        }

                        if (
                            !Array.isArray(
                                frames
                            )
                        ) {
                            wsWarn(
                                'MEDIA-FRAME',
                                'FrameParser returned non-array',
                                {
                                    ...wsInfo(ws),
                                    resultType:
                                        typeof frames,
                                }
                            );

                            return;
                        }

                        if (
                            frames.length > 0
                        ) {
                            ws.__frameCount +=
                                frames.length;

                            wsDebug(
                                'MEDIA-FRAME',
                                `parsed ${frames.length} frame(s)`,
                                {
                                    ...wsInfo(ws),
                                    totalFrames:
                                        ws.__frameCount,
                                    totalBytes:
                                        ws.__byteCount,
                                }
                            );
                        } else if (
                            DEBUG_FRAMES
                        ) {
                            wsDebug(
                                'MEDIA-FRAME',
                                'message produced no complete frame yet',
                                {
                                    ...wsInfo(ws),
                                    bytes:
                                        chunk.length,
                                }
                            );
                        }

                        for (
                            const frame of frames
                        ) {
                            if (
                                DEBUG_FRAMES
                            ) {
                                wsDebug(
                                    'MEDIA-FRAME',
                                    'dispatching frame',
                                    {
                                        ...wsInfo(
                                            ws
                                        ),
                                        frameType:
                                            frame?.type ??
                                            null,
                                        frameLength:
                                            frame?.length ??
                                            frame?.payload
                                                ?.length ??
                                            null,
                                    }
                                );
                            }

                            try {
                                void onFrame(
                                    ws,
                                    frame
                                );
                            } catch (
                                error
                            ) {
                                wsError(
                                    'MEDIA-FRAME',
                                    'onFrame threw synchronously',
                                    error,
                                    wsInfo(ws)
                                );
                            }
                        }

                        if (
                            ws.mediaAuth ||
                            ws.controlAuth
                        ) {
                            if (
                                ws.mediaAuthTimer
                            ) {
                                clearTimeout(
                                    ws.mediaAuthTimer
                                );

                                ws.mediaAuthTimer =
                                    null;

                                wsDebug(
                                    'MEDIA-AUTH',
                                    'AUTH received; auth timer cleared',
                                    {
                                        ...wsInfo(
                                            ws
                                        ),
                                        mediaAuth:
                                            Boolean(
                                                ws.mediaAuth
                                            ),
                                        controlAuth:
                                            Boolean(
                                                ws.controlAuth
                                            ),
                                    }
                                );
                            }
                        }
                    }
                );

                ws.on(
                    'close',
                    () => {
                        clearTimer(
                            ws,
                            'mediaAuthTimer'
                        );

                        const authenticated =
                            Boolean(
                                ws.mediaAuth ||
                                ws.controlAuth
                            );

                        wsDebug(
                            'MEDIA-AGENT',
                            authenticated
                                ? 'agent media socket closed after auth'
                                : 'agent media socket closed before auth',
                            {
                                ...wsInfo(ws),
                                authenticated,
                                mediaAuth:
                                    Boolean(
                                        ws.mediaAuth
                                    ),
                                controlAuth:
                                    Boolean(
                                        ws.controlAuth
                                    ),
                                mediaAuthPending:
                                    Boolean(
                                        ws.mediaAuthPending
                                    ),
                                frames:
                                    ws.__frameCount ||
                                    0,
                                bytes:
                                    ws.__byteCount ||
                                    0,
                            }
                        );

                        try {
                            onSocketClose(
                                ws
                            );
                        } catch (
                            error
                        ) {
                            wsError(
                                'MEDIA-AGENT',
                                'onSocketClose failed',
                                error,
                                wsInfo(ws)
                            );
                        }
                    }
                );

                return;
            }

            /* =================================================
             * GATEWAY / PENDING PEER
             * ================================================= */

            if (
                ws.authContext?.kind ===
                'pending'
            ) {
                wsDebug(
                    'GATEWAY',
                    'pending peer connected; registration timer started',
                    {
                        ...wsInfo(ws),
                        timeoutMs:
                            CONNECTION_TIMEOUT_MS,
                    }
                );

                ws.registrationTimer =
                    setTimeout(() => {
                        if (
                            ws.authContext
                                ?.kind ===
                                'pending' &&
                            ws.readyState ===
                                WebSocket.OPEN
                        ) {
                            wsWarn(
                                'GATEWAY',
                                'pending peer registration timeout',
                                wsInfo(ws)
                            );

                            try {
                                ws.send(
                                    JSON.stringify({
                                        type:
                                            'sys_ack',
                                        status:
                                            'auth_timeout',
                                        message:
                                            'register_channel required',
                                    })
                                );
                            } catch (
                                error
                            ) {
                                wsError(
                                    'GATEWAY',
                                    'failed sending auth_timeout',
                                    error,
                                    wsInfo(ws)
                                );
                            }

                            try {
                                ws.close(
                                    4001,
                                    'register_channel timeout'
                                );
                            } catch (
                                error
                            ) {
                                wsError(
                                    'GATEWAY',
                                    'failed closing pending peer',
                                    error,
                                    wsInfo(ws)
                                );
                            }
                        }
                    }, CONNECTION_TIMEOUT_MS);
            }

            /* -----------------------------------------------
             * GATEWAY MESSAGES
             * ----------------------------------------------- */

            ws.on(
                'message',
                (message, isBinary) => {
                    ws.__lastMessageAt =
                        Date.now();

                    wsDebug(
                        'GATEWAY-MESSAGE',
                        'message received',
                        {
                            ...wsInfo(ws),
                            isBinary:
                                Boolean(
                                    isBinary
                                ),
                            ...describeMessage(
                                message
                            ),
                        }
                    );

                    try {
                        const result =
                            handleSocketMessage(
                                ws,
                                message
                            );

                        if (
                            result &&
                            typeof result.then ===
                                'function'
                        ) {
                            result.catch(
                                (error) => {
                                    wsError(
                                        'GATEWAY-MESSAGE',
                                        'handleSocketMessage rejected',
                                        error,
                                        wsInfo(
                                            ws
                                        )
                                    );
                                }
                            );
                        }
                    } catch (error) {
                        wsError(
                            'GATEWAY-MESSAGE',
                            'handleSocketMessage threw',
                            error,
                            wsInfo(ws)
                        );
                    }
                }
            );

            ws.on(
                'close',
                (code, reason) => {
                    clearTimer(
                        ws,
                        'registrationTimer'
                    );

                    const reasonText =
                        Buffer.isBuffer(reason)
                            ? reason.toString(
                                'utf8'
                            )
                            : String(
                                reason || ''
                            );

                    wsDebug(
                        'GATEWAY',
                        'gateway peer closed',
                        {
                            ...wsInfo(ws),
                            closeCode: code,
                            closeReason:
                                reasonText,
                            registered:
                                ws.authContext
                                    ?.kind !==
                                'pending',
                            userId:
                                ws.authContext
                                    ?.user?.id ||
                                null,
                        }
                    );

                    try {
                        const result =
                            handleSocketClose(
                                ws
                            );

                        if (
                            result &&
                            typeof result.then ===
                                'function'
                        ) {
                            result.catch(
                                (error) => {
                                    wsError(
                                        'GATEWAY',
                                        'handleSocketClose rejected',
                                        error,
                                        wsInfo(
                                            ws
                                        )
                                    );
                                }
                            );
                        }
                    } catch (error) {
                        wsError(
                            'GATEWAY',
                            'handleSocketClose threw',
                            error,
                            wsInfo(ws)
                        );
                    }
                }
            );
        }
    );

    /* =====================================================
     * WSS ERROR
     * ===================================================== */

    wss.on(
        'error',
        (error) => {
            wsError(
                'WSS',
                'WebSocket.Server error',
                error
            );

            pushLiveLog(
                'error',
                `WSS server error: ${error?.message || error}`,
                {}
            );
        }
    );

    wss.on(
        'listening',
        () => {
            wsDebug(
                'WSS',
                'WebSocket server listening event'
            );
        }
    );

    /* =====================================================
     * RETURN
     * ===================================================== */

    wsDebug(
        'INIT',
        'WebSocket gateway initialized',
        {
            heartbeatMs:
                HEARTBEAT_MS,
            connectionTimeoutMs:
                CONNECTION_TIMEOUT_MS,
            debug: DEBUG,
            debugMessages:
                DEBUG_MESSAGES,
            debugFrames:
                DEBUG_FRAMES,
        }
    );

    return {
        wss,
        auditLogger,
        gatewayRateLimiter,
    };
}

module.exports = {
    initWebSocketGateway,
};