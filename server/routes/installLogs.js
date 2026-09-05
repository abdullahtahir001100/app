const express = require('express');
const router = express.Router();
const {
    resolveUserId,
    appendLog,
    getLogs,
    broadcastInstallLog,
} = require('../services/installLogService');
const { attachUser, requireUserIdOwnership } = require('../middleware/auth');

// Agent → server (public, authenticated by pairing credentials)
router.post('/', async (req, res) => {
    try {
        const pairingToken = req.body?.pairingToken || req.body?.pairToken;
        const pairingUserId = req.body?.pairingUserId || req.body?.pairUserId;
        const userId = await resolveUserId(pairingToken, pairingUserId);
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Invalid pairing credentials' });
        }

        const entry = {
            sessionId: String(req.body?.sessionId || ''),
            step: Number(req.body?.step) || 0,
            total: Number(req.body?.total) || 0,
            state: String(req.body?.state || 'running'),
            message: String(req.body?.message || ''),
            hostname: String(req.body?.hostname || ''),
            deviceId: String(req.body?.deviceId || ''),
            final: Boolean(req.body?.final),
            at: new Date().toISOString(),
        };

        appendLog(userId, entry);

        try {
            const { activeConnections } = require('../sockets/handler');
            if (activeConnections) {
                broadcastInstallLog(userId, entry, activeConnections);
            }
        } catch (_) {
            // handler may not export activeConnections yet
        }

        try {
            require('../services/liveLogBus').push({
                channel: 'install',
                level:
                    entry.state === 'fail' || entry.state === 'error'
                        ? 'error'
                        : entry.state === 'warn'
                          ? 'warn'
                          : 'info',
                message: entry.message,
                deviceId: entry.deviceId || null,
                userId,
                meta: { step: entry.step, total: entry.total, sessionId: entry.sessionId },
            });
        } catch (_) {}

        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Dashboard poll fallback
router.get('/', attachUser, requireUserIdOwnership, async (req, res) => {
    try {
        const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;
        const logs = getLogs(req.user.id, sessionId);
        res.status(200).json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, logs: [], message: error.message });
    }
});

module.exports = router;
