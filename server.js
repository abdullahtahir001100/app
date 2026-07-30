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
const liveLogsRoutes = require('./server/routes/live-logs');
const { initWebSocketGateway } = require('./server/sockets/gateway');
const { initTcpControlGateway } = require('./server/control/tcpGateway');
const { lookupShareToken, serviceErrorResponse } = require('./server/services/virtualFileService');
const { attachUser, requireAuthUnlessPublic } = require('./server/middleware/auth');
const liveLogBus = require('./server/services/liveLogBus');
const { startLiveLogFanout } = require('./server/services/liveLogFanout');

const PORT = process.env.PORT || 3000;

nextApp.prepare().then(() => {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    const server = http.createServer(app);
    const nextUpgradeHandler = nextApp.getUpgradeHandler();

    // Ultra-fast liveness — registered first, never waits on Mongo.
    app.get('/api/health', (_req, res) => {
        let agents = 0;
        let dashboards = 0;
        let controlTcp = 0;
        try {
            const { getConnectionRegistry } = require('./server/sockets/registry');
            const registry = getConnectionRegistry();
            for (const key of registry.keys()) {
                if (key.startsWith('AGENT_') || key.startsWith('DEVICE_')) agents += 1;
                else if (key.startsWith('DASHBOARD_')) dashboards += 1;
            }
            const { controlAgents } = require('./server/control/controlHandler');
            controlTcp = controlAgents.size;
        } catch (_) {}

        res.status(200).json({
            ok: true,
            agents,
            dashboards,
            controlTcp,
            uptime: process.uptime(),
            mongo: Boolean(global.__ZENVORA_MONGO_OK),
        });
    });

    registerSecurityMiddleware(app);
    app.use(cookieParser());
    app.use(liveLogBus.httpMiddleware());

    const jsonBodyParser = express.json({ limit: '2mb' });

    initWebSocketGateway(server, nextUpgradeHandler);
    initTcpControlGateway();
    const { initWsControlGateway } = require('./server/control/wsControlGateway');
    initWsControlGateway(server);
    startLiveLogFanout();

    const { broadcastDeviceList } = require('./server/sockets/handler');
    setInterval(() => {
        void broadcastDeviceList();
    }, 30000);

    app.use('/api', (req, res, next) => {
        if (req.path.startsWith('/agent') || req.path === '/health') {
            return next();
        }
        return jsonBodyParser(req, res, next);
    }, (req, res, next) => {
        if (req.path.startsWith('/agent') || req.path === '/health') {
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
    app.use('/api/live-logs', express.json(), liveLogsRoutes);

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
        const { getLiveDeviceOptions } = require('./server/sockets/handler');
        res.status(200).json({ success: true, devices: getLiveDeviceOptions(req.user.id) });
    });

    app.use((req, res) => nextHandler(req, res));

    // Listen IMMEDIATELY — do not wait for Mongo (that was wedging Railway + agent handshake).
    server.listen(PORT, '0.0.0.0', (err) => {
        if (err) throw err;

        liveLogBus.push({
            channel: 'system',
            level: 'info',
            message: `HTTP listening on :${PORT}`,
        });
        console.log(`> Server running on port ${PORT}`);

        const os = require('os');
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`> Network : http://${iface.address}:${PORT}`);
                }
            }
        }
    });

    // Mongo in background — never block accept/upgrade.
    void connectDB().then((ok) => {
        global.__ZENVORA_MONGO_OK = Boolean(ok);
        liveLogBus.push({
            channel: 'mongo',
            level: ok ? 'info' : 'error',
            message: ok ? 'MongoDB connected' : 'MongoDB unavailable — auth/data limited',
        });
    });
}).catch((err) => {
    console.error('Failed to prepare Next.js app:', err);
    process.exit(1);
});
