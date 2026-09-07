/**
 * Manual media transport preference (wss | tcp).
 * No auto-failover — agent honors preference only.
 */

export type MediaTransport = "wss" | "tcp";

export const MEDIA_TRANSPORT_KEY = "zenvora_preferred_media_transport";

export function getPreferredMediaTransport(): MediaTransport {
  if (typeof window === "undefined") return "wss";
  try {
    const v = String(localStorage.getItem(MEDIA_TRANSPORT_KEY) || "wss").toLowerCase();
    return v === "tcp" ? "tcp" : "wss";
  } catch {
    return "wss";
  }
}

export function setPreferredMediaTransport(transport: MediaTransport) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MEDIA_TRANSPORT_KEY, transport);
  } catch {
    // ignore
  }
}

/** Dispatch preference to a live agent (manual only — never auto). */
export function dispatchMediaTransportPreference(
  dispatch: (
    action: string,
    payload?: Record<string, unknown>,
    target?: string
  ) => { ok: boolean } | boolean,
  transport: MediaTransport,
  deviceId: string
): boolean {
  setPreferredMediaTransport(transport);
  if (!deviceId) return false;
  const result = dispatch(
    "SET_PREFERRED_MEDIA_TRANSPORT",
    { transport, preferredMediaTransport: transport },
    deviceId
  );
  if (typeof result === "boolean") return result;
  return Boolean(result?.ok);
}
