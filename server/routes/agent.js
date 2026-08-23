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
const {
    isLoopbackHost,
    resolvePublicApiBase,
    resolvePublicGatewayUrl,
} = require('../utils/publicUrls');
const { jsonMsg, msgText, Z } = require('../utils/messages');

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
        return jsonMsg(res, 401, Z.AUTH_REQUIRED);
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

    const apiBase = resolvePublicApiBase(req, req.body?.apiBase);
    const gatewayUrl = resolvePublicGatewayUrl(req, req.body?.gatewayUrl);
    let downloadUrl = String(
        req.body?.downloadUrl
        || process.env.NEXT_PUBLIC_AGENT_DOWNLOAD_URL
        || `${apiBase}/api/agent/download`
    );
    // Don't ship localhost download URLs to remote PCs.
    if (isLoopbackHost(downloadUrl) && !isLoopbackHost(apiBase)) {
        downloadUrl = `${apiBase}/api/agent/download`;
    }

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
            message: msgText(Z.BINARY_MISSING),
            route: '/api/agent/download',
        });
        return jsonMsg(res, 404, Z.BINARY_MISSING, 'Place ZenvoraAgent.exe in public/downloads/');
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

function getApiKeyForProvider(settings = {}, providerKey = 'gemini') {
    const direct = typeof settings.apiKey === 'string' ? settings.apiKey.trim() : '';
    if (direct) return direct;

    if (providerKey === 'gemini') {
        return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
    }
    if (providerKey === 'chatgpt' || providerKey === 'openai') {
        return process.env.OPENAI_API_KEY || '';
    }
    if (providerKey === 'openrouter') {
        return process.env.OPENROUTER_API_KEY || '';
    }
    if (providerKey === 'grok') {
        return process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
    }
    if (providerKey === 'claude' || providerKey === 'anthropic') {
        return process.env.ANTHROPIC_API_KEY || '';
    }
    return '';
}

async function callOpenAICompatibleAPI({ endpoint, apiKey, model, system, messages, prompt, jsonMode, headers = {} }) {
    const formattedMessages = [];
    if (system) {
        formattedMessages.push({ role: 'system', content: system });
    }
    if (Array.isArray(messages)) {
        for (const m of messages) {
            formattedMessages.push({
                role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
                content: String(m.text || m.content || ''),
            });
        }
    }
    if (prompt) {
        formattedMessages.push({ role: 'user', content: prompt });
    }

    const reqBody = {
        model,
        messages: formattedMessages,
        temperature: 0.15,
    };
    if (jsonMode) {
        reqBody.response_format = { type: 'json_object' };
    }

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...headers,
        },
        body: JSON.stringify(reqBody),
    });

    const raw = await res.text();
    if (!res.ok) {
        try {
            const errObj = JSON.parse(raw);
            const msg = errObj?.error?.message || errObj?.message || errObj?.error || raw;
            throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        } catch (e) {
            if (e instanceof Error && e.message !== raw) throw e;
            throw new Error(raw || `API error ${res.status}`);
        }
    }
    const data = JSON.parse(raw);
    return data?.choices?.[0]?.message?.content || '';
}

async function callAnthropicAPI({ apiKey, model, system, messages, prompt }) {
    const formattedMessages = [];
    if (Array.isArray(messages)) {
        for (const m of messages) {
            formattedMessages.push({
                role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
                content: String(m.text || m.content || ''),
            });
        }
    }
    if (prompt) {
        formattedMessages.push({ role: 'user', content: prompt });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: model || 'claude-3-5-sonnet-20241022',
            system: system || undefined,
            messages: formattedMessages,
            max_tokens: 3000,
        }),
    });

    const raw = await res.text();
    if (!res.ok) {
        try {
            const errObj = JSON.parse(raw);
            const msg = errObj?.error?.message || errObj?.message || raw;
            throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        } catch (e) {
            if (e instanceof Error && e.message !== raw) throw e;
            throw new Error(raw || `Anthropic HTTP ${res.status}`);
        }
    }
    const data = JSON.parse(raw);
    return data?.content?.[0]?.text || '';
}

async function callGeminiAPI({ apiKey, model, system, messages, prompt, jsonMode }) {
    const geminiModel = model || 'gemini-2.5-flash';
    const history = (Array.isArray(messages) ? messages : [])
        .slice(-20)
        .map((m) => ({
            role: m?.role === 'assistant' || m?.role === 'model' ? 'model' : 'user',
            parts: [{ text: String(m?.text || m?.content || '') }],
        }))
        .filter((m) => m.parts[0].text.trim().length > 0);

    const contents = [];
    if (system) {
        contents.push({ role: 'user', parts: [{ text: system }] });
    }
    contents.push(...history);
    if (prompt) {
        contents.push({ role: 'user', parts: [{ text: prompt }] });
    }

    const genConfig = {
        temperature: 0.12,
        maxOutputTokens: 4096,
    };
    if (jsonMode) {
        genConfig.responseMimeType = 'application/json';
    }

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': apiKey,
            },
            body: JSON.stringify({ contents, generationConfig: genConfig }),
        }
    );

    const raw = await response.text();
    if (!response.ok) {
        try {
            const errObj = JSON.parse(raw);
            const msg = errObj?.error?.message || errObj?.message || raw;
            throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        } catch (e) {
            if (e instanceof Error && e.message !== raw) throw e;
            throw new Error(raw || `Gemini HTTP ${response.status}`);
        }
    }
    const data = JSON.parse(raw);
    return (
        data?.candidates?.[0]?.content?.parts
            ?.map((p) => p?.text || '')
            .join('') || ''
    );
}

async function generateMultiProviderCompletion({ system, messages, prompt, settings, jsonMode }) {
    const provider = String(settings?.provider || 'gemini').toLowerCase();
    const apiKey = getApiKeyForProvider(settings || {}, provider);
    const model = settings?.model;

    if (provider === 'chatgpt' || provider === 'openai') {
        if (!apiKey) throw new Error('OpenAI / ChatGPT API key required.');
        return callOpenAICompatibleAPI({
            endpoint: 'https://api.openai.com/v1/chat/completions',
            apiKey,
            model: model || 'gpt-4o',
            system,
            messages,
            prompt,
            jsonMode,
        });
    }

    if (provider === 'openrouter') {
        if (!apiKey) throw new Error('OpenRouter API key required.');
        let openRouterModel = model || 'openai/gpt-4o';
        if (!openRouterModel.includes('/')) {
            if (openRouterModel.startsWith('gemini')) {
                openRouterModel = `google/${openRouterModel}`;
            } else if (openRouterModel.startsWith('claude')) {
                openRouterModel = `anthropic/${openRouterModel}`;
            } else if (openRouterModel.startsWith('llama')) {
                openRouterModel = `meta-llama/${openRouterModel}`;
            } else {
                openRouterModel = `openai/${openRouterModel}`;
            }
        }
        return callOpenAICompatibleAPI({
            endpoint: 'https://openrouter.ai/api/v1/chat/completions',
            apiKey,
            model: openRouterModel,
            system,
            messages,
            prompt,
            jsonMode,
            headers: { 'HTTP-Referer': 'https://zenvora.app', 'X-Title': 'Zenvora Agent' },
        });
    }

    if (provider === 'grok') {
        if (!apiKey) throw new Error('xAI Grok API key required.');
        return callOpenAICompatibleAPI({
            endpoint: 'https://api.x.ai/v1/chat/completions',
            apiKey,
            model: model || 'grok-3',
            system,
            messages,
            prompt,
            jsonMode,
        });
    }

    if (provider === 'claude' || provider === 'anthropic') {
        if (!apiKey) throw new Error('Anthropic Claude API key required.');
        return callAnthropicAPI({
            apiKey,
            model: model || 'claude-3-5-sonnet-20241022',
            system,
            messages,
            prompt,
        });
    }

    // Default: Gemini
    if (!apiKey) throw new Error('Gemini API key required.');
    return callGeminiAPI({
        apiKey,
        model: model || 'gemini-2.5-flash',
        system,
        messages,
        prompt,
        jsonMode,
    });
}

async function generateGeminiChat({ draft, messages, settings, capabilities, context }) {
    const enabledCapabilities = Object.entries(capabilities || {})
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k);

    let systemInstruction = `
You are Zenvora AI — an intelligent ChatGPT-class AI Coding Assistant and Windows Operator powered by top multi-provider models (OpenAI ChatGPT, Google Gemini, Anthropic Claude, Grok, OpenRouter).

CORE IDENTITY & CAPABILITIES:
1. ChatGPT Intelligence: Act as an expert senior software engineer, architect, and developer assistant. Provide high-quality, comprehensive markdown explanations, code snippets, and guidance.
2. Codebase Awareness: Understand repository structures, files, code patterns, npm/pnpm/git/rust workflows, and software development practices.
3. System & Terminal Execution: Turn requests for actions into real PC executions. When the user asks to run commands, install software, manage files, or automate workflows, output executable shell commands in a single code block:
\`\`\`execute
command_here
\`\`\`

SESSION MEMORY & CONTEXT:
- Working Directory (cwd): ${context?.currentDirectory || process.cwd() || 'unknown'}
- Last Command: ${context?.lastCommand || 'none'}
- Selected Item: ${context?.selectedItem || 'none'}
- Last Output: ${context?.lastOutput || 'none'}

EXECUTION RULES:
- If the user asks general questions, code architecture questions, or chat conversations: answer naturally in rich markdown with code examples (no execute block needed unless asking to run a command).
- If the user wants a task executed on their system or repository: include ONE \`\`\`execute command_here \`\`\` block with valid PowerShell/CMD syntax.
- Resolve relative paths and context ("it", "this file", "build it") using cwd, selected item, and message history.
- For screen/camera monitoring, remind the operator to use Agent Ops (/ops).

Enabled Capabilities: ${enabledCapabilities.join(', ') || 'default'}
`.trim();

    if (context?.fileContent) {
        systemInstruction += `\n\nATTACHED FILE CONTENT:\n${context.fileContent}`;
    }

    return generateMultiProviderCompletion({
        system: systemInstruction,
        messages,
        prompt: `User request:\n${draft || ''}`,
        settings,
    });
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
            try { res.end(); } catch (_) { }
            return;
        }
        return res.status(500).json({
            success: false,
            error: error?.message || 'Generation failed',
        });
    }
});

/**
 * Agent heal / system AI — plans fixes and returns discrete agent actions.
 * Dashboard dispatches HEAL_* / SHELL_EXECUTE; if Gemini fails, returns deterministic HEAL_FIX.
 */
router.post('/heal', express.json({ limit: '2mb' }), requireUserFast, async (req, res) => {
    try {
        const body = req.body || {};
        const deviceId = String(body.deviceId || '').trim();
        const message = String(body.message || body.prompt || '').trim();
        const topic = String(body.topic || '').trim().toLowerCase();
        const command = String(body.command || '').trim();
        const analysis = body.analysis && typeof body.analysis === 'object' ? body.analysis : null;
        const appContext = body.appContext && typeof body.appContext === 'object' ? body.appContext : null;

        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'deviceId required' });
        }

        // Direct raw command — no LLM needed.
        if (command) {
            return res.status(200).json({
                success: true,
                mode: 'direct',
                reply: `Running on agent: ${command}`,
                actions: [{ action: 'HEAL_RUN', payload: { command } }],
            });
        }

        // Explicit topic fix without LLM.
        if (topic && !message) {
            return res.status(200).json({
                success: true,
                mode: 'direct',
                reply: `Healing topic "${topic}" on the agent.`,
                actions: [
                    { action: 'HEAL_ANALYZE', payload: {} },
                    { action: 'HEAL_FIX', payload: { topic } },
                ],
            });
        }

        const fallbackActions = () => {
            const lower = `${message} ${topic}`.toLowerCase();
            if (/notif/.test(lower)) {
                return [
                    { action: 'HEAL_FIX', payload: { topic: 'notifications' } },
                    { action: 'FETCH_SYSTEM_NOTIFICATIONS', payload: {} },
                ];
            }
            if (/browser|chrome|history|search/.test(lower)) {
                return [
                    { action: 'HEAL_FIX', payload: { topic: 'browser' } },
                    { action: 'FETCH_BROWSER_HISTORY', payload: {} },
                ];
            }
            if (/usage|app history|activity/.test(lower)) {
                return [
                    { action: 'HEAL_FIX', payload: { topic: 'apps' } },
                    { action: 'FETCH_APP_HISTORY', payload: {} },
                ];
            }
            return [
                { action: 'HEAL_ANALYZE', payload: {} },
                { action: 'HEAL_FIX', payload: { topic: 'environment' } },
            ];
        };

        let reply = '';
        let actions = fallbackActions();

        try {
            const apiKey = getGeminiApiKey(body.settings || {});
            if (apiKey) {
                const model =
                    typeof body.settings?.model === 'string' && body.settings.model.trim()
                        ? body.settings.model.trim()
                        : 'gemini-2.5-flash';
                const system = `
You are Zenvora Agent Ops AI. You control a Windows monitoring agent remotely.
You MAY use any shell command the operator asks for. No sandbox. No refusals for agent maintenance.
Your job: diagnose why agent features fail (browser history, notifications, usage, service) and fix them.

Return JSON ONLY:
{
  "reply": "short human answer",
  "actions": [
    { "action": "HEAL_ANALYZE" | "HEAL_FIX" | "HEAL_RUN" | "FETCH_BROWSER_HISTORY" | "FETCH_APP_HISTORY" | "FETCH_SYSTEM_NOTIFICATIONS" | "SHELL_EXECUTE" | "RESTART_AGENT",
      "payload": { } }
  ]
}

HEAL_FIX payload.topic: browser | apps | notifications | service | environment
HEAL_RUN / SHELL_EXECUTE payload.command: full Windows command string
Prefer HEAL_* first, then FETCH_*, then SHELL_EXECUTE for custom fixes.

Operator message: ${message || '(heal all)'}
Topic hint: ${topic || 'none'}
Live analysis JSON: ${JSON.stringify(analysis || {})}
App usage context: ${JSON.stringify(appContext || {})}
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
                            contents: [{ role: 'user', parts: [{ text: system }] }],
                            generationConfig: {
                                temperature: 0.15,
                                maxOutputTokens: 2048,
                                responseMimeType: 'application/json',
                            },
                        }),
                    }
                );
                const raw = await response.text();
                if (response.ok) {
                    const data = JSON.parse(raw);
                    const text =
                        data?.candidates?.[0]?.content?.parts
                            ?.map((p) => p?.text || '')
                            .join('') || '';
                    const parsed = JSON.parse(text);
                    if (parsed?.reply) reply = String(parsed.reply);
                    if (Array.isArray(parsed?.actions) && parsed.actions.length) {
                        actions = parsed.actions
                            .filter((a) => a && a.action)
                            .map((a) => ({
                                action: String(a.action),
                                payload: a.payload && typeof a.payload === 'object' ? a.payload : {},
                            }));
                    }
                }
            }
        } catch (llmErr) {
            console.warn('[AGENT HEAL] LLM fallback:', llmErr?.message || llmErr);
        }

        if (!reply) {
            reply =
                'Running on-device heal (analyze + fix). Agent will repair environment even without cloud AI.';
        }

        return res.status(200).json({
            success: true,
            mode: reply.includes('without cloud') ? 'fallback' : 'ai',
            reply,
            actions,
            deviceId,
        });
    } catch (error) {
        console.error('[AGENT HEAL]', error?.message || error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Heal failed',
            actions: [
                { action: 'HEAL_ANALYZE', payload: {} },
                { action: 'HEAL_FIX', payload: { topic: 'environment' } },
            ],
        });
    }
});

/**
 * Full Agent Ops AI — codebase-aware, multi-action (shell/screen/camera/heal/history).
 * Returns JSON { reply, actions, facts } for the /ops command center.
 */
router.post('/ops', express.json({ limit: '2mb' }), requireUserFast, async (req, res) => {
    try {
        const body = req.body || {};
        const deviceId = String(body.deviceId || '').trim();
        const message = String(body.message || body.draft || '').trim();
        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'deviceId required' });
        }
        if (!message) {
            return res.status(400).json({ success: false, message: 'message required' });
        }

        const {
            buildDeviceFacts,
            buildOpsSystemPrompt,
            planOpsWindows,
            mergeWindows,
        } = require('../services/agentOpsKnowledge');

        const facts = await buildDeviceFacts(req.user.id, deviceId);
        const system = buildOpsSystemPrompt({ facts, deviceId });

        const history = Array.isArray(body.messages)
            ? body.messages
                .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.text)
                .slice(-12)
                .map((m) => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: String(m.text) }],
                }))
            : [];

        const enrichWindowData = (windows) =>
            (Array.isArray(windows) ? windows : []).map((w) => {
                const type = String(w.type || '').toLowerCase();
                const data = w.data && typeof w.data === 'object' ? { ...w.data } : {};
                const hasItems = Array.isArray(data.items) && data.items.length > 0;
                if (!hasItems) {
                    if (type === 'usage') data.items = facts.topUsage || [];
                    if (type === 'browser') data.items = facts.recentBrowser || [];
                    if (type === 'notifications') data.items = facts.recentNotifications || [];
                    if (type === 'activity') data.items = facts.recentActivity || [];
                }
                return { ...w, type, data };
            });

        const heuristic = () => {
            const lower = message.toLowerCase();
            const actions = [];
            if (/screen|monitor|desktop|display|dekho|screen pe/.test(lower)) {
                actions.push(
                    { action: 'START_SCREEN_STREAM', payload: { quality: 70, target_fps: 12 } },
                    { action: 'SHOW_MONITOR', payload: { channel: 'screen' } }
                );
            }
            if (/camera|webcam|cam /.test(lower)) {
                actions.push(
                    { action: 'START_STREAM', payload: {} },
                    { action: 'SHOW_MONITOR', payload: { channel: 'camera' } }
                );
            }
            if (/history|usage|kitna|kitni|notification|search|chrome|browser|activity/.test(lower)) {
                if (/notif/.test(lower)) actions.push({ action: 'FETCH_SYSTEM_NOTIFICATIONS', payload: {} });
                if (/browser|chrome|search|url|history/.test(lower)) {
                    actions.push({ action: 'FETCH_BROWSER_HISTORY', payload: {} });
                }
                if (/usage|app|activity|kitna|time|history/.test(lower)) {
                    actions.push({ action: 'FETCH_APP_HISTORY', payload: {} });
                }
            }
            if (/install |open |start |run |winget|powershell|cmd /.test(lower) || /^(install|open|run)\b/.test(lower)) {
                let cmd = message;
                if (/^open\s+/i.test(message)) {
                    const app = message.replace(/^open\s+/i, '').trim();
                    cmd = `Start-Process "${app}"`;
                } else if (/^install\s+/i.test(message)) {
                    const pkg = message.replace(/^install\s+/i, '').trim();
                    cmd = `winget install --id ${pkg} -e --accept-package-agreements --accept-source-agreements`;
                }
                actions.push({
                    action: 'SHELL_EXECUTE',
                    payload: { command: cmd, shell: 'powershell' },
                });
            }
            if (/heal|fix agent|repair/.test(lower)) {
                actions.push(
                    { action: 'HEAL_ANALYZE', payload: {} },
                    { action: 'HEAL_FIX', payload: { topic: 'environment' } }
                );
            }

            const top = (facts.topUsage || [])
                .slice(0, 5)
                .map((u) => `${u.appName}: ${Math.round((u.duration || 0) / 60)}m`)
                .join(', ');
            let reply = 'Opening panels on the canvas.';
            if (/usage|kitna|history/.test(lower) && top) {
                reply = `Last 24h top usage: ${top}.`;
            } else if (actions.some((a) => a.action === 'START_SCREEN_STREAM')) {
                reply = 'Opening live screen window.';
            } else if (actions.some((a) => a.action === 'START_STREAM')) {
                reply = 'Opening live camera window.';
            } else if (actions.some((a) => a.action === 'SHELL_EXECUTE')) {
                reply = 'Dispatching shell — task window opened.';
            }
            return { reply, actions, windows: planOpsWindows(message, facts) };
        };

        let reply = '';
        let actions = [];
        let aiWindows = [];

        try {
            let fullSystem = system;
            if (body.fileContent) {
                fullSystem += `\n\nATTACHED FILE CONTENT:\n${body.fileContent}`;
            }

            const rawText = await generateMultiProviderCompletion({
                system: fullSystem,
                messages: history.map((h) => ({ role: h.role, text: h.parts[0]?.text || '' })),
                prompt: `Operator:\n${message}`,
                settings: body.settings || {},
                jsonMode: true,
            });

            if (rawText) {
                const parsed = JSON.parse(rawText);
                if (parsed?.reply) reply = String(parsed.reply);
                if (Array.isArray(parsed?.actions)) {
                    actions = parsed.actions
                        .filter((a) => a && a.action)
                        .map((a) => ({
                            action: String(a.action).toUpperCase(),
                            payload:
                                a.payload && typeof a.payload === 'object' ? a.payload : {},
                        }));
                }
                if (Array.isArray(parsed?.windows)) {
                    aiWindows = parsed.windows;
                }
            }
        } catch (llmErr) {
            console.warn('[AGENT OPS] LLM fallback:', llmErr?.message || llmErr);
        }

        if (!reply && !actions.length && !aiWindows.length) {
            const fb = heuristic();
            reply = fb.reply;
            actions = fb.actions;
            aiWindows = fb.windows;
        } else if (!reply) {
            reply = actions.length ? `Dispatching ${actions.length} action(s).` : 'OK.';
        }

        let windows = enrichWindowData(
            mergeWindows(aiWindows, planOpsWindows(message, facts))
        );

        // Always open a note window with the reply so canvas isn't empty.
        if (!windows.some((w) => w.type === 'note')) {
            windows = [
                { type: 'note', title: 'Ops', data: { text: reply } },
                ...windows,
            ];
        }

        // Ensure media windows trigger monitor actions.
        if (windows.some((w) => w.type === 'screen') &&
            !actions.some((a) => a.action === 'START_SCREEN_STREAM')) {
            actions.push(
                { action: 'START_SCREEN_STREAM', payload: { quality: 70, target_fps: 12 } },
                { action: 'SHOW_MONITOR', payload: { channel: 'screen' } }
            );
        }
        if (windows.some((w) => w.type === 'camera') &&
            !actions.some((a) => a.action === 'START_STREAM')) {
            actions.push(
                { action: 'START_STREAM', payload: {} },
                { action: 'SHOW_MONITOR', payload: { channel: 'camera' } }
            );
        }

        return res.status(200).json({
            success: true,
            reply,
            actions,
            windows,
            facts,
            deviceId,
        });
    } catch (error) {
        console.error('[AGENT OPS]', error?.message || error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Ops AI failed',
            reply: error?.message || 'Ops AI failed',
            actions: [],
            windows: [],
        });
    }
});

module.exports = router;
module.exports.getTicket = getTicket;
module.exports.buildInstallScript = buildInstallScript;
module.exports.buildBootstrapCommand = buildBootstrapCommand;
