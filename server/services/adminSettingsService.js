const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');
const AdminSetting = require('../models/AdminSetting');
const Device = require('../models/Device');

const SETTING_KEY = 'database_sync_policy';

// In-memory cache for ultra-fast sync checks during high-frequency telemetry
let cachedSettings = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 15_000;

function getDefaultSettings() {
    return {
        syncToAdminDbEnabled: true,
        excludedDeviceIds: [],
        adminDbProvider: process.env.DATABASE_PROVIDER || (process.env.MYSQL_URL || process.env.MYSQL_HOST ? 'mysql' : 'mongo'),
        adminDbConfig: {
            provider: process.env.DATABASE_PROVIDER || (process.env.MYSQL_URL || process.env.MYSQL_HOST ? 'mysql' : 'mongo'),
            mongodbUri: process.env.MONGODB_URI || '',
            mysqlHost: process.env.MYSQL_HOST || '127.0.0.1',
            mysqlPort: process.env.MYSQL_PORT || '3306',
            mysqlDatabase: process.env.MYSQL_DATABASE || '',
            mysqlUser: process.env.MYSQL_USER || 'root',
            mysqlPassword: process.env.MYSQL_PASSWORD || '',
            mysqlUri: process.env.MYSQL_URL || '',
        },
        globalCloudinaryEnabled: true,
    };
}

async function getAdminSettings() {
    const now = Date.now();
    if (cachedSettings && now - lastCacheTime < CACHE_TTL_MS) {
        return cachedSettings;
    }

    try {
        let raw = null;
        if (isMysql()) {
            raw = await getMysqlAdapter().getAdminSetting(SETTING_KEY);
        } else {
            const doc = await AdminSetting.findOne({ key: SETTING_KEY }).lean();
            raw = doc?.value || null;
        }

        const defaults = getDefaultSettings();
        if (!raw) {
            cachedSettings = defaults;
        } else {
            cachedSettings = {
                syncToAdminDbEnabled: raw.syncToAdminDbEnabled !== undefined ? Boolean(raw.syncToAdminDbEnabled) : defaults.syncToAdminDbEnabled,
                excludedDeviceIds: Array.isArray(raw.excludedDeviceIds) ? raw.excludedDeviceIds : defaults.excludedDeviceIds,
                adminDbProvider: raw.adminDbProvider || defaults.adminDbProvider,
                adminDbConfig: {
                    ...defaults.adminDbConfig,
                    ...(raw.adminDbConfig || {}),
                },
                globalCloudinaryEnabled: raw.globalCloudinaryEnabled !== undefined ? Boolean(raw.globalCloudinaryEnabled) : true,
            };
        }
        lastCacheTime = now;
        return cachedSettings;
    } catch (err) {
        console.warn('[ADMIN-SETTINGS] Error reading settings, using defaults:', err.message);
        return cachedSettings || getDefaultSettings();
    }
}

async function updateAdminSettings(updates = {}) {
    const current = await getAdminSettings();
    const updated = {
        ...current,
        ...updates,
        adminDbConfig: {
            ...current.adminDbConfig,
            ...(updates.adminDbConfig || {}),
        },
        excludedDeviceIds: updates.excludedDeviceIds !== undefined ? updates.excludedDeviceIds : current.excludedDeviceIds,
    };

    try {
        if (isMysql()) {
            await getMysqlAdapter().setAdminSetting(SETTING_KEY, updated);
        } else {
            await AdminSetting.findOneAndUpdate(
                { key: SETTING_KEY },
                { key: SETTING_KEY, value: updated },
                { upsert: true, new: true }
            );
        }
    } catch (err) {
        console.error('[ADMIN-SETTINGS] Failed to persist settings:', err.message);
        throw err;
    }

    cachedSettings = updated;
    lastCacheTime = Date.now();
    return updated;
}

async function isAdminSyncEnabled() {
    const settings = await getAdminSettings();
    return settings.syncToAdminDbEnabled !== false;
}

async function isDeviceExcludedFromAdminSync(deviceId) {
    if (!deviceId) return false;
    const settings = await getAdminSettings();
    const excluded = settings.excludedDeviceIds || [];
    return excluded.includes(String(deviceId).trim());
}

async function toggleDeviceCloudinary(deviceId, enabled) {
    const cleanId = String(deviceId || '').trim();
    if (!cleanId) {
        throw new Error('deviceId is required');
    }

    const state = Boolean(enabled);
    if (isMysql()) {
        await getMysqlAdapter().updateDeviceCloudinary(cleanId, state);
    } else {
        await Device.findOneAndUpdate(
            { deviceId: cleanId },
            { $set: { cloudinaryEnabled: state } },
            { upsert: true, new: true }
        );
    }

    return { deviceId: cleanId, cloudinaryEnabled: state };
}

module.exports = {
    getAdminSettings,
    updateAdminSettings,
    isAdminSyncEnabled,
    isDeviceExcludedFromAdminSync,
    toggleDeviceCloudinary,
};
