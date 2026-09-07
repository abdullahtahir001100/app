const crypto = require('crypto');

function createConnectionRateLimiter(maxRequests = 20, windowMs = 60 * 1000) {
    const buckets = new Map();

    return {
        allow(key) {
            const now = Date.now();
            const bucket = buckets.get(key);
            if (!bucket || now - bucket.windowStart > windowMs) {
                buckets.set(key, { windowStart: now, count: 1 });
                return true;
            }

            if (bucket.count >= maxRequests) {
                return false;
            }

            bucket.count += 1;
            return true;
        },
        reset(key) {
            buckets.delete(key);
        }
    };
}

function createAuditLogger() {
    const records = [];

    return {
        log(event) {
            const entry = {
                id: crypto.randomUUID(),
                ts: new Date().toISOString(),
                ...event
            };

            records.push(entry);
            return entry;
        },
        getRecent(limit = 50) {
            return records.slice(-limit);
        }
    };
}

module.exports = {
    createConnectionRateLimiter,
    createAuditLogger
};
