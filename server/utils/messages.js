/**
 * Shared Zenvora production messages (Node server).
 * Source of truth: shared/zenvora-messages.json + MESSAGES.md
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'shared', 'zenvora-messages.json');
const catalog = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const MESSAGES = catalog.messages || {};
const PREFIX = catalog.prefix || 'ZENVORA';

function entry(code) {
    return MESSAGES[String(code)] || null;
}

function msgText(code, detail) {
    const e = entry(code);
    const base = e
        ? `[${PREFIX}-${code}] ${e.text}`
        : `[${PREFIX}-${code}] Unknown message`;
    const d = detail != null ? String(detail).trim() : '';
    return d ? `${base} (${d})` : base;
}

function msgMeaning(code) {
    return entry(code)?.meaning || 'No meaning documented for this code';
}

function msgKind(code) {
    return entry(code)?.kind || 'info';
}

function logMsg(code, detail, extra) {
    const text = msgText(code, detail);
    const line = `${text} — ${msgMeaning(code)}`;
    const kind = msgKind(code);
    if (kind === 'error') console.error(line, extra || '');
    else if (kind === 'warn') console.warn(line, extra || '');
    else console.log(line, extra || '');
    return text;
}

/** Express JSON error/success body with stable code. */
function jsonMsg(res, status, code, detail, extra = {}) {
    const message = msgText(code, detail);
    logMsg(code, detail);
    return res.status(status).json({
        success: status < 400,
        code: Number(code),
        message,
        meaning: msgMeaning(code),
        ...extra,
    });
}

const Z = {
    ACCOUNT_CREATED: 202,
    SIGNED_IN: 201,
    AUTH_REQUIRED: 301,
    AUTH_FAILED: 302,
    REGISTER_FAILED: 304,
    PAIR_FAILED: 402,
    AUTH_REJECTED: 403,
    UNAUTHORIZED_CONTROL: 404,
    DEVICE_OFFLINE: 504,
    DUPLICATE_AGENT: 503,
    BINARY_MISSING: 708,
    STORAGE_ERROR: 804,
    LOAD_FAILED: 806,
    UPDATE_FAILED: 807,
    DEVICE_NOT_FOUND: 808,
    USER_NOT_FOUND: 809,
    FILE_FAILED: 810,
    SELECT_DEVICE: 905,
};

module.exports = {
    msgText,
    msgMeaning,
    msgKind,
    logMsg,
    jsonMsg,
    Z,
    MESSAGES,
};
