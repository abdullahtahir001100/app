/**
 * Shared binary frame helpers for multi-device screen/camera streams.
 * Server wraps frames as: [0xFE][idLen][deviceId][original...]
 */

export const BINARY_DEVICE_ENVELOPE = 0xfe;

export function unwrapDeviceBinaryFrame(raw: ArrayBuffer | Uint8Array): {
  deviceId: string | null;
  frame: Uint8Array;
} {
  const buffer = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (buffer.length < 3 || buffer[0] !== BINARY_DEVICE_ENVELOPE) {
    return { deviceId: null, frame: buffer };
  }
  const idLen = buffer[1];
  if (idLen < 0 || buffer.length < 2 + idLen + 1) {
    return { deviceId: null, frame: buffer };
  }
  const deviceId = new TextDecoder().decode(buffer.subarray(2, 2 + idLen));
  return {
    deviceId: deviceId || null,
    frame: buffer.subarray(2 + idLen),
  };
}
