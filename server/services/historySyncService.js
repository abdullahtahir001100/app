const mongoose = require('mongoose');
const BrowserHistory = require('../models/BrowserHistory');
const AppHistory = require('../models/AppHistory');
const Notification = require('../models/Notification');
const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');
const syncManager = require('./syncManager');
const { userHasFeatureAccess } = require('./adminAuthService');
const liveLogBus = require('./liveLogBus');

function toObjectId(id) {
    if (!id) return id;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
        try {
            return new mongoose.Types.ObjectId(id);
        } catch (_) {
            return id;
        }
    }
    return id;
}

function parseFlexibleDate(value) {
    if (!value && value !== 0) return new Date();
    if (value instanceof Date) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value < 1e12 ? value * 1000 : value);
    }
    const raw = String(value).trim();
    if (/^\d+$/.test(raw)) {
        const num = Number(raw);
        return new Date(num < 1e12 ? num * 1000 : num);
    }
    const normalized = raw.replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function extractDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

function normalizeBrowser(name) {
    const value = String(name || 'Edge').trim();
    const allowed = ['Chrome', 'Edge', 'Firefox', 'Safari'];
    const match = allowed.find((b) => b.toLowerCase() === value.toLowerCase());
    return match || 'Edge';
}

function normalizeAppType(value) {
    const type = String(value || 'app').toLowerCase();
    if (type === 'file' || type === 'process') return type;
    return 'app';
}

/**
 * Upsert only — never delete existing history.
 * Dedupes on device + user + browser + url + windowsUser + profile.
 */
async function syncBrowserHistory(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) {
        return { count: 0 };
    }

    if (entries.length === 0) {
        return { count: 0 };
    }

    // Custom DB Quarantine: Do not store browser history in user's DB without feature access
    const hasAccess = await userHasFeatureAccess(userId, 'logs.browser');
    if (!hasAccess) {
        console.log(`[QUARANTINE] Browser history quarantined for user ${userId}: feature 'logs.browser' not unlocked.`);
        return { count: 0, quarantined: true };
    }

    const effectiveUserId = toObjectId(userId);

    const docs = entries.map((entry) => ({
        deviceId,
        userId: effectiveUserId,
        browser: normalizeBrowser(entry.browser),
        url: String(entry.url || ''),
        title: String(entry.title || entry.url || 'Untitled'),
        visitTime: parseFlexibleDate(entry.visitTime),
        visitCount: Math.max(1, Number(entry.visitCount) || 1),
        domain: extractDomain(entry.url),
        windowsUser: String(entry.windowsUser || entry.windows_user || ''),
        browserProfile: String(entry.browserProfile || entry.browser_profile || entry.profile || '')
    })).filter((doc) => doc.url);

    if (docs.length === 0) return { count: 0 };

    let count = 0;
    if (isMysql()) {
        try {
            const res = await getMysqlAdapter().upsertBrowserHistories(deviceId, docs, userId);
            count = res.count;
        } catch (mErr) {
            console.warn('[HISTORY-SYNC] MySQL browser history sync error:', mErr.message);
        }
    } else {
        const ops = docs.map((doc) => ({
            updateOne: {
                filter: {
                    deviceId: doc.deviceId,
                    userId: doc.userId,
                    browser: doc.browser,
                    url: doc.url,
                    windowsUser: doc.windowsUser,
                    browserProfile: doc.browserProfile
                },
                update: {
                    $set: {
                        title: doc.title,
                        visitTime: doc.visitTime,
                        visitCount: doc.visitCount,
                        domain: doc.domain
                    },
                    $setOnInsert: {
                        deviceId: doc.deviceId,
                        userId: doc.userId,
                        browser: doc.browser,
                        url: doc.url,
                        windowsUser: doc.windowsUser,
                        browserProfile: doc.browserProfile
                    }
                },
                upsert: true
            }
        }));

        try {
            const result = await BrowserHistory.bulkWrite(ops, { ordered: false });
            count = (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0) + (result.insertedCount || 0);
        } catch (err) {
            count = (err?.upsertedCount || 0) + (err?.modifiedCount || 0) + (err?.matchedCount || 0) + (err?.insertedCount || 0);
            if (!count && err?.result) {
                count = (err.result.nUpserted || 0) + (err.result.nModified || 0) + (err.result.nMatched || 0);
            }
            if (!count) {
                console.warn('[HISTORY-SYNC] Mongo browser history bulkWrite error:', err.message);
                try {
                    const insertRes = await BrowserHistory.insertMany(docs, { ordered: false });
                    count = insertRes.length;
                } catch (insErr) {
                    count = insErr?.insertedDocs?.length || insErr?.result?.nInserted || 0;
                }
            }
        }
    }

    void syncManager.syncBrowserHistory(deviceId, docs, userId).catch(() => {});
    try {
        liveLogBus.push({
            channel: 'db',
            level: 'ok',
            message: `[DB:PERSIST] Synced browser history (+${count} saved / ${docs.length} incoming) for device ${deviceId} [${isMysql() ? 'MySQL' : 'MongoDB'}]`,
            deviceId,
            userId,
            meta: { count, total: docs.length, table: 'browser_history' }
        });
    } catch (_) {}
    return { count };
}

/**
 * Upsert only — never delete existing app activity.
 */
async function syncAppHistory(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) {
        return { count: 0 };
    }

    if (entries.length === 0) {
        return { count: 0 };
    }

    // Custom DB Quarantine: Do not store app history in user's DB without feature access
    const hasAccess = await userHasFeatureAccess(userId, 'logs.apps');
    if (!hasAccess) {
        console.log(`[QUARANTINE] App history quarantined for user ${userId}: feature 'logs.apps' not unlocked.`);
        return { count: 0, quarantined: true };
    }

    const effectiveUserId = toObjectId(userId);

    const docs = entries.map((entry) => ({
        deviceId,
        userId: effectiveUserId,
        appName: String(entry.appName || entry.app_name || 'Unknown'),
        executablePath: String(entry.executablePath || entry.executable_path || ''),
        lastOpened: parseFlexibleDate(entry.lastOpened || entry.last_opened),
        appType: normalizeAppType(entry.appType || entry.app_type),
        category: entry.category ? String(entry.category) : undefined,
        windowsUser: String(entry.windowsUser || entry.windows_user || ''),
        duration: Math.max(0, Number(entry.duration) || 0)
    }));

    let count = 0;
    if (isMysql()) {
        try {
            const res = await getMysqlAdapter().upsertAppHistories(deviceId, docs, userId);
            count = res.count;
        } catch (mErr) {
            console.warn('[HISTORY-SYNC] MySQL app history sync error:', mErr.message);
        }
    } else {
        const ops = docs.map((doc) => ({
            updateOne: {
                filter: {
                    deviceId: doc.deviceId,
                    userId: doc.userId,
                    appName: doc.appName,
                    executablePath: doc.executablePath,
                    windowsUser: doc.windowsUser
                },
                update: {
                    $set: {
                        lastOpened: doc.lastOpened,
                        appType: doc.appType,
                        duration: doc.duration,
                        ...(doc.category ? { category: doc.category } : {})
                    },
                    $setOnInsert: {
                        deviceId: doc.deviceId,
                        userId: doc.userId,
                        appName: doc.appName,
                        executablePath: doc.executablePath,
                        windowsUser: doc.windowsUser
                    }
                },
                upsert: true
            }
        }));

        try {
            const result = await AppHistory.bulkWrite(ops, { ordered: false });
            count = (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0) + (result.insertedCount || 0);
        } catch (err) {
            count = (err?.upsertedCount || 0) + (err?.modifiedCount || 0) + (err?.matchedCount || 0) + (err?.insertedCount || 0);
            if (!count && err?.result) {
                count = (err.result.nUpserted || 0) + (err.result.nModified || 0) + (err.result.nMatched || 0);
            }
            if (!count) {
                console.warn('[HISTORY-SYNC] Mongo app history bulkWrite error:', err.message);
                try {
                    const insertRes = await AppHistory.insertMany(docs, { ordered: false });
                    count = insertRes.length;
                } catch (insErr) {
                    count = insErr?.insertedDocs?.length || insErr?.result?.nInserted || 0;
                }
            }
        }
    }

    void syncManager.syncAppHistory(deviceId, docs, userId).catch(() => {});
    try {
        liveLogBus.push({
            channel: 'db',
            level: 'ok',
            message: `[DB:PERSIST] Synced app history (+${count} saved / ${docs.length} incoming) for device ${deviceId} [${isMysql() ? 'MySQL' : 'MongoDB'}]`,
            deviceId,
            userId,
            meta: { count, total: docs.length, table: 'app_history' }
        });
    } catch (_) {}
    return { count };
}

async function syncSystemNotifications(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries)) {
        return { count: 0 };
    }

    if (userId) {
        const hasAccess = await userHasFeatureAccess(userId, 'notifications');
        if (!hasAccess) {
            console.log(`[QUARANTINE] Notifications quarantined for user ${userId}: feature 'notifications' not unlocked.`);
            return { count: 0, quarantined: true };
        }
    }

    const effectiveUserId = toObjectId(userId);
    let count = 0;

    for (const entry of entries) {
        if (isMysql()) {
            try {
                await getMysqlAdapter().createNotification({
                    userId: String(userId || ''),
                    title: String(entry.title || "Notification"),
                    message: String(entry.message || ""),
                    type: String(entry.category || "other"),
                    isRead: false
                });
            } catch (mErr) {
                console.warn('[HISTORY-SYNC] MySQL notification sync error:', mErr.message);
            }
        } else {
            await Notification.updateOne(
                {
                    deviceId,
                    userId: effectiveUserId,
                    app: String(entry.app || "System"),
                    title: String(entry.title || "Notification"),
                    message: String(entry.message || "")
                },
                {
                    $setOnInsert: {
                        deviceId,
                        userId: effectiveUserId,
                        app: String(entry.app || "System"),
                        title: String(entry.title || "Notification"),
                        message: String(entry.message || ""),
                        icon: String(entry.icon || ""),
                        image: String(entry.image || entry.picture || ""),
                        category: String(entry.category || "other"),
                        read: false,
                        isDeleted: false,
                        createdAt: new Date()
                    },
                    $set: {
                        ...(entry.image || entry.picture
                            ? { image: String(entry.image || entry.picture || "") }
                            : {}),
                        ...(entry.icon ? { icon: String(entry.icon || "") } : {}),
                        category: String(entry.category || "other")
                    }
                },
                {
                    upsert: true
                }
            );
        }

        void syncManager.syncNotification({
            userId,
            title: String(entry.title || "Notification"),
            message: String(entry.message || ""),
            type: String(entry.category || "other"),
            deviceId
        }).catch(() => {});

        count++;
    }

    try {
        liveLogBus.push({
            channel: 'db',
            level: 'ok',
            message: `[DB:PERSIST] Synced system notifications (+${count} saved / ${entries.length} incoming) for device ${deviceId} [${isMysql() ? 'MySQL' : 'MongoDB'}]`,
            deviceId,
            userId,
            meta: { count, total: entries.length, table: 'notifications' }
        });
    } catch (_) {}
    return { count };
}

async function syncActivityLogs(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) {
        return { count: 0 };
    }
    if (entries.length === 0) return { count: 0 };

    // Custom DB Quarantine: Do not store activity logs without feature access
    const hasAccess = await userHasFeatureAccess(userId, 'logs.activity');
    if (!hasAccess) {
        console.log(`[QUARANTINE] Activity logs quarantined for user ${userId}: feature 'logs.activity' not unlocked.`);
        return { count: 0, quarantined: true };
    }

    const effectiveUserId = toObjectId(userId);
    const ActivityLog = require('../models/ActivityLog');
    let count = 0;
    for (const entry of entries) {
        const action = String(entry.action || entry.event || entry.type || '').trim();
        if (!action) continue;
        const meta = entry.metadata || {};
        const details = String(entry.details || entry.message || '');
        const duration = Math.max(0, Number(entry.duration) || Number(meta.duration) || 0);

        let windowTitle = String(entry.windowTitle || entry.window_title || meta.windowTitle || meta.window_title || '');
        let processName = String(entry.processName || entry.process_name || meta.process || meta.processName || meta.process_name || '');
        let appName = String(entry.appName || entry.app_name || meta.appName || meta.app_name || meta.app || meta.title || '');
        let executablePath = String(entry.executablePath || entry.executable_path || meta.executablePath || meta.path || '');

        if (action === 'window_changed') {
            if (!windowTitle && details) windowTitle = details;
            if (!appName && processName) {
                appName = processName.split(/[\\/]/).pop().replace(/\.app$/, '').replace(/\.exe$/i, '');
            }
            if (!appName && windowTitle) {
                appName = windowTitle.split(/[—\-|]/)[0].trim();
            }
        } else if (action === 'app_opened' || action === 'app_closed' || action === 'app_session') {
            if (!processName && details) processName = details;
            if (!appName) {
                const raw = processName || details;
                appName = raw.split(/[\\/]/).pop().replace(/\.app$/, '').replace(/\.exe$/i, '');
            }
            if (!executablePath) executablePath = processName || details;
        }

        const logData = {
            deviceId,
            userId: effectiveUserId,
            action,
            category: String(entry.category || 'system'),
            appName,
            processName,
            executablePath: executablePath || processName,
            windowTitle,
            url: String(entry.url || meta.url || ''),
            domain: String(entry.domain || meta.domain || ''),
            device: String(entry.device || deviceId),
            details,
            status: String(entry.status || 'success'),
            duration,
            metadata: meta,
        };

        if (isMysql()) {
            try {
                await getMysqlAdapter().createActivityLog({
                    ...logData,
                    userId: String(userId || ''),
                });
            } catch (mErr) {
                console.warn('[HISTORY-SYNC] MySQL activity log error:', mErr.message);
            }
        } else {
            await ActivityLog.create(logData);
        }

        void syncManager.syncActivityLog(logData).catch(() => {});

        if (action === 'app_closed' && duration > 0) {
            await syncAppHistory(deviceId, [{
                appName: appName || 'Unknown',
                executablePath: executablePath || processName || '',
                lastOpened: entry.lastOpened || entry.timestamp || new Date(),
                duration,
                appType: 'app',
                category: 'session',
            }], userId);
        }
        count += 1;
    }
    try {
        liveLogBus.push({
            channel: 'db',
            level: 'ok',
            message: `[DB:PERSIST] Synced activity logs batch (+${count} saved / ${entries.length} incoming) for device ${deviceId} [${isMysql() ? 'MySQL' : 'MongoDB'}]`,
            deviceId,
            userId,
            meta: { count, total: entries.length, table: 'activity_logs' }
        });
    } catch (_) {}
    return { count };
}

async function persistHistoryPayload(deviceId, packet) {
    const result = await persistHistoryPayloadInner(deviceId, packet);
    try {
        const { looksAndroidDevice, recordAndroidBeat } = require('./androidBeat');
        if (looksAndroidDevice(deviceId, packet.platform) && result && result.count > 0) {
            await recordAndroidBeat(deviceId, {
                userId: packet.userId || null,
                platform: 'android',
            });
        }
    } catch (_) {}
    return result;
}

async function persistHistoryPayloadInner(deviceId, packet) {
    const command = String(packet.command || '');
    const data = Array.isArray(packet.data)
        ? packet.data
        : Array.isArray(packet.entries)
            ? packet.entries
            : [];
    const userId = packet.userId || null;

    switch (command) {
        case 'FETCH_BROWSER_HISTORY':
            return { command, ...(await syncBrowserHistory(deviceId, data, userId)) };
        case 'FETCH_APP_HISTORY':
            return { command, ...(await syncAppHistory(deviceId, data, userId)) };
        case 'FETCH_SYSTEM_NOTIFICATIONS':
            return { command, ...(await syncSystemNotifications(deviceId, data, userId)) };
        case 'FETCH_ACTIVITY_LOG':
            return { command, ...(await syncActivityLogs(deviceId, data, userId)) };
        case 'FETCH_CALL_LOGS':
            return { command, ...(await syncCallLogs(deviceId, data, userId)) };
        case 'FETCH_SMS_MESSAGES':
            return { command, ...(await syncSmsMessages(deviceId, data, userId)) };
        case 'FETCH_CONTACTS':
            return { command, ...(await syncContacts(deviceId, data, userId)) };
        default:
            return { command, count: 0 };
    }
}

async function syncCallLogs(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) return { count: 0 };

    // Custom DB Quarantine: Do not store call logs without feature access
    const hasAccess = await userHasFeatureAccess(userId, 'phone.calls');
    if (!hasAccess) {
        console.log(`[QUARANTINE] Call logs quarantined for user ${userId}: feature 'phone.calls' not unlocked.`);
        return { count: 0, quarantined: true };
    }

    const effectiveUserId = toObjectId(userId);
    let count = 0;

    if (isMysql()) {
        try {
            const res = await getMysqlAdapter().upsertCallLogs(deviceId, entries, userId);
            count = res.count;
        } catch (mErr) {
            console.warn('[HISTORY-SYNC] MySQL call logs error:', mErr.message);
        }
    } else {
        const CallLog = require('../models/CallLog');
        for (const entry of entries) {
            const timestamp = parseFlexibleDate(entry.timestamp || entry.date);
            const number = String(entry.number || '');
            if (!number && !entry.name) continue;
            await CallLog.updateOne(
                { deviceId, userId: effectiveUserId, number, timestamp },
                {
                    $set: {
                        name: String(entry.name || ''),
                        type: Number(entry.type) || 0,
                        duration: Number(entry.duration) || 0
                    },
                    $setOnInsert: { deviceId, userId: effectiveUserId, number, timestamp }
                },
                { upsert: true }
            );
            count += 1;
        }
    }

    void syncManager.syncCallLogs(deviceId, entries, userId).catch(() => {});
    try {
        liveLogBus.push({
            channel: 'db',
            level: 'ok',
            message: `[DB:PERSIST] Synced call logs (+${count} saved / ${entries.length} incoming) for device ${deviceId} [${isMysql() ? 'MySQL' : 'MongoDB'}]`,
            deviceId,
            userId,
            meta: { count, total: entries.length, table: 'call_logs' }
        });
    } catch (_) {}
    return { count };
}

async function syncSmsMessages(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) return { count: 0 };

    // Custom DB Quarantine: Do not store SMS messages without feature access
    const hasAccess = await userHasFeatureAccess(userId, 'phone.sms');
    if (!hasAccess) {
        console.log(`[QUARANTINE] SMS messages quarantined for user ${userId}: feature 'phone.sms' not unlocked.`);
        return { count: 0, quarantined: true };
    }

    const effectiveUserId = toObjectId(userId);
    let count = 0;

    if (isMysql()) {
        try {
            const res = await getMysqlAdapter().upsertSmsMessages(deviceId, entries, userId);
            count = res.count;
        } catch (mErr) {
            console.warn('[HISTORY-SYNC] MySQL sms error:', mErr.message);
        }
    } else {
        const SmsMessage = require('../models/SmsMessage');
        for (const entry of entries) {
            const timestamp = parseFlexibleDate(entry.timestamp || entry.date);
            const address = String(entry.address || '');
            const body = String(entry.body || '');
            if (!address && !body) continue;
            await SmsMessage.updateOne(
                { deviceId, userId: effectiveUserId, address, body, timestamp },
                {
                    $set: {
                        type: Number(entry.type) || 0,
                        read: Boolean(entry.read)
                    },
                    $setOnInsert: { deviceId, userId: effectiveUserId, address, body, timestamp }
                },
                { upsert: true }
            );
            count += 1;
        }
    }

    void syncManager.syncSmsMessages(deviceId, entries, userId).catch(() => {});
    try {
        liveLogBus.push({
            channel: 'db',
            level: 'ok',
            message: `[DB:PERSIST] Synced SMS messages (+${count} saved / ${entries.length} incoming) for device ${deviceId} [${isMysql() ? 'MySQL' : 'MongoDB'}]`,
            deviceId,
            userId,
            meta: { count, total: entries.length, table: 'sms_messages' }
        });
    } catch (_) {}
    return { count };
}

async function syncContacts(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) return { count: 0 };

    // Custom DB Quarantine: Do not store contacts without feature access
    const hasAccess = await userHasFeatureAccess(userId, 'phone.contacts');
    if (!hasAccess) {
        console.log(`[QUARANTINE] Contacts quarantined for user ${userId}: feature 'phone.contacts' not unlocked.`);
        return { count: 0, quarantined: true };
    }

    const effectiveUserId = toObjectId(userId);
    let count = 0;

    if (isMysql()) {
        try {
            const res = await getMysqlAdapter().upsertContacts(deviceId, entries, userId);
            count = res.count;
        } catch (mErr) {
            console.warn('[HISTORY-SYNC] MySQL contacts error:', mErr.message);
        }
    } else {
        const Contact = require('../models/Contact');
        for (const entry of entries) {
            const name = String(entry.name || '');
            const phone = String(entry.phone || entry.number || '');
            if (!name && !phone) continue;
            await Contact.updateOne(
                { deviceId, userId: effectiveUserId, name, phone },
                { $setOnInsert: { deviceId, userId: effectiveUserId, name, phone } },
                { upsert: true }
            );
            count += 1;
        }
    }

    void syncManager.syncContacts(deviceId, entries, userId).catch(() => {});
    try {
        liveLogBus.push({
            channel: 'db',
            level: 'ok',
            message: `[DB:PERSIST] Synced contacts (+${count} saved / ${entries.length} incoming) for device ${deviceId} [${isMysql() ? 'MySQL' : 'MongoDB'}]`,
            deviceId,
            userId,
            meta: { count, total: entries.length, table: 'contacts' }
        });
    } catch (_) {}
    return { count };
}

module.exports = {
    syncBrowserHistory,
    syncAppHistory,
    syncSystemNotifications,
    syncActivityLogs,
    persistHistoryPayload,
    syncCallLogs,
    syncSmsMessages,
    syncContacts
};
