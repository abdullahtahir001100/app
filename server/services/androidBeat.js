const Device = require('../models/Device');

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
        status: 'online',
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

function overlayDeviceStatus(deviceId, platform, lastAndroidBeatAt, isLiveWs) {
    if (isLiveWs) return 'online';
    if (looksAndroidDevice(deviceId, platform) && isBeatOnline(deviceId, lastAndroidBeatAt)) {
        return 'online';
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
