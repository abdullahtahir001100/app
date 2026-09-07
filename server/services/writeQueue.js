/**
 * Non-blocking Mongo write queue.
 * Networking never awaits these writes.
 */

const queue = [];
let flushTimer = null;
let flushing = false;

const MAX_QUEUE = 5000;
const FLUSH_MS = 250;
const BATCH_SIZE = 100;

function enqueue(job) {
    if (typeof job !== 'function') return;
    if (queue.length >= MAX_QUEUE) {
        queue.shift();
    }
    queue.push(job);
    if (!flushTimer) {
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void flush();
        }, FLUSH_MS);
    }
}

async function flush() {
    if (flushing) return;
    flushing = true;
    try {
        while (queue.length > 0) {
            const batch = queue.splice(0, BATCH_SIZE);
            for (const job of batch) {
                try {
                    await job();
                } catch (_) {
                    // swallow — never block the event loop on retries here
                }
            }
            // Yield between batches.
            if (queue.length > 0) {
                await new Promise((r) => setImmediate(r));
            }
        }
    } finally {
        flushing = false;
        if (queue.length > 0 && !flushTimer) {
            flushTimer = setTimeout(() => {
                flushTimer = null;
                void flush();
            }, FLUSH_MS);
        }
    }
}

function depth() {
    return queue.length;
}

module.exports = { enqueue, flush, depth };
