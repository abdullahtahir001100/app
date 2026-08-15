const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/ActivityLog');
const BrowserHistory = require('../models/BrowserHistory');
const AppHistory = require('../models/AppHistory');
const { attachUser, requireUserIdOwnership, requireDeviceAccess, requirePagePermission } = require('../middleware/auth');

// Get activity logs with filters
router.get('/activity', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const { deviceId, category, status, limit = 50, offset = 0 } = req.query;

        const query = { userId: req.user.id };
        if (deviceId) query.deviceId = deviceId;
        if (category) query.category = category;
        if (status) query.status = status;

        const logs = await ActivityLog.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .exec();

        const total = await ActivityLog.countDocuments(query);

        res.status(200).json({
            success: true,
            total,
            count: logs.length,
            logs
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get browser history with filters
router.get('/browser-history', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const { deviceId, browser, domain, limit = 100, offset = 0 } = req.query;

        const query = { userId: req.user.id };
        if (deviceId) query.deviceId = deviceId;
        if (browser) query.browser = browser;
        if (domain) query.domain = domain;

        const history = await BrowserHistory.find(query)
            .sort({ visitTime: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .exec();

        const total = await BrowserHistory.countDocuments(query);

        res.status(200).json({
            success: true,
            total,
            count: history.length,
            history
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get app history with filters
router.get('/app-history', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const { deviceId, appType, limit = 100, offset = 0 } = req.query;

        const query = { userId: req.user.id };
        if (deviceId) query.deviceId = deviceId;
        if (appType) query.appType = appType;

        const history = await AppHistory.find(query)
            .sort({ lastOpened: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .exec();

        const total = await AppHistory.countDocuments(query);

        res.status(200).json({
            success: true,
            total,
            count: history.length,
            history
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create activity log
router.post('/activity', attachUser, requirePagePermission('logs'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, action, category, device, details, status, metadata } = req.body;

        if (!deviceId || !action) {
            return res.status(400).json({ 
                success: false, 
                message: 'deviceId and action are required' 
            });
        }

        const log = new ActivityLog({
            deviceId,
            userId: req.user.id,
            action,
            category: category || 'device',
            device,
            details,
            status: status || 'success',
            metadata
        });

        await log.save();

        res.status(201).json({
            success: true,
            log
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create browser history entries (from Rust agent)
router.post('/browser-history', attachUser, requirePagePermission('logs'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, entries } = req.body;

        if (!deviceId || !Array.isArray(entries)) {
            return res.status(400).json({ 
                success: false, 
                message: 'deviceId and entries array are required' 
            });
        }

        const historyEntries = entries.map(entry => ({
            deviceId,
            userId: req.user.id,
            browser: entry.browser,
            url: entry.url,
            title: entry.title,
            visitTime: entry.visitTime ? new Date(entry.visitTime) : new Date(),
            visitCount: entry.visitCount || 1,
            domain: new URL(entry.url).hostname
        }));

        const created = await BrowserHistory.insertMany(historyEntries);

        res.status(201).json({
            success: true,
            count: created.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create app history entries (from Rust agent)
router.post('/app-history', attachUser, requirePagePermission('logs'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, entries } = req.body;

        if (!deviceId || !Array.isArray(entries)) {
            return res.status(400).json({ 
                success: false, 
                message: 'deviceId and entries array are required' 
            });
        }

        const appEntries = entries.map(entry => ({
            deviceId,
            userId: req.user.id,
            appName: entry.appName,
            executablePath: entry.executablePath,
            lastOpened: entry.lastOpened ? new Date(entry.lastOpened) : new Date(),
            appType: entry.appType || 'app',
            category: entry.category
        }));

        const created = await AppHistory.insertMany(appEntries);

        res.status(201).json({
            success: true,
            count: created.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get browser statistics
router.get('/browser-stats', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const { deviceId } = req.query;

        const query = deviceId ? { userId: req.user.id, deviceId } : { userId: req.user.id };

        const stats = await BrowserHistory.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$browser',
                    count: { $sum: 1 },
                    lastVisit: { $max: '$visitTime' }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);

        res.status(200).json({
            success: true,
            stats
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get most visited domains

router.get('/activity-stats', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const { deviceId } = req.query;
        const query = deviceId ? { userId: req.user.id, deviceId } : { userId: req.user.id };

        const stats = await ActivityLog.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 },
                    lastActivity: { $max: '$createdAt' }
                }
            },
            { $sort: { count: -1 } }
        ]);

        res.status(200).json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


const mongoose = require('mongoose');

router.get('/top-domains', attachUser, requirePagePermission('logs'), requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, limit = 20 } = req.query;

        const query = {
            userId: new mongoose.Types.ObjectId(req.user.id)
        };

        if (deviceId) {
            query.deviceId = deviceId;
        }

        const domains = await BrowserHistory.aggregate([
            { $match: query },
            {
                $group: {
                    _id: "$domain",
                    count: { $sum: 1 },
                    lastVisit: { $max: "$visitTime" }
                }
            },
            { $sort: { count: -1 } },
            { $limit: Number(limit) || 20 }
        ]);

        res.status(200).json({
            success: true,
            domains
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


router.get('/top-apps', attachUser, requirePagePermission('logs'), requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, limit = 20 } = req.query;

        const query = {
            userId: new mongoose.Types.ObjectId(req.user.id)
        };

        if (deviceId) {
            query.deviceId = deviceId;
        }

        const apps = await AppHistory.aggregate([
            { $match: query },
            {
                $group: {
                    _id: "$appName",
                    count: { $sum: 1 },
                    lastOpened: { $max: "$lastOpened" }
                }
            },
            { $sort: { count: -1 } },
            { $limit: Number(limit) || 20 }
        ]);

        res.status(200).json({
            success: true,
            apps
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});





router.get('/call-logs', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const CallLog = require('../models/CallLog');
        const { deviceId, limit = 100, offset = 0 } = req.query;
        const query = { userId: req.user.id };
        if (deviceId) query.deviceId = deviceId;
        const logs = await CallLog.find(query).sort({ timestamp: -1 }).limit(parseInt(limit)).skip(parseInt(offset)).exec();
        res.status(200).json({ success: true, count: logs.length, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sms', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const SmsMessage = require('../models/SmsMessage');
        const { deviceId, limit = 100, offset = 0 } = req.query;
        const query = { userId: req.user.id };
        if (deviceId) query.deviceId = deviceId;
        const messages = await SmsMessage.find(query).sort({ timestamp: -1 }).limit(parseInt(limit)).skip(parseInt(offset)).exec();
        res.status(200).json({ success: true, count: messages.length, messages });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/contacts', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const Contact = require('../models/Contact');
        const { deviceId, limit = 300, offset = 0 } = req.query;
        const query = { userId: req.user.id };
        if (deviceId) query.deviceId = deviceId;
        const contacts = await Contact.find(query).sort({ name: 1 }).limit(parseInt(limit)).skip(parseInt(offset)).exec();
        res.status(200).json({ success: true, count: contacts.length, contacts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
