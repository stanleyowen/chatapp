import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { CLOSE, LIMITS, type ServerFrame } from '../../shared/protocol.ts';
import { loadConfig } from '../src/config.ts';
import { createChatServer, type ChatServer } from '../src/server.ts';

const ORIGIN = 'https://chat.test';
const ROOM = 'f'.repeat(64);

let chat: ChatServer;
let base: string;

beforeAll(async () => {
  chat = createChatServer(loadConfig({ ALLOWED_ORIGINS: ORIGIN, MAX_CONNECTIONS_PER_IP: '5' }));
  await new Promise<void>((r) => chat.server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${(chat.server.address() as AddressInfo).port}`;
});

afterAll(() => chat.close());

interface Client {
  ws: WebSocket;
  next(): Promise<ServerFrame>;
  closed: Promise<number>;
}

function connect(origin = ORIGIN, path = '/ws'): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}${path}`, { origin });
    const queue: ServerFrame[] = [];
    const waiters: ((f: ServerFrame) => void)[] = [];
    ws.on('message', (d) => {
      const f = JSON.parse(d.toString()) as ServerFrame;
      const w = waiters.shift();
      if (w) w(f);
      else queue.push(f);
    });
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.once('open', () =>
      resolve({
        ws,
        closed,
        next: () => {
          const f = queue.shift();
          return f ? Promise.resolve(f) : new Promise((r) => waiters.push(r));
        },
      }),
    );
    ws.once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
    ws.once('error', reject);
  });
}

describe('http', () => {
  it('serves a health check with hardened headers', async () => {
    const res = await fetch(`http://${base}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await fetch(`http://${base}/`)).status).toBe(404);
  });
});

describe('websocket', () => {
  it('rejects foreign or missing origins (CSWSH protection)', async () => {
    await expect(connect('https://evil.test')).rejects.toThrow('403');
    await expect(connect('')).rejects.toThrow('403');
  });

  it('rejects unknown paths', async () => {
    await expect(connect(ORIGIN, '/other')).rejects.toThrow('404');
  });

  it('relays encrypted messages between members of a room', async () => {
    const a = await connect();
    a.ws.send(JSON.stringify({ t: 'join', room: ROOM, profile: 'cGE' }));
    const welcomeA = await a.next();
    expect(welcomeA).toMatchObject({ t: 'welcome', members: [{ profile: 'cGE' }] });

    const b = await connect();
    b.ws.send(JSON.stringify({ t: 'join', room: ROOM, profile: 'cGI' }));
    expect((await b.next()).t).toBe('welcome');
    expect(await a.next()).toMatchObject({ t: 'joined', member: { profile: 'cGI' } });

    b.ws.send(JSON.stringify({ t: 'msg', cid: 'm1', data: 'Y2lwaGVy' }));
    const got = await a.next();
    expect(got).toMatchObject({ t: 'msg', cid: 'm1', data: 'Y2lwaGVy' });
    expect(await b.next()).toEqual(got);

    b.ws.close();
    expect(await a.next()).toMatchObject({ t: 'left' });
    a.ws.close();
  });

  it.each([
    ['garbage', 'not json'],
    ['message before join', JSON.stringify({ t: 'msg', cid: 'a', data: 'a' })],
    ['typed garbage', JSON.stringify({ t: 'join', room: 1, profile: null })],
  ])('closes the socket on %s without crashing the server', async (_l, payload) => {
    const c = await connect();
    c.ws.send(payload);
    expect(await c.next()).toMatchObject({ t: 'error', fatal: true });
    expect(await c.closed).toBe(CLOSE.policy);
    // server is still alive
    expect((await fetch(`http://${base}/healthz`)).status).toBe(200);
  });

  it('closes on binary frames and oversized payloads', async () => {
    const c1 = await connect();
    c1.ws.send(Buffer.from([1, 2, 3]));
    expect(await c1.closed).toBe(CLOSE.policy);

    const c2 = await connect();
    c2.ws.send('x'.repeat(64 * 1024));
    expect(await c2.closed).toBe(CLOSE.tooBig);
  });

  it('rate-limits floods', async () => {
    const c = await connect();
    c.ws.send(JSON.stringify({ t: 'join', room: ROOM, profile: 'cA' }));
    await c.next();
    for (let i = 0; i < 60; i++) c.ws.send('{"t":"typing"}');
    expect(await c.closed).toBe(CLOSE.rateLimited);
  });

  it('shares one ciphertext budget across all connections from an IP (fan-out amplification)', async () => {
    const room = 'e'.repeat(64);
    const [a, b] = await Promise.all([connect(), connect()]);
    for (const c of [a, b]) {
      c.ws.send(JSON.stringify({ t: 'join', room, profile: 'cA' }));
      expect((await c.next()).t).toBe('welcome');
    }
    expect((await a.next()).t).toBe('joined'); // b arrived

    // 30 max-size messages (360 KB) exceed the 256 KB per-IP burst even though
    // each connection stays well inside its own per-connection rate limit.
    const big = JSON.stringify({ t: 'msg', cid: 'x', data: 'A'.repeat(LIMITS.maxCiphertextChars) });
    for (let i = 0; i < 15; i++) a.ws.send(big);
    for (let i = 0; i < 15; i++) b.ws.send(big);

    let f: ServerFrame;
    do f = await b.next();
    while (f.t === 'msg');
    expect(f).toEqual({ t: 'error', code: 'rate_limited', fatal: false });

    for (const c of [a, b]) c.ws.close();
    await Promise.all([a.closed, b.closed]);
  });

  it('caps connections per IP', async () => {
    const clients = await Promise.all(Array.from({ length: 5 }, () => connect()));
    await expect(connect()).rejects.toThrow('429');
    for (const c of clients) c.ws.close();
    await Promise.all(clients.map((c) => c.closed));
  });
});
