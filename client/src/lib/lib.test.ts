import { describe, expect, it } from 'vitest';

import { LIMITS } from '../../../shared/protocol';
import { deriveRoomKeys, open, seal } from './crypto';
import { generateRoomCode, isGeneratedCode, normalizeRoom, roomFromHash } from './room';
import { cleanMessage, cleanName, initials } from './text';

describe('room codes', () => {
  it('generates canonical, unique codes', () => {
    const codes = new Set(Array.from({ length: 200 }, generateRoomCode));
    expect(codes.size).toBe(200);
    for (const c of codes) {
      expect(isGeneratedCode(c)).toBe(true);
      expect(normalizeRoom(c)).toBe(c);
    }
  });

  it('normalises typed codes regardless of case/spacing', () => {
    const c = generateRoomCode();
    expect(normalizeRoom(` ${c.toUpperCase().replace(/-/g, ' ')} `)).toBe(c);
    expect(normalizeRoom(c.replace(/-/g, ''))).toBe(c);
  });

  it('normalises free-form room names', () => {
    expect(normalizeRoom('  Design   Team ')).toBe('design team');
    expect(normalizeRoom('ｄｅｓｉｇｎ')).toBe('design'); // NFKC folds full-width
    expect(isGeneratedCode('design team')).toBe(false);
  });

  it('parses the URL fragment defensively', () => {
    expect(roomFromHash('')).toBeNull();
    expect(roomFromHash('#')).toBeNull();
    expect(roomFromHash('#%E0%A4%A')).toBeNull(); // malformed escape
    expect(roomFromHash(`#${'a'.repeat(100)}`)).toBeNull();
    expect(roomFromHash('#Design%20Team')).toBe('design team');
  });
});

describe('end-to-end crypto', () => {
  it('derives the same room id and key from the same code, and different ones otherwise', async () => {
    const [a, b, c] = await Promise.all([deriveRoomKeys('room-x'), deriveRoomKeys('room-x'), deriveRoomKeys('room-y')]);
    expect(a.roomId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.roomId).toBe(b.roomId);
    expect(a.roomId).not.toBe(c.roomId);

    const blob = await seal(a, 'msg', { text: 'hi' });
    expect(await open(b, 'msg', blob)).toEqual({ text: 'hi' });
    expect(await open(c, 'msg', blob)).toBeNull(); // wrong room key
  });

  it('rejects tampering, kind confusion, and garbage', async () => {
    const k = await deriveRoomKeys('room-z');
    const blob = await seal(k, 'profile', { n: 'Alex' });
    expect(await open(k, 'msg', blob)).toBeNull(); // AAD binds the purpose
    const flipped = blob.slice(0, 20) + (blob[20] === 'A' ? 'B' : 'A') + blob.slice(21);
    expect(await open(k, 'profile', flipped)).toBeNull();
    expect(await open(k, 'profile', '!!!')).toBeNull();
    expect(await open(k, 'profile', '')).toBeNull();
  });

  it('uses a fresh IV per message and pads lengths', async () => {
    const k = await deriveRoomKeys('room-pad');
    const [x, y] = await Promise.all([seal(k, 'msg', { text: 'a' }), seal(k, 'msg', { text: 'a' })]);
    expect(x).not.toBe(y);
    const short = await seal(k, 'msg', { text: 'a' });
    const longer = await seal(k, 'msg', { text: 'a'.repeat(30) });
    expect(short.length).toBe(longer.length); // same 64-byte bucket
  });

  it('fits the largest allowed message within the server ciphertext limit', async () => {
    const k = await deriveRoomKeys('room-max');
    const worst = '😀'.repeat(LIMITS.maxMessageChars / 2); // 4 bytes per 2 UTF-16 units
    const blob = await seal(k, 'msg', { text: worst, from: 'x'.repeat(16), cid: 'y'.repeat(12) });
    expect(blob.length).toBeLessThanOrEqual(LIMITS.maxCiphertextChars);
    const nameBlob = await seal(k, 'profile', { n: '😀'.repeat(LIMITS.maxNameChars) });
    expect(nameBlob.length).toBeLessThanOrEqual(LIMITS.maxProfileChars);
  });
});

describe('text sanitising', () => {
  it('strips bidi overrides and control characters from names', () => {
    expect(cleanName('  evil‮txt.exe ')).toBe('eviltxt.exe');
    expect(cleanName('a\u0000b\nc')).toBe('abc');
    expect(cleanName('👩‍💻 Dev')).toBe('👩‍💻 Dev'); // ZWJ emoji survive
    expect(cleanName(42)).toBe('');
    expect([...cleanName('x'.repeat(100))].length).toBe(LIMITS.maxNameChars);
  });

  it('keeps newlines in messages but removes dangerous invisibles', () => {
    expect(cleanMessage('hi\n\n\n\nthere⁦')).toBe('hi\n\nthere');
    expect(cleanMessage('   ')).toBe('');
    expect(cleanMessage({})).toBe('');
  });

  it('builds initials', () => {
    expect(initials('alex smith')).toBe('AS');
    expect(initials('Ünal')).toBe('Ü');
    expect(initials('👩‍💻 Dev')).toBe('D');
    expect(initials('Bob 🚀')).toBe('B');
    expect(initials('👩‍💻')).toBe('👩‍💻'); // whole grapheme, not half a ZWJ sequence
    expect(initials('')).toBe('?');
  });
});
