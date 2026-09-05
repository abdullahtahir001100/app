/**
 * Shared Zenvora production messages (browser).
 * Source of truth: shared/zenvora-messages.json + MESSAGES.md
 */
import catalog from "@/shared/zenvora-messages.json";
import { toast } from "sonner";

export type MsgKind = "info" | "success" | "warn" | "error";

type CatalogEntry = { kind: MsgKind; text: string; meaning: string };

const MESSAGES = catalog.messages as Record<string, CatalogEntry>;
const PREFIX = catalog.prefix || "ZENVORA";

export function msgText(code: number | string, detail?: string): string {
  const key = String(code);
  const entry = MESSAGES[key];
  const base = entry
    ? `[${PREFIX}-${key}] ${entry.text}`
    : `[${PREFIX}-${key}] Unknown message`;
  const d = detail?.trim();
  return d ? `${base} (${d})` : base;
}

export function msgMeaning(code: number | string): string {
  const entry = MESSAGES[String(code)];
  return entry?.meaning || "No meaning documented for this code";
}

export function msgKind(code: number | string): MsgKind {
  return MESSAGES[String(code)]?.kind || "info";
}

/** Prefer API `code` when present; otherwise fall back. */
export function alertFromApi(
  data: { code?: number; message?: string } | null | undefined,
  fallbackCode: number | string,
  detail?: string
): string {
  if (data?.code != null) {
    return alertMsg(data.code, detail || (data.message?.includes(`[${PREFIX}-`) ? undefined : data.message));
  }
  if (data?.message?.includes(`[${PREFIX}-`)) {
    logMsg(fallbackCode, detail);
    toast.error(data.message);
    return data.message;
  }
  return alertMsg(fallbackCode, detail || data?.message);
}

/** console.* with code + meaning (production-friendly). */
export function logMsg(
  code: number | string,
  detail?: string,
  extra?: unknown
): string {
  const text = msgText(code, detail);
  const meaning = msgMeaning(code);
  const line = `${text} — ${meaning}`;
  const kind = msgKind(code);
  if (kind === "error") console.error(line, extra ?? "");
  else if (kind === "warn") console.warn(line, extra ?? "");
  else console.log(line, extra ?? "");
  return text;
}

/** sonner toast + console with the same coded text. */
export function alertMsg(code: number | string, detail?: string): string {
  const text = msgText(code, detail);
  logMsg(code, detail);
  const kind = msgKind(code);
  if (kind === "error") toast.error(text, { description: msgMeaning(code) });
  else if (kind === "warn") toast.message(text, { description: msgMeaning(code) });
  else if (kind === "success") toast.success(text);
  else toast.message(text);
  return text;
}

/** Named codes for call sites (keep in sync with JSON / Rust). */
export const Z = {
  PROVISION_STARTED: 100,
  AGENT_READY: 101,
  PAIRING: 102,
  CREDENTIALS_SAVED: 103,
  CONNECTED: 200,
  SIGNED_IN: 201,
  ACCOUNT_CREATED: 202,
  VERIFIED: 203,
  COMMAND_COPIED: 204,
  RESTART_SENT: 205,
  PAIRING_ROTATED: 206,
  PAIRING_UPDATED: 207,
  AGENT_UPDATE_SENT: 208,
  AUTH_REQUIRED: 301,
  AUTH_FAILED: 302,
  PASSWORD_MISMATCH: 303,
  REGISTER_FAILED: 304,
  INVALID_OTP: 305,
  VERIFY_FAILED: 306,
  GOOGLE_REDIRECT: 307,
  OTP_RESENT: 308,
  OTP_RESEND_FAILED: 309,
  SESSION_REPLACED: 310,
  PAIR_REQUIRED: 401,
  PAIR_FAILED: 402,
  AUTH_REJECTED: 403,
  UNAUTHORIZED_CONTROL: 404,
  GATEWAY_UNREACHABLE: 501,
  HANDSHAKE_TIMEOUT: 502,
  DUPLICATE_AGENT: 503,
  DEVICE_OFFLINE: 504,
  RECONNECTING: 505,
  AGENT_OFFLINE: 506,
  GATEWAY_READY: 507,
  MEDIA_CONNECTING: 601,
  MEDIA_NOT_READY: 602,
  MEDIA_READY: 603,
  STREAM_START_FAILED: 604,
  WAITING_STREAM: 605,
  LIVE_STREAM: 606,
  STREAM_STOPPED: 607,
  STREAM_INTERRUPTED: 608,
  NO_AGENT: 609,
  COMMAND_FAILED: 610,
  ADMIN_REQUIRED: 701,
  INSTALL_BLOCKED: 702,
  BINARY_MISSING: 708,
  SHORT_CMD_NOT_READY: 709,
  COPY_FAILED: 710,
  STORAGE_ERROR: 804,
  LOAD_FAILED: 806,
  UPDATE_FAILED: 807,
  DEVICE_NOT_FOUND: 808,
  USER_NOT_FOUND: 809,
  FILE_FAILED: 810,
  SESSION_ZERO: 901,
  CAMERA_IN_USE: 902,
  CAMERA_OPEN_FAILED: 903,
  SCREEN_CAPTURE_FAILED: 904,
  SELECT_DEVICE: 905,
  ENTER_DEST_PATH: 906,
} as const;
