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
    rotateUserPairingFields,
    updateUserPairingFields,
    requestPasswordReset,
    resetPassword,
    AUTH_COOKIE,
    authCookieOptions,
    pairAgent
} = require('../services/authService');
const { attachUser, extractToken } = require('../middleware/auth');
const { jsonMsg, Z } = require('../utils/messages');
const { getConnectionRegistry } = require('../sockets/registry');
const { forceLogoutUserDashboards } = require('../sockets/fanout');

const router = express.Router();

function kickOtherSessions(userId) {
    try {
        const registry = getConnectionRegistry();
        forceLogoutUserDashboards(registry, userId, 'session_replaced');
    } catch (_) {
        // registry may be unavailable during early boot
    }
}

router.post('/agent/pair', async (req, res) => {
    try {
        const result = await pairAgent(req.body || {}, req);
        return res.status(200).json({
            success: true,
            agentToken: result.agentToken,
            gatewayUrl: result.gatewayUrl
        });
    } catch (error) {
        return jsonMsg(res, error.status || 500, Z.PAIR_FAILED, error.message);
    }
});

router.post('/register', async (req, res) => {
    try {
        const user = await registerUser(req.body || {});
        const token = signUserToken(user);
        await setUserAuthSession(user, token);
        kickOtherSessions(String(user._id));
        res.cookie(AUTH_COOKIE, token, authCookieOptions());
        return res.status(200).json({
            success: true,
            code: 202,
            message: '[ZENVORA-202] Account created',
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
        return jsonMsg(res, error.status || 500, Z.REGISTER_FAILED, error.message);
    }
});

router.post('/login', async (req, res) => {
    try {
        const user = await loginUser(req.body || {});
        const token = signUserToken(user);
        await setUserAuthSession(user, token);
        kickOtherSessions(String(user._id));
        res.cookie(AUTH_COOKIE, token, authCookieOptions());
        return res.status(200).json({
            success: true,
            code: 201,
            message: '[ZENVORA-201] Signed in successfully',
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
        return jsonMsg(res, error.status || 500, Z.AUTH_FAILED, error.message);
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const result = await requestPasswordReset(req.body?.email);
        return res.status(200).json({
            success: true,
            code: 308,
            message: result.message || '[ZENVORA-308] New code sent',
        });
    } catch (error) {
        return jsonMsg(res, error.status || 500, Z.AUTH_FAILED, error.message);
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        await resetPassword(req.body?.email, req.body?.otp, req.body?.newPassword);
        return res.status(200).json({
            success: true,
            code: 203,
            message: '[ZENVORA-203] Verification successful',
        });
    } catch (error) {
        return jsonMsg(res, error.status || 500, Z.AUTH_FAILED, error.message);
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
function issueWsTicket(req, res) {
    const ticket = signWsTicket(req.user);
    return res.status(200).json({
        success: true,
        ticket,
        expiresIn: 120
    });
}

router.get('/ws-ticket', attachUser, issueWsTicket);
router.post('/ws-ticket', attachUser, issueWsTicket);

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
        return res.status(401).json({
            success: false,
            authenticated: false,
            code: 310,
            reason: 'session_invalid',
            message: 'Signed in elsewhere — this session was closed.',
        });
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

/** Rotate pairing token + pairing user id (agent re-pair required after). */
router.post('/pairing/rotate', attachUser, async (req, res) => {
    try {
        const user = await rotateUserPairingFields(req.user.id);
        return res.status(200).json({
            success: true,
            code: 206,
            message: '[ZENVORA-206] Pairing credentials rotated',
            user: {
                id: String(user._id),
                pairingToken: user.pairingToken,
                pairingUserId: user.pairingUserId,
            },
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Could not rotate pairing credentials.',
        });
    }
});

/** Manually set pairing token / pairing user id (unique). */
router.put('/pairing', attachUser, async (req, res) => {
    try {
        const user = await updateUserPairingFields(req.user.id, req.body || {});
        return res.status(200).json({
            success: true,
            code: 207,
            message: '[ZENVORA-207] Pairing credentials updated',
            user: {
                id: String(user._id),
                pairingToken: user.pairingToken,
                pairingUserId: user.pairingUserId,
            },
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Could not update pairing credentials.',
        });
    }
});

module.exports = router;
