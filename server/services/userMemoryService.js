/**
 * UserMemoryService
 * 
 * 2 GB Long-Term Memory & Persona Engine for Zenvora Autonomous Copilot.
 * Stores conversation history, behavioral traits, preferred languages (Urdu/Hindi/English),
 * mood tracking, and past automated actions with fast semantic/keyword retrieval.
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(process.cwd(), 'data', 'ai_memory');
const MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB limit

// Ensure storage directory exists
if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function getUserMemoryFilePath(userId) {
    const safeId = String(userId || 'default_user').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(MEMORY_DIR, `memory_${safeId}.json`);
}

function loadMemoryData(userId) {
    const filePath = getUserMemoryFilePath(userId);
    if (!fs.existsSync(filePath)) {
        return {
            userId: String(userId),
            persona: {
                name: 'User',
                preferredLanguage: 'mixed (Urdu/Hindi/English)',
                speakingStyle: 'conversational, direct, technical',
                currentMood: 'neutral',
                moodHistory: [],
                frequentTopics: [],
            },
            conversations: [],
            automatedTasks: [],
            createdAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
        };
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('[UserMemoryService] Failed to parse memory file:', err);
        return {
            userId: String(userId),
            persona: {},
            conversations: [],
            automatedTasks: [],
        };
    }
}

function saveMemoryData(userId, data) {
    const filePath = getUserMemoryFilePath(userId);
    data.lastUpdatedAt = new Date().toISOString();
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('[UserMemoryService] Failed to write memory file:', err);
    }
}

/**
 * Record a new interaction to long-term memory
 */
function recordInteraction(userId, { userMessage, assistantReply, mood, topic, actionsTaken = [] }) {
    const memory = loadMemoryData(userId);

    // Update Mood & Speaking Tone
    if (mood) {
        memory.persona.currentMood = mood;
        memory.persona.moodHistory.push({
            mood,
            timestamp: new Date().toISOString(),
        });
        if (memory.persona.moodHistory.length > 50) {
            memory.persona.moodHistory.shift();
        }
    }

    if (topic && !memory.persona.frequentTopics.includes(topic)) {
        memory.persona.frequentTopics.push(topic);
        if (memory.persona.frequentTopics.length > 30) {
            memory.persona.frequentTopics.shift();
        }
    }

    // Append conversation entry
    memory.conversations.push({
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        user: userMessage,
        assistant: assistantReply,
        topic: topic || 'general',
        mood: mood || 'neutral',
        timestamp: new Date().toISOString(),
    });

    if (actionsTaken && actionsTaken.length > 0) {
        memory.automatedTasks.push({
            id: `task_${Date.now()}`,
            description: userMessage,
            actions: actionsTaken,
            timestamp: new Date().toISOString(),
        });
    }

    // Prune if reaching size limit
    const jsonStr = JSON.stringify(memory);
    if (Buffer.byteLength(jsonStr, 'utf8') > MAX_MEMORY_BYTES) {
        // Drop oldest 20% conversations while preserving persona
        const dropCount = Math.ceil(memory.conversations.length * 0.2);
        memory.conversations.splice(0, dropCount);
    }

    saveMemoryData(userId, memory);
    return memory;
}

/**
 * Retrieve relevant past context for a prompt to inject into LLM system prompt
 */
function getRelevantContext(userId, currentPrompt = '') {
    const memory = loadMemoryData(userId);
    const recentConvos = memory.conversations.slice(-6);
    const recentTasks = memory.automatedTasks.slice(-4);

    return {
        persona: memory.persona,
        recentConversations: recentConvos,
        recentTasks: recentTasks,
        contextSummary: `User preferred tone: ${memory.persona.speakingStyle || 'Urdu/English code-switching'}. Current detected mood: ${memory.persona.currentMood || 'neutral'}. Frequent topics: ${memory.persona.frequentTopics.slice(-5).join(', ')}.`,
    };
}

/**
 * Get memory storage statistics (bytes, MB, count)
 */
function getMemoryStats(userId) {
    const filePath = getUserMemoryFilePath(userId);
    if (!fs.existsSync(filePath)) {
        return {
            usedBytes: 0,
            usedMB: '0.00',
            maxBytes: MAX_MEMORY_BYTES,
            maxGB: 2,
            percentUsed: 0,
            totalConversations: 0,
            totalTasks: 0,
            currentMood: 'neutral',
        };
    }

    try {
        const stats = fs.statSync(filePath);
        const data = loadMemoryData(userId);
        const usedMB = (stats.size / (1024 * 1024)).toFixed(2);
        const percent = Math.min(100, ((stats.size / MAX_MEMORY_BYTES) * 100).toFixed(2));

        return {
            usedBytes: stats.size,
            usedMB,
            maxBytes: MAX_MEMORY_BYTES,
            maxGB: 2,
            percentUsed: percent,
            totalConversations: data.conversations?.length || 0,
            totalTasks: data.automatedTasks?.length || 0,
            currentMood: data.persona?.currentMood || 'neutral',
            preferredLanguage: data.persona?.preferredLanguage || 'Urdu/English',
        };
    } catch (err) {
        return {
            usedBytes: 0,
            usedMB: '0.00',
            maxBytes: MAX_MEMORY_BYTES,
            maxGB: 2,
            percentUsed: 0,
        };
    }
}

/**
 * Clear memory for user
 */
function clearMemory(userId) {
    const filePath = getUserMemoryFilePath(userId);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            return true;
        } catch (e) {
            return false;
        }
    }
    return true;
}

module.exports = {
    recordInteraction,
    getRelevantContext,
    getMemoryStats,
    clearMemory,
};
