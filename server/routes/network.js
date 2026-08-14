const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const { getLiveDeviceOptions } = require('../sockets/handler');
const {
    attachUser,
    requireUserIdOwnership,
    requireDeviceAccess,
    userCanAccessAnyDevice,
} = require('../middleware/auth');

router.get('/devices', attachUser, requireUserIdOwnership, async (req, res) => {
    try {
        const seeAll = await userCanAccessAnyDevice(req.user);
        const query = seeAll ? {} : { userId: req.user.id };
        const allDevices = await Device.find(query).sort({ lastSeen: -1 }).lean();
        const liveDevices = getLiveDeviceOptions(req.user.id, { seeAll });
        const liveDeviceIds = new Set(liveDevices.map((device) => String(device.value)));

        const devices = allDevices.map((device) => {
            const deviceId = String(device.deviceId || '');
            const isLive = liveDeviceIds.has(deviceId);
            return {
                ...device,
                deviceId,
                status: isLive ? 'online' : 'offline',
                label: device.hostname || deviceId,
                value: deviceId
            };
        });

        // Include live agents not yet in Mongo (still owner-scoped unless seeAll).
        for (const live of liveDevices) {
            if (!devices.some((d) => String(d.deviceId || d.value) === String(live.value))) {
                devices.unshift({
                    deviceId: live.value,
                    value: live.value,
                    label: live.label,
                    status: 'online',
                    hostname: live.label,
                });
            }
        }

        res.status(200).json({ success: true, devices });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/devices/:deviceId', attachUser, requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const seeAll = await userCanAccessAnyDevice(req.user);
        const filter = seeAll
            ? { deviceId: req.params.deviceId }
            : { userId: req.user.id, deviceId: req.params.deviceId };
        const device = await Device.findOne(filter).lean();
        if (!device) {
            return res.status(404).json({ success: false, message: 'Device not found' });
        }

        const liveDevices = getLiveDeviceOptions(req.user.id, { seeAll });
        const isLive = liveDevices.some((d) => String(d.value) === String(device.deviceId));

        res.status(200).json({
            success: true,
            device: {
                ...device,
                status: isLive ? 'online' : 'offline'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/live-agents', attachUser, requireUserIdOwnership, async (req, res) => {
    try {
        const seeAll = await userCanAccessAnyDevice(req.user);
        const liveDevices = getLiveDeviceOptions(req.user.id, { seeAll });
        const liveDeviceIds = new Set(liveDevices.map((device) => String(device.value)));
        const query = seeAll ? {} : { userId: req.user.id };
        const deviceRecords = await Device.find(query).sort({ lastSeen: -1 }).lean();

        const metricPercent = (value) => {
            if (typeof value === 'number' && Number.isFinite(value)) {
                return Math.max(0, Math.min(100, value));
            }
            if (typeof value === 'string' && value.trim() !== '') {
                const n = Number(value);
                if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
            }
            return null;
        };

        const devices = deviceRecords.map((record) => {
            const deviceId = String(record.deviceId || '');
            const isLive = liveDeviceIds.has(deviceId);
            return {
                value: deviceId,
                label: record.hostname || deviceId,
                role: 'AGENT',
                platform: record.platform || 'unknown',
                status: isLive ? 'online' : 'offline',
                localIp: record.localIp || '',
                publicIp: record.publicIp || '',
                battery: metricPercent(record.battery),
                storage: metricPercent(record.storage),
                network: record.network || '',
                latitude: record.latitude,
                longitude: record.longitude,
                country: record.country || '',
                region: record.region || '',
                city: record.city || '',
                isp: record.isp || '',
                timezone: record.timezone || '',
                hostname: record.hostname || '',
                username: record.username || '',
                osVersion: record.osVersion || '',
                architecture: record.architecture || '',
                cpu: record.cpu || '',
                ram: record.ram,
                lastSeen: record.lastSeen ? record.lastSeen.toISOString() : null,
            };
        });

        res.status(200).json({ success: true, devices });
    } catch (error) {
        res.status(500).json({ success: false, devices: [], message: error.message });
    }
});

router.post('/heartbeat', attachUser, requireUserIdOwnership, requireDeviceAccess, async (req, res) => {
    try {
        const { deviceId, localIp, clientPort, platform } = req.body;
        const publicIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

        if (!deviceId || !localIp) return res.status(400).json({ success: false });

        const updatedDevice = await Device.findOneAndUpdate(
            { deviceId },
            {
                $set: {
                    platform, localIp, publicIp, clientPort,
                    status: 'online', lastSeen: new Date(),
                },
                $setOnInsert: {
                    userId: req.user.id,
                    deviceId,
                },
            },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, data: updatedDevice });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
