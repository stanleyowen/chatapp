# chatapp

> Private, end-to-end encrypted chat rooms. No accounts, no history, no trackers.

[![CI](https://github.com/stanleyowen/chatapp/actions/workflows/ci.yml/badge.svg)](https://github.com/stanleyowen/chatapp/actions/workflows/ci.yml)
[![Netlify Status](https://api.netlify.com/api/v1/badges/024685b7-595d-4ecf-85f6-3ed7cf7a9f60/deploy-status)](https://app.netlify.com/sites/chatapp-clone/deploys)
[![MIT License](https://img.shields.io/github/license/stanleyowen/chatapp?style=flat-square)](LICENSE)

- **End-to-end encrypted.** Messages *and* display names are encrypted in the browser (AES-256-GCM via Web Crypto). The server relays ciphertext it cannot read.
- **Nothing stored.** No database, no message history, no request logs. When the last person leaves, the room no longer exists anywhere.
- **No tracking.** No cookies, analytics, web fonts, CDNs, or any third-party request. Enforced by a strict Content-Security-Policy.
- **Fast.** ~80 KB gzipped total, two runtime dependencies on the client (React) and one on the server (`ws`).

## How it works

```
                       URL fragment (#…) – never sent to any server
                                 │
 Browser  ── room code ──PBKDF2──┴─HKDF──┬─▶ room id ───────────────┐
                                         └─▶ AES-256-GCM key (stays local)
                                                                    ▼
 Netlify (static files)            Cloudflare Tunnel ─▶ Node relay (Docker, in-memory only)
                                   sees: opaque room id, ciphertext, timing
```

- **Create private room** generates a random 100-bit code like `7kq2m-xv9ph-3dwz8-rb4tn`. The invite link is `https://your-site/#<code>`. Because the code lives in the `#fragment`, browsers never send it to Netlify or to the relay.
- You can also join by typing a **room name** (like the old app). Anyone who guesses that name can join, so the UI warns about it. PBKDF2 (300k iterations) slows guessing down, but use generated codes for anything private.

### Threat model (honest version)

| The relay server / a network attacker **cannot** | The relay server **can** |
| --- | --- |
| read messages or display names | see that *some* room exists, how many people are in it, and when they send messages |
| learn the room code or invite link | see IP addresses of connected clients (kept in memory only, for rate limiting) |
| forge or modify messages (AES-GCM authenticated; sender id is bound inside the ciphertext) | drop or delay messages |
| replay a message to someone who already received it (clients de-duplicate) | re-send an old ciphertext to a member who joined later (it would show as new) |
| impersonate a member inside the encrypted content | serve a malicious client *if* it also controls the Netlify site – E2EE in web apps trusts whoever serves the JS |

Anyone holding the invite link is a full member of the room. Treat the link like a password.

## Project layout

```
client/   React 19 + Vite 8 + TypeScript 7 single-page app (deploys to Netlify)
server/   Node.js WebSocket relay; TypeScript run natively by Node, no build step
shared/   Wire protocol + limits used by both
deploy/   Dockerfile, docker-compose (relay + Cloudflare Tunnel), deploy script
```

## Local development

Requires **Node.js 24+** (`nvm use` picks up `.nvmrc` → 26 LTS).

```bash
npm run install:all     # installs client/ and server/
npm run dev:server      # relay on ws://localhost:8787/ws
npm run dev:client      # app on http://localhost:5173
npm run check           # typecheck + lint + tests for both
```

> On macOS, avoid port 5000: AirPlay Receiver occupies it and answers `403`.

## Deploying

```
 Browser ──HTTPS──▶ Netlify (static client, chatapp-clone.netlify.app)
    │
    └──WSS──▶ Cloudflare edge ──Tunnel──▶ cloudflared ──internal net──▶ relay
              chat-api.stanleyowen.com    (container)    no internet    (container)
```

### 1. Relay server (Ubuntu + Docker, via Cloudflare Tunnel)

The relay runs as two containers in `~/server/chatapp` on the Ubuntu box. **No ports are opened on the host.** Traffic only arrives through an outbound Cloudflare Tunnel, and Cloudflare terminates TLS for `chat-api.stanleyowen.com`.

```bash
./deploy/deploy.sh            # tests, rsync over Cloudflare Access SSH, docker compose build + up, health check
```

`deploy.sh` defaults to `stanley@192.168.1.100` over plain SSH on the LAN. Away from home, run `./deploy/deploy.sh stanley@ssh.stanleyowen.com`, which goes through `cloudflared access ssh` automatically. It never needs sudo and never touches the server's `.env`.

One-time setup (already done for `chat-api.stanleyowen.com`):

```bash
cloudflared tunnel create chatapp-api
cloudflared tunnel route dns chatapp-api chat-api.stanleyowen.com
mkdir -m 700 -p ~/server/chatapp && cd ~/server/chatapp
umask 077 && printf 'ALLOWED_ORIGINS=https://chatapp-clone.netlify.app\nTUNNEL_TOKEN=%s\n' "$(cloudflared tunnel token chatapp-api)" > .env
```

To allow another client origin (e.g. a custom domain), edit `ALLOWED_ORIGINS` in `~/server/chatapp/.env` (comma separated) and run `docker compose up -d` there.

How the containers are hardened (`deploy/docker-compose.yml`, `deploy/Dockerfile`):

| | relay | cloudflared |
| --- | --- | --- |
| user | uid 10001, can't write its own code | uid 65532 |
| filesystem | read-only | read-only |
| capabilities | none (`cap_drop: ALL`, `no-new-privileges`) | none |
| network | **internal only: no internet, no DNS** | internal + outbound to Cloudflare |
| limits | 256 MB RAM, 1 CPU, 64 pids | 256 MB RAM, 64 pids |
| image | `node:26 alpine` pinned by digest; npm, yarn and corepack removed; built with `npm ci --ignore-scripts` | pinned by digest |
| logs | startup lines only, capped at 2 × 1 MB | warnings only |

The client IP is read from Cloudflare's `CF-Connecting-IP`, but only when the request comes from a private Docker address. It is used for in-memory per-IP limits only and is never logged.

Operations:

```bash
ssh stanley@192.168.1.100      # or, remotely: ssh -o ProxyCommand="cloudflared access ssh --hostname %h" stanley@ssh.stanleyowen.com
cd ~/server/chatapp
docker compose ps          # status / health
docker compose logs -f     # (intentionally almost empty)
docker compose restart relay
```

### 2. Client (Netlify)

`netlify.toml` builds `client/` with Node 26 and points it at `wss://chat-api.stanleyowen.com/ws`. In the Netlify dashboard, make sure **Base directory is empty**, so the root `netlify.toml` is used. Merge to `master` to deploy.

The build emits `dist/_headers` with a CSP that allows connections **only** to the relay origin, plus HSTS, `Referrer-Policy: no-referrer`, a locked-down `Permissions-Policy`, Trusted Types, and immutable caching for hashed assets.

## Security hardening summary

**Relay**
- strict Origin allow-list on the WebSocket handshake (CORS does not protect WebSockets)
- validates every frame against a strict schema; non-JSON or binary frames close the connection
- caps: 16 KB frames, 50 members per room, total rooms, connections in total and per IP, and per-socket token-bucket rate limits
- join timeout, ping/pong heartbeat, and backpressure, so slow readers get dropped instead of eating memory
- no compression (avoids zip bombs and CPU cost) and no persistence

**Client**
- CSP `default-src 'none'`, no inline scripts or styles, no `eval`, Trusted Types enforced
- all rendering goes through React text nodes, never HTML; bidi-override and control characters are stripped from names and messages
- display names are kept per-tab in `sessionStorage` only; nothing else is stored

**Supply chain**
- lockfiles plus `npm ci` everywhere; `--ignore-scripts` in the image; base images pinned by digest; Dependabot weekly (npm, Docker, Actions); `npm audit` and an image build in CI

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Found a bug or have an idea? [Open an issue](https://github.com/stanleyowen/chatapp/issues/new/choose).

## License

[MIT](LICENSE)
