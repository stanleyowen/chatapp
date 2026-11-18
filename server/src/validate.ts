import {
  BLOB_PATTERN,
  CLIENT_ID_PATTERN,
  LIMITS,
  ROOM_ID_PATTERN,
  type ClientFrame,
} from '../../shared/protocol.ts';

const isBlob = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max && BLOB_PATTERN.test(v);

/**
 * Strictly parse an untrusted frame. Returns null for anything malformed.
 * Builds fresh objects so unexpected keys never propagate.
 */
export function parseClientFrame(raw: string): ClientFrame | null {
  if (raw.length > LIMITS.maxPayloadBytes) return null;

  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;

  switch (o.t) {
    case 'join':
      if (typeof o.room === 'string' && ROOM_ID_PATTERN.test(o.room) && isBlob(o.profile, LIMITS.maxProfileChars)) {
        return { t: 'join', room: o.room, profile: o.profile };
      }
      return null;
    case 'msg':
      if (typeof o.cid === 'string' && CLIENT_ID_PATTERN.test(o.cid) && isBlob(o.data, LIMITS.maxCiphertextChars)) {
        return { t: 'msg', cid: o.cid, data: o.data };
      }
      return null;
    case 'typing':
      return { t: 'typing' };
    default:
      return null;
  }
}
