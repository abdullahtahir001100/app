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

async function syncBrowserHistory(deviceId, entries, userId = null) {
    if (!deviceId || !Array.isArray(entries) || !userId) {
        return { count: 0 };
    }

    if (entries.length === 0) {
        // Never wipe existing history on an empty scrape (Session 0 / locked DBs).
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
        windowsUser: String(entry.windowsUser || entry.windows_user || '')
    })).filter((doc) => doc.url);

    if (docs.length === 0) return { count: 0 };

    await BrowserHistory.deleteMany({ deviceId, userId });
    await BrowserHistory.insertMany(docs, { ordered: false });
    return { count: docs.length };
}

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

    await AppHistory.deleteMany({ deviceId, userId });
    await AppHistory.insertMany(docs, { ordered: false });
    return { count: docs.length };
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
