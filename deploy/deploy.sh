#!/usr/bin/env bash
# Deploy the relay to the Ubuntu server as Docker containers.
#
#   ./deploy/deploy.sh                                # default: stanley@192.168.1.100 (LAN)
#   ./deploy/deploy.sh stanley@ssh.stanleyowen.com    # remotely, via Cloudflare Access
#
# SSH goes through `cloudflared access ssh` automatically for ssh.stanleyowen.com
# (or force it with USE_CLOUDFLARED=1 / disable with USE_CLOUDFLARED=0).
# The server needs: docker + compose plugin, rsync, and ~/server/chatapp/.env
# (see deploy/.env.example). Nothing here needs sudo.
set -euo pipefail

TARGET="${1:-stanley@192.168.1.100}"
APP_DIR="${APP_DIR:-server/chatapp}" # relative to the remote home directory
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SSH=(ssh -o ServerAliveInterval=30)
RSYNC_RSH="ssh -o ServerAliveInterval=30"
USE_CLOUDFLARED="${USE_CLOUDFLARED:-auto}"
if [[ "$USE_CLOUDFLARED" == auto ]]; then
  [[ "$TARGET" == *ssh.stanleyowen.com ]] && USE_CLOUDFLARED=1 || USE_CLOUDFLARED=0
fi
if [[ "$USE_CLOUDFLARED" == 1 ]]; then
  SSH+=(-o "ProxyCommand=cloudflared access ssh --hostname %h")
  RSYNC_RSH+=" -o 'ProxyCommand=cloudflared access ssh --hostname %h'"
fi

if [[ "${SKIP_CHECKS:-0}" != 1 ]]; then
  echo "==> Typecheck + tests"
  (cd "$ROOT/server" && npm ci --no-audit --no-fund --silent && npm run typecheck && npm test --silent)
fi

echo "==> Staging build context"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/server"
cp "$ROOT/server/package.json" "$ROOT/server/package-lock.json" "$STAGE/server/"
cp -R "$ROOT/server/src" "$STAGE/server/src"
cp -R "$ROOT/shared" "$STAGE/shared"
cp "$ROOT/.dockerignore" "$ROOT/deploy/Dockerfile" "$ROOT/deploy/docker-compose.yml" "$ROOT/deploy/.env.example" "$STAGE/"

echo "==> Uploading to $TARGET:~/$APP_DIR"
"${SSH[@]}" "$TARGET" "mkdir -p ~/$APP_DIR && chmod 700 ~/$APP_DIR"
# --delete keeps the remote tree identical to the stage; .env is excluded so it is never touched.
chmod -R u=rwX,go=rX "$STAGE" # portable: macOS openrsync lacks --chmod
chmod 700 "$STAGE"               # app dir itself stays private (it holds .env)
rsync -rlpt --delete --exclude .env -e "$RSYNC_RSH" "$STAGE/" "$TARGET:$APP_DIR/"

echo "==> Building and starting containers"
"${SSH[@]}" "$TARGET" APP_DIR="$APP_DIR" bash -s <<'REMOTE'
set -euo pipefail
cd ~/"$APP_DIR"
if [[ ! -f .env ]]; then
  echo "Missing ~/$APP_DIR/.env – copy .env.example, fill it in, chmod 600." >&2
  exit 1
fi
chmod 600 .env
docker compose build --pull --quiet
docker compose up -d --remove-orphans --wait --wait-timeout 90
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
docker image prune -f --filter label=org.opencontainers.image.title=chatapp-relay >/dev/null
REMOTE

echo "==> Public health check"
for i in $(seq 1 20); do
  if [[ "$(curl -fsS --max-time 5 https://chat-api.stanleyowen.com/healthz 2>/dev/null)" == ok ]]; then
    echo "https://chat-api.stanleyowen.com is live"
    exit 0
  fi
  sleep 3
done
echo "Public health check failed (DNS/tunnel may still be propagating)." >&2
exit 1
