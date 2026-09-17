const express = require('express');
const router = express.Router();
const { planAndExecuteAutonomousTask } = require('../services/aiPilotService');
const { transcribeLowBandwidthAudio, buildVoiceSynthesisPayload } = require('../services/lowBandwidthVoiceService');
const { getMemoryStats, clearMemory } = require('../services/userMemoryService');
const { getConnectionRegistry } = require('../sockets/registry');

// POST /api/ai-pilot/execute - Run autonomous task
router.post('/execute', express.json(), async (req, res) => {
    try {
        const { prompt, deviceId, engine = 'hybrid', apiKey, provider } = req.body;
        const userId = req.user?.id || 'admin';

        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ ok: false, error: 'Prompt is required.' });
        }

        const plan = await planAndExecuteAutonomousTask({
            userId,
            prompt,
            deviceId,
            preferredEngine: engine,
            customApiKey: apiKey,
            customProvider: provider,
        });

        // If target device is specified, dispatch OpenClaw autonomous plan!
        if (deviceId && (plan.openClawSteps?.length || plan.script)) {
            try {
                const registry = getConnectionRegistry();
                const targetKey = `DEVICE_${deviceId}`;
                const clientWs = registry.get(targetKey) || registry.get(`AGENT_${deviceId}`);
                if (clientWs && clientWs.readyState === 1) {
                    clientWs.send(JSON.stringify({
                        action: 'OPENCLAW_EXECUTE',
                        payload: {
                            taskId: `openclaw-${Date.now()}`,
                            steps: plan.openClawSteps || [],
                            script: plan.script,
                        },
                        target: deviceId,
                    }));
                }
            } catch (dispatchErr) {
                console.warn('[AI Pilot] Agent dispatch warning:', dispatchErr.message);
            }
        }

        const voicePayload = buildVoiceSynthesisPayload(plan.spokenReplyUrdu, plan.moodDetected);

        return res.json({
            ok: true,
            plan,
            voice: voicePayload,
            memoryStats: getMemoryStats(userId),
        });
    } catch (err) {
        console.error('[AI Pilot Execute Error]', err);
        return res.status(500).json({ ok: false, error: err.message || 'Execution failed' });
    }
});

// POST /api/ai-pilot/voice-stream - Ultra-low bandwidth voice command
router.post('/voice-stream', express.json({ limit: '10mb' }), async (req, res) => {
    try {
        const { audioBase64, mimeType = 'audio/webm', deviceId, apiKey } = req.body;
        const userId = req.user?.id || 'admin';

        if (!audioBase64) {
            return res.status(400).json({ ok: false, error: 'audioBase64 data required' });
        }

        const transcription = await transcribeLowBandwidthAudio(audioBase64, mimeType, apiKey);
        const prompt = transcription.text;

        const plan = await planAndExecuteAutonomousTask({
            userId,
            prompt,
            deviceId,
            preferredEngine: 'hybrid',
            customApiKey: apiKey,
        });

        // Dispatch OpenClaw execution
        if (deviceId && (plan.openClawSteps?.length || plan.script)) {
            try {
                const registry = getConnectionRegistry();
                const targetKey = `DEVICE_${deviceId}`;
                const clientWs = registry.get(targetKey) || registry.get(`AGENT_${deviceId}`);
                if (clientWs && clientWs.readyState === 1) {
                    clientWs.send(JSON.stringify({
                        action: 'OPENCLAW_EXECUTE',
                        payload: {
                            taskId: `openclaw-voice-${Date.now()}`,
                            steps: plan.openClawSteps || [],
                            script: plan.script,
                        },
                        target: deviceId,
                    }));
                }
            } catch (e) {}
        }

        const voicePayload = buildVoiceSynthesisPayload(plan.spokenReplyUrdu, plan.moodDetected);

        return res.json({
            ok: true,
            transcription,
            plan,
            voice: voicePayload,
            memoryStats: getMemoryStats(userId),
        });
    } catch (err) {
        console.error('[AI Pilot Voice Stream Error]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ai-pilot/device-context/:deviceId - Query agent's tracked database context
router.get('/device-context/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    try {
        const registry = getConnectionRegistry();
        const targetKey = `DEVICE_${deviceId}`;
        const clientWs = registry.get(targetKey) || registry.get(`AGENT_${deviceId}`);
        const isOnline = !!(clientWs && clientWs.readyState === 1);

        if (isOnline) {
            // Request live context from Rust agent
            clientWs.send(JSON.stringify({
                action: 'OPENCLAW_GET_CONTEXT',
                payload: {},
                target: deviceId,
            }));
        }

        return res.json({
            ok: true,
            deviceId,
            online: isOnline,
            message: isOnline ? 'Context request dispatched to agent' : 'Device offline'
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ai-pilot/memory - Get 2GB memory stats
router.get('/memory', (req, res) => {
    const userId = req.user?.id || 'admin';
    const stats = getMemoryStats(userId);
    return res.json({ ok: true, stats });
});

// POST /api/ai-pilot/models - Dynamically fetch all available models from provider API
router.post('/models', express.json(), async (req, res) => {
    try {
        let { provider = 'gemini', apiKey = '' } = req.body || {};
        provider = String(provider).toLowerCase();

        // Resolve API key from environment if not supplied
        if (!apiKey) {
            if (provider === 'gemini') apiKey = process.env.GEMINI_API_KEY || '';
            else if (provider === 'chatgpt' || provider === 'openai') apiKey = process.env.OPENAI_API_KEY || '';
            else if (provider === 'openrouter') apiKey = process.env.OPENROUTER_API_KEY || '';
            else if (provider === 'grok') apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
            else if (provider === 'claude') apiKey = process.env.ANTHROPIC_API_KEY || '';
            else if (provider === 'deepseek') apiKey = process.env.DEEPSEEK_API_KEY || '';
        }

        let dynamicModels = [];

        if (apiKey) {
            try {
                if (provider === 'gemini') {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
                    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
                    if (response.ok) {
                        const data = await response.json();
                        if (Array.isArray(data.models)) {
                            dynamicModels = data.models
                                .filter(m => m.supportedGenerationMethods?.includes('generateContent') || m.name.includes('gemini'))
                                .map(m => m.name.replace(/^models\//, ''));
                        }
                    }
                } else if (provider === 'chatgpt' || provider === 'openai') {
                    const response = await fetch('https://api.openai.com/v1/models', {
                        headers: { Authorization: `Bearer ${apiKey}` },
                        signal: AbortSignal.timeout(6000)
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (Array.isArray(data.data)) {
                            const chatModels = data.data
                                .filter(m => m.id.includes('gpt') || m.id.startsWith('o1') || m.id.startsWith('o3'))
                                .map(m => m.id)
                                .sort();
                            dynamicModels = chatModels;
                        }
                    }
                } else if (provider === 'openrouter') {
                    const response = await fetch('https://openrouter.ai/api/v1/models', {
                        headers: { Authorization: `Bearer ${apiKey}` },
                        signal: AbortSignal.timeout(6000)
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (Array.isArray(data.data)) {
                            dynamicModels = data.data.map(m => m.id).slice(0, 50);
                        }
                    }
                } else if (provider === 'grok') {
                    const response = await fetch('https://api.x.ai/v1/models', {
                        headers: { Authorization: `Bearer ${apiKey}` },
                        signal: AbortSignal.timeout(6000)
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (Array.isArray(data.data)) {
                            dynamicModels = data.data.map(m => m.id);
                        }
                    }
                } else if (provider === 'deepseek') {
                    const response = await fetch('https://api.deepseek.com/models', {
                        headers: { Authorization: `Bearer ${apiKey}` },
                        signal: AbortSignal.timeout(6000)
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (Array.isArray(data.data)) {
                            dynamicModels = data.data.map(m => m.id);
                        }
                    }
                } else if (provider === 'claude') {
                    const response = await fetch('https://api.anthropic.com/v1/models', {
                        headers: {
                            'x-api-key': apiKey,
                            'anthropic-version': '2023-06-01'
                        },
                        signal: AbortSignal.timeout(6000)
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (Array.isArray(data.data)) {
                            dynamicModels = data.data.map(m => m.id);
                        }
                    }
                }
            } catch (fetchErr) {
                console.warn(`[AI Models Fetch Warning] ${provider}:`, fetchErr.message);
            }
        }

        // Comprehensive fallback models if dynamic fetch didn't return any
        const fallbackCatalog = {
            gemini: [
                'gemini-2.5-pro',
                'gemini-2.5-flash',
                'gemini-2.0-flash',
                'gemini-2.0-flash-lite',
                'gemini-2.0-pro-exp-02-05',
                'gemini-1.5-pro',
                'gemini-1.5-flash',
                'gemini-1.5-flash-8b',
                'gemini-1.0-pro'
            ],
            chatgpt: [
                'gpt-4o',
                'gpt-4o-mini',
                'o1',
                'o1-mini',
                'o1-preview',
                'o3-mini',
                'chatgpt-4o-latest',
                'gpt-4-turbo',
                'gpt-4-turbo-preview',
                'gpt-4',
                'gpt-3.5-turbo'
            ],
            openrouter: [
                'openai/gpt-4o',
                'openai/gpt-4o-mini',
                'openai/o3-mini',
                'anthropic/claude-3.7-sonnet',
                'anthropic/claude-3.5-sonnet',
                'anthropic/claude-3.5-haiku',
                'deepseek/deepseek-r1',
                'deepseek/deepseek-chat',
                'google/gemini-2.0-flash-001',
                'google/gemini-2.5-pro',
                'meta-llama/llama-3.3-70b-instruct',
                'meta-llama/llama-3.1-405b-instruct',
                'meta-llama/llama-3.1-70b-instruct',
                'qwen/qwen-2.5-72b-instruct',
                'mistralai/mistral-large-2411'
            ],
            grok: [
                'grok-3',
                'grok-3-mini',
                'grok-2-1212',
                'grok-2-vision-1212',
                'grok-beta'
            ],
            claude: [
                'claude-3-7-sonnet-20250219',
                'claude-3-5-sonnet-20241022',
                'claude-3-5-haiku-20241022',
                'claude-3-opus-20240229',
                'claude-3-sonnet-20240229',
                'claude-3-haiku-20240307'
            ],
            deepseek: [
                'deepseek-chat',
                'deepseek-reasoner'
            ]
        };

        const resultModels = dynamicModels.length > 0 
            ? Array.from(new Set([...dynamicModels, ...(fallbackCatalog[provider] || [])]))
            : (fallbackCatalog[provider] || fallbackCatalog.gemini);

        return res.json({
            ok: true,
            provider,
            isLiveFetched: dynamicModels.length > 0,
            models: resultModels,
            count: resultModels.length
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;

