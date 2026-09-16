/**
 * AiPilotService (Pure OpenClaw + Microsoft UFO Engine)
 * 
 * 100% LLM Driven:
 * - NO hardcoded application arrays.
 * - NO hardcoded scripts or templates.
 * - NO hardcoded keyword regexes.
 * 
 * The LLM dynamically analyzes the user prompt, determines mood/sentiment,
 * writes the conversational spoken reply, and generates the exact OpenClaw / UFO execution steps.
 */

const { getRelevantContext, recordInteraction } = require('./userMemoryService');
let AdminSetting = null;
try {
    AdminSetting = require('../models/AdminSetting');
} catch (e) {}

/**
 * Call real LLM (Gemini / OpenAI / Groq / Ollama) for 100% autonomous desktop control planning.
 * The LLM generates the spoken reply, mood, steps, openClawSteps, and script dynamically.
 */
async function callLLMForAutonomousPlan({ prompt, userMemory, deviceContext, apiKey, provider }) {
    let activeKey = apiKey;
    let activeProvider = provider || 'gemini';

    if (!activeKey) {
        if (process.env.GEMINI_API_KEY) {
            activeKey = process.env.GEMINI_API_KEY;
            activeProvider = 'gemini';
        } else if (process.env.OPENAI_API_KEY) {
            activeKey = process.env.OPENAI_API_KEY;
            activeProvider = 'openai';
        } else if (process.env.GROQ_API_KEY) {
            activeKey = process.env.GROQ_API_KEY;
            activeProvider = 'groq';
        }
    }

    if (!activeKey && AdminSetting) {
        try {
            const row = await AdminSetting.findOne({ where: { key: 'ai_settings' } });
            if (row && row.value) {
                const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
                if (parsed.apiKey) {
                    activeKey = parsed.apiKey;
                    activeProvider = parsed.provider || activeProvider;
                }
            }
        } catch (e) {}
    }

    if (!activeKey) {
        return null;
    }

    const systemPrompt = `You are Zenvora AI Desktop Pilot, an autonomous operating system control agent following Microsoft UFO (https://github.com/microsoft/UFO) and OpenClaw principles.
You control ANY application on Windows/macOS/Linux (e.g. WhatsApp, Skype, Excel, Word, Zoom, Discord, Spotify, Chrome, Terminal, PowerShell, Settings, etc.) completely dynamically.

Device Environment:
Active Window: ${deviceContext?.activeWindow || 'Desktop'}
User Persona/Memory: ${JSON.stringify(userMemory?.persona || {})}

OpenClaw Action Primitives:
- "launch": { "path": "<executable or URI protocol like whatsapp: or skype: or spotify:>" }
- "focus": { "title": "<window title substring>" }
- "hotkey": { "key": "<SendKeys format like ^f for Ctrl+F, {ENTER}, ^+c for Call>" }
- "type": { "text": "<string to type>", "press_enter": boolean }
- "click": { "x": number, "y": number, "button": "left|right|double" }
- "sleep": { "ms": number }
- "turbo_script": { "script": "<dynamic PowerShell or Shell script you write to perform the action>", "runtime": "powershell" }

Return a JSON object ONLY in this exact schema:
{
  "spokenReplyUrdu": "Natural, helpful conversational reply in Urdu/Hindi/English matching user mood",
  "mood": "detected mood (e.g. focused, hurried, concerned, pleased, casual)",
  "steps": ["Step 1 description", "Step 2 description", ...],
  "openClawSteps": [
    { "step_index": 1, "action_type": "<primitive>", "params": { ... }, "description": "..." }
  ],
  "script": "Complete dynamic PowerShell/shell automation script generated specifically for this goal, or null if using primitives"
}`;

    const userPromptText = `User Goal: "${prompt}"`;

    try {
        let jsonStr = '';
        if (activeProvider === 'gemini') {
            const modelName = 'gemini-2.0-flash';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(activeKey)}`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: systemPrompt },
                            { text: userPromptText }
                        ]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json"
                    }
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            jsonStr = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (activeProvider === 'openai') {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${activeKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPromptText }
                    ],
                    response_format: { type: 'json_object' }
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            jsonStr = data?.choices?.[0]?.message?.content || '';
        } else if (activeProvider === 'groq') {
            const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${activeKey}`
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPromptText }
                    ],
                    response_format: { type: 'json_object' }
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            jsonStr = data?.choices?.[0]?.message?.content || '';
        }

        if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
            if (parsed.steps && parsed.spokenReplyUrdu) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[AI Pilot] LLM planning request error:', e.message);
    }

    return null;
}

/**
 * Main Autonomous Execution Orchestrator
 * Purely LLM-directed: no hardcoded templates or rules.
 */
async function planAndExecuteAutonomousTask({
    userId = 'admin',
    prompt,
    deviceId,
    preferredEngine = 'openclaw',
    customApiKey = '',
    customProvider = '',
}) {
    const startTime = Date.now();
    const userMemory = getRelevantContext(userId, prompt);

    // Call LLM for 100% dynamic planning
    const plan = await callLLMForAutonomousPlan({
        prompt,
        userMemory,
        deviceContext: {},
        apiKey: customApiKey,
        provider: customProvider,
    });

    if (!plan) {
        return {
            success: false,
            executionType: 'openclaw',
            script: null,
            steps: ['LLM API key required in Settings for autonomous desktop execution'],
            openClawSteps: [],
            spokenReplyUrdu: 'Bhai, AI Pilot ke liye Settings page me Gemini ya OpenAI ki API key activate karein taake LLM real-time me aapka order execute kar sake.',
            moodDetected: 'neutral',
            elapsedMs: Date.now() - startTime,
            memorySizeMB: 'Active',
        };
    }

    const mood = plan.mood || 'focused';

    // Save interaction into long-term memory
    recordInteraction(userId, {
        userMessage: prompt,
        assistantReply: plan.spokenReplyUrdu,
        mood,
        topic: 'Autonomous Desktop Control',
        actionsTaken: plan.steps,
    });

    const elapsedMs = Date.now() - startTime;

    return {
        success: true,
        executionType: 'openclaw',
        script: plan.script || null,
        steps: plan.steps || [],
        openClawSteps: plan.openClawSteps || [],
        spokenReplyUrdu: plan.spokenReplyUrdu,
        moodDetected: mood,
        elapsedMs,
        memorySizeMB: 'Updated',
    };
}

module.exports = {
    planAndExecuteAutonomousTask,
    callLLMForAutonomousPlan,
};
