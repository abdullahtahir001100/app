const { getAdminSettings } = require('./adminSettingsService');
const { testMysqlConnection, cleanHostString, buildMysqlUri } = require('../db/mysql/connection');
const mysql = require('mysql2/promise');
const mongoose = require('mongoose');

// Cache to keep fast middleware execution
const adminEmailCache = new Map(); // email -> { isAdmin: boolean, expiresAt: number }
const CACHE_TTL_MS = 20_000;

let masterMysqlPool = null;
let masterMysqlConfigSig = '';

function getMasterMysqlPool(config) {
    const host = config?.mysqlHost || config?.host || process.env.MYSQL_HOST || '127.0.0.1';
    const port = Number(config?.mysqlPort || config?.port || process.env.MYSQL_PORT || 3306);
    const user = config?.mysqlUser || config?.user || process.env.MYSQL_USER || 'root';
    const password = config?.mysqlPassword ?? config?.password ?? process.env.MYSQL_PASSWORD ?? '';
    const database = config?.mysqlDatabase || config?.database || process.env.MYSQL_DATABASE || '';
    const sig = `${host}:${port}:${user}:${database}`;

    if (masterMysqlPool && masterMysqlConfigSig === sig) {
        return masterMysqlPool;
    }

    try {
        if (masterMysqlPool) {
            void masterMysqlPool.end().catch(() => {});
        }
    } catch (_) {}

    masterMysqlConfigSig = sig;
    masterMysqlPool = mysql.createPool({
        host,
        port,
        user,
        password,
        database: database || undefined,
        waitForConnections: true,
        connectionLimit: 5,
        connectTimeout: 5000,
        ssl: { rejectUnauthorized: false },
    });
    return masterMysqlPool;
}

/**
 * Validates whether a user email is an authorized system administrator
 * strictly based on the Admin Master Database selected in Admin Settings / .env.
 * 
 * If a user connects their own custom DB and sets role='admin', this function
 * will reject them, ensuring admin access CANNOT be hijacked.
 */
async function isUserMasterAdmin(email) {
    if (!email) return false;
    const normalized = String(email).trim().toLowerCase();
    if (!normalized) return false;

    // 1. Env Admin Override
    const envAdmin = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (envAdmin && normalized === envAdmin) {
        return true;
    }

    // 2. Check in-memory cache
    const now = Date.now();
    const cached = adminEmailCache.get(normalized);
    if (cached && cached.expiresAt > now) {
        return cached.isAdmin;
    }

    let isAdmin = false;

    try {
        const settings = await getAdminSettings();
        const provider = settings.adminDbProvider || (process.env.DATABASE_PROVIDER || (process.env.MYSQL_URL || process.env.MYSQL_HOST ? 'mysql' : 'mongo'));
        const config = settings.adminDbConfig || {};

        if (provider === 'mysql') {
            const pool = getMasterMysqlPool(config);
            const [rows] = await pool.query(
                'SELECT role FROM users WHERE email = ? LIMIT 1',
                [normalized]
            );
            if (rows && rows[0]) {
                isAdmin = rows[0].role === 'admin';
            }
        } else {
            // Mongo Master DB check
            const User = require('../models/User');
            const doc = await User.findOne({ email: normalized }).select('role').lean();
            if (doc) {
                isAdmin = doc.role === 'admin';
            }
        }
    } catch (err) {
        console.warn(`[ADMIN-AUTH] Master admin check notice for ${normalized}:`, err.message);
        // Fallback: if master check fails, trust env admin only
        isAdmin = envAdmin ? normalized === envAdmin : false;
    }

    // Store in cache
    adminEmailCache.set(normalized, {
        isAdmin,
        expiresAt: now + CACHE_TTL_MS,
    });

    return isAdmin;
}

/**
 * Sanitize a user object, stripping admin role and permissions
 * if the user is not verified in the Admin Master Database.
 */
async function enforceAdminRoleIsolation(user) {
    if (!user) return user;
    const email = user.email || '';
    const authorized = await isUserMasterAdmin(email);

    if (!authorized) {
        if (user.role === 'admin') {
            user.role = 'user';
        }
        user.adminUnlocked = false;
        if (Array.isArray(user.pages)) {
            user.pages = user.pages.filter((p) => p !== 'admin' && p !== 'devices.any');
        }
    }

    return user;
}

/**
 * Checks if a specific user owns or is granted access to a specific capability / tab.
 * Admins verified against Master Admin DB automatically have access to all features.
 * Custom DB writes are quarantined unless this function returns true.
 */
async function userHasFeatureAccess(userId, featureKey) {
    if (!userId) return false;
    try {
        const { loadUserPermissions, userHasPage } = require('../middleware/auth');
        const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');
        let user;
        if (isMysql()) {
            user = await getMysqlAdapter().findUserById(userId);
        } else {
            const User = require('../models/User');
            user = await User.findById(userId).lean();
        }
        if (!user) return false;
        if (user.role === 'admin') {
            const isMaster = await isUserMasterAdmin(user.email);
            if (isMaster) return true;
        }
        const pages = await loadUserPermissions(userId, user.role || 'user');
        return userHasPage(pages, featureKey);
    } catch (err) {
        console.warn(`[FEATURE-ACCESS] Error checking ${featureKey} for user ${userId}:`, err.message);
        return false;
    }
}

module.exports = {
    isUserMasterAdmin,
    enforceAdminRoleIsolation,
    invalidateAdminCache,
    userHasFeatureAccess,
};
