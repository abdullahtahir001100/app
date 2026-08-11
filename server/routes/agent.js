const express = require('express');
const fs = require('fs');
const path = require('path');
const {
    createTicket,
    getTicket,
    buildInstallScript,
    buildBootstrapCommand,
    buildBootstrapCommandCurl,
    buildBootstrapCommandCmd,
} = require('../services/bootstrapTicketService');
const liveLogBus = require('../services/liveLogBus');
const { verifyUserTokenFast, AUTH_COOKIE } = require('../services/authService');

const router = express.Router();

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    String(header).split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx <= 0) return;
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return out;
}

function requireUserFast(req, res, next) {
    const authHeader = req.headers?.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const cookies = parseCookies(req.headers?.cookie || '');
    const token = bearer || req.cookies?.[AUTH_COOKIE] || cookies[AUTH_COOKIE] || null;
    const user = verifyUserTokenFast(token);
    if (!user?.sub) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    req.user = { id: String(user.sub), email: user.email, role: user.role, name: user.name };
    return next();
}

function candidatePaths() {
    const cwd = process.cwd();
    const envPath = process.env.AGENT_BINARY_PATH;
    return [
        envPath,
        path.join(cwd, 'public', 'downloads', 'ZenvoraAgent.exe'),
        path.join(cwd, 'public', 'downloads', 'win_32.exe'),
        path.join(cwd, 'zenvora_agent', 'target', 'release', 'ZenvoraAgent.exe'),
        path.join(cwd, 'zenvora_agent', 'target', 'release', 'deps', 'ZenvoraAgent.exe'),
        path.join(cwd, 'zenvora_agent', 'target', 'release', 'win_32.exe'),
        path.join(cwd, 'zenvora_agent', 'target', 'release', 'deps', 'win_32.exe'),
    ].filter(Boolean);
}

function findAgentBinary() {
    return candidatePaths().find((p) => {
        try {
            return fs.existsSync(p) && fs.statSync(p).isFile();
        } catch {
            return false;
        }
    }) || null;
}

/** Auth: create short bootstrap code for dashboard copy command. */
router.post('/bootstrap', express.json(), requireUserFast, (req, res) => {
    const pairingToken = String(req.body?.pairingToken || '').trim();
    const pairingUserId = String(req.body?.pairingUserId || '').trim();
    const sessionId = String(req.body?.sessionId || `web-${Date.now().toString(36)}`);

    if (!pairingToken || !pairingUserId) {
        return res.status(400).json({ success: false, message: 'pairingToken and pairingUserId required' });
    }

    const host = `${req.protocol}://${req.get('host')}`;
    const apiBase = String(req.body?.apiBase || host).replace(/\/$/, '');
    const defaultWsScheme = apiBase.startsWith('https://') ? 'wss' : 'ws';
    let gatewayUrl = String(
        req.body?.gatewayUrl
        || process.env.NEXT_PUBLIC_GATEWAY_URL
        || process.env.ZENVORA_GATEWAY_URL
        || `${defaultWsScheme}://${req.get('host')}/ws/gateway`
    );
    // Local/http installs must not get wss:// (TLS will hang the handshake).
    if (apiBase.startsWith('http://') && gatewayUrl.startsWith('wss://')) {
        gatewayUrl = gatewayUrl.replace(/^wss:\/\//i, 'ws://');
    } else if (apiBase.startsWith('https://') && gatewayUrl.startsWith('ws://')) {
        gatewayUrl = gatewayUrl.replace(/^ws:\/\//i, 'wss://');
    }
    const downloadUrl = String(
        req.body?.downloadUrl
        || process.env.NEXT_PUBLIC_AGENT_DOWNLOAD_URL
        || `${apiBase}/api/agent/download`
    );

    const ticket = createTicket({
        userId: req.user.id,
        pairingToken,
        pairingUserId,
        sessionId,
        apiBase,
        gatewayUrl,
        downloadUrl,
    });

    const command = buildBootstrapCommand(apiBase, ticket.code);
    const commandCurl = buildBootstrapCommandCurl(apiBase, ticket.code);
    const commandCmd = buildBootstrapCommandCmd(apiBase, ticket.code);

    liveLogBus.push({
        channel: 'install',
        level: 'info',
        message: `bootstrap ticket ${ticket.code} created`,
        userId: req.user.id,
        meta: { sessionId, code: ticket.code },
    });

    return res.status(200).json({
        success: true,
        code: ticket.code,
        command,
        commandCurl,
        commandCmd,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        sessionId: ticket.sessionId,
    });
});

/**
 * Stream agent EXE — avoids loading whole binary into memory (fixes download stuck).
 */
router.get('/download', (req, res) => {
    const filePath = findAgentBinary();
    if (!filePath) {
        liveLogBus.push({
            channel: 'http',
            level: 'error',
            message: 'agent download 404 — ZenvoraAgent.exe / win_32.exe missing',
            route: '/api/agent/download',
        });
        return res.status(404).json({
            success: false,
            message: 'Agent binary not found. Place ZenvoraAgent.exe in public/downloads/.',
        });
    }

    const stat = fs.statSync(filePath);
    liveLogBus.push({
        channel: 'http',
        level: 'info',
        message: `agent download start (${stat.size} bytes)`,
        route: '/api/agent/download',
    });

    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="ZenvoraAgent.exe"');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
        liveLogBus.push({
            channel: 'http',
            level: 'error',
            message: `agent download stream error: ${err.message}`,
            route: '/api/agent/download',
        });
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
    });
    stream.pipe(res);
});

function getGeminiApiKey(settings = {}) {
    const direct = typeof settings.apiKey === 'string' ? settings.apiKey.trim() : '';
    if (direct) return direct;
    return (
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
        ''
    );
}

async function generateGeminiChat({ draft, messages, settings, capabilities, context }) {
    const apiKey = getGeminiApiKey(settings || {});
    if (!apiKey) {
        throw new Error('Gemini API key not found.');
    }

    const model =
        typeof settings?.model === 'string' && settings.model.trim()
            ? settings.model.trim()
            : 'gemini-2.5-flash';

    const history = (Array.isArray(messages) ? messages : [])
        .slice(-20)
        .map((m) => ({
            role: m?.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(m?.text || '') }],
        }))
        .filter((m) => m.parts[0].text.trim().length > 0);

    const enabledCapabilities = Object.entries(capabilities || {})
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k);

    const systemInstruction = `
You are Zenvora AI, an autonomous Windows execution agent.

MISSION:
Convert natural language requests into executable Windows terminal commands.

SESSION MEMORY:

Current directory:
${context?.currentDirectory || 'unknown'}

Last command:
${context?.lastCommand || 'none'}

Selected item:
${context?.selectedItem || 'none'}

Last terminal output:
${context?.lastOutput || 'none'}

RULES:

1. Maintain session memory.
2. Remember the current working directory.
3. Remember the previously selected file/folder.
4. Remember previous command output.
5. When the user says "it", resolve from selectedItem / currentDirectory / previous result.

FAILURE RECOVERY:
If previous output contains errors and the user asks to open/retry/continue, generate a corrected command.

Always return ONLY one executable block when the user wants something run on the PC:

\`\`\`execute
command_here
\`\`\`

If the user is only greeting or chatting (salam, hello, thanks), reply in plain text — do NOT wrap chat in an execute/echo block.

Do NOT explain technical details unless asked. For real tasks, prefer executable commands.

Enabled capabilities:
${enabledCapabilities.join(', ') || 'default'}
`.trim();

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                contents: [
                    { role: 'user', parts: [{ text: systemInstruction }] },
                    ...history,
                    { role: 'user', parts: [{ text: `User request:\n${draft || ''}` }] },
                ],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: Number(settings?.maxTokens ?? 2048),
                    topP: 0.9,
                    topK: 40,
                },
            }),
        }
    );

    const raw = await response.text();
    if (!response.ok) {
        throw new Error(raw || `Gemini HTTP ${response.status}`);
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error('Invalid JSON returned from Gemini.');
    }

    return (
        data?.candidates?.[0]?.content?.parts
            ?.map((p) => p?.text || '')
            .join('') || ''
    );
}

/**
 * Shell AI chat — Express (not Next) so request body is never double-read
 * under the custom server (avoids "Response body object should not be disturbed").
 */
router.post('/chat', express.json({ limit: '2mb' }), async (req, res) => {
    try {
        const body = req.body || {};
        const text = await generateGeminiChat({
            draft: typeof body.draft === 'string' ? body.draft : '',
            messages: Array.isArray(body.messages) ? body.messages : [],
            settings: typeof body.settings === 'object' && body.settings ? body.settings : {},
            capabilities:
                typeof body.capabilities === 'object' && body.capabilities
                    ? body.capabilities
                    : {},
            context: typeof body.context === 'object' && body.context ? body.context : {},
        });

        res.status(200);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');

        const words = String(text).match(/\S+\s*/g) || [];
        let index = 0;

        const pump = () => {
            if (res.writableEnded || res.destroyed) return;
            if (index >= words.length) {
                res.end();
                return;
            }
            res.write(words[index]);
            index += 1;
            setTimeout(pump, 15);
        };
        pump();
    } catch (error) {
        console.error('[AGENT CHAT]', error?.message || error);
        if (res.headersSent) {
            try { res.end(); } catch (_) {}
            return;
        }
        return res.status(500).json({
            success: false,
            error: error?.message || 'Generation failed',
        });
    }
});

module.exports = router;
module.exports.getTicket = getTicket;
module.exports.buildInstallScript = buildInstallScript;
module.exports.buildBootstrapCommand = buildBootstrapCommand;
