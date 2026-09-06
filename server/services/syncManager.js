const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');
const { isAdminSyncEnabled, isDeviceExcludedFromAdminSync } = require('./adminSettingsService');
const Device = require('../models/Device');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');
const VirtualFile = require('../models/VirtualFile');

/**
 * Dual Database Sync Manager
 * Ensures all user data is safely recorded into the Admin Master Database,
 * while respecting the Admin's sync toggle and device exclusion rules.
 */
class SyncManager {
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

        return true;
    }

    /**
     * Dual-write device updates
     */
    async syncDevice(deviceId, data = {}) {
        const shouldSync = await this.shouldSyncToAdmin(deviceId);
        if (!shouldSync) {
            console.log(`[SYNC-MANAGER] Device ${deviceId} excluded from Admin DB sync.`);
            return null;
        }

        try {
            // Write to primary active adapter
            if (isMysql()) {
                await getMysqlAdapter().upsertDevice(deviceId, data);
            } else {
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

        try {
            if (isMysql()) {
                await getMysqlAdapter().createActivityLog(data);
            } else {
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

        try {
            if (isMysql()) {
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
            if (isMysql()) {
                await getMysqlAdapter().createNotification(notifData);
            } else {
                await Notification.create(notifData);
            }
        } catch (err) {
            console.warn('[SYNC-MANAGER] Notification sync notice:', err.message);
        }
    }
}

module.exports = new SyncManager();
