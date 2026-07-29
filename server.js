const express = require('express');
const http = require('http');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const connectDB = require('./server/config/db');
const { registerSecurityMiddleware } = require('./server/middleware/security');
const { nextApp, nextHandler } = require('./server/config/next');
const authRoutes = require('./server/routes/auth');
const networkRoutes = require('./server/routes/network');
const mediaRoutes = require('./server/routes/media');
const virtualFileRoutes = require('./server/routes/virtual-files');
const fileRoutes = require('./server/routes/files');
const notificationRoutes = require('./server/routes/notifications');
const logsRoutes = require('./server/routes/logs');
const installLogsRoutes = require('./server/routes/installLogs');
const securityAuditRoutes = require('./server/routes/security-audit');
const { initWebSocketGateway } = require('./server/sockets/gateway');
const { lookupShareToken, serviceErrorResponse } = require('./server/services/virtualFileService');
const { attachUser, requireAuthUnlessPublic } = require('./server/middleware/auth');

const PORT = process.env.PORT || 3000;

nextApp.prepare().then(async () => {
    await connectDB();

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    const server = http.createServer(app);
    const nextUpgradeHandler = nextApp.getUpgradeHandler();

    registerSecurityMiddleware(app);
    app.use(cookieParser());

    const jsonBodyParser = express.json();

    initWebSocketGateway(server, nextUpgradeHandler);

    const { broadcastDeviceList } = require('./server/sockets/handler');
    setInterval(() => broadcastDeviceList(), 15000);

    app.use('/api', (req, res, next) => {
        if (req.path.startsWith('/agent')) {
            return next();
        }
        return jsonBodyParser(req, res, next);
    }, (req, res, next) => {
        if (req.path.startsWith('/agent')) {
            return next();
        }
        return requireAuthUnlessPublic(req, res, next);
    });
    app.use('/api/auth', express.json(), authRoutes);
    app.use('/api/network', express.json(), networkRoutes);
    app.use('/api/media', express.json(), mediaRoutes);
    app.use('/api/virtual-files', express.json(), virtualFileRoutes);
    app.use('/api/files', express.json(), fileRoutes);
    app.use('/api/notifications', express.json(), notificationRoutes);
    app.use('/api/logs', express.json(), logsRoutes);
    app.use('/api/install-logs', express.json(), installLogsRoutes);
    app.use('/api/security', express.json(), securityAuditRoutes);

    app.get('/api/virtual-files/share/:token', async (req, res) => {
        try {
            const payload = await lookupShareToken(req, req.params.token);
            return res.status(200).json(payload);
        } catch (error) {
            const err = serviceErrorResponse(error, 'Share lookup failed.');
            return res.status(err.status).json(err);
        }
    });

    app.get('/api/network/live-agents', attachUser, (req, res) => {
        const { getConnectionRegistry } = require('./server/sockets/registry');
        const { getLiveDeviceOptions } = require('./server/sockets/handler');
        getConnectionRegistry();
        res.status(200).json({ success: true, devices: getLiveDeviceOptions(req.user.id) });
    });

    app.use((req, res) => nextHandler(req, res));

    server.listen(PORT, "0.0.0.0", (err) => {
        if (err) throw err;

        console.log(`> Server running on:`);
        console.log(`> Local   : http://localhost:${PORT}`);

        const os = require("os");

        const interfaces = os.networkInterfaces();

        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === "IPv4" && !iface.internal) {
                    console.log(`> Network : http://${iface.address}:${PORT}`);
                }
            }
        }
    });
});
