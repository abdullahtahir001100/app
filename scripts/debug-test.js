#!/usr/bin/env node
/**
 * ============================================================
 * Zenvora Full Debug Test Script
 * Tests: DB → Server → WebSocket → Agent Registration → Commands
 * Run: node scripts/debug-test.js
 * ============================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const mongoose = require('mongoose');

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const WS_URL = process.env.ZENVORA_GATEWAY_URL || 'ws://localhost:3000/ws/gateway';
const MONGO_URI = process.env.MONGODB_URI;

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

let passed = 0;
let failed = 0;
let warnings = 0;

function ok(msg) { console.log(`${GREEN}✅ PASS${RESET} ${msg}`); passed++; }
function fail(msg, detail = '') { console.log(`${RED}❌ FAIL${RESET} ${msg}${detail ? ` — ${detail}` : ''}`); failed++; }
function warn(msg) { console.log(`${YELLOW}⚠️  WARN${RESET} ${msg}`); warnings++; }
function info(msg) { console.log(`${CYAN}ℹ️  INFO${RESET} ${msg}`); }
function section(title) { console.log(`\n${BOLD}${MAGENTA}═══ ${title} ═══${RESET}`); }

function httpGet(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(body), raw: body }); }
                catch { resolve({ status: res.statusCode, body: null, raw: body }); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function testEnvConfig() {
    section('1. ENV CONFIG CHECK');
    
    const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL;
    const ZENVORA_GATEWAY_URL = process.env.ZENVORA_GATEWAY_URL;
    const JWT_SECRET = process.env.JWT_SECRET;
    const MONGO_URI_SET = Boolean(MONGO_URI);

    info(`API URL: ${NEXT_PUBLIC_API_URL || 'NOT SET'}`);
    info(`Gateway URL: ${ZENVORA_GATEWAY_URL || 'NOT SET'}`);
    info(`NODE_ENV: ${process.env.NODE_ENV || 'NOT SET'}`);

    if (NEXT_PUBLIC_API_URL && !NEXT_PUBLIC_API_URL.includes('localhost') && !NEXT_PUBLIC_API_URL.includes('127.0.0.1')) {
        ok(`NEXT_PUBLIC_API_URL is non-localhost: ${NEXT_PUBLIC_API_URL}`);
    } else if (NEXT_PUBLIC_API_URL && (NEXT_PUBLIC_API_URL.includes('localhost') || NEXT_PUBLIC_API_URL.includes('127.0.0.1'))) {
        fail('NEXT_PUBLIC_API_URL is localhost — remote agents will NEVER connect', NEXT_PUBLIC_API_URL);
    } else {
        fail('NEXT_PUBLIC_API_URL is not set');
    }

    if (ZENVORA_GATEWAY_URL && !ZENVORA_GATEWAY_URL.includes('localhost') && !ZENVORA_GATEWAY_URL.includes('127.0.0.1')) {
        ok(`ZENVORA_GATEWAY_URL is non-localhost: ${ZENVORA_GATEWAY_URL}`);
    } else {
        fail('ZENVORA_GATEWAY_URL is localhost — agents cannot connect to WebSocket', ZENVORA_GATEWAY_URL);
    }

    if (MONGO_URI_SET) {
        ok('MONGODB_URI is set');
    } else {
        fail('MONGODB_URI is not set');
    }

    if (JWT_SECRET) {
        ok('JWT_SECRET is set');
    } else {
        fail('JWT_SECRET is not set');
    }

    // Check LAN IP usage
    const lanIp = NEXT_PUBLIC_API_URL?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1];
    if (lanIp) {
        info(`Detected LAN IP in config: ${lanIp}`);
        if (lanIp.startsWith('192.168.') || lanIp.startsWith('10.') || lanIp.startsWith('172.')) {
            ok(`LAN IP is private range — good for local testing`);
        }
    }
}

async function testServerHealth() {
    section('2. SERVER HEALTH CHECK');
    
    info(`Testing: ${BASE_URL}/api/health`);
    try {
        const { status, body } = await httpGet(`${BASE_URL}/api/health`, 8000);
        if (status === 200 && body?.ok) {
            ok(`Server is UP (uptime: ${body.uptime?.toFixed(0)}s)`);
            info(`  Agents connected: ${body.agents}`);
            info(`  Dashboards connected: ${body.dashboards}`);
            info(`  Control TCP agents: ${body.controlTcp}`);
            info(`  MongoDB OK: ${body.mongo}`);
            if (!body.mongo) {
                fail('MongoDB is NOT connected — check MONGODB_URI');
            } else {
                ok('MongoDB connected');
            }
            if (body.agents > 0) {
                ok(`${body.agents} agent(s) currently connected`);
            } else {
                warn('No agents currently connected (this is expected if no agent is running)');
            }
        } else {
            fail(`Server health check failed (status: ${status})`);
        }
    } catch (err) {
        fail(`Server is DOWN or not reachable at ${BASE_URL}`, err.message);
    }
}

async function testMyIp() {
    section('3. IP DETECTION CHECK');
    
    try {
        const { status, body } = await httpGet(`${BASE_URL}/api/network/my-ip`);
        if (status === 200 && body?.ip) {
            ok(`/api/network/my-ip returned: ${body.ip}`);
            if (body.ip === '127.0.0.1' || body.ip === '::1') {
                warn('IP returned is loopback — may cause LAN routing issues');
            }
            if (body.ip.startsWith('192.168.') || body.ip.startsWith('10.')) {
                info('IP is LAN range — when using LAN IP, direct mode may trigger incorrectly for remote devices');
            }
        } else {
            fail('/api/network/my-ip failed');
        }
    } catch (err) {
        fail('/api/network/my-ip unreachable', err.message);
    }
}

async function testMongoDB() {
    section('4. MONGODB DIRECT CONNECTION TEST');
    
    if (!MONGO_URI) {
        fail('MONGODB_URI not set, skipping direct DB test');
        return null;
    }
    
    info(`Connecting to MongoDB...`);
    try {
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
        ok('MongoDB connected successfully');
        
        // Check Device collection
        const Device = require('../server/models/Device');
        const deviceCount = await Device.countDocuments();
        info(`Devices in DB: ${deviceCount}`);
        
        if (deviceCount > 0) {
            const devices = await Device.find().sort({ lastSeen: -1 }).limit(5).lean();
            info('Last 5 devices:');
            for (const d of devices) {
                console.log(`   ${CYAN}→${RESET} deviceId=${d.deviceId} platform=${d.platform} status=${d.status}`);
                console.log(`     localIp=${d.localIp || 'EMPTY'} publicIp=${d.publicIp || 'EMPTY'}`);
                console.log(`     lat=${d.latitude ?? 'NULL'} lon=${d.longitude ?? 'NULL'} city=${d.city || 'EMPTY'} country=${d.country || 'EMPTY'}`);
                console.log(`     lastSeen=${d.lastSeen?.toISOString() || 'NULL'}`);
                
                if (!d.localIp && !d.publicIp) {
                    warn(`Device ${d.deviceId}: NO IP data — agent never sent status update (likely wrong gateway URL)`);
                }
                if (!d.latitude && !d.longitude) {
                    warn(`Device ${d.deviceId}: NO geo data — agent never sent geolocation`);
                }
                if (d.status === 'online') {
                    warn(`Device ${d.deviceId}: DB says 'online' — but this may be stale. Check /api/network/devices for live status`);
                }
            }
        } else {
            warn('No devices in DB yet');
        }
        
        return mongoose;
    } catch (err) {
        fail(`MongoDB connection failed: ${err.message}`);
        return null;
    }
}

async function testWebSocketGateway() {
    section('5. WEBSOCKET GATEWAY TEST');
    
    info(`Testing WS at: ${WS_URL}`);
    
    return new Promise((resolve) => {
        const ws = new WebSocket(WS_URL, { handshakeTimeout: 8000 });
        let timedOut = false;
        
        const timer = setTimeout(() => {
            timedOut = true;
            ws.terminate();
            fail('WebSocket connection TIMED OUT — server may not be running or WS URL wrong');
            resolve();
        }, 10000);
        
        ws.on('open', () => {
            ok(`WebSocket gateway CONNECTED: ${WS_URL}`);
            
            // Test register as agent (will fail auth, but tests connection)
            ws.send(JSON.stringify({
                type: 'register_channel',
                role: 'AGENT',
                id: 'DEBUG-TEST-DEVICE-001',
                authToken: 'invalid-test-token',
                platform: 'mac',
            }));
            info('Sent register_channel as AGENT (expect auth_failed or duplicate response)');
        });
        
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                info(`WS received: type=${msg.type} status=${msg.status || msg.code || '-'}`);
                
                if (msg.type === 'sys_ack' && msg.status === 'auth_failed') {
                    ok('Gateway correctly rejected invalid agent token (auth working)');
                } else if (msg.type === 'sys_ack' && msg.status === 'ready') {
                    ok('Gateway accepted connection — agent authenticated!');
                } else if (msg.type === 'sys_ack' && msg.status === 'duplicate') {
                    warn('Gateway says duplicate — another agent with this deviceId is connected');
                } else {
                    info(`Gateway response: ${JSON.stringify(msg)}`);
                }
            } catch {
                info(`WS non-JSON message: ${data.toString().slice(0, 100)}`);
            }
            
            clearTimeout(timer);
            ws.close();
            resolve();
        });
        
        ws.on('error', (err) => {
            if (!timedOut) {
                clearTimeout(timer);
                fail(`WebSocket error: ${err.message}`);
                if (err.message.includes('ECONNREFUSED')) {
                    fail('Server is NOT running — start with: npm run dev');
                }
                resolve();
            }
        });
        
        ws.on('close', () => {
            if (!timedOut) {
                clearTimeout(timer);
                resolve();
            }
        });
    });
}

async function testDeviceList() {
    section('6. DEVICE LIST & STATUS CHECK');
    
    // This needs auth token — skip detailed test but check endpoint exists
    try {
        const { status } = await httpGet(`${BASE_URL}/api/network/devices`);
        if (status === 401 || status === 403) {
            ok('/api/network/devices exists (requires auth as expected)');
        } else if (status === 200) {
            warn('/api/network/devices returned 200 without auth — check auth middleware');
        } else {
            info(`/api/network/devices status: ${status}`);
        }
    } catch (err) {
        fail('/api/network/devices unreachable', err.message);
    }
}

async function testPublicUrlResolution() {
    section('7. PUBLIC URL RESOLUTION LOGIC');
    
    const { resolvePublicApiBase, resolvePublicGatewayUrl } = require('../server/utils/publicUrls');
    
    // Simulate a local request (no x-forwarded-for)
    const mockLocalReq = {
        headers: { host: '192.168.100.9:3000' },
        get: (h) => mockLocalReq.headers[h.toLowerCase()],
        socket: { remoteAddress: '192.168.100.9' },
        protocol: 'http',
    };
    
    const apiBase = resolvePublicApiBase(mockLocalReq, null);
    const gwUrl = resolvePublicGatewayUrl(mockLocalReq, null);
    
    info(`Resolved API base: ${apiBase}`);
    info(`Resolved Gateway URL: ${gwUrl}`);
    
    if (apiBase.includes('localhost') || apiBase.includes('127.0.0.1')) {
        fail('resolvePublicApiBase returning localhost for LAN request — agents will not connect!');
    } else {
        ok(`resolvePublicApiBase OK: ${apiBase}`);
    }
    
    if (gwUrl.includes('localhost') || gwUrl.includes('127.0.0.1')) {
        fail('resolvePublicGatewayUrl returning localhost — agents will not connect to WS!');
    } else {
        ok(`resolvePublicGatewayUrl OK: ${gwUrl}`);
    }
    
    // Simulate agent download URL
    const downloadUrl = `${apiBase}/api/agent/download`;
    info(`Agent would download from: ${downloadUrl}`);
    
    // Test the download endpoint
    try {
        const { status, body } = await httpGet(`${BASE_URL}/api/agent/download?platform=windows`);
        if (status === 200) {
            ok('Agent Windows binary download endpoint works');
        } else if (status === 404) {
            warn(`Agent binary missing (404) — place ZenvoraAgent.exe in public/downloads/`);
            if (body?.message) info(`  Message: ${body.message}`);
        } else {
            info(`Agent download status: ${status}`);
        }
    } catch (err) {
        fail('Agent download endpoint unreachable', err.message);
    }
    
    // Mac binary
    try {
        const { status } = await httpGet(`${BASE_URL}/api/agent/download?platform=mac&format=binary`);
        if (status === 200) {
            ok('Agent Mac binary exists');
        } else {
            warn('Mac agent binary missing — place ZenvoraAgent-mac in public/downloads/');
        }
    } catch {}
}

async function testAgentStatusFlow() {
    section('8. AGENT STATUS FLOW ANALYSIS');
    
    info('Tracing: Agent connects → register_channel → device_status_update → DB');
    info('');
    info('Expected flow:');
    console.log(`   ${CYAN}1.${RESET} Agent downloads binary from /api/agent/download?platform=...`);
    console.log(`   ${CYAN}2.${RESET} Agent runs --headless --pair-token TOKEN --api-url ${BASE_URL}`);
    console.log(`   ${CYAN}3.${RESET} Agent POSTs to /api/agent/pair (creates device in DB)`);
    console.log(`   ${CYAN}4.${RESET} Agent connects WebSocket to ${WS_URL}`);
    console.log(`   ${CYAN}5.${RESET} Agent sends: { type: 'register_channel', role: 'AGENT', id: 'DEVICE_ID', authToken: '...' }`);
    console.log(`   ${CYAN}6.${RESET} Server validates authToken → adds to activeConnections map`);
    console.log(`   ${CYAN}7.${RESET} Agent sends: { type: 'device_status_update', status: 'online', localIp: '...', geolocation: {...} }`);
    console.log(`   ${CYAN}8.${RESET} Server pushes to owner dashboards: { type: 'device_status_update' }`);
    console.log(`   ${CYAN}9.${RESET} Dashboard shows device as ONLINE with correct location`);
    
    info('');
    info('Common failure points:');
    console.log(`   ${RED}→${RESET} Step 2-4: Wrong --api-url or --gateway-url (localhost) → agent can't reach server`);
    console.log(`   ${RED}→${RESET} Step 6: authToken invalid → auth_failed → agent closes`);
    console.log(`   ${RED}→${RESET} Step 7: Agent connected but status stuck "offline" → register_channel failed`);
    console.log(`   ${RED}→${RESET} Status shows "online" but commands fail → socket open but NOT in activeConnections`);
}

async function printSummary() {
    section('SUMMARY');
    console.log(`${GREEN}Passed:${RESET}   ${passed}`);
    console.log(`${RED}Failed:${RESET}   ${failed}`);
    console.log(`${YELLOW}Warnings:${RESET} ${warnings}`);
    
    if (failed > 0) {
        console.log(`\n${RED}${BOLD}🔴 ISSUES FOUND — see failures above${RESET}`);
    } else if (warnings > 0) {
        console.log(`\n${YELLOW}${BOLD}🟡 MINOR ISSUES — check warnings${RESET}`);
    } else {
        console.log(`\n${GREEN}${BOLD}🟢 ALL CHECKS PASSED${RESET}`);
    }
    
    console.log(`\n${BOLD}Quick Fix Checklist:${RESET}`);
    console.log('  1. .env mein LAN IP use karo (localhost ki jagah): 192.168.100.9');
    console.log('  2. Server restart karo: npm run dev');
    console.log('  3. Agent binary place karo: public/downloads/ZenvoraAgent.exe (Win) or ZenvoraAgent-mac (Mac)');
    console.log('  4. Naya bootstrap ticket generate karo (puraana localhost URLs wala expire hoga)');
    console.log('  5. Agent install karo naye ticket se');
}

(async () => {
    console.log(`${BOLD}${MAGENTA}`);
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║    ZENVORA FULL SYSTEM DEBUG TESTER v1.0     ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(RESET);
    
    await testEnvConfig();
    await testServerHealth();
    await testMyIp();
    await testMongoDB().catch(() => {});
    await testWebSocketGateway();
    await testDeviceList();
    await testPublicUrlResolution();
    await testAgentStatusFlow();
    
    await printSummary();
    
    try { await mongoose.disconnect(); } catch {}
    process.exit(failed > 0 ? 1 : 0);
})();
