const {
    verifyUserToken,
    userOwnsDevice,
    AUTH_COOKIE,
    isAdminUnlocked
} = require('../services/authService');
const { isUserMasterAdmin } = require('../services/adminAuthService');

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

    if (typeof req.cookies?.get === 'function') {
        const c = req.cookies.get(AUTH_COOKIE);
        if (c && typeof c === 'object' && c.value) return c.value;
        if (typeof c === 'string') return c;
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
        '/api/integrations',
        '/downloads/',
        '/r/',
    ];

    return publicPaths.some(path =>
        pathname === path || pathname.startsWith(path + "/")
    );
}

async function loadUserPermissions(userId, role) {
    try {
        const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');
        const Permission = require('../models/Permission');
        let doc;
        if (isMysql()) {
            doc = await getMysqlAdapter().findPermissionByUser(userId);
        } else {
            doc = await Permission.findOne({ userId }).lean();
        }
        let pages;
        if (!doc) {
            pages = Permission.defaultsForRole(role);
        } else {
            pages = Array.isArray(doc.pages) ? doc.pages : Permission.defaultsForRole(role);
        }
        return expandLegacyPageKeys(pages, role);
    } catch (_) {
        const Permission = require('../models/Permission');
        return Permission.defaultsForRole(role);
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
    }
    return [...set];
}

function userHasPage(pages, pageKey) {
    if (!pageKey) return true;
    if (!Array.isArray(pages)) return false;
    if (pages.includes(pageKey)) return true;

    // Granular parent grants child
    if (pageKey.startsWith('logs.') && pages.includes('logs')) return true;
    if (pageKey.startsWith('phone.') && pages.includes('phone')) return true;

    // Granular child grants parent page access (e.g. logs.browser grants access to /logs)
    if (pageKey === 'logs') {
        return pages.some((p) => p === 'logs' || p.startsWith('logs.'));
    }
    if (pageKey === 'phone') {
        return pages.some((p) => p === 'phone' || p.startsWith('phone.'));
    }

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

    let role = payload.role || 'user';
    let adminUnlocked = false;
    if (role === 'admin') {
        const isMaster = await isUserMasterAdmin(payload.email);
        if (isMaster) {
            adminUnlocked = isAdminUnlocked(payload);
        } else {
            role = 'user';
        }
    }

    const pages = await loadUserPermissions(payload.sub, role);
    req.user = {
        id: payload.sub,
        email: payload.email,
        role,
        name: payload.name,
        pages: role === 'admin' ? pages : pages.filter((p) => p !== 'admin' && p !== 'devices.any'),
        adminUnlocked,
    };
    req.authToken = token;
    return next();
}

async function optionalUser(req, res, next) {
    const token = extractToken(req);
    const payload = await verifyUserToken(token);
    if (payload?.sub) {
        let role = payload.role || 'user';
        let adminUnlocked = false;
        if (role === 'admin') {
            const isMaster = await isUserMasterAdmin(payload.email);
            if (isMaster) {
                adminUnlocked = isAdminUnlocked(payload);
            } else {
                role = 'user';
            }
        }

        const pages = await loadUserPermissions(payload.sub, role);
        req.user = {
            id: payload.sub,
            email: payload.email,
            role,
            name: payload.name,
            pages: role === 'admin' ? pages : pages.filter((p) => p !== 'admin' && p !== 'devices.any'),
            adminUnlocked,
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

async function requireAdmin(req, res, next) {
    if (!req.user?.id) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const isMaster = await isUserMasterAdmin(req.user.email);
    if (!isMaster) {
        req.user.role = 'user';
        req.user.adminUnlocked = false;
        return res.status(403).json({ success: false, message: 'Admin access strictly restricted to Master Admin Database.' });
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
    let role = payload.role || 'user';
    let adminUnlocked = false;
    if (role === 'admin') {
        const isMaster = await isUserMasterAdmin(payload.email);
        if (isMaster) {
            adminUnlocked = isAdminUnlocked(payload);
        } else {
            role = 'user';
        }
    }
    const pages = await loadUserPermissions(payload.sub, role);
    const user = {
        id: payload.sub,
        email: payload.email,
        role,
        name: payload.name,
        pages: role === 'admin' ? pages : pages.filter((p) => p !== 'admin' && p !== 'devices.any'),
        adminUnlocked,
    };
    if (role === 'admin' && user.adminUnlocked !== true) {
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
