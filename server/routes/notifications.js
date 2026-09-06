const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');
const syncManager = require('../services/syncManager');
const notification = require("../services/notificationService");
const { attachUser, requireUserIdOwnership, requireDeviceAccess, requirePagePermission } = require('../middleware/auth');

// Get notifications for current device
router.get('/', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, category, limit = 50 } = req.query;
        
        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'deviceId required' });
        }

        if (isMysql()) {
            const filter = { userId: req.user.id, deviceId };
            if (category && category !== 'all') {
                filter.type = category;
            }
            const notifications = await getMysqlAdapter().findNotifications(filter, { limit: parseInt(limit) || 50 });
            return res.status(200).json({
                success: true,
                count: notifications.length,
                notifications
            });
        }

        const query = { userId: req.user.id, deviceId, isDeleted: { $ne: true } };
        if (category && category !== 'all') {
            query.category = category;
        }

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .exec();

        res.status(200).json({
            success: true,
            count: notifications.length,
            notifications
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/mark-all-read', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId } = req.body;

        if (isMysql()) {
            const result = await getMysqlAdapter().markAllNotificationsRead(req.user.id);
            return res.json({
                success: true,
                modified: result.modifiedCount
            });
        }

        const result = await notification.markAllNotificationsAsRead(deviceId);

        res.json({
            success: true,
            modified: result.modifiedCount
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// Get notification count by category
router.get('/categories', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, async (req, res) => {
    try {
        if (isMysql()) {
            const notifications = await getMysqlAdapter().findNotifications({ userId: req.user.id });
            const counts = {};
            for (const n of notifications) {
                const cat = n.type || 'other';
                counts[cat] = (counts[cat] || 0) + 1;
            }
            const categories = Object.entries(counts).map(([k, v]) => ({ _id: k, count: v }));
            return res.json({ success: true, categories });
        }

        const categories = await Notification.aggregate([
            { $match: { userId: req.user.id, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: '$app',
                    count: { $sum: 1 }
                }
            }
        ]);

        res.json({
            success: true,
            categories
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create notification (from agent)
router.post('/', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, app, title, message, icon, category } = req.body;

        if (!deviceId || !app || !title) {
            return res.status(400).json({ 
                success: false, 
                message: 'app and title are required' 
            });
        }

        const notifData = {
            userId: req.user.id,
            deviceId,
            app,
            title,
            message,
            icon,
            type: category || 'other',
            category: category || 'other',
            read: false,
            isDeleted: false
        };

        let resultNotification;
        if (isMysql()) {
            resultNotification = await getMysqlAdapter().createNotification(notifData);
        } else {
            const notificationDoc = new Notification(notifData);
            resultNotification = await notificationDoc.save();
        }

        void syncManager.syncNotification(notifData).catch(() => {});

        res.status(201).json({
            success: true,
            notification: resultNotification
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bulk create notifications
router.post('/bulk', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { notifications: notifs } = req.body;

        if (!Array.isArray(notifs)) {
            return res.status(400).json({ 
                success: false, 
                message: 'notifications must be an array' 
            });
        }

        for (const item of notifs) {
            const payload = {
                ...item,
                userId: req.user.id,
                deviceId: item.deviceId || req.body.deviceId
            };
            if (isMysql()) {
                await getMysqlAdapter().createNotification(payload);
            }
            void syncManager.syncNotification(payload).catch(() => {});
        }

        if (!isMysql()) {
            await Notification.insertMany(
                notifs.map((item) => ({
                    ...item,
                    userId: req.user.id,
                    deviceId: item.deviceId || req.body.deviceId
                }))
            );
        }

        res.status(201).json({
            success: true,
            count: notifs.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mark notification as read
router.put('/:id/read', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, async (req, res) => {
    try {
        if (isMysql()) {
            await getMysqlAdapter().markNotificationRead(req.params.id, req.user.id);
            return res.status(200).json({ success: true });
        }

        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { read: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({ success: true, notification });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Soft-delete notification
router.delete('/:id', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, async (req, res) => {
    try {
        if (isMysql()) {
            await getMysqlAdapter().deleteNotification(req.params.id, req.user.id);
            return res.status(200).json({ success: true, message: 'Notification deleted' });
        }

        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $set: { isDeleted: true } },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({ success: true, message: 'Notification deleted', notification });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Clear all notifications for this user
router.post('/clear/all', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, async (req, res) => {
    try {
        if (isMysql()) {
            await getMysqlAdapter().clearAllNotifications(req.user.id);
            return res.status(200).json({ success: true, message: 'All notifications cleared' });
        }

        const result = await Notification.updateMany(
            { userId: req.user.id, isDeleted: { $ne: true } },
            { $set: { isDeleted: true } }
        );

        res.status(200).json({
            success: true,
            message: `${result.modifiedCount} notifications cleared`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
