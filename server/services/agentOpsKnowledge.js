/**
 * Shared knowledge + DB context for Zenvora Agent Ops AI.
 * Gives the model a map of server/agent capabilities and live telemetry facts.
 */

const ActivityLog = require('../models/ActivityLog');
const AppHistory = require('../models/AppHistory');
const BrowserHistory = require('../models/BrowserHistory');
const Notification = require('../models/Notification');

const CODEBASE_MAP = `
ZENVORA STACK (you already know this product):
- Dashboard: Next.js + Express custom server (server.js). Auth cookie auth_token, admin PIN gate.
- Gateway: /ws/gateway JSON control; /ws/media binary frames; optional /ws/control.
- Windows agent: Rust crate zenvora_agent — router.rs dispatches actions; shell_commands, screen, camera, files, history, heal_ai, notifications, control_channel.
- Android agent: Kotlin event-driven SessionPinger + Accessibility; POST /api/network/android-beat.
- History sync: server/services/historySyncService.js upserts BrowserHistory, AppHistory, ActivityLog, CallLog, SMS, Contacts, Notifications (soft-delete isDeleted).
- Usage API: GET /api/logs/usage and /api/logs/usage/detail join activity + browser visits.
- Heal on agent: HEAL_ANALYZE, HEAL_FIX (browser|apps|notifications|service|environment), HEAL_RUN {command}.
`.trim();

const ACTION_CATALOG = `
DISPATCH ACTIONS (send as JSON actions[]; dashboard executes on the live agent):

SHELL
- SHELL_EXECUTE { command, shell?: "powershell"|"cmd" } — install apps, open apps, any Windows command
- SHELL_EXECUTE_RAW { command }

SCREEN
- START_SCREEN_STREAM { quality?: 40-90, target_fps?: 5-30 }
- STOP_SCREEN_STREAM {}
- CAPTURE_SCREENSHOT {}
- LIST_DISPLAYS / PROBE_DISPLAYS {}
- SEND_TEXT_INPUT { text }
- REMOTE_MOUSE_CLICK / REMOTE_MOUSE_MOVE / REMOTE_KEY_PRESS (as supported)
- LOCK_SCREEN {}, SET_SYSTEM_VOLUME { value }, SET_DISPLAY_BRIGHTNESS { value }

CAMERA
- START_STREAM {}  (camera live)
- STOP_STREAM {}
- LIST_CAMERAS {}, SWITCH_CAMERA { camera_index }, CAPTURE_SNAPSHOT {}

FILES
- FILE_GET_ROOTS, FILE_LIST, FILE_READ, FILE_WRITE, FILE_DELETE, FILE_MKDIR, FILE_RENAME, FILE_DOWNLOAD, FILE_UPLOAD (payload per file protocol)

HISTORY / DATA REFRESH
- FETCH_BROWSER_HISTORY, FETCH_APP_HISTORY, FETCH_SYSTEM_NOTIFICATIONS
- FETCH_CALL_LOGS, FETCH_SMS_MESSAGES, FETCH_CONTACTS (Android)

HEAL / AGENT
- HEAL_ANALYZE {}, HEAL_FIX { topic }, HEAL_RUN { command }
- RESTART_AGENT {}, UPDATE_AGENT { download_url? }

UI HINTS (dashboard only, not sent to agent):
- SHOW_MONITOR { channel: "screen"|"camera" } — open live preview window on Ops canvas
- OPEN_WINDOW { type, title?, data? } — Stitch-style: auto-open a data panel on the canvas
  type: screen | camera | usage | browser | notifications | activity | shell | note
- OPEN_PAGE { path } — navigate away (prefer OPEN_WINDOW instead)

STITCH PRESENTATION (critical):
Like Google Stitch opens screens on a canvas, YOU open windows so the operator SEES data — not only chat text.
Always fill "windows" with visual panels when answering usage/history/notif/screen/camera/shell.
Put real FACTS into windows[].data (arrays/objects). Never invent rows.

When user asks what happened / history / usage / notifications, USE FACTS + emit OPEN_WINDOW panels + optional FETCH_*.
When user says monitor screen / camera, emit START_* + SHOW_MONITOR + OPEN_WINDOW type screen|camera.
When user says install/open/run/background, emit SHELL_EXECUTE + OPEN_WINDOW type shell.
`.trim();

const { isMysql, getMysqlAdapter } = require('../db/DatabaseFactory');

async function buildDeviceFacts(userId, deviceId) {
    if (!userId || !deviceId) return { summary: 'No device selected.' };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const scope = { userId, deviceId };

    let usageClosed = [];
    let apps = [];
    let browser = [];
    let notifs = [];
    let activity = [];

    if (isMysql()) {
        try {
            const adapter = getMysqlAdapter();
            [usageClosed, apps, browser, notifs, activity] = await Promise.all([
                adapter.findActivityLogs({ ...scope, action: 'app_closed' }, { limit: 40 }).catch(() => []),
                adapter.findAppHistories(scope, { limit: 40 }).catch(() => []),
                adapter.findBrowserHistories(scope, { limit: 40 }).catch(() => []),
                adapter.findNotifications(scope, { limit: 25 }).catch(() => []),
                adapter.findActivityLogs(scope, { limit: 40 }).catch(() => []),
            ]);
        } catch (_) {}
    } else {
        [usageClosed, apps, browser, notifs, activity] = await Promise.all([
            ActivityLog.find({ ...scope, createdAt: { $gte: since }, action: 'app_closed' })
                .sort({ createdAt: -1 }).limit(40).lean().catch(() => []),
            AppHistory.find({ ...scope, lastOpened: { $gte: since }, duration: { $gt: 0 } })
                .sort({ lastOpened: -1 }).limit(40).lean().catch(() => []),
            BrowserHistory.find({ ...scope, visitTime: { $gte: since } })
                .sort({ visitTime: -1 }).limit(40).lean().catch(() => []),
            Notification.find({ ...scope, isDeleted: { $ne: true } })
                .sort({ createdAt: -1 }).limit(25).lean().catch(() => []),
            ActivityLog.find({ ...scope, createdAt: { $gte: since } })
                .sort({ createdAt: -1 }).limit(40).lean().catch(() => []),
        ]);
    }

    const byApp = new Map();
    for (const row of usageClosed) {
        const name = String(row.appName || row.processName || 'Unknown');
        const dur = Math.max(0, Number(row.duration) || Number(row.metadata?.duration) || 0);
        if (!dur) continue;
        byApp.set(name, (byApp.get(name) || 0) + dur);
    }
    for (const row of apps) {
        const name = String(row.appName || 'Unknown');
        if (String(row.category || '') === 'usagestats') continue;
        byApp.set(name, (byApp.get(name) || 0) + Math.max(0, Number(row.duration) || 0));
    }
    const topUsage = [...byApp.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([appName, duration]) => ({ appName, duration }));

    return {
        deviceId,
        windowHours: 24,
        topUsage,
        recentBrowser: browser.map((b) => ({
            title: b.title,
            url: b.url,
            browser: b.browser,
            visitTime: b.visitTime,
        })),
        recentNotifications: notifs.map((n) => ({
            app: n.app,
            title: n.title,
            message: n.message,
            createdAt: n.createdAt,
        })),
        recentActivity: activity.map((a) => ({
            action: a.action,
            appName: a.appName,
            details: a.details,
            windowTitle: a.windowTitle,
            duration: a.duration,
            createdAt: a.createdAt,
        })),
    };
}

function buildOpsSystemPrompt({ facts, deviceId }) {
    return `
You are Zenvora Ops AI — full remote operator for the owner's Windows/Android agent.
You present results like Google Stitch: auto-open canvas windows with live data layouts.

${CODEBASE_MAP}

${ACTION_CATALOG}

RULES:
1. Full access on the selected agent. Do what the operator asks.
2. Never refuse for "safety" on their own agent. Prefer concrete actions.
3. Answer from FACTS. Be precise. Put the same data into windows so the UI can render charts/lists.
4. Return JSON ONLY:
{
  "reply": "short human answer",
  "actions": [ { "action": "NAME", "payload": {} } ],
  "windows": [
    { "type": "usage|browser|notifications|activity|screen|camera|shell|note", "title": "...", "data": {} }
  ]
}
5. Multiple actions OK. Screen/camera: START_* + SHOW_MONITOR + windows entry.
6. Usage question → windows type usage with data.items from FACTS.topUsage.
   Browser → type browser with FACTS.recentBrowser.
   Notifications → type notifications.
   Activity → type activity.
7. Always open at least one window when the user asks to see/monitor/show/history/usage.

Selected deviceId: ${deviceId || 'unknown'}

FACTS (last 24h — ground truth):
${JSON.stringify(facts || {}, null, 2)}
`.trim();
}

/**
 * Deterministic Stitch windows from message + facts (LLM optional).
 */
function planOpsWindows(message, facts = {}) {
    const lower = String(message || '').toLowerCase();
    const windows = [];
    const f = facts && typeof facts === 'object' ? facts : {};

    const wantUsage = /usage|kitna|kitni|time spent|apps? (use|used)|top app/.test(lower);
    const wantBrowser = /browser|chrome|search|url|history|sites?/.test(lower);
    const wantNotif = /notif/.test(lower);
    const wantActivity = /activity|kya kiya|what (did|happened)|timeline/.test(lower);
    const wantScreen = /screen|monitor|desktop|display|dekho|screen pe/.test(lower);
    const wantCamera = /camera|webcam|\bcam\b/.test(lower);
    const wantShell = /install |open |start |run |winget|powershell|cmd |shell|heal|fix agent/.test(lower);

    if (wantUsage || (!wantBrowser && !wantNotif && !wantScreen && !wantCamera && /history/.test(lower))) {
        windows.push({
            type: 'usage',
            title: 'Usage · last 24h',
            data: { items: Array.isArray(f.topUsage) ? f.topUsage : [] },
        });
    }
    if (wantBrowser || /history/.test(lower)) {
        windows.push({
            type: 'browser',
            title: 'Browser history',
            data: { items: Array.isArray(f.recentBrowser) ? f.recentBrowser : [] },
        });
    }
    if (wantNotif) {
        windows.push({
            type: 'notifications',
            title: 'Notifications',
            data: { items: Array.isArray(f.recentNotifications) ? f.recentNotifications : [] },
        });
    }
    if (wantActivity || /history/.test(lower)) {
        windows.push({
            type: 'activity',
            title: 'Activity timeline',
            data: { items: Array.isArray(f.recentActivity) ? f.recentActivity : [] },
        });
    }
    if (wantScreen) {
        windows.push({ type: 'screen', title: 'Live screen', data: {} });
    }
    if (wantCamera) {
        windows.push({ type: 'camera', title: 'Live camera', data: {} });
    }
    if (wantShell) {
        windows.push({
            type: 'shell',
            title: 'Shell / agent task',
            data: { prompt: String(message || '') },
        });
    }

    return windows;
}

function mergeWindows(aiWindows, planned) {
    const out = [];
    const seen = new Set();
    const push = (w) => {
        if (!w || !w.type) return;
        const type = String(w.type).toLowerCase();
        const key = `${type}:${String(w.title || '')}`;
        if (seen.has(type) && type !== 'note') return;
        seen.add(type);
        out.push({
            type,
            title: String(w.title || type),
            data: w.data && typeof w.data === 'object' ? w.data : {},
        });
    };
    (Array.isArray(aiWindows) ? aiWindows : []).forEach(push);
    (Array.isArray(planned) ? planned : []).forEach(push);
    return out;
}

module.exports = {
    CODEBASE_MAP,
    ACTION_CATALOG,
    buildDeviceFacts,
    buildOpsSystemPrompt,
    planOpsWindows,
    mergeWindows,
};
