/**
 * End-to-end encryption for rooms, using only the browser's Web Crypto API.
 *
 *   room code ──PBKDF2(300k)──▶ master ──HKDF──┬─▶ room id   (sent to server, opaque)
 *                                             └─▶ AES-256-GCM key (never leaves the browser)
 *
 * The room code itself lives only in the URL fragment (#...), which browsers
 * never send to any server. The relay server therefore sees an unlinkable
 * room id and ciphertext, nothing else.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const VERSION = 'chatapp/v1';
const SALT = enc.encode(`${VERSION}/room-salt`);
/** Slows down offline guessing of human-chosen room names. */
const PBKDF2_ITERATIONS = 300_000;
const IV_BYTES = 12;
/** Pad plaintexts to a multiple of this to hide exact message length. */
const PAD_TO = 64;

export type Kind = 'msg' | 'profile';

export interface RoomKeys {
  roomId: string;
  key: CryptoKey;
}

export async function deriveRoomKeys(code: string): Promise<RoomKeys> {
  const password = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: PBKDF2_ITERATIONS },
    password,
    256,
  );
  const hkdf = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const info = (label: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(`${VERSION}/${label}`) });

  const [idBits, key] = await Promise.all([
    crypto.subtle.deriveBits(info('room-id'), hkdf, 256),
    crypto.subtle.deriveKey(info('aes-key'), hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
  ]);
  return { roomId: toHex(new Uint8Array(idBits)), key };
}

/** Additional authenticated data binds ciphertext to its room and purpose. */
const aad = (keys: RoomKeys, kind: Kind) => enc.encode(`${VERSION}|${keys.roomId}|${kind}`);

export async function seal(keys: RoomKeys, kind: Kind, value: unknown): Promise<string> {
  let json = JSON.stringify(value);
  const len = enc.encode(json).length;
  json += ' '.repeat((PAD_TO - (len % PAD_TO)) % PAD_TO); // JSON.parse ignores trailing whitespace
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(keys, kind) },
    keys.key,
    enc.encode(json),
  );
  const out = new Uint8Array(IV_BYTES + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), IV_BYTES);
  return toBase64Url(out);
}

/** Returns null for anything that fails authentication or parsing. */
export async function open(keys: RoomKeys, kind: Kind, blob: string): Promise<unknown> {
  try {
    const bytes = fromBase64Url(blob);
    if (bytes.length <= IV_BYTES) return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: aad(keys, kind) },
      keys.key,
      bytes.subarray(IV_BYTES),
    );
    return JSON.parse(dec.decode(pt)) as unknown;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 12): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function toBase64Url(b: Uint8Array): string {
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
