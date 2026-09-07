/**
 * In-memory realtime ops log bus.
 * Never awaits Mongo. Fan-out to dashboards immediately.
 */

const MAX = 2500;
const ring = [];
const subscribers = new Set(); // (entry) => void

function push(partial) {
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        channel: String(partial.channel || 'system'),
        level: String(partial.level || 'info'),
        message: String(partial.message || ''),
        route: partial.route || null,
        method: partial.method || null,
        status: partial.status ?? null,
        ms: partial.ms ?? null,
        deviceId: partial.deviceId || null,
        userId: partial.userId || null,
        meta: partial.meta && typeof partial.meta === 'object' ? partial.meta : undefined,
    };

    ring.push(entry);
    if (ring.length > MAX) {
        ring.splice(0, ring.length - MAX);
    }

    for (const fn of subscribers) {
        try {
            fn(entry);
        } catch (_) {}
    }

    return entry;
}

function recent(limit = 300, channel = null) {
    const list = channel
        ? ring.filter((e) => e.channel === channel)
        : ring;
    return list.slice(-Math.min(Math.max(Number(limit) || 300, 1), MAX));
}

function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}

function httpMiddleware() {
    return (req, res, next) => {
        const start = Date.now();
        const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
        // Skip noisy static / next internals
        if (
            pathOnly.startsWith('/_next') ||
            pathOnly.startsWith('/favicon') ||
            pathOnly.match(/\.(js|css|map|png|jpg|svg|ico|woff2?)$/i)
        ) {
            return next();
        }

        res.on('finish', () => {
            push({
                channel: 'http',
                level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
                message: `${req.method} ${pathOnly} → ${res.statusCode}`,
                method: req.method,
                route: pathOnly,
                status: res.statusCode,
                ms: Date.now() - start,
            });
        });
        next();
    };
}

module.exports = {
    push,
    recent,
    subscribe,
    httpMiddleware,
};
