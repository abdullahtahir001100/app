const BrowserHistory = require('../models/BrowserHistory');
const AppHistory = require('../models/AppHistory');
const Notification = require('../models/Notification');

function parseFlexibleDate(value) {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    const normalized = String(value).replace(' ', 'T');
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
        windowsUser: String(entry.windowsUser || entry.windows_user || '')
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
                    ...(doc.category ? { category: doc.category } : {})
                },
                $setOnInsert: {
                    deviceId: doc.deviceId,
                    userId: doc.userId,
                    appName: doc.appName,
                    executablePath: doc.executablePath,
                    lastOpened: doc.lastOpened,
                    windowsUser: doc.windowsUser
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

async function persistHistoryPayload(deviceId, packet) {
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
        default:
            return { command, count: 0 };
    }
}

module.exports = {
    syncBrowserHistory,
    syncAppHistory,
    syncSystemNotifications,
    persistHistoryPayload
};
