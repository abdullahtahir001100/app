const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');

const notification = require("../services/notificationService");
const { attachUser, requireUserIdOwnership, requireDeviceAccess, requirePagePermission } = require('../middleware/auth');
// Get notifications for current device
router.get('/', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, category, limit = 50 } = req.query;
        
        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'deviceId required' });
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

// Get notification cou nt by category
router.get('/categories', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, async (req, res) => {

    console.log("CATEGORIES ROUTE HIT");

    const categories = await Notification.aggregate([
        { $match: { userId: req.user.id, isDeleted: { $ne: true } } },
        {
            $group: {
                _id: '$app',
                count: { $sum: 1 }
            }
        }
    ]);

    console.log(categories);

    res.json({
        success: true,
        categories
    });
});
// Create notification (from Rust agent)
router.post('/', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, app, title, message, icon, category } = req.body;

        if (!deviceId || !app || !title) {
            return res.status(400).json({ 
                success: false, 
                message: 'app and title are required' 
            });
        }

        const notificationDoc = new Notification({
            userId: req.user.id,
            deviceId,
            app,
            title,
            message,
            icon,
            category: category || 'other',
            read: false,
            isDeleted: false
        });

        const notification = await notificationDoc.save();

        res.status(201).json({
            success: true,
            notification
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bulk create notifications
router.post('/bulk', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { notifications } = req.body;

        if (!Array.isArray(notifications)) {
            return res.status(400).json({ 
                success: false, 
                message: 'notifications must be an array' 
            });
        }

        const created = await Notification.insertMany(
            notifications.map((item) => ({
                ...item,
                userId: req.user.id,
                deviceId: item.deviceId || req.body.deviceId
            }))
        );

        res.status(201).json({
            success: true,
            count: created.length,
            notifications: created
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mark notification as read
router.put('/:id/read', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, async (req, res) => {
    try {
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

// Soft-delete notification (row stays; isDeleted = true)
router.delete('/:id', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, async (req, res) => {
    try {
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

// Soft-delete all notifications for this user
router.post('/clear/all', attachUser, requirePagePermission('notifications'), requireUserIdOwnership, async (req, res) => {
    try {
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
