#!/usr/bin/env node
/**
 * =========================================================================
 * ZENVORA AGENT LIVE INSPECTOR & DIAGNOSTIC MONITOR
 * =========================================================================
 * Realtime log tracker showing:
 * 1. How Agent communicates (packets, payloads, latency)
 * 2. When Agent goes offline, HOW and WHY (close code, reason, grace period)
 * 3. How Server routes and manages every message
 * 4. How MongoDB / MySQL updates and persists device state
 *
 * Usage:
 *   node scripts/agent-logs.js             # Live stream all agent events
 *   node scripts/agent-logs.js --recent 50 # Show last 50 events
 *   node scripts/agent-logs.js --explain   # Full architectural breakdown
 *   node scripts/agent-logs.js --device ID # Filter by specific device
 * =========================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const http = require('http');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

// ANSI Colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const BG_BLUE = '\x1b[44m';

const args = process.argv.slice(2);
const isExplain = args.includes('--explain') || args.includes('-e');
const isHelp = args.includes('--help') || args.includes('-h');
const deviceFilterIndex = args.indexOf('--device');
const targetDevice = deviceFilterIndex !== -1 ? args[deviceFilterIndex + 1] : null;
const recentIndex = args.indexOf('--recent');
const recentLimit = recentIndex !== -1 ? Number(args[recentIndex + 1]) || 50 : 25;

if (isHelp) {
    console.log(`
${BOLD}${CYAN}Zenvora Agent Live Inspector & Diagnostic Monitor${RESET}

${BOLD}COMMANDS:${RESET}
  ${GREEN}node scripts/agent-logs.js${RESET}             Live real-time stream of all events
  ${GREEN}node scripts/agent-logs.js --recent 50${RESET}   Show last 50 events then stream
  ${GREEN}node scripts/agent-logs.js --device <id>${RESET} Filter events for a specific device
  ${GREEN}node scripts/agent-logs.js --explain${RESET}     Detailed explanation of Agent AI & Flow
  ${GREEN}node scripts/agent-logs.js --help${RESET}        Show this help message
`);
    process.exit(0);
}

if (isExplain) {
    printArchitectureExplanation();
    process.exit(0);
}

function printHeader() {
    console.clear();
    console.log(`${CYAN}╔══════════════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${CYAN}║     ${BOLD}${WHITE}ZENVORA REALTIME AGENT & SERVER DIAGNOSTIC MONITOR${RESET}${CYAN}          ║${RESET}`);
    console.log(`${CYAN}╚══════════════════════════════════════════════════════════════════╝${RESET}`);
    console.log(`${DIM}Connecting to local Zenvora server on port ${PORT}...${RESET}`);
}

function printArchitectureExplanation() {
    console.log(`
${BOLD}${CYAN}╔════════════════════════════════════════════════════════════════════════════╗${RESET}
${BOLD}${CYAN}║            ZENVORA AGENT & SERVER ARCHITECTURE DEEP-DIVE                   ║${RESET}
${BOLD}${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${RESET}

${BOLD}${YELLOW}1. AGENT KAISE BAAT KARTA HAI? (COMMUNICATION PROTOCOL)${RESET}
  • Agent target machine (Windows / Mac / Linux) par ek lightweight binary / service hai.
  • Yeh server ke sath WebSocket connection banata hai:
    ${GREEN}ws://<SERVER_IP>:3000/ws/gateway${RESET}
  • Connection bante hi Agent ek JSON packet bhejta hai:
    ${CYAN}{
      "type": "register_channel",
      "role": "AGENT",
      "id": "<DEVICE_ID>",
      "authToken": "<DEVICE_SECRET_TOKEN>",
      "platform": "win32 | darwin | linux"
    }${RESET}
  • Server is token ko MongoDB / Memory me verify karta hai.
  • Agar token valid ho:
    - Server socket ko ${GREEN}activeConnections${RESET} map me save karta hai: ${MAGENTA}AGENT_<DEVICE_ID>${RESET}
    - Server auto IP-based Geo lookup karta hai (City, Country, ISP) agar DB me location na ho.
    - Server dashboard ko ${GREEN}{ type: "device_status_update", status: "online" }${RESET} push karta hai.

${BOLD}${YELLOW}2. SERVER MESSAGE KO KAHAN AUR KAISE MANAGE KARTA HAI?${RESET}
  ${WHITE}A. Inbound Agent Messages:${RESET}
     • ${CYAN}agent_ping:${RESET} Server immediately respond karta hai ${GREEN}agent_pong${RESET} (Keepalive heartbeat).
     • ${CYAN}device_status_update:${RESET} Agent bhejta hai (Battery %, CPU %, RAM, Storage %, Local IP, Geolocation).
       → Server debounce queue (${MAGENTA}pendingMetricsDb${RESET}) me rakhta hai taake DB par flood na ho.
       → Server foran owner ke sabhi open Dashboards ko fan-out push karta hai via WebSocket.
     • ${CYAN}sys_ack / shell_output / file_result:${RESET} Agent command execution result wapis bhejta hai.
       → Server user ke dashboard session ko deliver karta hai.

  ${WHITE}B. Outbound Dashboard Commands:${RESET}
     • User dashboard par click karta hai (e.g. Screen View, Shell Command, Camera, File Explorer).
     • Dashboard bhejta hai: ${CYAN}{ type: "dispatch_control", action: "...", targetDeviceId: "..." }${RESET}
     • Server check karta hai:
       1. Kya user is device ka verified owner/admin hai? (Auth check)
       2. Kya agent ${GREEN}activeConnections${RESET} me online hai?
       3. Agar online hai, to packet seedha agent ke WebSocket par dispatch hota hai.
       4. Agar offline hai, to error ata hai: "Target system offline".

${BOLD}${YELLOW}3. DATABASE (MONGODB) ME KESE HANDLE HOTA HAI?${RESET}
  • ${BOLD}Collection:${RESET} ${MAGENTA}devices${RESET}
  • Har physical machine ka ek unique document hota hai (${CYAN}deviceId${RESET}).
  • ${BOLD}Fields:${RESET}
    - ${WHITE}status:${RESET} 'online' | 'offline' | 'away'
    - ${WHITE}lastSeen:${RESET} Latest heartbeat / status timestamp
    - ${WHITE}localIp & publicIp:${RESET} Device LAN & WAN IP addresses
    - ${WHITE}latitude & longitude, city, country:${RESET} Geolocation coordinates
    - ${WHITE}battery, cpu, ram, storage:${RESET} Real-time hardware telemetry
    - ${WHITE}userId:${RESET} Device ka owner account ID

${BOLD}${YELLOW}4. AGENT KAB OFFLINE HOTA HAI, KAISE AUR KYON?${RESET}
  • Jab Agent ka socket drop hota hai, WebSocket disconnect event trigger hota hai:
    - ${RED}Code 1000:${RESET} Normal closure (service stopped / PC shut down cleanly)
    - ${RED}Code 1006:${RESET} Abnormal closure (WiFi lost / network cable unplugged / OS killed process / power cut)
    - ${RED}Code 4001:${RESET} Auth timeout (agent handshake incomplete within 15 seconds)
  
  • ${BOLD}${YELLOW}45-SECOND GRACE PERIOD SYSTEM:${RESET}
    - Network drops me aksar WiFi 5-10 second me reconnect ho jata hai.
    - Agar Zenvora foran offline mark kar de to dashboard bar bar flicker karega!
    - Is liye server pehle socket ko ${MAGENTA}activeConnections${RESET} se remove karta hai,
      aur ${YELLOW}45 seconds ka Grace Timer${RESET} start karta hai.
    - Agar 45 seconds ke andar agent dobara connect ho jaye:
      → Server offline update cancel karta hai aur device ${GREEN}ONLINE${RESET} rehta hai!
    - Agar 45 seconds guzar jayein aur agent reconnect na ho:
      → MongoDB me query chalti hai:
        ${RED}Device.updateOne({ deviceId }, { $set: { status: 'offline', lastSeen: new Date() } })${RESET}
      → Dashboard ko notify kiya jata hai ke device ab pakka OFFLINE ho gaya hai.
`);
}

function formatLogEntry(entry) {
    const time = entry.ts ? entry.ts.split('T')[1].replace('Z', '') : new Date().toISOString().split('T')[1].slice(0, 8);
    const channel = (entry.channel || 'sys').toUpperCase().padEnd(6);
    const level = (entry.level || 'info').toLowerCase();
    const dev = entry.deviceId ? `[${entry.deviceId.slice(0, 14)}]` : '';

    let levelBadge = `${DIM}[INFO]${RESET}`;
    if (level === 'error') levelBadge = `${RED}${BOLD}[ERR] ${RESET}`;
    else if (level === 'warn') levelBadge = `${YELLOW}${BOLD}[WARN]${RESET}`;
    else if (level === 'ok') levelBadge = `${GREEN}${BOLD}[ OK ]${RESET}`;

    let channelColor = CYAN;
    if (channel.startsWith('AGENT')) channelColor = GREEN;
    else if (channel.startsWith('MONGO') || channel.startsWith('DB')) channelColor = MAGENTA;
    else if (channel.startsWith('NODE')) channelColor = BLUE;
    else if (channel.startsWith('HTTP')) channelColor = WHITE;

    // Highlight key words
    let msg = entry.message || '';
    if (msg.includes('DISCONNECT') || msg.includes('OFFLINE') || msg.includes('dropped')) {
        msg = `${RED}${BOLD}${msg}${RESET}`;
    } else if (msg.includes('registered') || msg.includes('RECONNECT') || msg.includes('ONLINE')) {
        msg = `${GREEN}${BOLD}${msg}${RESET}`;
    } else if (msg.includes('Status update') || msg.includes('METRICS')) {
        msg = `${CYAN}${msg}${RESET}`;
    } else if (msg.includes('Grace period')) {
        msg = `${YELLOW}${msg}${RESET}`;
    }

    return `${DIM}${time}${RESET} ${channelColor}[${channel}]${RESET} ${levelBadge} ${dev ? `${MAGENTA}${dev}${RESET} ` : ''}${msg}`;
}

async function fetchInitialStatus() {
    return new Promise((resolve) => {
        const req = http.get(
            {
                hostname: HOST,
                port: PORT,
                path: `/api/live-logs?limit=${recentLimit}&monitor=true`,
                headers: { 'x-internal-monitor': 'true' },
                timeout: 5000,
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        resolve(null);
                    }
                });
            }
        );
        req.on('error', () => resolve(null));
    });
}

function startStream() {
    printHeader();

    fetchInitialStatus().then((initial) => {
        if (!initial || !initial.ok) {
            console.log(`${RED}❌ Could not connect to Zenvora server on http://${HOST}:${PORT}${RESET}`);
            console.log(`${YELLOW}Please make sure the server is running: npm run dev${RESET}`);
            process.exit(1);
        }

        console.log(`\n${BOLD}SYSTEM HEALTH SNAPSHOT:${RESET}`);
        console.log(`  • Server Uptime:    ${GREEN}${Math.round(initial.uptime || 0)}s${RESET}`);
        console.log(`  • Active Agents:    ${BOLD}${initial.agents > 0 ? GREEN : YELLOW}${initial.agents} connected${RESET}`);
        console.log(`  • Dashboards:       ${initial.dashboards} connected`);
        console.log(`  • MongoDB Status:   ${initial.mongo ? `${GREEN}Connected OK${RESET}` : `${RED}Disconnected${RESET}`}`);
        console.log(`  • Filtering Device: ${targetDevice ? `${CYAN}${targetDevice}${RESET}` : `${DIM}All Devices${RESET}`}`);
        console.log(`\n${CYAN}═══ RECENT EVENTS (LAST ${recentLimit}) ═══${RESET}`);

        const logs = initial.logs || [];
        const filtered = targetDevice ? logs.filter((l) => !l.deviceId || l.deviceId === targetDevice) : logs;
        if (filtered.length === 0) {
            console.log(`${DIM}No recent events recorded yet.${RESET}`);
        } else {
            filtered.forEach((entry) => console.log(formatLogEntry(entry)));
        }

        console.log(`\n${GREEN}═══ LIVE EVENT STREAMING (Press Ctrl+C to stop) ═══${RESET}\n`);

        connectSSE();
    });
}

function connectSSE() {
    const streamUrl = `/api/live-logs/stream?monitor=true${targetDevice ? `&device=${encodeURIComponent(targetDevice)}` : ''}`;
    const req = http.get(
        {
            hostname: HOST,
            port: PORT,
            path: streamUrl,
            headers: {
                'x-internal-monitor': 'true',
                Accept: 'text/event-stream',
            },
        },
        (res) => {
            if (res.statusCode !== 200) {
                console.log(`${RED}SSE Stream connection failed with status code ${res.statusCode}${RESET}`);
                setTimeout(connectSSE, 3000);
                return;
            }

            let buffer = '';
            res.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
                const lines = buffer.split('\n\n');
                buffer = lines.pop(); // Keep incomplete chunk

                for (const block of lines) {
                    for (const line of block.split('\n')) {
                        if (line.startsWith('data: ')) {
                            try {
                                const payload = JSON.parse(line.slice(6));
                                if (payload.type === 'stream_connected') continue;
                                if (targetDevice && payload.deviceId && payload.deviceId !== targetDevice) continue;
                                console.log(formatLogEntry(payload));
                            } catch (_) {}
                        }
                    }
                }
            });

            res.on('end', () => {
                console.log(`${YELLOW}Stream disconnected. Reconnecting in 2s...${RESET}`);
                setTimeout(connectSSE, 2000);
            });
        }
    );

    req.on('error', (err) => {
        console.log(`${RED}Stream connection error: ${err.message}. Retrying in 3s...${RESET}`);
        setTimeout(connectSSE, 3000);
    });
}

startStream();
