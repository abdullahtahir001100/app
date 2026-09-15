const express = require('express');
const { recent, subscribe } = require('../services/liveLogBus');
const { getConnectionRegistry } = require('../sockets/registry');
const { controlAgents } = require('../control/controlHandler');
const { verifyUserTokenFast, AUTH_COOKIE } = require('../services/authService');
const { attachUser, requirePagePermission } = require('../middleware/auth');

const router = express.Router();

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    String(header).split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx <= 0) return;
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return out;
}

function requireUserFast(req, res, next) {
    // Allow local CLI monitor scripts running on localhost
    const clientIp = req.socket?.remoteAddress || '';
    const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
    if (isLocal && (req.headers['x-internal-monitor'] === 'true' || req.query?.monitor === 'true')) {
        req.user = { id: 'local-monitor', email: 'monitor@zenvora.local', role: 'admin', name: 'CLI Monitor' };
        return next();
    }

    const authHeader = req.headers?.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const cookies = parseCookies(req.headers?.cookie || '');
    const token = bearer || req.cookies?.[AUTH_COOKIE] || cookies[AUTH_COOKIE] || req.query?.token || null;
    const user = verifyUserTokenFast(token);
    if (!user?.sub) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    req.user = { id: String(user.sub), email: user.email, role: user.role, name: user.name };
    return next();
}

router.get('/', requireUserFast, (req, res) => {
    const limit = Number(req.query.limit) || 400;
    const channel = req.query.channel ? String(req.query.channel) : null;
    const registry = getConnectionRegistry();
    let agents = 0;
    let dashboards = 0;
    for (const key of registry.keys()) {
        if (key.startsWith('AGENT_') || key.startsWith('DEVICE_')) agents += 1;
        else if (key.startsWith('DASHBOARD_')) dashboards += 1;
    }

    res.status(200).json({
        success: true,
        ok: true,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        agents,
        dashboards,
        controlTcp: controlAgents.size,
        mongo: Boolean(global.__ZENVORA_MONGO_OK),
        channels: ['http', 'ws', 'tcp', 'agent', 'install', 'system', 'mongo', 'db', 'node'],
        logs: recent(limit, channel),
    });
});

/**
 * Realtime Server-Sent Events (SSE) log stream for CLI tools & Dashboards
 */
router.get('/stream', requireUserFast, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();

    // Initial connected packet
    res.write(`data: ${JSON.stringify({ type: 'stream_connected', ts: new Date().toISOString() })}\n\n`);

    const channelFilter = req.query.channel ? String(req.query.channel) : null;
    const deviceFilter = req.query.device ? String(req.query.device) : null;

    const unsubscribe = subscribe((entry) => {
        if (channelFilter && entry.channel !== channelFilter) return;
        if (deviceFilter && entry.deviceId && entry.deviceId !== deviceFilter) return;
        try {
            res.write(`data: ${JSON.stringify(entry)}\n\n`);
        } catch (_) {}
    });

    const keepaliveTimer = setInterval(() => {
        try {
            res.write(': keepalive\n\n');
        } catch (_) {}
    }, 15000);

    req.on('close', () => {
        clearInterval(keepaliveTimer);
        unsubscribe();
    });
});

module.exports = router;
