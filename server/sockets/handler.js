// Active live client connection pointers cache mapping tracker
const { getConnectionRegistry } = require('./registry');
const activeConnections = getConnectionRegistry();

const { handleCameraCommand, handleCameraTelemetry, broadcastBinaryFrame } = require('./cameraHandler');
const {
    handleScreenCommand,
    handleScreenTelemetry,
    broadcastScreenBinaryFrame,
    isScreenBinaryFrame
} = require('./screenHandler');
const {
    FILE_ACTION_TOKENS,
    handleFileCommand,
    handleFileTelemetry,
    isFileBinaryFrame,
    broadcastFileBinaryFrame
} = require('./fileHandler');
const { handleShellCommand, SHELL_ACTION_TOKENS } = require('./shellHandler');
const ActivityLog = require('../models/ActivityLog');
const Device = require('../models/Device');
const {
    isHistoryCommand,
    isHistoryAgentResponse,
    handleHistoryAgentResponse,
    extractDeviceIdFromAgentSocket
} = require('./historyHandler');
const { userOwnsDevice, verifyAgentToken } = require('../services/authService');
const {
    extractOwnerUserId,
    sendToOwnerDashboards,
    broadcastOwnerBinary,
} = require('./fanout');

const CAMERA_ACTION_TOKENS = [
    'SWITCH_CAMERA',
    'LIST_CAMERAS',
    'PROBE_HARDWARE',
    'SET_HARDWARE_PARAMETER',
    'SET_FLASH_STATE',
    'FETCH_TELEMETRY',
    'CAPTURE_SNAPSHOT',
    'START_RECORDING',
    'STOP_RECORDING',
    'FETCH_LATEST_MEDIA',
    'START_STREAM',
    'STOP_STREAM'
];

const SCREEN_ACTION_TOKENS = [
    'PROBE_DISPLAYS',
    'LIST_DISPLAYS',
    'SWITCH_DISPLAY',
    'START_SCREEN_STREAM',
    'STOP_SCREEN_STREAM',
    'CAPTURE_SCREENSHOT',
    'FETCH_SCREEN_TELEMETRY',
    'SET_DISPLAY_BRIGHTNESS',
    'SET_SYSTEM_VOLUME',
    'SEND_TEXT_INPUT',
    'LOCK_SCREEN',
    'OPEN_SETTINGS',
    'SET_SCREEN_QUALITY',
    'REMOTE_MOUSE_MOVE',
    'REMOTE_MOUSE_DOWN',
    'REMOTE_MOUSE_UP',
    'REMOTE_MOUSE_WHEEL',
    'REMOTE_KEY_DOWN',
    'REMOTE_KEY_UP'
];

const FRAME_STREAM = 0x01;
const FRAME_SNAPSHOT = 0x02;
const FRAME_RAW_RGB = 0x03;
const FRAME_AUDIO_STREAM = 0x0A;

function getLiveDeviceOptions(userId = null) {
    return Array.from(activeConnections.entries())
        .filter(([key, socket]) => {
            if (!key.startsWith('AGENT_') && !key.startsWith('DEVICE_')) return false;
            if (socket?.readyState !== 1) return false;
            const auth = socket?.authContext;
            if (!auth || auth.kind !== 'agent') return false;
            if (!userId) return true;
            return String(auth.userId || '') === String(userId);
        })
        .map(([key]) => {
            const deviceId = String(key.replace(/^AGENT_/, '').replace(/^DEVICE_/, ''));
            return {
                value: deviceId,
                label: deviceId,
                role: key.startsWith('AGENT_') ? 'AGENT' : 'DEVICE',
                status: 'online',
            };
        });
}

async function getDeviceOptions(userId = null) {
    const liveDevices = getLiveDeviceOptions(userId);
    const liveDeviceIds = new Set(liveDevices.map((device) => String(device.value)));
    const query = userId ? { userId } : {};
    const allDevices = await Device.find(query).sort({ lastSeen: -1 }).lean();

    return allDevices.map((device) => {
        const deviceId = String(device.deviceId || '');
        const isLive = liveDeviceIds.has(deviceId);
        return {
            value: deviceId,
            label: device.hostname || deviceId,
            role: isLive ? 'AGENT' : 'DEVICE',
            status: isLive ? 'online' : 'offline',
            platform: device.platform || 'unknown',
            localIp: device.localIp || '',
            publicIp: device.publicIp || '',
            battery: device.battery ?? null,
            storage: device.storage ?? null,
            lastSeen: device.lastSeen ? new Date(device.lastSeen).toISOString() : null,
            network: device.network || '',
            hostname: device.hostname || '',
            username: device.username || '',
        };
    });
}

let lastBroadcastAt = 0;
let lastBroadcastPayload = null;

/**
 * @param {{ force?: boolean }} [options]
 * force=true bypasses the 15s throttle (must use on connect/disconnect).
 */
async function broadcastDeviceList(options = {}) {
    const force = options.force === true;
    const now = Date.now();
    if (!force && now - lastBroadcastAt < 15000) {
        return lastBroadcastPayload;
    }

    lastBroadcastAt = now;

    const dashboardSockets = Array.from(activeConnections.entries()).filter(([key, clientSocket]) => {
        return key.startsWith('DASHBOARD_') && clientSocket.readyState === 1;
    });

    for (const [, clientSocket] of dashboardSockets) {
        const userId = clientSocket?.authContext?.kind === 'user' ? clientSocket.authContext.user?.id : null;
        const devices = await getDeviceOptions(userId);
        const payload = JSON.stringify({
            type: 'device_list_update',
            devices
        });
        lastBroadcastPayload = payload;
        try {
            clientSocket.send(payload);
        } catch (_) {
            // ignore broken dashboard sockets
        }
    }

    return lastBroadcastPayload;
}

function forwardPacketToDashboards(packet, activeConnections, ownerUserId = null) {
    const owner = String(ownerUserId || '');
    if (!owner) return;
    sendToOwnerDashboards(activeConnections, owner, packet);
}

function getShellResponsePayload(packet) {
    if (!packet || typeof packet !== 'object') return null;

    if (packet.shell && typeof packet.shell === 'object') {
        return packet.shell;
    }

    if (typeof packet.stdout === 'string' || typeof packet.stderr === 'string') {
        return {
            command: typeof packet.command === 'string' ? packet.command : '',
            exit_code: typeof packet.exit_code === 'number' ? packet.exit_code : null,
            stdout: typeof packet.stdout === 'string' ? packet.stdout : '',
            stderr: typeof packet.stderr === 'string' ? packet.stderr : '',
            timed_out: typeof packet.timed_out === 'boolean' ? packet.timed_out : false,
        };
    }

    return null;
}

function isShellResponsePacket(packet) {
    const shellPayload = getShellResponsePayload(packet);
    return Boolean(
        packet && (
            packet.type === 'shell_output' ||
            packet.type === 'sys_error' ||
            (packet.type === 'sys_ack' && (
                shellPayload ||
                packet.action === 'SHELL_EXECUTE' ||
                packet.action === 'SHELL_EXECUTE_RAW' ||
                typeof packet.message === 'string'
            ))
        )
    );
}

function toBuffer(message) {
    if (Buffer.isBuffer(message)) return message;
    if (typeof message === 'string') return Buffer.from(message);
    if (message instanceof ArrayBuffer) return Buffer.from(message);
    if (ArrayBuffer.isView(message)) {
        return Buffer.from(message.buffer, message.byteOffset, message.byteLength);
    }
    return Buffer.from(String(message));
}

function isBinaryMediaFrame(buffer) {
    if (!buffer || buffer.length < 3) return false;

    const frameType = buffer[0];
    if (frameType === FRAME_STREAM || frameType === FRAME_SNAPSHOT
        || isScreenBinaryFrame(frameType)) {
        return buffer[1] === 0xFF && buffer[2] === 0xD8;
    }
    if (frameType === FRAME_RAW_RGB) {
        return buffer.length >= 6;
    }
    return false;
}

function isAgentBinaryFrame(ws, buffer) {
    if (!buffer || buffer.length < 2) return false;

    const frameType = buffer[0];
    const knownFrame = (
        frameType === FRAME_STREAM
        || frameType === FRAME_SNAPSHOT
        || frameType === FRAME_RAW_RGB
        || isScreenBinaryFrame(frameType)
        || isFileBinaryFrame(frameType)
    );

    if (!knownFrame) return false;

    if (ws.connectionKey && ws.connectionKey.startsWith('AGENT_')) {
        return true;
    }

    return isBinaryMediaFrame(buffer);
}

function isFileAck(packet) {
    if (packet.channel === 'files') return true;
    if (typeof packet.last_action === 'string' && packet.last_action.startsWith('FILE_')) return true;
    return false;
}

function isScreenAck(packet) {
    if (packet.channel === 'screen') return true;
    if (packet.type === 'screen_telemetry_stream') return true;
    if (typeof packet.last_action === 'string' && packet.last_action.includes('SCREEN')) return true;
    if (typeof packet.last_action === 'string' && (packet.last_action === 'LIST_DISPLAYS' || packet.last_action === 'PROBE_DISPLAYS')) {
        return true;
    }
    if (typeof packet.action === 'string' && (packet.action.includes('SCREEN') || packet.action === 'LIST_DISPLAYS' || packet.action === 'PROBE_DISPLAYS')) {
        return true;
    }
    if (typeof packet.last_action === 'string' && SCREEN_ACTION_TOKENS.includes(packet.last_action)) {
        return true;
    }
    if (packet.hardware_metrics && Array.isArray(packet.hardware_metrics.available_displays)) {
        return true;
    }
    return false;
}

function isKnownBinaryFrame(buffer) {
    if (!buffer || buffer.length < 2) return false;

    const frameType = buffer[0];
    return (
        frameType === FRAME_STREAM
        || frameType === FRAME_SNAPSHOT
        || frameType === FRAME_RAW_RGB
        || isScreenBinaryFrame(frameType)
        || isFileBinaryFrame(frameType)
        || frameType === FRAME_AUDIO_STREAM
    );
}

async function authorizeSocketAction(ws, targetDeviceId) {
    if (!targetDeviceId) return false;
    if (ws.authContext?.kind === 'agent') {
        return String(ws.authContext.deviceId || '') === String(targetDeviceId);
    }
    if (ws.authContext?.kind === 'user') {
        return userOwnsDevice(ws.authContext.user?.id, String(targetDeviceId));
    }
    return false;
}

async function handleSocketMessage(ws, message) {
    //  console.log("=================================");
    // console.log("MESSAGE FROM:", ws.connectionKey);
    // console.log(message.toString());
    // console.log("=================================");
    
    const raw = toBuffer(message);

    if (isKnownBinaryFrame(raw) || isBinaryMediaFrame(raw)) {
        handleSocketBinary(ws, raw);
        return;
    }

    if (isAgentBinaryFrame(ws, raw)) {
        handleSocketBinary(ws, raw);
        return;
    }

    try {
        const packet = JSON.parse(raw.toString('utf8'));

        if (packet.type === 'dashboard_ping' || packet.type === 'agent_ping') {
            ws.send(JSON.stringify({
                type: packet.type === 'agent_ping' ? 'agent_pong' : 'dashboard_pong',
                status: 'ok'
            }));
            return;
        }

        if (packet.type === 'install_log') {
            const {
                appendLog,
                broadcastInstallLog,
                resolveUserId,
            } = require('../services/installLogService');

            let userId = ws.authContext?.kind === 'install' ? ws.authContext.userId : null;
            if (!userId) {
                userId = await resolveUserId(
                    packet.pairingToken || packet.pairToken,
                    packet.pairingUserId || packet.pairUserId
                );
            }
            if (!userId) {
                ws.send(JSON.stringify({ type: 'sys_ack', status: 'error', message: 'install auth required' }));
                return;
            }

            const entry = {
                sessionId: String(packet.sessionId || ws.authContext?.sessionId || ''),
                step: Number(packet.step) || 0,
                total: Number(packet.total) || 0,
                state: String(packet.state || 'running'),
                message: String(packet.message || ''),
                hostname: String(packet.hostname || ''),
                deviceId: String(packet.deviceId || ''),
                final: Boolean(packet.final),
                at: new Date().toISOString(),
            };
            appendLog(userId, entry);
            broadcastInstallLog(userId, entry, activeConnections);
            ws.send(JSON.stringify({ type: 'sys_ack', status: 'ok' }));
            return;
        }

        if (packet.type === 'register_channel') {
            const role = String(packet.role || 'AGENT').toUpperCase();
            const deviceOrPanelId = String(packet.id || '').trim();

            if (role === 'AGENT' || role === 'DEVICE') {
                if (!deviceOrPanelId) {
                    ws.send(JSON.stringify({
                        type: 'sys_ack',
                        status: 'auth_failed',
                        message: 'device id required'
                    }));
                    ws.close();
                    return;
                }

                if (ws.authContext?.kind !== 'agent' || String(ws.authContext.deviceId) !== deviceOrPanelId) {
                    const token = packet.authToken || packet.agentToken || '';
                    let credential = null;
                    try {
                        credential = await Promise.race([
                            verifyAgentToken(deviceOrPanelId, token),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('auth timeout')), 8000)
                            )
                        ]);
                    } catch (_) {
                        credential = null;
                    }

                    if (!credential) {
                        ws.send(JSON.stringify({
                            type: 'sys_ack',
                            status: 'auth_failed',
                            message: 'invalid agent credentials'
                        }));
                        ws.close();
                        return;
                    }

                    ws.authContext = {
                        kind: 'agent',
                        deviceId: deviceOrPanelId,
                        userId: String(credential.userId || '')
                    };
                }

                if (ws.registrationTimer) {
                    clearTimeout(ws.registrationTimer);
                    ws.registrationTimer = null;
                }
            } else if (role === 'DASHBOARD') {
                if (ws.authContext?.kind !== 'user') {
                    ws.send(JSON.stringify({
                        type: 'sys_ack',
                        status: 'auth_failed',
                        message: 'dashboard authentication required'
                    }));
                    ws.close();
                    return;
                }
            } else if (role === 'INSTALL') {
                const {
                    resolveUserId,
                } = require('../services/installLogService');
                const pairingToken = packet.pairingToken || packet.pairToken || '';
                const pairingUserId = packet.pairingUserId || packet.pairUserId || '';
                const userId = await resolveUserId(pairingToken, pairingUserId);
                if (!userId) {
                    ws.send(JSON.stringify({
                        type: 'sys_ack',
                        status: 'auth_failed',
                        message: 'invalid install pairing credentials'
                    }));
                    ws.close();
                    return;
                }
                ws.authContext = {
                    kind: 'install',
                    userId,
                    sessionId: String(packet.sessionId || deviceOrPanelId || ''),
                };
                if (ws.registrationTimer) {
                    clearTimeout(ws.registrationTimer);
                    ws.registrationTimer = null;
                }
            }

            // Dashboards must use unique panel ids so tabs/reconnects don't clobber each other.
            const connectionKey = role === 'DASHBOARD'
                ? `DASHBOARD_${deviceOrPanelId || `web-${Date.now()}`}`
                : role === 'INSTALL'
                    ? `INSTALL_${ws.authContext?.userId || deviceOrPanelId || Date.now()}`
                    : `${role}_${deviceOrPanelId}`;

            // If an agent reconnects, drop the stale socket for the same device key.
            if ((role === 'AGENT' || role === 'DEVICE') && activeConnections.has(connectionKey)) {
                const prev = activeConnections.get(connectionKey);
                if (prev && prev !== ws) {
                    try { prev.close(); } catch (_) {}
                }
            }

            activeConnections.set(connectionKey, ws);
            ws.connectionKey = connectionKey;

            const userId = ws.authContext?.kind === 'user'
                ? ws.authContext.user?.id
                : ws.authContext?.kind === 'agent' || ws.authContext?.kind === 'install'
                    ? ws.authContext.userId
                    : null;

            console.log(`[GATEWAY] Stream connection assigned registry key: ${connectionKey}`);
            const devices = role === 'INSTALL' ? [] : await getDeviceOptions(userId);
            ws.send(JSON.stringify({
                type: 'sys_ack',
                status: 'ready',
                devices
            }));
            if (role !== 'INSTALL') {
                void broadcastDeviceList({ force: true });
            }
            return;
        }

        if (packet.type === 'register_dashboard') {
            if (ws.authContext?.kind !== 'user') {
                ws.send(JSON.stringify({
                    type: 'sys_ack',
                    status: 'auth_failed',
                    message: 'dashboard authentication required'
                }));
                ws.close();
                return;
            }
            const connectionKey = `DASHBOARD_${packet.id || `web-${Date.now()}`}`;
            activeConnections.set(connectionKey, ws);
            ws.connectionKey = connectionKey;

            const userId = ws.authContext.user?.id || null;
            console.log(`[GATEWAY] Dashboard registered: ${connectionKey}`);
            const devices = await getDeviceOptions(userId);
            ws.send(JSON.stringify({
                type: 'sys_ack',
                status: 'ready',
                devices
            }));
            void broadcastDeviceList({ force: true });
            return;
        }

        if (packet.type === 'device_status_update' && ws.connectionKey?.startsWith('AGENT_')) {
            void handleDeviceStatusUpdate(ws, packet, activeConnections);
            return;
        }

        if (isShellResponsePacket(packet) && (ws.connectionKey?.startsWith('AGENT_') || ws.connectionKey?.startsWith('DEVICE_'))) {
            const shellPayload = getShellResponsePayload(packet);
            if (shellPayload) {
                packet.shell = shellPayload;
            }
            forwardPacketToDashboards(packet, activeConnections, extractOwnerUserId(ws));
            return;
        }

        if (packet.type === 'sys_ack' && (packet.file_result || isFileAck(packet))) {
            handleFileTelemetry(ws, packet, activeConnections);
            return;
        }

        if (
            (packet.type === 'sys_ack' || packet.hardware_metrics) &&
            ws.connectionKey?.startsWith('AGENT_') &&
            !isFileAck(packet)
        ) {
            void persistHardwareMetrics(ws, packet, activeConnections);

            if (isScreenAck(packet)) {
                handleScreenTelemetry(ws, packet, activeConnections);
            } else {
                handleCameraTelemetry(ws, packet, activeConnections);
            }

            return;
        }

        if (packet.type === 'activity_log' && (ws.connectionKey?.startsWith('AGENT_') || ws.connectionKey?.startsWith('DEVICE_'))) {
            void handleActivityLog(ws, packet, activeConnections);
            return;
        }

        if (isHistoryAgentResponse(packet) && (ws.connectionKey?.startsWith('AGENT_') || ws.connectionKey?.startsWith('DEVICE_'))) {
            void handleHistoryAgentResponse(ws, packet, activeConnections);
            return;
        }

        if (packet.type === 'dispatch_control') {
            packet.targetDeviceId =
                packet.targetDeviceId || packet.target_device_id || packet.targetDevice;
            console.log(`[GATEWAY] dispatch_control ${packet.action} -> ${packet.targetDeviceId || 'MISSING'}`);

            if (!await authorizeSocketAction(ws, packet.targetDeviceId)) {
                ws.send(JSON.stringify({
                    type: 'sys_ack',
                    status: 'error',
                    message: 'Unauthorized device control request.'
                }));
                return;
            }
        }

        if (packet.type === 'dispatch_control' && isHistoryCommand(packet.action)) {
            const agentKey = `AGENT_${packet.targetDeviceId}`;
            const deviceKey = `DEVICE_${packet.targetDeviceId}`;
            const targetDeviceSocket = activeConnections.get(agentKey) || activeConnections.get(deviceKey);

            if (targetDeviceSocket && targetDeviceSocket.readyState === 1) {
                targetDeviceSocket.send(JSON.stringify({
                    action: packet.action,
                    payload: packet.payload || {},
                    timestamp: new Date()
                }));
                ws.send(JSON.stringify({ type: 'sys_ack', status: 'dispatched', action: packet.action }));
            } else {
                ws.send(JSON.stringify({ type: 'sys_error', message: 'Target system offline on WAN node connection pool.' }));
            }
            return;
        }

        if (packet.type === 'dispatch_control' && SCREEN_ACTION_TOKENS.includes(packet.action)) {
            handleScreenCommand(ws, packet, activeConnections);
            return;
        }

        if (packet.type === 'dispatch_control' && FILE_ACTION_TOKENS.includes(packet.action)) {
            handleFileCommand(ws, packet, activeConnections);
            return;
        }

        if (packet.type === 'dispatch_control' && SHELL_ACTION_TOKENS.includes(packet.action)) {
            handleShellCommand(ws, packet, activeConnections);
            return;
        }

        if (packet.type === 'dispatch_control' && CAMERA_ACTION_TOKENS.includes(packet.action)) {
            handleCameraCommand(ws, packet, activeConnections);
            return;
        }

        if (packet.type === 'sys_ack' && packet.hardware_metrics) {
            if (isScreenAck(packet)) {
                handleScreenTelemetry(ws, packet, activeConnections);
            } else {
                handleCameraTelemetry(ws, packet, activeConnections);
            }
            return;
        }

        if (packet.type === 'dispatch_control') {
            const agentKey = `AGENT_${packet.targetDeviceId}`;
            const deviceKey = `DEVICE_${packet.targetDeviceId}`;
            const targetDeviceSocket = activeConnections.get(agentKey) || activeConnections.get(deviceKey);

            if (targetDeviceSocket && targetDeviceSocket.readyState === 1) {
                targetDeviceSocket.send(JSON.stringify({
                    action: packet.action,
                    payload: packet.payload,
                    timestamp: new Date()
                }));
                ws.send(JSON.stringify({ type: 'sys_ack', status: 'dispatched' }));
            } else {
                ws.send(JSON.stringify({ type: 'sys_error', message: 'Target system offline on WAN node connection pool.' }));
            }
        }
    } catch (err) {
        console.error('Transmission stack failure processing packet:', err.message);
    }
}

// async function handleDeviceStatusUpdate(ws, packet, activeConnections) {
//     const deviceId = extractDeviceIdFromAgentSocket(ws);
//     if (!deviceId) {
//         console.warn('[DEVICE] Agent device_status_update ignored — missing device id');
//         return;
//     }

//     const status = String(packet.status || 'online');
//     const platform = String(packet.platform || 'unknown');
//     const localIp = String(packet.localIp || packet.local_ip || '');
//     const publicIp = String(packet.publicIp || packet.public_ip || '');
//     const lastSeen = packet.timestamp ? new Date(Number(packet.timestamp) * 1000) : new Date();

//     try {
//         await Device.findOneAndUpdate(
//             { deviceId },
//             {
//                 status,
//                 platform,
//                 localIp,
//                 publicIp,
//                 lastSeen,
//             },
//             { new: true, upsert: true }
//         );

//         broadcastDeviceList();

//         const message = JSON.stringify({
//             type: 'device_status_update',
//             deviceId,
//             status,
//             platform,
//             localIp,
//             publicIp,
//             lastSeen: lastSeen.toISOString(),
//         });

//         activeConnections.forEach((clientSocket, key) => {
//             if (key.startsWith('DASHBOARD_') && clientSocket.readyState === 1) {
//                 clientSocket.send(message);
//             }
//         });
//     } catch (err) {
//         console.error('[DEVICE] Failed to persist device_status_update:', err.message);
//     }
// }
async function handleDeviceStatusUpdate(ws, packet, activeConnections) {
    const deviceId = extractDeviceIdFromAgentSocket(ws);

    if (!deviceId) {
        console.warn("[DEVICE] Agent device_status_update ignored — missing device id");
        return;
    }

    const ownerUserId = ws?.authContext?.userId || ws?.authContext?.user?.id || null;
    const metrics = packet.hardware_metrics || {};
    const geo = packet.geolocation || metrics.geolocation || {};

    const status = packet.status || "online";
    const platform = packet.platform || metrics.platform || "unknown";

    const localIp =
        packet.localIp ||
        packet.local_ip ||
        metrics.localIp ||
        metrics.local_ip ||
        "";

    const publicIp =
        packet.publicIp ||
        packet.public_ip ||
        metrics.publicIp ||
        metrics.public_ip ||
        "";

    const battery =
        packet.battery ??
        metrics.battery ??
        metrics.battery_level ??
        null;

    const storage =
        packet.storage ??
        metrics.storage ??
        metrics.storage_percent ??
        null;

    const network =
        packet.network ||
        metrics.network ||
        "";

    const latitude =
        geo.latitude ??
        metrics.latitude ??
        null;

    const longitude =
        geo.longitude ??
        metrics.longitude ??
        null;

    const country =
        geo.country ||
        metrics.country ||
        "";

    const region =
        geo.region ||
        metrics.region ||
        "";

    const city =
        geo.city ||
        metrics.city ||
        "";

    const isp =
        geo.isp ||
        metrics.isp ||
        "";

    const timezone =
        geo.timezone ||
        metrics.timezone ||
        "";

    const hostname =
        packet.hostname ||
        metrics.hostname ||
        "";

    const username =
        packet.username ||
        metrics.username ||
        "";

    const osVersion =
        packet.osVersion ||
        packet.os_version ||
        metrics.osVersion ||
        metrics.os_version ||
        "";

    const architecture =
        packet.architecture ||
        metrics.architecture ||
        "";

    const cpu =
        packet.cpu ||
        metrics.cpu ||
        "";

    const ram =
        packet.ram ??
        metrics.ram ??
        null;

    const lastSeen = packet.timestamp
        ? new Date(Number(packet.timestamp) * 1000)
        : new Date();

    try {
        const update = {
            status,
            platform,
            localIp,
            publicIp,
            battery,
            storage,
            network,
            latitude,
            longitude,
            country,
            region,
            city,
            isp,
            timezone,
            hostname,
            username,
            osVersion,
            architecture,
            cpu,
            ram,
            lastSeen,
        };
        if (ownerUserId) {
            update.userId = ownerUserId;
        }

        await Device.findOneAndUpdate(
            ownerUserId ? { deviceId, userId: ownerUserId } : { deviceId },
            update,
            {
                new: true,
                upsert: true,
            }
        );

        broadcastDeviceList();

        const message = JSON.stringify({
            type: "device_status_update",
            deviceId,
            status,
            platform,
            localIp,
            publicIp,
            battery,
            storage,
            network,
            latitude,
            longitude,
            country,
            region,
            city,
            isp,
            timezone,
            hostname,
            username,
            osVersion,
            architecture,
            cpu,
            ram,
            lastSeen: lastSeen.toISOString(),
        });

        activeConnections.forEach((clientSocket, key) => {
            if (!(key.startsWith("DASHBOARD_") && clientSocket.readyState === 1)) return;
            if (ownerUserId) {
                const dashUserId = clientSocket?.authContext?.user?.id || clientSocket?.authContext?.userId;
                if (String(dashUserId || '') !== String(ownerUserId)) return;
            }
            clientSocket.send(message);
        });

    } catch (err) {
        console.error("[DEVICE] Failed to persist device_status_update:", err.message);
    }
}
async function persistHardwareMetrics(ws, packet, activeConnections) {
    const deviceId = extractDeviceIdFromAgentSocket(ws);
    if (!deviceId) return;

    const ownerUserId = ws?.authContext?.userId || ws?.authContext?.user?.id || null;
    const metrics = packet.hardware_metrics || {};
    const battery = typeof metrics.battery === 'number' ? metrics.battery : (typeof metrics.battery_level === 'number' ? metrics.battery_level : null);
    const storage = typeof metrics.storage === 'number' ? metrics.storage : (typeof metrics.storage_percent === 'number' ? metrics.storage_percent : null);
    const localIp = String(metrics.local_ip || metrics.localIp || packet.localIp || packet.local_ip || '');
    const publicIp = String(metrics.public_ip || metrics.publicIp || packet.publicIp || packet.public_ip || '');
    const platform = String(packet.platform || metrics.platform || 'unknown');
    const status = String(packet.status || 'online');
    const lastSeen = packet.timestamp ? new Date(Number(packet.timestamp) * 1000) : new Date();

    try {
        const update = {
            battery,
            storage,
            localIp,
            publicIp,
            platform,
            status,
            lastSeen,
        };
        if (ownerUserId) {
            update.userId = ownerUserId;
        }

        await Device.findOneAndUpdate(
            ownerUserId ? { deviceId, userId: ownerUserId } : { deviceId },
            update,
            { new: true, upsert: true }
        );

        // Do NOT force broadcastDeviceList here — metrics arrive often and starve WS upgrades.
        // Periodic interval + connect/disconnect force keep the list fresh.

        const message = JSON.stringify({
            type: 'device_status_update',
            deviceId,
            status,
            platform,
            localIp,
            publicIp,
            battery,
            storage,
            lastSeen: lastSeen.toISOString(),
        });

        sendToOwnerDashboards(activeConnections, ownerUserId, message);
    } catch (err) {
        console.error('[DEVICE] Failed to persist hardware metrics:', err.message);
    }
}

async function handleActivityLog(ws, packet, activeConnections) {
    const deviceId = extractDeviceIdFromAgentSocket(ws);
    const userId = ws?.authContext?.userId || ws?.authContext?.user?.id || null;
    if (!deviceId) {
        console.warn('[ACTIVITY] Agent activity_log ignored — missing device id');
        return;
    }

    const metadata = packet.metadata || {};
    const details = String(packet.details || '');
    const processName = String(metadata.process || metadata.processName || '');
    const windowTitle = String(metadata.windowTitle || '');
    const appName = String(metadata.app || metadata.appName || metadata.title || metadata.windowTitle || '');

    const logPayload = {
        deviceId,
        userId,
        action: String(packet.action || 'unknown'),
        category: String(packet.category || 'system'),
        device: String(packet.device || ''),
        details,
        status: String(packet.status || 'success'),
        metadata,
        appName,
        processName,
        windowTitle,
        executablePath: String(metadata.executablePath || metadata.path || details || ''),
    };

    try {
        const log = new ActivityLog(logPayload);
        await log.save();
        console.log(`[ACTIVITY] Persisted activity_log for ${deviceId}: ${logPayload.action}`);

        const message = JSON.stringify({
            type: 'activity_telemetry',
            deviceId,
            log: {
                _id: log._id,
                action: log.action,
                category: log.category,
                device: log.device,
                details: log.details,
                status: log.status,
                metadata: log.metadata,
                appName: log.appName,
                processName: log.processName,
                windowTitle: log.windowTitle,
                executablePath: log.executablePath,
                createdAt: log.createdAt,
            }
        });

        sendToOwnerDashboards(activeConnections, userId, message);
    } catch (err) {
        console.error('[ACTIVITY] Failed to persist activity_log:', err.message);
    }
}

function broadcastAudioBinaryFrame(frameBuffer, activeConnections, sourceWs = null) {
    if (sourceWs) {
        return broadcastOwnerBinary(sourceWs, frameBuffer, activeConnections);
    }
    return 0;
}

function handleSocketBinary(ws, message) {
    if (message.length < 2) return;

    const frameType = message[0];
    const fromAgent = !ws.connectionKey || ws.connectionKey.startsWith('AGENT_') || ws.connectionKey.startsWith('DEVICE_');

    if (!fromAgent && !isBinaryMediaFrame(message)) {
        return;
    }

    if (frameType === FRAME_AUDIO_STREAM) {
        broadcastAudioBinaryFrame(message, activeConnections, ws);
        return;
    }

    if (isFileBinaryFrame(frameType)) {
        broadcastFileBinaryFrame(message, activeConnections, ws);
        return;
    }

    if (isScreenBinaryFrame(frameType)) {
        broadcastScreenBinaryFrame(message, activeConnections, ws);
        return;
    }

    if (frameType !== FRAME_STREAM && frameType !== FRAME_SNAPSHOT && frameType !== FRAME_RAW_RGB) {
        return;
    }

    broadcastBinaryFrame(message, activeConnections, frameType, ws);
}

function handleSocketClose(ws) {
    if (!ws.connectionKey) return;

    const current = activeConnections.get(ws.connectionKey);
    if (current !== ws) {
        console.log(`[GATEWAY] Ignoring stale close for ${ws.connectionKey} (replaced by newer socket).`);
        return;
    }

    const key = ws.connectionKey;
    const wasAgent = key.startsWith('AGENT_') || key.startsWith('DEVICE_');
    const deviceId = wasAgent
        ? String(key.replace(/^AGENT_/, '').replace(/^DEVICE_/, ''))
        : '';

    activeConnections.delete(key);
    console.log(`Connection dropped and connection memory freed: ${key}`);

    if (wasAgent && deviceId) {
        const ownerUserId = extractOwnerUserId(ws);
        const filter = ownerUserId ? { deviceId, userId: ownerUserId } : { deviceId };
        void Device.updateOne(
            filter,
            { $set: { status: 'offline', lastSeen: new Date() } }
        ).catch((err) => {
            console.warn('[GATEWAY] Failed to mark device offline:', err?.message || err);
        });
    }

    void broadcastDeviceList({ force: true });
}

module.exports = {
    handleSocketMessage,
    handleSocketClose,
    getLiveDeviceOptions,
    broadcastDeviceList,
    activeConnections,
};
