const express = require('express');
const User = require('../models/User');
const {
    registerUser,
    loginUser,
    signUserToken,
    signWsTicket,
    verifyUserToken,
    createAgentCredential,
    listUserDevices,
    setUserAuthSession,
    clearUserAuthSession,
    AUTH_COOKIE,
    authCookieOptions,
    pairAgent
} = require('../services/authService');
const { attachUser, extractToken } = require('../middleware/auth');

const router = express.Router();

router.post('/agent/pair', async (req, res) => {
    try {
        const result = await pairAgent(req.body || {});
        return res.status(200).json({
            success: true,
            agentToken: result.agentToken,
            gatewayUrl: result.gatewayUrl
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Pairing process failed.'
        });
    }
});

router.post('/register', async (req, res) => {
    try {
        const user = await registerUser(req.body || {});
        const token = signUserToken(user);
        await setUserAuthSession(user, token);
        res.cookie(AUTH_COOKIE, token, authCookieOptions());
        return res.status(200).json({
            success: true,
            user: {
                id: String(user._id),
                email: user.email,
                name: user.name,
                role: user.role,
                pairingToken: user.pairingToken,
                pairingUserId: user.pairingUserId
            }
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Registration failed.'
        });
    }
});

router.post('/login', async (req, res) => {
    try {
        const user = await loginUser(req.body || {});
        const token = signUserToken(user);
        await setUserAuthSession(user, token);
        res.cookie(AUTH_COOKIE, token, authCookieOptions());
        return res.status(200).json({
            success: true,
            user: {
                id: String(user._id),
                email: user.email,
                name: user.name,
                role: user.role,
                pairingToken: user.pairingToken,
                pairingUserId: user.pairingUserId
            }
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Login failed.'
        });
    }
});

router.post('/logout', async (req, res) => {
    const token = extractToken(req);
    const payload = await verifyUserToken(token);
    if (payload?.sub) {
        await clearUserAuthSession(payload.sub);
    }
    res.clearCookie(AUTH_COOKIE, { ...authCookieOptions(), maxAge: 0 });
    return res.status(200).json({ success: true });
});

router.get('/me', attachUser, async (req, res) => {
    const devices = await listUserDevices(req.user.id);
    return res.status(200).json({
        success: true,
        user: req.user,
        devices: devices.map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            lastConnectedAt: d.lastConnectedAt
        }))
    });
});

/** Short-lived WS auth ticket — use when Cookie is not sent on Upgrade. */
router.get('/ws-ticket', attachUser, (req, res) => {
    const ticket = signWsTicket(req.user);
    return res.status(200).json({
        success: true,
        ticket,
        expiresIn: 120
    });
});

router.get('/agents', attachUser, async (req, res) => {
    const devices = await listUserDevices(req.user.id);
    return res.status(200).json({
        success: true,
        devices: devices.map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            lastConnectedAt: d.lastConnectedAt
        }))
    });
});

router.post('/agents', attachUser, async (req, res) => {
    try {
        const { deviceId, label } = req.body || {};
        const { credential, agentToken } = await createAgentCredential(
            req.user.id,
            deviceId,
            label
        );
        return res.status(200).json({
            success: true,
            device: {
                deviceId: credential.deviceId,
                label: credential.label
            },
            agentToken
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Could not register agent.'
        });
    }
});

router.get('/session', attachUser, async (req, res) => {
    const payload = await verifyUserToken(req.authToken || req.cookies?.[AUTH_COOKIE]);
    if (!payload?.sub) {
        return res.status(401).json({ success: false, authenticated: false });
    }

    const user = await User.findById(payload.sub).lean();
    return res.status(200).json({
        success: true,
        authenticated: true,
        user: {
            id: payload.sub,
            email: payload.email,
            name: payload.name,
            role: payload.role || user?.role || 'user',
            pages: req.user?.pages || [],
            avatarUrl: user?.avatarUrl || payload?.avatarUrl || null,
            pairingToken: user?.pairingToken || null,
            pairingUserId: user?.pairingUserId || null
        }
    });
});

module.exports = router;
