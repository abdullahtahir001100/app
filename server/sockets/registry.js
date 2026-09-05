/**
 * Single in-memory registry shared by WebSocket gateway + HTTP API routes.
 * Next.js route handlers can load a separate module copy — globalThis keeps one Map.
 */
function getConnectionRegistry() {
    if (!globalThis.__zenvoraActiveConnections) {
        globalThis.__zenvoraActiveConnections = new Map();
    }
    return globalThis.__zenvoraActiveConnections;
}

module.exports = { getConnectionRegistry };
