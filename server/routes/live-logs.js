const express = require('express');
const { recent } = require('../services/liveLogBus');
const { getConnectionRegistry } = require('../sockets/registry');
const { controlAgents } = require('../control/controlHandler');
const { verifyUserTokenFast, AUTH_COOKIE } = require('../services/authService');

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
    const authHeader = req.headers?.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const cookies = parseCookies(req.headers?.cookie || '');
    const token = bearer || req.cookies?.[AUTH_COOKIE] || cookies[AUTH_COOKIE] || null;
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
        channels: ['http', 'ws', 'tcp', 'agent', 'install', 'system', 'mongo'],
        logs: recent(limit, channel),
    });
});

module.exports = router;
