import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { isIPv6 } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

import { CLOSE, LIMITS, type ErrorCode } from '../../shared/protocol.ts';
import type { Config } from './config.ts';
import { Hub, send, type Peer } from './hub.ts';
import { TokenBucket } from './rateLimit.ts';
import { parseClientFrame } from './validate.ts';

const WS_PATH = '/ws';
const JOIN_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
/** Drop clients that stop reading (protects server memory). */
const MAX_BUFFERED_BYTES = 1024 * 1024;
const RATE_BURST = 20;
const RATE_PER_SECOND = 5;
const MAX_RATE_STRIKES = 10;

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const ERROR_CLOSE: Partial<Record<ErrorCode, number>> = {
  room_full: CLOSE.roomFull,
  server_full: CLOSE.serverFull,
};

export interface ChatServer {
  server: http.Server;
  hub: Hub;
  close(): Promise<void>;
}

export function createChatServer(config: Config): ChatServer {
  const hub = new Hub({ maxRooms: config.maxRooms });
  const connectionsPerIp = new Map<string, number>();
  const heartbeats = new Map<WebSocket, () => void>();
  let connections = 0;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.maxPayloadBytes,
    // Ciphertext doesn't compress; deflate only adds CPU cost and attack surface.
    perMessageDeflate: false,
    clientTracking: true,
  });

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if ((req.method === 'GET' || req.method === 'HEAD') && path === '/healthz') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'ok');
      return;
    }
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  // Keep slow-loris style clients from holding sockets open.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.maxHeadersCount = 50;

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());

    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) return reject(socket, 404, 'Not Found');

    // Browsers always send Origin on WebSocket handshakes; CORS does NOT apply to
    // WebSockets, so this check is what prevents cross-site WebSocket hijacking.
    const origin = req.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) return reject(socket, 403, 'Forbidden');

    const ip = limitKey(clientIp(req, config));
    if (connections >= config.maxConnections) return reject(socket, 503, 'Service Unavailable');
    if ((connectionsPerIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
      return reject(socket, 429, 'Too Many Requests');
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      connections++;
      connectionsPerIp.set(ip, (connectionsPerIp.get(ip) ?? 0) + 1);
      ws.once('close', () => {
        connections--;
        const n = (connectionsPerIp.get(ip) ?? 1) - 1;
        if (n <= 0) connectionsPerIp.delete(ip);
        else connectionsPerIp.set(ip, n);
      });
      onConnection(ws);
    });
  });

  function onConnection(ws: WebSocket): void {
    const peer: Peer = {
      id: randomBytes(12).toString('base64url'),
      send(s) {
        if (ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
          ws.terminate();
          return;
        }
        ws.send(s);
      },
    };
    const bucket = new TokenBucket(RATE_BURST, RATE_PER_SECOND);
    let strikes = 0;
    let alive = true;

    const fail = (code: ErrorCode, closeCode: number): void => {
      send(peer, { t: 'error', code, fatal: true });
      ws.close(closeCode);
    };

    const joinTimer = setTimeout(() => {
      if (!hub.isJoined(peer)) ws.close(CLOSE.joinTimeout);
    }, JOIN_TIMEOUT_MS);

    ws.on('pong', () => {
      alive = true;
    });
    heartbeats.set(ws, () => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    });

    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) return fail('bad_request', CLOSE.policy);

        if (!bucket.take()) {
          if (++strikes > MAX_RATE_STRIKES) return fail('rate_limited', CLOSE.rateLimited);
          return send(peer, { t: 'error', code: 'rate_limited', fatal: false });
        }

        const frame = parseClientFrame(data.toString());
        if (!frame) return fail('bad_request', CLOSE.policy);

        let err: ErrorCode | null;
        switch (frame.t) {
          case 'join':
            err = hub.join(peer, frame.room, frame.profile);
            break;
          case 'msg':
            err = hub.message(peer, frame.cid, frame.data);
            break;
          case 'typing':
            err = hub.typing(peer);
            break;
        }
        if (err) fail(err, ERROR_CLOSE[err] ?? CLOSE.policy);
      } catch (e) {
        console.error('message handler error:', e instanceof Error ? e.message : e);
        ws.terminate();
      }
    });

    ws.on('error', () => ws.terminate());
    ws.once('close', () => {
      clearTimeout(joinTimer);
      heartbeats.delete(ws);
      hub.leave(peer);
    });
  }

  const heartbeat = setInterval(() => {
    for (const beat of heartbeats.values()) beat();
  }, HEARTBEAT_MS);
  heartbeat.unref();

  async function close(): Promise<void> {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.close(CLOSE.goingAway, 'Server restarting');
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
        resolve();
      }, 3000);
      force.unref();
      wss.close(() => {
        clearTimeout(force);
        resolve();
      });
    });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { server, hub, close };
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function clientIp(req: http.IncomingMessage, config: Pick<Config, 'trustProxy' | 'clientIpHeader'>): string {
  const remote = req.socket.remoteAddress ?? 'unknown';
  const trusted =
    (config.trustProxy === 'loopback' && isLoopback(remote)) ||
    (config.trustProxy === 'private' && (isLoopback(remote) || isPrivate(remote)));
  if (trusted) {
    const real = req.headers[config.clientIpHeader];
    if (typeof real === 'string' && real.length > 0 && real.length <= 64) return real.trim();
  }
  return remote;
}

const unmap = (addr: string) => (addr.startsWith('::ffff:') ? addr.slice(7) : addr);

/**
 * Key used for per-client limits. IPv4 addresses are used as-is, but an IPv6
 * client usually controls a whole /64 (2^64 addresses), so keying on the full
 * address would let one host bypass every per-IP limit by rotating addresses.
 */
export function limitKey(addr: string): string {
  const a = unmap(addr.trim().toLowerCase()).split('%')[0]!;
  if (!isIPv6(a)) return a;
  const [head = '', tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  // A trailing dotted IPv4 (e.g. 64:ff9b::1.2.3.4) occupies two groups.
  const width = (g: string[]) => g.reduce((n, x) => n + (x.includes('.') ? 2 : 1), 0);
  const groups = [...h, ...Array<string>(Math.max(0, 8 - width(h) - width(t))).fill('0'), ...t];
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

export function isLoopback(addr: string): boolean {
  const a = unmap(addr);
  return a === '::1' || /^127\./.test(a);
}

/** RFC 1918 IPv4 and RFC 4193 (fc00::/7) IPv6 – i.e. Docker bridge networks. */
export function isPrivate(addr: string): boolean {
  const a = unmap(addr).toLowerCase();
  if (/^10\./.test(a) || /^192\.168\./.test(a)) return true;
  const m = /^172\.(\d{1,3})\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/.test(a);
}
