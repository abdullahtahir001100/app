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

// POST /api/ai-pilot/memory/clear - Wipe context
router.post('/memory/clear', (req, res) => {
    const userId = req.user?.id || 'admin';
    const cleared = clearMemory(userId);
    return res.json({ ok: true, cleared });
});

module.exports = router;
