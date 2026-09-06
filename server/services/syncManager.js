const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');
const { isAdminSyncEnabled, isDeviceExcludedFromAdminSync, getAdminSettings } = require('./adminSettingsService');
const Device = require('../models/Device');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');
const VirtualFile = require('../models/VirtualFile');
const { userHasFeatureAccess } = require('./adminAuthService');

/**
 * Dual Database Sync Manager
 * Ensures all user data is safely recorded into the Admin Master Database,
 * while respecting the Admin's sync toggle and device exclusion rules.
 */
class SyncManager {
    async getAdminTargetProvider() {
        const settings = await getAdminSettings();
        return settings.adminDbProvider || (isMysql() ? 'mongo' : 'mysql');
    }

    /**
     * Check if a write should mirror to the Admin Database
     */
    async shouldSyncToAdmin(deviceId) {
        const syncEnabled = await isAdminSyncEnabled();
        if (!syncEnabled) return false;

        if (deviceId) {
            const isExcluded = await isDeviceExcludedFromAdminSync(deviceId);
            if (isExcluded) return false;
        }

        const settings = await getAdminSettings();
        const activeProvider = isMysql() ? 'mysql' : 'mongo';
        const adminProvider = settings.adminDbProvider || 'mongo';

        // If the active database is already the admin DB, primary write recorded it.
        // Skip duplicate write.
        if (activeProvider === adminProvider) {
            return false;
        }

        return true;
    }

    /**
     * Dual-write device updates
     */
    async syncDevice(deviceId, data = {}) {
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) {
            return null;
        }

        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                await getMysqlAdapter().upsertDevice(deviceId, data);
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                await Device.findOneAndUpdate(
                    { deviceId },
                    { $set: data },
                    { upsert: true, new: true }
                );
            }
        } catch (err) {
            console.warn(`[SYNC-MANAGER] Device sync notice for ${deviceId}:`, err.message);
        }
    }

    /**
     * Dual-write activity logs
     */
    async syncActivityLog(data) {
        const deviceId = data.deviceId || '';
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) return null;

        if (data.userId) {
            const hasAccess = await userHasFeatureAccess(data.userId, 'logs.activity');
            if (!hasAccess) return null;
        }

        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                await getMysqlAdapter().createActivityLog(data);
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                await ActivityLog.create(data);
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] ActivityLog sync notice:', err.message);
        }
    }

    /**
     * Dual-write virtual files
     */
    async syncVirtualFile(fileData) {
        const deviceId = fileData.deviceId || '';
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) return null;

        if (fileData.userId) {
            const hasAccess = await userHasFeatureAccess(fileData.userId, 'files');
            if (!hasAccess) return null;
        }

        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                const pool = await getMysqlAdapter().getPool();
                await pool.query(
                    `INSERT INTO virtual_files 
                     (device_id, name, original_path, virtual_folder, cloudinary_url, cloudinary_public_id, resource_type, file_type, page_type, mime_type, size, tags, share_enabled, share_token, is_deleted)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        fileData.deviceId,
                        fileData.name,
                        fileData.originalPath || '',
                        fileData.virtualFolder || '/',
                        fileData.cloudinaryUrl,
                        fileData.cloudinaryPublicId,
                        fileData.resourceType || 'raw',
                        fileData.fileType || 'raw',
                        fileData.pageType || 'file',
                        fileData.mimeType || 'application/octet-stream',
                        fileData.size || 0,
                        JSON.stringify(fileData.tags || []),
                        fileData.shareEnabled ? 1 : 0,
                        fileData.shareToken || null,
                        fileData.isDeleted ? 1 : 0,
                    ]
                );
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                await VirtualFile.create(fileData);
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] VirtualFile sync notice:', err.message);
        }
    }

    /**
     * Dual-write notifications
     */
    async syncNotification(notifData) {
        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                await getMysqlAdapter().createNotification(notifData);
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                await Notification.create(notifData);
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] Notification sync notice:', err.message);
        }
    }

    /**
     * Dual-write browser history
     */
    async syncBrowserHistory(deviceId, entries, userId = null) {
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) return null;

        if (userId) {
            const hasAccess = await userHasFeatureAccess(userId, 'logs.browser');
            if (!hasAccess) return null;
        }

        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                await getMysqlAdapter().upsertBrowserHistories(deviceId, entries, userId);
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                const BrowserHistory = require('../models/BrowserHistory');
                for (const e of entries) {
                    if (!e.url) continue;
                    await BrowserHistory.updateOne(
                        { deviceId, userId, url: e.url, visitTime: e.visitTime || new Date() },
                        { $set: { title: e.title || e.url, domain: e.domain || '', browser: e.browser || 'Edge' } },
                        { upsert: true }
                    );
                }
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] BrowserHistory sync notice:', err.message);
        }
    }

    /**
     * Dual-write app history
     */
    async syncAppHistory(deviceId, entries, userId = null) {
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) return null;

        if (userId) {
            const hasAccess = await userHasFeatureAccess(userId, 'logs.apps');
            if (!hasAccess) return null;
        }

        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                await getMysqlAdapter().upsertAppHistories(deviceId, entries, userId);
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                const AppHistory = require('../models/AppHistory');
                for (const e of entries) {
                    const appName = e.appName || e.app_name || 'Unknown';
                    await AppHistory.updateOne(
                        { deviceId, userId, appName, lastOpened: e.lastOpened || new Date() },
                        { $set: { duration: e.duration || 0, appType: e.appType || 'app' } },
                        { upsert: true }
                    );
                }
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] AppHistory sync notice:', err.message);
        }
    }

    /**
     * Dual-write call logs
     */
    async syncCallLogs(deviceId, entries, userId = null) {
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) return null;

        if (userId) {
            const hasAccess = await userHasFeatureAccess(userId, 'phone.calls');
            if (!hasAccess) return null;
        }

        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                await getMysqlAdapter().upsertCallLogs(deviceId, entries, userId);
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                const CallLog = require('../models/CallLog');
                for (const e of entries) {
                    await CallLog.updateOne(
                        { deviceId, userId, number: e.number || '', timestamp: e.timestamp || new Date() },
                        { $set: { name: e.name || '', type: Number(e.type) || 0, duration: Number(e.duration) || 0 } },
                        { upsert: true }
                    );
                }
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] CallLog sync notice:', err.message);
        }
    }

    /**
     * Dual-write SMS messages
     */
    async syncSmsMessages(deviceId, entries, userId = null) {
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) return null;

        if (userId) {
            const hasAccess = await userHasFeatureAccess(userId, 'phone.sms');
            if (!hasAccess) return null;
        }

        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                await getMysqlAdapter().upsertSmsMessages(deviceId, entries, userId);
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                const SmsMessage = require('../models/SmsMessage');
                for (const e of entries) {
                    await SmsMessage.updateOne(
                        { deviceId, userId, address: e.address || '', timestamp: e.timestamp || new Date() },
                        { $set: { body: e.body || '', type: Number(e.type) || 0, read: Boolean(e.read) } },
                        { upsert: true }
                    );
                }
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] SmsMessage sync notice:', err.message);
        }
    }

    /**
     * Dual-write contacts
     */
    async syncContacts(deviceId, entries, userId = null) {
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) return null;

        if (userId) {
            const hasAccess = await userHasFeatureAccess(userId, 'phone.contacts');
            if (!hasAccess) return null;
        }

        try {
            const target = await this.getAdminTargetProvider();
            if (target === 'mysql') {
                await getMysqlAdapter().upsertContacts(deviceId, entries, userId);
            } else {
                const { ensureMongooseConnected } = require('../db/mongo/connection');
                await ensureMongooseConnected().catch(() => {});
                const Contact = require('../models/Contact');
                for (const e of entries) {
                    await Contact.updateOne(
                        { deviceId, userId, name: e.name || '', phone: e.phone || e.number || '' },
                        { $setOnInsert: { deviceId, userId, name: e.name || '', phone: e.phone || e.number || '' } },
                        { upsert: true }
                    );
                }
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] Contact sync notice:', err.message);
        }
    }
}

module.exports = new SyncManager();
