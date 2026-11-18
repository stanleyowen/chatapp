export interface Config {
  host: string;
  port: number;
  /** Exact origins allowed to open a WebSocket (e.g. https://chat.example.com). */
  allowedOrigins: ReadonlySet<string>;
  /**
   * Which peers may supply the client IP via `clientIpHeader`:
   *  - none:     never (relay is directly exposed)
   *  - loopback: a proxy on the same host (nginx)
   *  - private:  loopback or a private-network address (Docker sidecar such as
   *              cloudflared). Only safe when the relay port is not reachable
   *              from the internet – e.g. an internal Docker network.
   */
  trustProxy: 'none' | 'loopback' | 'private';
  /** Header carrying the real client IP, e.g. x-real-ip or cf-connecting-ip. */
  clientIpHeader: string;
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxRooms: number;
}

function int(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function parseTrustProxy(raw: string | undefined): Config['trustProxy'] {
  switch ((raw ?? '').trim().toLowerCase()) {
    case '':
    case '0':
    case 'false':
    case 'none':
      return 'none';
    case '1':
    case 'true':
    case 'loopback':
      return 'loopback';
    case 'private':
      return 'private';
    default:
      throw new Error('TRUST_PROXY must be one of: none, loopback, private');
  }
}

function parseHeaderName(raw: string | undefined): string {
  const name = (raw || 'x-real-ip').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error('CLIENT_IP_HEADER must be a valid header name');
  return name;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );

  if (allowedOrigins.size === 0) {
    if (env.NODE_ENV === 'production') {
      throw new Error('ALLOWED_ORIGINS is required in production (e.g. https://chat.example.com)');
    }
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  for (const origin of allowedOrigins) {
    if (origin === '*' || !/^https?:\/\/[^/]+$/.test(origin)) {
      throw new Error(`Invalid origin in ALLOWED_ORIGINS: ${origin}`);
    }
  }

  return {
    host: env.HOST || '127.0.0.1',
    port: int('PORT', 8787, env),
    allowedOrigins,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    clientIpHeader: parseHeaderName(env.CLIENT_IP_HEADER),
    maxConnections: int('MAX_CONNECTIONS', 5000, env),
    maxConnectionsPerIp: int('MAX_CONNECTIONS_PER_IP', 20, env),
    maxRooms: int('MAX_ROOMS', 10_000, env),
  };
}
