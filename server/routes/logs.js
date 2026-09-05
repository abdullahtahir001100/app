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

router.get('/usage', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const { deviceId, from, to } = req.query;
        const start = from ? new Date(String(from)) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const end = to ? new Date(String(to)) : new Date();
        const scope = { userId: req.user.id };
        if (deviceId) scope.deviceId = String(deviceId);

        const [historyRows, activityRows] = await Promise.all([
            AppHistory.find({
                ...scope,
                lastOpened: { $gte: start, $lte: end },
                duration: { $gt: 0 },
                category: { $ne: 'usagestats' },
            }).sort({ lastOpened: -1 }).limit(2000).lean(),
            ActivityLog.find({
                ...scope,
                createdAt: { $gte: start, $lte: end },
                action: 'app_closed',
            }).sort({ createdAt: -1 }).limit(2000).lean(),
        ]);

        const byApp = new Map();
        const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, duration: 0, sessions: 0 }));
        const timeline = [];

        const add = (name, duration, at) => {
            const seconds = Math.max(0, Number(duration) || 0);
            if (seconds <= 0) return;
            const appName = String(name || 'Unknown').trim() || 'Unknown';
            const prev = byApp.get(appName) || { appName, duration: 0, sessions: 0, lastOpened: at };
            prev.duration += seconds;
            prev.sessions += 1;
            if (at && (!prev.lastOpened || at > prev.lastOpened)) prev.lastOpened = at;
            byApp.set(appName, prev);
            const opened = at ? new Date(at) : null;
            if (opened && !Number.isNaN(opened.getTime())) {
                hourly[opened.getHours()].duration += seconds;
                hourly[opened.getHours()].sessions += 1;
            }
            timeline.push({ appName, duration: seconds, lastOpened: at });
        };

        const closed = activityRows.filter((row) => {
            const seconds = Math.max(0, Number(row.duration) || Number(row.metadata?.duration) || 0);
            return seconds > 0;
        });

        if (closed.length > 0) {
            for (const row of closed) {
                add(
                    row.appName || row.processName || row.details,
                    Number(row.duration) || Number(row.metadata?.duration) || 0,
                    row.createdAt
                );
            }
        } else {
            for (const row of historyRows) {
                add(row.appName, row.duration, row.lastOpened);
            }
        }

        const apps = [...byApp.values()].sort((a, b) => b.duration - a.duration).slice(0, 40);
        timeline.sort((a, b) => b.duration - a.duration);

        res.status(200).json({
            success: true,
            from: start.toISOString(),
            to: end.toISOString(),
            apps,
            hourly,
            timeline: timeline.slice(0, 200),
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** App drill-down: activity + browser visits related to one app name (Chrome, etc.). */
router.get('/usage/detail', attachUser, requirePagePermission('logs'), requireUserIdOwnership, async (req, res) => {
    try {
        const deviceId = req.query.deviceId ? String(req.query.deviceId) : '';
        const appName = String(req.query.appName || req.query.app || '').trim();
        if (!deviceId || !appName) {
            return res.status(400).json({ success: false, message: 'deviceId and appName required' });
        }
        const start = req.query.from
            ? new Date(String(req.query.from))
            : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const end = req.query.to ? new Date(String(req.query.to)) : new Date();
        const scope = { userId: req.user.id, deviceId };
        const appRe = new RegExp(appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

        const isBrowser = /chrome|edge|firefox|brave|opera|safari|browser|msedge/i.test(appName);

        const [activity, appSessions, browser] = await Promise.all([
            ActivityLog.find({
                ...scope,
                createdAt: { $gte: start, $lte: end },
                $or: [
                    { appName: appRe },
                    { processName: appRe },
                    { executablePath: appRe },
                    { details: appRe },
                    { windowTitle: appRe },
                ],
            }).sort({ createdAt: -1 }).limit(300).lean(),
            AppHistory.find({
                ...scope,
                lastOpened: { $gte: start, $lte: end },
                appName: appRe,
                duration: { $gt: 0 },
            }).sort({ lastOpened: -1 }).limit(100).lean(),
            isBrowser
                ? BrowserHistory.find({
                    ...scope,
                    visitTime: { $gte: start, $lte: end },
                }).sort({ visitTime: -1 }).limit(200).lean()
                : Promise.resolve([]),
        ]);

        res.status(200).json({
            success: true,
            appName,
            deviceId,
            from: start.toISOString(),
            to: end.toISOString(),
            isBrowser,
            activity,
            appSessions,
            browserHistory: browser,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
