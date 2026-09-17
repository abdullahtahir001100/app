const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Permission = require('../models/Permission');
const Device = require('../models/Device');
const AgentCredential = require('../models/AgentCredential');
const VirtualFile = require('../models/VirtualFile');
const ActivityLog = require('../models/ActivityLog');
const UserAuditLog = require('../models/UserAuditLog');
const BlockedIp = require('../models/BlockedIp');
const { attachUser, requireAdmin } = require('../middleware/auth');
const { refreshBlockedIpsCache } = require('../middleware/security');
const { getConnectionRegistry } = require('../sockets/registry');
const { forceLogoutUserDashboards } = require('../sockets/fanout');
const { overlayDeviceStatus } = require('../services/androidBeat');
const { isMysql, getMysqlAdapter, getActiveProvider } = require('../db/DatabaseFactory');
const { testMysqlConnection } = require('../db/mysql/connection');
const {
    getAdminSettings,
    updateAdminSettings,
    toggleDeviceCloudinary,
} = require('../services/adminSettingsService');

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
        let users = 0;
        let devices = 0;
        let credentials = 0;

        if (isMysql()) {
            const adapter = getMysqlAdapter();
            const pool = await adapter.getPool();
            const [uRows] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
            const [dRows] = await pool.query('SELECT COUNT(*) AS cnt FROM devices');
            const [cRows] = await pool.query('SELECT COUNT(*) AS cnt FROM agent_credentials');
            users = Number(uRows[0]?.cnt || 0);
            devices = Number(dRows[0]?.cnt || 0);
            credentials = Number(cRows[0]?.cnt || 0);
        } else {
            const [uCount, dCount, cCount] = await Promise.all([
                User.countDocuments(),
                Device.countDocuments(),
                AgentCredential.countDocuments(),
            ]);
            users = uCount;
            devices = dCount;
            credentials = cCount;
        }

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
        if (isMysql()) {
            const adapter = getMysqlAdapter();
            const users = await adapter.listAllUsers();
            const perms = await adapter.listAllPermissions();
            const byUser = new Map(perms.map((p) => [String(p.userId), p.pages]));

            return res.json({
                success: true,
                users: users.map((u) => ({
                    ...u,
                    id: String(u.id || u._id),
                    provider: u.provider || 'local',
                    pages: byUser.get(String(u.id || u._id)) || Permission.defaultsForRole(u.role),
                })),
                pageKeys: Permission.PAGE_KEYS,
                pageLabels: Permission.PAGE_LABELS || {},
            });
        }

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
            pageLabels: Permission.PAGE_LABELS || {},
            proNormalPages: Permission.PRO_NORMAL_PAGES,
            proPlusPages: Permission.PRO_PLUS_PAGES,
            defaultUserPages: Permission.DEFAULT_USER_PAGES,
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

        if (isMysql()) {
            const adapter = getMysqlAdapter();
            const user = await adapter.findUserById(req.params.id);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            const updated = await adapter.updateUser(user.id || user._id, { role });
            if (role === 'admin') {
                await adapter.savePermission(user.id || user._id, Permission.defaultsForRole('admin'));
            }
            return res.json({ success: true, user: updated });
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

/**
 * GET /api/admin/online-users
 * Returns live online users, web session status, blocking status, and active page.
 */
router.get('/online-users', async (_req, res) => {
    try {
        const users = await User.find({})
            .select('name email role provider isBlocked blockedReason blockedAt blockedBy loginCount failedLoginCount lastFailedLoginAt lastLoginIp lastActiveAt currentPage createdAt avatarUrl')
            .sort({ lastActiveAt: -1 })
            .lean();

        const registry = getConnectionRegistry();
        const activeWebUserIds = new Set();
        try {
            for (const [key, socket] of registry.entries()) {
                if (key.startsWith('DASHBOARD_') && socket?.authContext?.userId) {
                    activeWebUserIds.add(String(socket.authContext.userId));
                }
            }
        } catch (_) {}

        // Gather device counts per user
        const deviceCounts = await Device.aggregate([
            { $match: { userId: { $ne: null } } },
            { $group: { _id: '$userId', count: { $sum: 1 } } }
        ]);
        const deviceCountMap = new Map(deviceCounts.map((d) => [String(d._id), d.count]));

        const credentialCounts = await AgentCredential.aggregate([
            { $match: { userId: { $ne: null } } },
            { $group: { _id: '$userId', count: { $sum: 1 } } }
        ]);
        for (const c of credentialCounts) {
            const current = deviceCountMap.get(String(c._id)) || 0;
            if (c.count > current) deviceCountMap.set(String(c._id), c.count);
        }

        const now = Date.now();
        const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // Active within last 3 minutes

        let onlineCount = 0;
        let blockedCount = 0;

        const enrichedUsers = users.map((u) => {
            const uid = String(u._id);
            const lastActiveTs = u.lastActiveAt ? new Date(u.lastActiveAt).getTime() : 0;
            const isSocketOnline = activeWebUserIds.has(uid);
            const isRecentActive = lastActiveTs > 0 && (now - lastActiveTs) < ONLINE_THRESHOLD_MS;
            const isOnline = isSocketOnline || isRecentActive;

            if (isOnline) onlineCount++;
            if (u.isBlocked) blockedCount++;

            return {
                id: uid,
                name: u.name || 'User',
                email: u.email,
                role: u.role || 'user',
                provider: u.provider || 'local',
                isOnline,
                isBlocked: !!u.isBlocked,
                blockedReason: u.blockedReason || '',
                blockedAt: u.blockedAt || null,
                blockedBy: u.blockedBy || '',
                currentPage: u.currentPage || '',
                lastActiveAt: u.lastActiveAt || u.createdAt,
                lastLoginIp: u.lastLoginIp || '',
                loginCount: u.loginCount || 0,
                failedLoginCount: u.failedLoginCount || 0,
                lastFailedLoginAt: u.lastFailedLoginAt || null,
                devicesCount: deviceCountMap.get(uid) || 0,
                avatarUrl: u.avatarUrl || '',
                createdAt: u.createdAt
            };
        });

        return res.json({
            success: true,
            totalUsers: users.length,
            onlineCount,
            blockedCount,
            users: enrichedUsers
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/admin/users/:id/block
 * Blocks a user, invalidates all sessions, forces immediate WebSocket logout, and audits event.
 */
router.post('/users/:id/block', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const reason = String(req.body?.reason || 'Account blocked by administrator').trim();

        // Safety: Do not allow admin to block themselves
        if (String(req.user.id) === String(targetUserId)) {
            return res.status(400).json({ success: false, message: 'You cannot block your own account.' });
        }

        const user = await User.findById(targetUserId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        user.isBlocked = true;
        user.blockedReason = reason;
        user.blockedAt = new Date();
        user.blockedBy = req.user.email || 'Admin';
        user.authTokenHash = ''; // Revoke current session token
        await user.save();

        // Force terminate active dashboard sessions
        try {
            const registry = getConnectionRegistry();
            forceLogoutUserDashboards(registry, targetUserId, 'account_blocked');
        } catch (_) {}

        // Log audit event
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
        await UserAuditLog.create({
            userId: user._id,
            email: user.email,
            eventType: 'account_blocked',
            ip,
            status: 'warning',
            reason,
            metadata: { blockedBy: req.user.email }
        });

        return res.json({
            success: true,
            message: `User ${user.email} has been blocked and active sessions were terminated.`,
            user: {
                id: String(user._id),
                email: user.email,
                isBlocked: true,
                blockedReason: reason
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/admin/users/:id/unblock
 * Unblocks a user and restores their ability to sign in.
 */
router.post('/users/:id/unblock', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const user = await User.findById(targetUserId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        user.isBlocked = false;
        user.blockedReason = '';
        user.blockedAt = null;
        user.blockedBy = '';
        await user.save();

        // Log audit event
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
        await UserAuditLog.create({
            userId: user._id,
            email: user.email,
            eventType: 'account_unblocked',
            ip,
            status: 'success',
            reason: 'Account unblocked by administrator',
            metadata: { unblockedBy: req.user.email }
        });

        return res.json({
            success: true,
            message: `User ${user.email} has been unblocked.`,
            user: {
                id: String(user._id),
                email: user.email,
                isBlocked: false
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/admin/users/:id
 * Permanently deletes a user and associated data.
 */
router.delete('/users/:id', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        if (String(req.user.id) === String(targetUserId)) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
        }

        const user = await User.findById(targetUserId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Kick all active sessions
        try {
            const registry = getConnectionRegistry();
            forceLogoutUserDashboards(registry, targetUserId, 'account_deleted');
        } catch (_) {}

        await Promise.all([
            User.findByIdAndDelete(targetUserId),
            Permission.deleteMany({ userId: targetUserId }),
            AgentCredential.deleteMany({ userId: targetUserId })
        ]);

        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
        await UserAuditLog.create({
            userId: targetUserId,
            email: user.email,
            eventType: 'account_deleted',
            ip,
            status: 'warning',
            reason: 'Account deleted by admin',
            metadata: { deletedBy: req.user.email }
        });

        return res.json({ success: true, message: `User ${user.email} permanently deleted.` });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/admin/users/:id/audit
 * Returns deep-dive audit logs (login attempts, page visits, dwell time, and user devices).
 */
router.get('/users/:id/audit', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const user = await User.findById(targetUserId)
            .select('name email role provider isBlocked blockedReason blockedAt blockedBy loginCount failedLoginCount lastFailedLoginAt lastLoginIp lastActiveAt currentPage createdAt avatarUrl')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Fetch audit logs for this user
        const logs = await UserAuditLog.find({
            $or: [
                { userId: targetUserId },
                { email: user.email }
            ]
        })
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        // Fetch all devices associated with this user
        const [devices, credentials] = await Promise.all([
            Device.find({ userId: targetUserId }).sort({ lastSeen: -1 }).lean(),
            AgentCredential.find({ userId: targetUserId }).sort({ updatedAt: -1 }).lean()
        ]);

        const registry = getConnectionRegistry();
        const onlineDevices = new Set();
        try {
            for (const key of registry.keys()) {
                if (key.startsWith('AGENT_')) onlineDevices.add(key.slice('AGENT_'.length));
                if (key.startsWith('DEVICE_')) onlineDevices.add(key.slice('DEVICE_'.length));
            }
        } catch (_) {}

        const devicesMap = new Map();
        for (const d of devices) {
            const devId = String(d.deviceId);
            devicesMap.set(devId, {
                deviceId: devId,
                hostname: d.hostname || devId,
                platform: d.platform || 'unknown',
                status: overlayDeviceStatus(devId, d.platform, d.lastAndroidBeatAt, onlineDevices.has(devId), registry),
                lastSeen: d.lastSeen || d.updatedAt,
                publicIp: d.publicIp || '',
                localIp: d.localIp || '',
                battery: metricPercent(d.battery),
                storage: metricPercent(d.storage),
                osVersion: d.osVersion || '',
                cpu: d.cpu || '',
                ram: d.ram || null
            });
        }

        for (const c of credentials) {
            const devId = String(c.deviceId);
            if (!devicesMap.has(devId)) {
                devicesMap.set(devId, {
                    deviceId: devId,
                    hostname: c.label || devId,
                    platform: 'unknown',
                    status: onlineDevices.has(devId) ? 'online' : 'offline',
                    lastSeen: c.lastConnectedAt || c.updatedAt,
                    publicIp: '',
                    localIp: '',
                    battery: null,
                    storage: null,
                    osVersion: '',
                    cpu: '',
                    ram: null
                });
            }
        }

        // Aggregate stats
        const loginSuccesses = logs.filter((l) => l.eventType === 'login_success').length;
        const loginFailures = logs.filter((l) => l.eventType === 'login_failure').length;
        const pageVisits = logs.filter((l) => l.eventType === 'page_visit' || l.eventType === 'page_dwell');
        const totalDwellSeconds = pageVisits.reduce((sum, l) => sum + (l.dwellSeconds || 0), 0);

        return res.json({
            success: true,
            user: {
                ...user,
                id: String(user._id),
                loginSuccessCount: loginSuccesses || user.loginCount || 0,
                loginFailureCount: loginFailures || user.failedLoginCount || 0,
                totalDwellSeconds
            },
            logs: logs.map((l) => ({
                id: String(l._id),
                eventType: l.eventType,
                page: l.page || '',
                pageTitle: l.pageTitle || '',
                dwellSeconds: l.dwellSeconds || 0,
                ip: l.ip || '',
                userAgent: l.userAgent || '',
                status: l.status || 'info',
                reason: l.reason || '',
                timestamp: l.createdAt
            })),
            devices: Array.from(devicesMap.values())
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/permissions/:userId', async (req, res) => {
    try {
        let user;
        let pages;

        if (isMysql()) {
            const adapter = getMysqlAdapter();
            user = await adapter.findUserById(req.params.userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            const perm = await adapter.findPermissionByUser(user.id || user._id);
            pages = perm?.pages?.length ? perm.pages : Permission.defaultsForRole(user.role);
        } else {
            user = await User.findById(req.params.userId).select('name email role');
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            const perm = await ensurePermissionDoc(user);
            pages = perm.pages;
        }

        res.json({
            success: true,
            user: {
                id: String(user.id || user._id),
                name: user.name,
                email: user.email,
                role: user.role,
            },
            pages,
            pageKeys: Permission.PAGE_KEYS,
            pageLabels: Permission.PAGE_LABELS || {},
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/permissions/:userId', async (req, res) => {
    try {
        let user;
        let savedPages;
        const incoming = Array.isArray(req.body?.pages) ? req.body.pages.map(String) : [];
        const allowed = new Set(Permission.PAGE_KEYS);
        const pages = [...new Set(incoming.filter((p) => allowed.has(p)))];

        if (isMysql()) {
            const adapter = getMysqlAdapter();
            user = await adapter.findUserById(req.params.userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            savedPages = pages.length ? pages : Permission.defaultsForRole(user.role);
            await adapter.savePermission(user.id || user._id, savedPages);
        } else {
            user = await User.findById(req.params.userId).select('name email role');
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            const perm = await ensurePermissionDoc(user);
            perm.pages = pages.length ? pages : Permission.defaultsForRole(user.role);
            await perm.save();
            savedPages = perm.pages;
        }

        res.json({
            success: true,
            user: {
                id: String(user.id || user._id),
                name: user.name,
                email: user.email,
                role: user.role,
            },
            pages: savedPages,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Bulk Grant: Grant pages or all PRO / PRO+ features to all registered users in a single click
router.post('/permissions/bulk-grant', async (req, res) => {
    try {
        const { pages: incomingPages, grantAllPro = false, tier } = req.body || {};
        let targetPages = [];

        if (tier === 'pro' || tier === 'normal') {
            targetPages = Permission.PRO_NORMAL_PAGES;
        } else if (tier === 'pro_plus' || tier === 'premium' || grantAllPro) {
            targetPages = Permission.PRO_PLUS_PAGES;
        } else if (Array.isArray(incomingPages)) {
            const allowed = new Set(Permission.PAGE_KEYS);
            targetPages = [...new Set(incomingPages.filter((p) => allowed.has(p) && p !== 'admin' && p !== 'devices.any'))];
        }

        if (targetPages.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid capability pages specified to grant.' });
        }

        let updatedCount = 0;
        if (isMysql()) {
            const adapter = getMysqlAdapter();
            const users = await adapter.listAllUsers();
            for (const u of users) {
                if (u.role === 'admin') continue;
                const existingPerm = await adapter.findPermissionByUser(u.id || u._id);
                const currentPages = new Set(existingPerm?.pages || Permission.defaultsForRole(u.role));
                targetPages.forEach((p) => currentPages.add(p));
                await adapter.savePermission(u.id || u._id, [...currentPages]);
                updatedCount++;
            }
        } else {
            const users = await User.find({ role: { $ne: 'admin' } }).select('_id role').lean();
            for (const u of users) {
                const doc = await ensurePermissionDoc(u);
                const currentPages = new Set(doc.pages || Permission.defaultsForRole(u.role));
                targetPages.forEach((p) => currentPages.add(p));
                doc.pages = [...currentPages];
                await doc.save();
                updatedCount++;
            }
        }

        return res.json({
            success: true,
            message: `Successfully granted ${targetPages.length} permissions to all ${updatedCount} users in 1 click.`,
            updatedCount,
            pagesGranted: targetPages,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Bulk Reset: Reset all non-admin users back to free tier defaults in a single click
router.post('/permissions/bulk-reset', async (_req, res) => {
    try {
        const defaultFree = Permission.DEFAULT_USER_PAGES;
        let resetCount = 0;

        if (isMysql()) {
            const adapter = getMysqlAdapter();
            const users = await adapter.listAllUsers();
            for (const u of users) {
                if (u.role === 'admin') continue;
                await adapter.savePermission(u.id || u._id, [...defaultFree]);
                resetCount++;
            }
        } else {
            const users = await User.find({ role: { $ne: 'admin' } }).select('_id role').lean();
            for (const u of users) {
                const doc = await ensurePermissionDoc(u);
                doc.pages = [...defaultFree];
                await doc.save();
                resetCount++;
            }
        }

        return res.json({
            success: true,
            message: `Successfully reset all ${resetCount} users to default Free Tier permissions.`,
            resetCount,
            pages: defaultFree,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/devices', async (_req, res) => {
    try {
        let devices = [];
        let credentials = [];

        if (isMysql()) {
            const adapter = getMysqlAdapter();
            [devices, credentials] = await Promise.all([
                adapter.listDevices({}, { limit: 500 }),
                adapter.listAllAgentCredentials(500),
            ]);
        } else {
            [devices, credentials] = await Promise.all([
                Device.find({}).sort({ updatedAt: -1 }).limit(500).lean(),
                AgentCredential.find({}).sort({ updatedAt: -1 }).limit(500).lean(),
            ]);
        }

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
                status: overlayDeviceStatus(String(d.deviceId), d.platform, d.lastAndroidBeatAt, online.has(String(d.deviceId)), getConnectionRegistry()),
                lastSeen: d.lastSeen || d.updatedAt,
                battery: metricPercent(d.battery),
                storage: metricPercent(d.storage),
                cloudinaryEnabled: d.cloudinaryEnabled !== false,
            });
        }
        // Only include actual registered devices from the database
        res.json({ success: true, devices: [...byId.values()] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Toggle Cloudinary media upload per device
router.patch('/devices/:deviceId/cloudinary', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const enabled = req.body?.enabled !== false;
        const result = await toggleDeviceCloudinary(deviceId, enabled);
        res.json({
            success: true,
            deviceId: result.deviceId,
            cloudinaryEnabled: result.cloudinaryEnabled,
            message: `Cloudinary storage for device "${deviceId}" set to ${result.cloudinaryEnabled ? 'ON' : 'OFF'}.`,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get Database Management & Admin Sync settings
router.get('/security/database-sync', async (_req, res) => {
    try {
        const settings = await getAdminSettings();
        res.json({
            success: true,
            settings,
            activeProvider: getActiveProvider(),
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update Database Management & Admin Sync settings
router.post('/security/database-sync', async (req, res) => {
    try {
        const {
            syncToAdminDbEnabled,
            excludedDeviceIds,
            adminDbProvider,
            adminDbConfig,
        } = req.body || {};

        const updated = await updateAdminSettings({
            syncToAdminDbEnabled: syncToAdminDbEnabled !== undefined ? Boolean(syncToAdminDbEnabled) : true,
            excludedDeviceIds: Array.isArray(excludedDeviceIds) ? excludedDeviceIds : [],
            adminDbProvider: adminDbProvider || 'mongo',
            adminDbConfig: adminDbConfig || {},
        });

        res.json({
            success: true,
            settings: updated,
            message: 'Database management & sync policies updated successfully.',
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Test Admin Master DB Connection (Mongo or MySQL)
router.post('/security/test-admin-db', async (req, res) => {
    try {
        const { provider = 'mongo', config = {} } = req.body || {};
        if (provider === 'mysql') {
            const testResult = await testMysqlConnection(config);
            return res.json(testResult);
        }

        // Test MongoDB
        const uri = String(config.mongodbUri || config.uri || '').trim();
        if (!uri) {
            return res.json({ success: false, error: 'MongoDB Connection URI is required.' });
        }
        const start = Date.now();
        const mongoose = require('mongoose');
        const tempConn = mongoose.createConnection(uri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });
        await tempConn.asPromise();
        if (tempConn.readyState === 1 && tempConn.db) {
            await tempConn.db.admin().ping();
        }
        const latencyMs = Date.now() - start;
        const dbName = tempConn.name || 'zenvora';
        const host = tempConn.host || 'cluster';
        await tempConn.close();

        return res.json({
            success: true,
            latencyMs,
            dbName,
            host,
            message: `✓ Connected to MongoDB database "${dbName}" (${latencyMs}ms ping)!`,
        });
    } catch (err) {
        return res.json({
            success: false,
            error: `Connection Failed: ${err.message || String(err)}`,
        });
    }
});

// 1. Get Users who configured APIs / Keys
router.get('/security/api-users', async (_req, res) => {
    try {
        const users = await User.find({})
            .select('name email role avatarUrl createdAt lastActiveAt')
            .lean();

        const [credentials, devices] = await Promise.all([
            AgentCredential.find({}).lean(),
            Device.find({ cloudinaryEnabled: true }).lean()
        ]);

        const credsByUser = new Map();
        for (const c of credentials) {
            const uid = String(c.userId);
            if (!credsByUser.has(uid)) credsByUser.set(uid, []);
            credsByUser.get(uid).push(c.deviceId);
        }

        const cloudinaryUsers = new Set(devices.map((d) => String(d.userId)));

        const apiUsers = users.map((u) => {
            const uid = String(u._id);
            const userCreds = credsByUser.get(uid) || [];
            const hasCloudinary = cloudinaryUsers.has(uid);

            const configuredApis = [];
            if (userCreds.length > 0) {
                configuredApis.push({
                    name: 'Agent Nodes Token',
                    type: 'agent_key',
                    count: userCreds.length,
                    status: 'active'
                });
            }
            if (hasCloudinary) {
                configuredApis.push({
                    name: 'Cloudinary Media Storage',
                    type: 'cloudinary',
                    count: 1,
                    status: 'active'
                });
            }
            configuredApis.push({
                name: 'Zenvora Multi-LLM Gateway',
                type: 'ai_pilot',
                providers: ['Gemini', 'OpenAI', 'Claude', 'Grok', 'DeepSeek', 'OpenRouter'],
                status: 'active'
            });

            return {
                id: uid,
                name: u.name || 'User',
                email: u.email,
                role: u.role || 'user',
                avatarUrl: u.avatarUrl || '',
                apis: configuredApis,
                agentKeysCount: userCreds.length,
                lastActiveAt: u.lastActiveAt || u.createdAt,
            };
        });

        res.json({ success: true, apiUsers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Blocked IPs Management
router.get('/security/blocked-ips', async (_req, res) => {
    try {
        const blocked = await BlockedIp.find({ status: 'active' })
            .sort({ createdAt: -1 })
            .lean();
        res.json({
            success: true,
            blockedIPs: blocked.map(b => ({
                id: String(b._id),
                ip: b.ip,
                reason: b.reason,
                blockedBy: b.blockedBy,
                attempts: b.attempts || 1,
                date: b.createdAt
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/security/blocked-ips', async (req, res) => {
    try {
        const ip = String(req.body?.ip || '').trim();
        const reason = String(req.body?.reason || 'Suspicious network activity').trim();

        if (!ip) {
            return res.status(400).json({ success: false, message: 'Valid IP address is required.' });
        }

        const doc = await BlockedIp.findOneAndUpdate(
            { ip },
            {
                ip,
                reason,
                blockedBy: req.user.email || 'Admin',
                status: 'active',
                $inc: { attempts: 1 }
            },
            { upsert: true, new: true }
        );

        refreshBlockedIpsCache();

        await UserAuditLog.create({
            email: req.user.email || 'admin@zenvora',
            eventType: 'ip_blocked',
            ip,
            status: 'warning',
            reason: `IP ${ip} was added to blocklist: ${reason}`,
            metadata: { blockedBy: req.user.email }
        }).catch(() => {});

        res.json({ success: true, message: `IP ${ip} blocked successfully.`, blockedIp: doc });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/security/blocked-ips/:id/unblock', async (req, res) => {
    try {
        const doc = await BlockedIp.findByIdAndUpdate(
            req.params.id,
            { status: 'unblocked' },
            { new: true }
        );

        refreshBlockedIpsCache();

        if (doc) {
            await UserAuditLog.create({
                email: req.user.email || 'admin@zenvora',
                eventType: 'ip_unblocked',
                ip: doc.ip,
                status: 'success',
                reason: `IP ${doc.ip} was unblocked.`,
                metadata: { unblockedBy: req.user.email }
            }).catch(() => {});
        }

        res.json({ success: true, message: 'IP unblocked successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/security/blocked-ips/:id', async (req, res) => {
    try {
        const doc = await BlockedIp.findByIdAndDelete(req.params.id);
        refreshBlockedIpsCache();
        res.json({ success: true, message: 'IP record removed.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. Real Security Alerts (Login failures, successes, registrations, and blocks)
router.get('/security/alerts', async (req, res) => {
    try {
        const filterType = String(req.query?.filter || req.query?.type || 'all').toLowerCase();
        let query = {};

        if (filterType === 'failures' || filterType === 'failed_login') {
            query.eventType = 'login_failure';
        } else if (filterType === 'successful_login') {
            query.eventType = 'login_success';
        } else if (filterType === 'logins') {
            query.eventType = { $in: ['login_success', 'login_failure'] };
        } else if (filterType === 'registrations' || filterType === 'user_registered') {
            query.eventType = 'user_registered';
        } else if (filterType === 'blocks' || filterType === 'ip_blocked') {
            query.eventType = { $in: ['account_blocked', 'account_unblocked', 'ip_blocked', 'ip_unblocked'] };
        } else {
            query.eventType = {
                $in: [
                    'login_failure',
                    'login_success',
                    'user_registered',
                    'account_blocked',
                    'account_unblocked',
                    'account_deleted',
                    'ip_blocked',
                    'ip_unblocked'
                ]
            };
        }

        const logs = await UserAuditLog.find(query)
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        const alerts = logs.map((log) => {
            let level = 'info';
            let title = 'Security Event';

            if (log.eventType === 'login_failure') {
                level = 'critical';
                title = 'Failed Login Attempt';
            } else if (log.eventType === 'login_success') {
                level = 'success';
                title = 'Successful Sign-in';
            } else if (log.eventType === 'user_registered') {
                level = 'info';
                title = 'New User Registration';
            } else if (log.eventType === 'account_blocked' || log.eventType === 'ip_blocked') {
                level = 'warning';
                title = log.eventType === 'account_blocked' ? 'Account Blocked' : 'IP Address Blocked';
            } else if (log.eventType === 'account_unblocked' || log.eventType === 'ip_unblocked') {
                level = 'info';
                title = log.eventType === 'account_unblocked' ? 'Account Unblocked' : 'IP Unblocked';
            }

            return {
                id: String(log._id),
                level,
                title,
                eventType: log.eventType,
                email: log.email,
                ip: log.ip,
                description: log.reason || `${title} for ${log.email || log.ip || 'user'}`,
                userAgent: log.userAgent,
                timestamp: log.createdAt
            };
        });

        res.json({ success: true, alerts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Storage Analytics & Logs (Cloudinary & Database breakdown per user & device)
router.get('/storage-analytics', async (_req, res) => {
    try {
        if (isMysql()) {
            const pool = await getMysqlAdapter().getPool();

            // Cloudinary stats per device
            const [deviceFileStats] = await pool.query(`
                SELECT device_id, COUNT(*) AS file_count, COALESCE(SUM(size), 0) AS total_bytes
                FROM virtual_files WHERE is_deleted = 0 GROUP BY device_id
            `);
            const devFileMap = new Map(deviceFileStats.map((r) => [String(r.device_id), {
                files: Number(r.file_count || 0),
                bytes: Number(r.total_bytes || 0),
            }]));

            // Cloudinary stats per user
            const [userFileStats] = await pool.query(`
                SELECT user_id, COUNT(*) AS file_count, COALESCE(SUM(size), 0) AS total_bytes
                FROM virtual_files WHERE is_deleted = 0 GROUP BY user_id
            `);
            const userFileMap = new Map(userFileStats.map((r) => [String(r.user_id), {
                files: Number(r.file_count || 0),
                bytes: Number(r.total_bytes || 0),
            }]));

            // Global totals
            const [totalFilesRow] = await pool.query(`
                SELECT COUNT(*) AS total_files, COALESCE(SUM(size), 0) AS total_bytes
                FROM virtual_files WHERE is_deleted = 0
            `);

            // DB Record Counts
            const [uC] = await pool.query('SELECT COUNT(*) as c FROM users');
            const [dC] = await pool.query('SELECT COUNT(*) as c FROM devices');
            const [fC] = await pool.query('SELECT COUNT(*) as c FROM virtual_files');
            const [aC] = await pool.query('SELECT COUNT(*) as c FROM activity_logs');
            const [bC] = await pool.query('SELECT COUNT(*) as c FROM browser_histories');
            const [apC] = await pool.query('SELECT COUNT(*) as c FROM app_histories');
            const [cC] = await pool.query('SELECT COUNT(*) as c FROM contacts');
            const [sC] = await pool.query('SELECT COUNT(*) as c FROM sms_messages');
            const [clC] = await pool.query('SELECT COUNT(*) as c FROM call_logs');

            const totalDbRecords = Number(uC[0]?.c || 0) + Number(dC[0]?.c || 0) +
                Number(fC[0]?.c || 0) + Number(aC[0]?.c || 0) + Number(bC[0]?.c || 0) +
                Number(apC[0]?.c || 0) + Number(cC[0]?.c || 0) + Number(sC[0]?.c || 0) +
                Number(clC[0]?.c || 0);

            // Users and devices for mapping
            const [users] = await pool.query('SELECT _id, id, name, email FROM users ORDER BY created_at DESC');
            const [devices] = await pool.query('SELECT device_id, user_id, hostname, platform, cloudinary_enabled FROM devices');

            const userDevCount = new Map();
            for (const d of devices) {
                const uid = String(d.user_id || '');
                userDevCount.set(uid, (userDevCount.get(uid) || 0) + 1);
            }

            const userStorage = users.map((u) => {
                const uid = String(u._id || u.id);
                const fileData = userFileMap.get(uid) || { files: 0, bytes: 0 };
                return {
                    userId: uid,
                    name: u.name || 'User',
                    email: u.email,
                    deviceCount: userDevCount.get(uid) || 0,
                    cloudinaryFiles: fileData.files,
                    cloudinaryBytes: fileData.bytes,
                    dbRecords: Math.max(1, Math.round(totalDbRecords / (users.length || 1))),
                };
            });

            const userMap = new Map(users.map((u) => [String(u._id || u.id), u]));
            const deviceStorage = devices.map((d) => {
                const did = String(d.device_id);
                const fileData = devFileMap.get(did) || { files: 0, bytes: 0 };
                const owner = userMap.get(String(d.user_id));
                return {
                    deviceId: did,
                    hostname: d.hostname || did,
                    userId: String(d.user_id || ''),
                    userName: owner?.name || 'Unassigned',
                    userEmail: owner?.email || '',
                    platform: d.platform || 'unknown',
                    cloudinaryEnabled: d.cloudinary_enabled !== 0,
                    cloudinaryFiles: fileData.files,
                    cloudinaryBytes: fileData.bytes,
                };
            });

            // Recent 40 file logs
            const [recentLogs] = await pool.query(`
                SELECT id, device_id, name, size, mime_type, resource_type, created_at
                FROM virtual_files ORDER BY created_at DESC LIMIT 40
            `);

            return res.json({
                success: true,
                summary: {
                    totalCloudinaryBytes: Number(totalFilesRow[0]?.total_bytes || 0),
                    totalCloudinaryFiles: Number(totalFilesRow[0]?.total_files || 0),
                    totalDbRecords,
                    totalUsers: users.length,
                    totalDevices: devices.length,
                },
                userStorage,
                deviceStorage,
                recentLogs: recentLogs.map((l) => ({
                    id: String(l.id),
                    name: l.name,
                    deviceId: l.device_id,
                    size: Number(l.size || 0),
                    mimeType: l.mime_type,
                    resourceType: l.resource_type,
                    createdAt: l.created_at,
                })),
            });
        }

        // MongoDB Aggregations
        const [
            userFileStats,
            deviceFileStats,
            totalFilesAgg,
            totalDbCounts,
            users,
            devices,
            recentFiles,
        ] = await Promise.all([
            VirtualFile.aggregate([
                { $match: { isDeleted: false } },
                { $group: { _id: '$userId', files: { $sum: 1 }, bytes: { $sum: '$size' } } },
            ]),
            VirtualFile.aggregate([
                { $match: { isDeleted: false } },
                { $group: { _id: '$deviceId', files: { $sum: 1 }, bytes: { $sum: '$size' } } },
            ]),
            VirtualFile.aggregate([
                { $match: { isDeleted: false } },
                { $group: { _id: null, totalFiles: { $sum: 1 }, totalBytes: { $sum: '$size' } } },
            ]),
            Promise.all([
                User.countDocuments(),
                Device.countDocuments(),
                VirtualFile.countDocuments(),
                ActivityLog.countDocuments(),
            ]),
            User.find({}).select('name email').lean(),
            Device.find({}).select('deviceId userId hostname platform cloudinaryEnabled').lean(),
            VirtualFile.find({ isDeleted: false }).sort({ createdAt: -1 }).limit(40).lean(),
        ]);

        const totalDbRecords = totalDbCounts.reduce((acc, c) => acc + c, 0);
        const userFileMap = new Map(userFileStats.map((r) => [String(r._id), { files: r.files, bytes: r.bytes }]));
        const devFileMap = new Map(deviceFileStats.map((r) => [String(r._id), { files: r.files, bytes: r.bytes }]));

        const userDevCount = new Map();
        for (const d of devices) {
            const uid = String(d.userId || '');
            userDevCount.set(uid, (userDevCount.get(uid) || 0) + 1);
        }

        const userStorage = users.map((u) => {
            const uid = String(u._id);
            const fileData = userFileMap.get(uid) || { files: 0, bytes: 0 };
            return {
                userId: uid,
                name: u.name || 'User',
                email: u.email,
                deviceCount: userDevCount.get(uid) || 0,
                cloudinaryFiles: fileData.files,
                cloudinaryBytes: fileData.bytes,
                dbRecords: Math.max(1, Math.round(totalDbRecords / (users.length || 1))),
            };
        });

        const userMap = new Map(users.map((u) => [String(u._id), u]));
        const deviceStorage = devices.map((d) => {
            const did = String(d.deviceId);
            const fileData = devFileMap.get(did) || { files: 0, bytes: 0 };
            const owner = userMap.get(String(d.userId));
            return {
                deviceId: did,
                hostname: d.hostname || did,
                userId: String(d.userId || ''),
                userName: owner?.name || 'Unassigned',
                userEmail: owner?.email || '',
                platform: d.platform || 'unknown',
                cloudinaryEnabled: d.cloudinaryEnabled !== false,
                cloudinaryFiles: fileData.files,
                cloudinaryBytes: fileData.bytes,
            };
        });

        res.json({
            success: true,
            summary: {
                totalCloudinaryBytes: totalFilesAgg[0]?.totalBytes || 0,
                totalCloudinaryFiles: totalFilesAgg[0]?.totalFiles || 0,
                totalDbRecords,
                totalUsers: users.length,
                totalDevices: devices.length,
            },
            userStorage,
            deviceStorage,
            recentLogs: recentFiles.map((f) => ({
                id: String(f._id),
                name: f.name,
                deviceId: f.deviceId,
                size: Number(f.size || 0),
                mimeType: f.mimeType,
                resourceType: f.resourceType,
                createdAt: f.createdAt,
            })),
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
