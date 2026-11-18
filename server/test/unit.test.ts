import { describe, expect, it } from 'vitest';

import { LIMITS, type ServerFrame } from '../../shared/protocol.ts';
import { loadConfig } from '../src/config.ts';
import { Hub, type Peer } from '../src/hub.ts';
import { TokenBucket } from '../src/rateLimit.ts';
import { clientIp, isLoopback, isPrivate } from '../src/server.ts';
import { parseClientFrame } from '../src/validate.ts';

const ROOM = 'a'.repeat(64);

describe('parseClientFrame', () => {
  it('accepts well-formed frames and strips unknown keys', () => {
    expect(parseClientFrame(JSON.stringify({ t: 'join', room: ROOM, profile: 'abc_-', extra: 1 }))).toEqual({
      t: 'join',
      room: ROOM,
      profile: 'abc_-',
    });
    expect(parseClientFrame('{"t":"msg","cid":"x1","data":"QUJD"}')).toEqual({ t: 'msg', cid: 'x1', data: 'QUJD' });
    expect(parseClientFrame('{"t":"typing"}')).toEqual({ t: 'typing' });
  });

  it.each([
    ['not json', '{'],
    ['array', '[]'],
    ['null', 'null'],
    ['unknown type', '{"t":"nope"}'],
    ['non-hex room', JSON.stringify({ t: 'join', room: 'Z'.repeat(64), profile: 'a' })],
    ['short room', JSON.stringify({ t: 'join', room: 'a', profile: 'a' })],
    ['non-string profile', JSON.stringify({ t: 'join', room: ROOM, profile: 5 })],
    ['empty profile', JSON.stringify({ t: 'join', room: ROOM, profile: '' })],
    ['html in data', JSON.stringify({ t: 'msg', cid: 'a', data: '<script>' })],
    ['oversized data', JSON.stringify({ t: 'msg', cid: 'a', data: 'a'.repeat(LIMITS.maxCiphertextChars + 1) })],
    ['oversized profile', JSON.stringify({ t: 'join', room: ROOM, profile: 'a'.repeat(LIMITS.maxProfileChars + 1) })],
    ['bad cid', JSON.stringify({ t: 'msg', cid: 'a b', data: 'a' })],
    ['proto pollution attempt', '{"t":"msg","__proto__":{"x":1},"cid":{},"data":"a"}'],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientFrame(raw)).toBeNull();
  });
});

describe('TokenBucket', () => {
  it('allows a burst, then refills over time', () => {
    let now = 0;
    const b = new TokenBucket(3, 1, () => now);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    now += 1000;
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    now += 60_000;
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });
});

describe('loadConfig', () => {
  it('requires explicit origins in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ALLOWED_ORIGINS/);
  });
  it('rejects wildcard and malformed origins', () => {
    expect(() => loadConfig({ ALLOWED_ORIGINS: '*' })).toThrow();
    expect(() => loadConfig({ ALLOWED_ORIGINS: 'https://a.com/path' })).toThrow();
  });
  it('normalises trailing slashes', () => {
    expect([...loadConfig({ ALLOWED_ORIGINS: 'https://a.com/, https://b.com' }).allowedOrigins]).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});

function fakePeer(id: string): Peer & { inbox: ServerFrame[] } {
  const inbox: ServerFrame[] = [];
  return { id, inbox, send: (s) => inbox.push(JSON.parse(s) as ServerFrame) };
}

describe('Hub', () => {
  it('joins, relays, and cleans up empty rooms', () => {
    const hub = new Hub({ maxRooms: 10, now: () => 42 });
    const a = fakePeer('a');
    const b = fakePeer('b');

    expect(hub.join(a, ROOM, 'pa')).toBeNull();
    expect(a.inbox.at(-1)).toEqual({ t: 'welcome', self: 'a', members: [{ id: 'a', profile: 'pa' }] });

    expect(hub.join(b, ROOM, 'pb')).toBeNull();
    expect(a.inbox.at(-1)).toEqual({ t: 'joined', member: { id: 'b', profile: 'pb' } });
    expect(b.inbox.at(-1)).toMatchObject({ t: 'welcome', self: 'b' });

    expect(hub.message(a, 'c1', 'ct')).toBeNull();
    const msg = { t: 'msg', from: 'a', cid: 'c1', data: 'ct', ts: 42 };
    expect(a.inbox.at(-1)).toEqual(msg);
    expect(b.inbox.at(-1)).toEqual(msg);

    hub.typing(b);
    expect(a.inbox.at(-1)).toEqual({ t: 'typing', from: 'b' });
    expect(b.inbox.at(-1)).toEqual(msg); // typing isn't echoed to sender

    hub.leave(a);
    expect(b.inbox.at(-1)).toEqual({ t: 'left', id: 'a' });
    hub.leave(b);
    expect(hub.roomCount).toBe(0);
  });

  it('refuses double joins, messages before join, and enforces caps', () => {
    const hub = new Hub({ maxRooms: 1, maxRoomMembers: 1 });
    const a = fakePeer('a');
    expect(hub.message(a, 'c', 'd')).toBe('not_joined');
    expect(hub.typing(a)).toBe('not_joined');
    expect(hub.join(a, ROOM, 'p')).toBeNull();
    expect(hub.join(a, ROOM, 'p')).toBe('already_joined');
    expect(hub.join(fakePeer('b'), ROOM, 'p')).toBe('room_full');
    expect(hub.join(fakePeer('c'), 'b'.repeat(64), 'p')).toBe('server_full');
  });
});

describe('client IP behind a proxy', () => {
  const req = (remoteAddress: string, headers: Record<string, string> = {}) =>
    ({ socket: { remoteAddress }, headers }) as unknown as import('node:http').IncomingMessage;
  const cf = { 'cf-connecting-ip': '203.0.113.9' };

  it('classifies addresses', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(a)).toBe(true);
    for (const a of ['10.1.2.3', '172.18.0.3', '::ffff:172.31.255.1', '192.168.1.5', 'fd00::1']) expect(isPrivate(a)).toBe(true);
    for (const a of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '2606:4700::1', '::ffff:1.1.1.1']) expect(isPrivate(a)).toBe(false);
  });

  it('only honours the header from trusted peers', () => {
    const priv = { trustProxy: 'private' as const, clientIpHeader: 'cf-connecting-ip' };
    expect(clientIp(req('172.18.0.3', cf), priv)).toBe('203.0.113.9');
    expect(clientIp(req('8.8.8.8', cf), priv)).toBe('8.8.8.8'); // spoof attempt from the internet
    expect(clientIp(req('172.18.0.3', cf), { ...priv, trustProxy: 'loopback' })).toBe('172.18.0.3');
    expect(clientIp(req('127.0.0.1', cf), { ...priv, trustProxy: 'none' })).toBe('127.0.0.1');
    expect(clientIp(req('172.18.0.3'), priv)).toBe('172.18.0.3'); // header missing
  });

  it('parses TRUST_PROXY / CLIENT_IP_HEADER strictly', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe('loopback');
    expect(loadConfig({ TRUST_PROXY: 'private', CLIENT_IP_HEADER: 'CF-Connecting-IP' })).toMatchObject({
      trustProxy: 'private',
      clientIpHeader: 'cf-connecting-ip',
    });
    expect(() => loadConfig({ TRUST_PROXY: 'everyone' })).toThrow();
    expect(() => loadConfig({ CLIENT_IP_HEADER: 'bad header' })).toThrow();
  });
});
