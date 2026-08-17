const BrowserHistory = require('../models/BrowserHistory');
const AppHistory = require('../models/AppHistory');
const Notification = require('../models/Notification');

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
 * Dedupes on device + user + browser + url + visitTime + windowsUser + profile.
 */
async function syncBrowserHistory(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) {
        return { count: 0 };
    }

    if (entries.length === 0) {
        return { count: 0 };
    }

    const docs = entries.map((entry) => ({
        deviceId,
        userId,
        browser: normalizeBrowser(entry.browser),
        url: String(entry.url || ''),
        title: String(entry.title || entry.url || 'Untitled'),
        visitTime: parseFlexibleDate(entry.visitTime),
        visitCount: Number(entry.visitCount) || 1,
        domain: extractDomain(entry.url),
        windowsUser: String(entry.windowsUser || entry.windows_user || ''),
        browserProfile: String(entry.browserProfile || entry.browser_profile || entry.profile || '')
    })).filter((doc) => doc.url);

    if (docs.length === 0) return { count: 0 };

    const ops = docs.map((doc) => ({
        updateOne: {
            filter: {
                deviceId: doc.deviceId,
                userId: doc.userId,
                browser: doc.browser,
                url: doc.url,
                visitTime: doc.visitTime,
                windowsUser: doc.windowsUser,
                browserProfile: doc.browserProfile
            },
            update: {
                $set: {
                    title: doc.title,
                    visitCount: doc.visitCount,
                    domain: doc.domain
                },
                $setOnInsert: {
                    deviceId: doc.deviceId,
                    userId: doc.userId,
                    browser: doc.browser,
                    url: doc.url,
                    visitTime: doc.visitTime,
                    windowsUser: doc.windowsUser,
                    browserProfile: doc.browserProfile
                }
            },
            upsert: true
        }
    }));

    try {
        const result = await BrowserHistory.bulkWrite(ops, { ordered: false });
        return {
            count: (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0)
        };
    } catch (err) {
        // Partial bulkWrite success still inserts most docs.
        if (err?.result) {
            return {
                count: (err.result.nUpserted || 0) + (err.result.nModified || 0) + (err.result.nMatched || 0)
            };
        }
        throw err;
    }
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

    const docs = entries.map((entry) => ({
        deviceId,
        userId,
        appName: String(entry.appName || entry.app_name || 'Unknown'),
        executablePath: String(entry.executablePath || entry.executable_path || ''),
        lastOpened: parseFlexibleDate(entry.lastOpened || entry.last_opened),
        appType: normalizeAppType(entry.appType || entry.app_type),
        category: entry.category ? String(entry.category) : undefined,
        windowsUser: String(entry.windowsUser || entry.windows_user || ''),
        duration: Math.max(0, Number(entry.duration) || 0)
    }));

    const ops = docs.map((doc) => ({
        updateOne: {
            filter: {
                deviceId: doc.deviceId,
                userId: doc.userId,
                appName: doc.appName,
                executablePath: doc.executablePath,
                lastOpened: doc.lastOpened,
                windowsUser: doc.windowsUser
            },
            update: {
                $set: {
                    appType: doc.appType,
                    duration: doc.duration,
                    ...(doc.category ? { category: doc.category } : {})
                },
                $setOnInsert: {
                    deviceId: doc.deviceId,
                    userId: doc.userId,
                    appName: doc.appName,
                    executablePath: doc.executablePath,
                    lastOpened: doc.lastOpened,
                    windowsUser: doc.windowsUser,
                    duration: doc.duration
                }
            },
            upsert: true
        }
    }));

    try {
        const result = await AppHistory.bulkWrite(ops, { ordered: false });
        return {
            count: (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0)
        };
    } catch (err) {
        if (err?.result) {
            return {
                count: (err.result.nUpserted || 0) + (err.result.nModified || 0) + (err.result.nMatched || 0)
            };
        }
        throw err;
    }
}

async function syncSystemNotifications(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries)) {
        return { count: 0 };
    }

    let count = 0;

    for (const entry of entries) {
        await Notification.updateOne(
            {
                deviceId,
                userId,
                app: String(entry.app || "System"),
                title: String(entry.title || "Notification"),
                message: String(entry.message || "")
            },
            {
                $setOnInsert: {
                    deviceId,
                    userId,
                    app: String(entry.app || "System"),
                    title: String(entry.title || "Notification"),
                    message: String(entry.message || ""),
                    icon: String(entry.icon || ""),
                    category: String(entry.category || "other"),
                    read: false,
                    createdAt: new Date()
                }
            },
            {
                upsert: true
            }
        );

        count++;
    }

    return { count };
}

async function syncActivityLogs(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) {
        return { count: 0 };
    }
    if (entries.length === 0) return { count: 0 };

    const ActivityLog = require('../models/ActivityLog');
    let count = 0;
    for (const entry of entries) {
        const action = String(entry.action || entry.event || entry.type || '').trim();
        if (!action) continue;
        const duration = Math.max(0, Number(entry.duration) || Number(entry.metadata?.duration) || 0);
        await ActivityLog.create({
            deviceId,
            userId,
            action,
            category: String(entry.category || 'system'),
            appName: String(entry.appName || entry.app_name || ''),
            processName: String(entry.processName || entry.process_name || ''),
            executablePath: String(entry.executablePath || entry.executable_path || ''),
            windowTitle: String(entry.windowTitle || entry.window_title || ''),
            url: String(entry.url || ''),
            domain: String(entry.domain || ''),
            device: String(entry.device || deviceId),
            details: String(entry.details || entry.message || ''),
            status: String(entry.status || 'success'),
            duration,
            metadata: entry.metadata || entry,
        });
        if (action === 'app_closed' && duration > 0) {
            await syncAppHistory(deviceId, [{
                appName: String(entry.appName || entry.app_name || entry.processName || 'Unknown'),
                executablePath: String(entry.executablePath || entry.executable_path || entry.processName || ''),
                lastOpened: entry.lastOpened || entry.timestamp || new Date(),
                duration,
                appType: 'app',
                category: 'session',
            }], userId);
        }
        count += 1;
    }
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
    const CallLog = require('../models/CallLog');
    let count = 0;
    for (const entry of entries) {
        const timestamp = parseFlexibleDate(entry.timestamp || entry.date);
        const number = String(entry.number || '');
        if (!number && !entry.name) continue;
        await CallLog.updateOne(
            { deviceId, userId, number, timestamp },
            {
                $set: {
                    name: String(entry.name || ''),
                    type: Number(entry.type) || 0,
                    duration: Number(entry.duration) || 0
                },
                $setOnInsert: { deviceId, userId, number, timestamp }
            },
            { upsert: true }
        );
        count += 1;
    }
    return { count };
}

async function syncSmsMessages(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) return { count: 0 };
    const SmsMessage = require('../models/SmsMessage');
    let count = 0;
    for (const entry of entries) {
        const timestamp = parseFlexibleDate(entry.timestamp || entry.date);
        const address = String(entry.address || '');
        const body = String(entry.body || '');
        if (!address && !body) continue;
        await SmsMessage.updateOne(
            { deviceId, userId, address, body, timestamp },
            {
                $set: {
                    type: Number(entry.type) || 0,
                    read: Boolean(entry.read)
                },
                $setOnInsert: { deviceId, userId, address, body, timestamp }
            },
            { upsert: true }
        );
        count += 1;
    }
    return { count };
}

async function syncContacts(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) return { count: 0 };
    const Contact = require('../models/Contact');
    let count = 0;
    for (const entry of entries) {
        const name = String(entry.name || '');
        const phone = String(entry.phone || entry.number || '');
        if (!name && !phone) continue;
        await Contact.updateOne(
            { deviceId, userId, name, phone },
            { $setOnInsert: { deviceId, userId, name, phone } },
            { upsert: true }
        );
        count += 1;
    }
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
