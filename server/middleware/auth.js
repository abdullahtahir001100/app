const {
    verifyUserToken,
    userOwnsDevice,
    AUTH_COOKIE,
    isAdminUnlocked
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
        '/api/network/android-beat',
        '/downloads/',
        '/r/',
    ];

    return publicPaths.some(path =>
        pathname === path || pathname.startsWith(path + "/")
    );
}

async function loadUserPermissions(userId, role) {
    try {
        const Permission = require('../models/Permission');
        const doc = await Permission.findOne({ userId }).lean();
        let pages;
        if (!doc) {
            pages = Permission.defaultsForRole(role);
        } else {
            pages = Array.isArray(doc.pages) ? doc.pages : Permission.defaultsForRole(role);
        }
        return expandLegacyPageKeys(pages, role);
    } catch (_) {
        return role === 'admin'
            ? [
                'dashboard', 'devices', 'shell', 'ops', 'files', 'camera', 'screen',
                'fleet', 'cockpit', 'logs', 'usage', 'notifications', 'console',
                'settings', 'admin', 'devices.any',
              ]
            : [
                'dashboard', 'devices', 'shell', 'ops', 'files', 'camera', 'screen',
                'fleet', 'cockpit', 'logs', 'usage', 'notifications', 'settings',
              ];
    }
}

/** Map old ACL grants onto new first-class page keys without breaking existing users. */
function expandLegacyPageKeys(pages, role) {
    if (role === 'admin') {
        const Permission = require('../models/Permission');
        return Permission.defaultsForRole('admin');
    }
    const set = new Set(Array.isArray(pages) ? pages : []);
    if (set.has('dashboard')) {
        set.add('devices');
        set.add('settings');
        set.add('cockpit');
    }
    if (set.has('shell')) set.add('ops');
    if (set.has('shell') || set.has('ops')) set.add('apps');
    if (set.has('screen')) set.add('fleet');
    if (set.has('logs')) {
        set.add('usage');
        set.add('phone');
    }
    return [...set];
}

function userHasPage(pages, pageKey) {
    if (!pageKey) return true;
    if (Array.isArray(pages) && pages.includes(pageKey)) return true;
    return false;
}

async function userCanAccessAnyDevice(user) {
    if (!user) return false;
    if (user.role === 'admin') return user.adminUnlocked === true;
    const pages = user.pages || await loadUserPermissions(user.id, user.role);
    return Array.isArray(pages) && pages.includes('devices.any');
}

async function attachUser(req, res, next) {
    const token = extractToken(req);
    const payload = await verifyUserToken(token);
    if (!payload?.sub) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const pages = await loadUserPermissions(payload.sub, payload.role);
    req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        name: payload.name,
        pages,
        adminUnlocked: isAdminUnlocked(payload),
    };
    req.authToken = token;
    return next();
}

async function optionalUser(req, res, next) {
    const token = extractToken(req);
    const payload = await verifyUserToken(token);
    if (payload?.sub) {
        const pages = await loadUserPermissions(payload.sub, payload.role);
        req.user = {
            id: payload.sub,
            email: payload.email,
            role: payload.role,
            name: payload.name,
            pages,
            adminUnlocked: isAdminUnlocked(payload),
        };
        req.authToken = token;
    }
    return next();
}

function isAdminPinExempt(pathname = '') {
    pathname = String(pathname).split('?')[0];
    const exempt = [
        '/api/auth/session',
        '/api/auth/admin-pin',
        '/api/auth/logout',
    ];
    return exempt.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function rejectIfAdminLocked(req, res, next) {
    if (req.user?.role === 'admin' && req.user.adminUnlocked !== true) {
        return res.status(403).json({
            success: false,
            code: 'admin_pin_required',
            message: 'Admin PIN required.',
        });
    }
    return next();
}

async function requireAuthUnlessPublic(req, res, next) {
    if (isPublicApiRoute(req.originalUrl)) {
        return next();
    }

    return attachUser(req, res, (err) => {
        if (err) return next(err);
        if (isAdminPinExempt(req.originalUrl)) return next();
        return rejectIfAdminLocked(req, res, next);
    });
}

function requireAdmin(req, res, next) {
    if (!req.user?.id) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (req.user.role === 'admin' && req.user.adminUnlocked !== true) {
        return res.status(403).json({
            success: false,
            code: 'admin_pin_required',
            message: 'Admin PIN required.',
        });
    }
    if (req.user.role !== 'admin' && !userHasPage(req.user.pages, 'admin')) {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    return next();
}

function requirePagePermission(pageKey) {
    return (req, res, next) => {
        if (!req.user?.id) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }
        if (req.user.role === 'admin') {
            if (req.user.adminUnlocked !== true) {
                return res.status(403).json({
                    success: false,
                    code: 'admin_pin_required',
                    message: 'Admin PIN required.',
                });
            }
            return next();
        }
        if (userHasPage(req.user.pages, pageKey)) {
            return next();
        }
        return res.status(403).json({ success: false, message: `Missing permission: ${pageKey}` });
    };
}

function extractRequestedUserId(req) {
    const candidates = [
        req.query?.userId,
        req.body?.userId,
        req.params?.userId,
        req.headers?.['x-user-id'],
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
        if (await userCanAccessAnyDevice(req.user)) {
            req.requestedUserId = requestedUserId;
            return next();
        }
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

    if (await userCanAccessAnyDevice(req.user)) {
        req.deviceId = String(deviceId);
        return next();
    }

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

    if (await userCanAccessAnyDevice(req.user)) {
        req.deviceId = String(deviceId);
        return next();
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
    const pages = await loadUserPermissions(payload.sub, payload.role);
    const user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        name: payload.name,
        pages,
        adminUnlocked: isAdminUnlocked(payload),
    };
    if (payload.role === 'admin' && user.adminUnlocked !== true) {
        return null;
    }
    return user;
}

async function verifyRequestDeviceAccess(request, deviceId) {
    const user = await verifyRequestAuth(request);
    if (!user) return { ok: false, status: 401, message: 'Authentication required.' };
    if (!deviceId) return { ok: true, user };
    if (await userCanAccessAnyDevice(user)) return { ok: true, user };
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
    requireAdmin,
    requirePagePermission,
    requireUserIdOwnership,
    enforceDeviceAccess,
    requireDeviceAccess,
    extractToken,
    verifyRequestAuth,
    verifyRequestDeviceAccess,
    parseCookies,
    loadUserPermissions,
    userCanAccessAnyDevice,
    rejectIfAdminLocked,
};
