const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Permission = require('../models/Permission');
const Device = require('../models/Device');
const AgentCredential = require('../models/AgentCredential');
const { attachUser, requireAdmin } = require('../middleware/auth');
const { getConnectionRegistry } = require('../sockets/registry');

router.use(attachUser, requireAdmin);

/** Coerce Mongo / lean values to a finite 0–100 metric (or null). */
function metricPercent(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(100, value));
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
    }
    return null;
}

async function ensurePermissionDoc(user) {
    let doc = await Permission.findOne({ userId: user._id });
    if (!doc) {
        doc = await Permission.create({
            userId: user._id,
            pages: Permission.defaultsForRole(user.role),
        });
    }
    return doc;
}

router.get('/stats', async (_req, res) => {
    try {
        const [users, devices, credentials] = await Promise.all([
            User.countDocuments(),
            Device.countDocuments(),
            AgentCredential.countDocuments(),
        ]);

        let agentsOnline = 0;
        try {
            const registry = getConnectionRegistry();
            for (const key of registry.keys()) {
                if (key.startsWith('AGENT_') || key.startsWith('DEVICE_')) agentsOnline += 1;
            }
        } catch (_) {}

        res.json({
            success: true,
            stats: {
                totalUsers: users,
                totalDevices: devices,
                credentials,
                agentsOnline,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/users', async (_req, res) => {
    try {
        const users = await User.find({})
            .select('name email role provider lastLoginAt createdAt avatarUrl')
            .sort({ createdAt: -1 })
            .lean();

        const perms = await Permission.find({
            userId: { $in: users.map((u) => u._id) },
        }).lean();
        const byUser = new Map(perms.map((p) => [String(p.userId), p.pages]));

        res.json({
            success: true,
            users: users.map((u) => ({
                ...u,
                id: String(u._id),
                provider: u.provider || 'local',
                pages: byUser.get(String(u._id)) || Permission.defaultsForRole(u.role),
            })),
            pageKeys: Permission.PAGE_KEYS,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/users/:id/role', async (req, res) => {
    try {
        const role = String(req.body?.role || '').trim();
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ success: false, message: 'role must be admin or user' });
        }
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { role },
            { new: true }
        ).select('name email role');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const perm = await ensurePermissionDoc(user);
        if (role === 'admin') {
            perm.pages = Permission.defaultsForRole('admin');
            await perm.save();
        }

        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/permissions/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('name email role');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const perm = await ensurePermissionDoc(user);
        res.json({
            success: true,
            user: {
                id: String(user._id),
                name: user.name,
                email: user.email,
                role: user.role,
            },
            pages: perm.pages,
            pageKeys: Permission.PAGE_KEYS,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/permissions/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('name email role');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const incoming = Array.isArray(req.body?.pages) ? req.body.pages.map(String) : [];
        const allowed = new Set(Permission.PAGE_KEYS);
        const pages = [...new Set(incoming.filter((p) => allowed.has(p)))];

        const perm = await ensurePermissionDoc(user);
        perm.pages = pages.length ? pages : Permission.defaultsForRole(user.role);
        await perm.save();

        res.json({
            success: true,
            user: {
                id: String(user._id),
                name: user.name,
                email: user.email,
                role: user.role,
            },
            pages: perm.pages,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/devices', async (_req, res) => {
    try {
        const [devices, credentials] = await Promise.all([
            Device.find({}).sort({ updatedAt: -1 }).limit(500).lean(),
            AgentCredential.find({}).sort({ updatedAt: -1 }).limit(500).lean(),
        ]);

        const online = new Set();
        try {
            const registry = getConnectionRegistry();
            for (const key of registry.keys()) {
                if (key.startsWith('AGENT_')) online.add(key.slice('AGENT_'.length));
                if (key.startsWith('DEVICE_')) online.add(key.slice('DEVICE_'.length));
            }
        } catch (_) {}

        const byId = new Map();
        for (const d of devices) {
            byId.set(String(d.deviceId), {
                deviceId: d.deviceId,
                userId: String(d.userId || ''),
                hostname: d.hostname || d.deviceId,
                platform: d.platform,
                status: online.has(String(d.deviceId)) ? 'online' : (d.status || 'offline'),
                lastSeen: d.lastSeen || d.updatedAt,
                battery: metricPercent(d.battery),
                storage: metricPercent(d.storage),
            });
        }
        for (const c of credentials) {
            const id = String(c.deviceId);
            if (!byId.has(id)) {
                byId.set(id, {
                    deviceId: id,
                    userId: String(c.userId || ''),
                    hostname: c.label || id,
                    platform: 'unknown',
                    status: online.has(id) ? 'online' : 'offline',
                    lastSeen: c.updatedAt,
                    battery: null,
                    storage: null,
                });
            }
        }

        res.json({ success: true, devices: [...byId.values()] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
