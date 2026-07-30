const {
    verifyUserToken,
    userOwnsDevice,
    AUTH_COOKIE
} = require('../services/authService');

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

function extractToken(req) {
    const authHeader = req.headers?.authorization || req.headers?.get?.('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }

    if (req.cookies?.[AUTH_COOKIE]) {
        return req.cookies[AUTH_COOKIE];
    }

    const cookieHeader = req.headers?.cookie || req.headers?.get?.('cookie');
    const cookies = parseCookies(cookieHeader);
    return cookies[AUTH_COOKIE] || null;
}

function isPublicApiRoute(pathname = "") {
    pathname = pathname.split("?")[0];

    const publicPaths = [
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/logout",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
        "/api/auth/google",
        "/api/virtual-files/share",
        '/api/auth/agent/pair',
        '/api/agent/chat',
        '/api/install-logs',
        '/api/agent/download',
        '/api/health',
        '/downloads/'
    ];

    return publicPaths.some(path =>
        pathname === path || pathname.startsWith(path + "/")
    );
}
async function attachUser(req, res, next) {
    const token = extractToken(req);
    const payload = await verifyUserToken(token);
    if (!payload?.sub) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        name: payload.name
    };
    req.authToken = token;
    return next();
}

async function optionalUser(req, res, next) {
    const token = extractToken(req);
    const payload = await verifyUserToken(token);
    if (payload?.sub) {
        req.user = {
            id: payload.sub,
            email: payload.email,
            role: payload.role,
            name: payload.name
        };
        req.authToken = token;
    }
    return next();
}

async function requireAuthUnlessPublic(req, res, next) {
    if (isPublicApiRoute(req.originalUrl)) {
        return next();
    }

    return attachUser(req, res, next);
}

function extractRequestedUserId(req) {
    const candidates = [
        req.query?.userId,
        req.body?.userId,
        req.params?.userId,
        req.headers?.['x-user-id'],
        req.headers?.['x-user-id']
    ];

    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
            return String(candidate).trim();
        }
    }

    return null;
}

async function requireUserIdOwnership(req, res, next) {
    if (!req.user?.id) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const requestedUserId = extractRequestedUserId(req);
    if (!requestedUserId) {
        req.requestedUserId = req.user.id;
        return next();
    }

    if (String(requestedUserId) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'userId does not belong to the authenticated user.' });
    }

    req.requestedUserId = requestedUserId;
    return next();
}

function extractDeviceId(req) {
    return (
        req.query?.deviceId
        || req.body?.deviceId
        || req.body?.targetDeviceId
        || req.params?.deviceId
        || null
    );
}

async function enforceDeviceAccess(req, res, next) {
    const deviceId = extractDeviceId(req);
    if (!deviceId) return next();

    const allowed = await userOwnsDevice(req.user.id, String(deviceId));
    if (!allowed) {
        return res.status(403).json({
            success: false,
            message: 'You do not have access to this device.'
        });
    }

    req.deviceId = String(deviceId);
    return next();
}

async function requireDeviceAccess(req, res, next) {
    const deviceId = extractDeviceId(req);
    if (!deviceId) {
        return res.status(400).json({ success: false, message: 'deviceId is required.' });
    }
    if (!req.user?.id) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const allowed = await userOwnsDevice(req.user.id, String(deviceId));
    if (!allowed) {
        return res.status(403).json({ success: false, message: 'You do not have access to this device.' });
    }

    req.deviceId = String(deviceId);
    return next();
}

async function verifyRequestAuth(request) {
    const token = extractToken(request);
    const payload = await verifyUserToken(token);
    if (!payload?.sub) return null;
    return {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        name: payload.name
    };
}

async function verifyRequestDeviceAccess(request, deviceId) {
    const user = await verifyRequestAuth(request);
    if (!user) return { ok: false, status: 401, message: 'Authentication required.' };
    if (!deviceId) return { ok: true, user };
    const allowed = await userOwnsDevice(user.id, String(deviceId));
    if (!allowed) {
        return { ok: false, status: 403, message: 'You do not have access to this device.' };
    }
    return { ok: true, user };
}

module.exports = {
    AUTH_COOKIE,
    attachUser,
    optionalUser,
    requireAuthUnlessPublic,
    requireUserIdOwnership,
    enforceDeviceAccess,
    requireDeviceAccess,
    extractToken,
    verifyRequestAuth,
    verifyRequestDeviceAccess,
    parseCookies
};
