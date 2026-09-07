const Device = require('../models/Device');
const { getControlAgent } = require('../control/controlHandler');

const ANDROID_BEAT_MS = 5 * 60 * 1000;
const beats = new Map();

function isFresh(at) {
    if (!at) return false;
    const ms = at instanceof Date ? at.getTime() : Number(at);
    if (!Number.isFinite(ms)) return false;
    return Date.now() - ms < ANDROID_BEAT_MS;
}

function isAndroidPlatform(platform) {
    return String(platform || '').toLowerCase() === 'android';
}

function looksAndroidDevice(deviceId, platform) {
    if (isAndroidPlatform(platform)) return true;
    return String(deviceId || '').startsWith('AND-');
}

async function recordAndroidBeat(deviceId, extras = {}) {
    const id = String(deviceId || '').trim();
    if (!id) return null;
    const now = new Date();
    beats.set(id, { at: now.getTime(), userId: extras.userId ? String(extras.userId) : null });

    const $set = {
        lastAndroidBeatAt: now,
        lastSeen: now,
        status: 'away',
        platform: extras.platform || 'android',
    };
    if (extras.hostname) $set.hostname = extras.hostname;
    if (extras.battery != null && Number.isFinite(Number(extras.battery))) {
        $set.battery = Math.max(0, Math.min(100, Number(extras.battery)));
    }
    if (extras.network) $set.network = String(extras.network);
    if (extras.localIp) $set.localIp = String(extras.localIp);

    const update = { $set };
    if (extras.userId) {
        update.$setOnInsert = { userId: extras.userId, deviceId: id };
    }

    const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');
    if (isMysql()) {
        try {
            const data = {
                platform: extras.platform || 'android',
                status: 'away',
                lastSeen: now,
            };
            if (extras.hostname) data.hostname = extras.hostname;
            if (extras.battery != null && Number.isFinite(Number(extras.battery))) {
                data.battery = Math.max(0, Math.min(100, Number(extras.battery)));
            }
            if (extras.network) data.network = String(extras.network);
            if (extras.localIp) data.localIp = String(extras.localIp);
            if (extras.userId) data.userId = String(extras.userId);
            return await getMysqlAdapter().upsertDevice(id, data);
        } catch (_) {
            return null;
        }
    }

    try {
        return await Device.findOneAndUpdate(
            { deviceId: id },
            update,
            { new: true, upsert: Boolean(extras.userId) }
        );
    } catch (_) {
        return null;
    }
}

function isBeatOnline(deviceId, mongoLastBeat) {
    const mem = beats.get(String(deviceId || ''));
    if (mem && isFresh(mem.at)) return true;
    return isFresh(mongoLastBeat);
}

function overlayDeviceStatus(deviceId, platform, lastAndroidBeatAt, isLiveWs, activeConnections = null) {
    const { isCommandReady } = require('../sockets/dispatchAgent');
    const registry = activeConnections || require('../sockets/registry').getConnectionRegistry();
    if (isCommandReady(deviceId, registry)) return 'online';
    if (isLiveWs) {
        const control = getControlAgent(deviceId);
        if (control?.socket && !control.socket.destroyed) return 'online';
    }
    if (looksAndroidDevice(deviceId, platform) && isBeatOnline(deviceId, lastAndroidBeatAt)) {
        return 'away';
    }
    return 'offline';
}

function beatOnlineIds(userId = null, seeAll = false) {
    const ids = [];
    const now = Date.now();
    for (const [id, rec] of beats.entries()) {
        if (!isFresh(rec.at) && now - rec.at >= ANDROID_BEAT_MS) continue;
        if (!seeAll && userId && rec.userId && rec.userId !== String(userId)) continue;
        if (isFresh(rec.at)) ids.push(id);
    }
    return ids;
}

module.exports = {
    ANDROID_BEAT_MS,
    recordAndroidBeat,
    isBeatOnline,
    overlayDeviceStatus,
    looksAndroidDevice,
    beatOnlineIds,
};
