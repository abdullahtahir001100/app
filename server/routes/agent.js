const express = require('express');
const fs = require('fs');
const path = require('path');
const {
    createTicket,
    getTicket,
    buildInstallScript,
} = require('../services/bootstrapTicketService');
const liveLogBus = require('../services/liveLogBus');
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

function candidatePaths() {
    const cwd = process.cwd();
    const envPath = process.env.AGENT_BINARY_PATH;
    return [
        envPath,
        path.join(cwd, 'public', 'downloads', 'win_32.exe'),
        path.join(cwd, 'zenvora_agent', 'target', 'release', 'win_32.exe'),
        path.join(cwd, 'zenvora_agent', 'target', 'release', 'win_32', 'win_32.exe'),
    ].filter(Boolean);
}

function findAgentBinary() {
    return candidatePaths().find((p) => {
        try {
            return fs.existsSync(p) && fs.statSync(p).isFile();
        } catch {
            return false;
        }
    }) || null;
}

/** Auth: create short bootstrap code for dashboard copy command. */
router.post('/bootstrap', express.json(), requireUserFast, (req, res) => {
    const pairingToken = String(req.body?.pairingToken || '').trim();
    const pairingUserId = String(req.body?.pairingUserId || '').trim();
    const sessionId = String(req.body?.sessionId || `web-${Date.now().toString(36)}`);

    if (!pairingToken || !pairingUserId) {
        return res.status(400).json({ success: false, message: 'pairingToken and pairingUserId required' });
    }

    const host = `${req.protocol}://${req.get('host')}`;
    const apiBase = String(req.body?.apiBase || host).replace(/\/$/, '');
    const gatewayUrl = String(
        req.body?.gatewayUrl
        || process.env.NEXT_PUBLIC_GATEWAY_URL
        || process.env.ZENVORA_GATEWAY_URL
        || `wss://${req.get('host')}/ws/gateway`
    );
    const downloadUrl = String(
        req.body?.downloadUrl
        || process.env.NEXT_PUBLIC_AGENT_DOWNLOAD_URL
        || `${apiBase}/api/agent/download`
    );

    const ticket = createTicket({
        userId: req.user.id,
        pairingToken,
        pairingUserId,
        sessionId,
        apiBase,
        gatewayUrl,
        downloadUrl,
    });

    const command = `irm ${apiBase}/r/${ticket.code} | iex`;

    liveLogBus.push({
        channel: 'install',
        level: 'info',
        message: `bootstrap ticket ${ticket.code} created`,
        userId: req.user.id,
        meta: { sessionId, code: ticket.code },
    });

    return res.status(200).json({
        success: true,
        code: ticket.code,
        command,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        sessionId: ticket.sessionId,
    });
});

/**
 * Stream agent EXE — avoids loading whole binary into memory (fixes download stuck).
 */
router.get('/download', (req, res) => {
    const filePath = findAgentBinary();
    if (!filePath) {
        liveLogBus.push({
            channel: 'http',
            level: 'error',
            message: 'agent download 404 — win_32.exe missing',
            route: '/api/agent/download',
        });
        return res.status(404).json({
            success: false,
            message: 'Agent binary not found. Place win_32.exe in public/downloads/.',
        });
    }

    const stat = fs.statSync(filePath);
    liveLogBus.push({
        channel: 'http',
        level: 'info',
        message: `agent download start (${stat.size} bytes)`,
        route: '/api/agent/download',
    });

    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="win_32.exe"');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
        liveLogBus.push({
            channel: 'http',
            level: 'error',
            message: `agent download stream error: ${err.message}`,
            route: '/api/agent/download',
        });
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
    });
    stream.pipe(res);
});

module.exports = router;
module.exports.getTicket = getTicket;
module.exports.buildInstallScript = buildInstallScript;
