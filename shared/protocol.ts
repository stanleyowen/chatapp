/**
 * Wire protocol shared by client and server.
 *
 * Privacy model: the server only ever sees an opaque room id (derived from the
 * room code in the browser) and opaque ciphertext blobs. Display names and
 * message bodies are end-to-end encrypted; the server cannot read them.
 *
 * This file must stay "erasable" TypeScript (no enums / namespaces) so Node can
 * run it directly with native type stripping.
 */

export const LIMITS = {
  /** Max size of a single WebSocket frame accepted by the server (bytes). */
  maxPayloadBytes: 16 * 1024,
  /** Max plaintext message length the client allows (characters). */
  maxMessageChars: 2000,
  /** Max encrypted message blob length (base64url chars). */
  maxCiphertextChars: 12_000,
  /** Max display-name length (characters, after trimming). */
  maxNameChars: 32,
  /** Max encrypted profile blob length (base64url chars). */
  maxProfileChars: 512,
  /** Max client-generated message id length. */
  maxClientIdChars: 32,
  /** Max members in a single room. */
  maxRoomMembers: 50,
} as const;

/** Room ids are 32 bytes, hex encoded (derived client-side from the room code). */
export const ROOM_ID_PATTERN = /^[0-9a-f]{64}$/;
/** Ciphertext / profile blobs are base64url without padding. */
export const BLOB_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Client message ids: short random tokens used to reconcile optimistic sends. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export interface Member {
  /** Server-assigned, random, per-connection id. Not linked to any identity. */
  id: string;
  /** Encrypted profile (display name) – opaque to the server. */
  profile: string;
}

// ---- Client -> Server -------------------------------------------------------

export type ClientFrame =
  | { t: 'join'; room: string; profile: string }
  | { t: 'msg'; cid: string; data: string }
  | { t: 'typing' };

// ---- Server -> Client -------------------------------------------------------

export type ErrorCode =
  | 'bad_request'
  | 'rate_limited'
  | 'room_full'
  | 'server_full'
  | 'not_joined'
  | 'already_joined';

export type ServerFrame =
  | { t: 'welcome'; self: string; members: Member[] }
  | { t: 'joined'; member: Member }
  | { t: 'left'; id: string }
  | { t: 'msg'; from: string; cid: string; data: string; ts: number }
  | { t: 'typing'; from: string }
  | { t: 'error'; code: ErrorCode; fatal: boolean };

/** WebSocket close codes used by the server (4000–4999 is the app range). */
export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  policy: 1008,
  tooBig: 1009,
  joinTimeout: 4001,
  rateLimited: 4002,
  roomFull: 4003,
  serverFull: 4004,
} as const;
