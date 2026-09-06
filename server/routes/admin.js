const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Permission = require('../models/Permission');
const Device = require('../models/Device');
const AgentCredential = require('../models/AgentCredential');
const VirtualFile = require('../models/VirtualFile');
const ActivityLog = require('../models/ActivityLog');
const { attachUser, requireAdmin } = require('../middleware/auth');
const { getConnectionRegistry } = require('../sockets/registry');
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
                    cloudinaryEnabled: true,
                });
            }
        }

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
