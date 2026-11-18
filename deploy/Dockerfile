# syntax=docker/dockerfile:1
# Quietroom relay – minimal, non-root, read-only image.
# Build context: repo root (or the deploy dir on the server, same layout).

ARG NODE_IMAGE=node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

# ---- deps: install exactly what the lockfile says, never run install scripts
FROM ${NODE_IMAGE} AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

# ---- runtime
FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="quietroom-relay" \
      org.opencontainers.image.source="https://github.com/stanleyowen/quietroom"
ENV NODE_ENV=production
# Patch OS packages, then remove package managers the app never needs at runtime.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && addgroup -S -g 10001 relay && adduser -S -D -H -u 10001 -G relay -s /sbin/nologin relay

WORKDIR /app
# Code is owned by root and only readable by the runtime user.
COPY --chown=root:root --chmod=a=rX shared ./shared
COPY --chown=root:root --chmod=a=rX server/package.json ./server/
COPY --chown=root:root --chmod=a=rX server/src ./server/src
COPY --from=deps --chown=root:root --chmod=a=rX /app/server/node_modules ./server/node_modules

USER 10001:10001
WORKDIR /app/server
EXPOSE 8787
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "--disable-proto=delete", "--disable-warning=ExperimentalWarning", "--max-old-space-size=192", "src/index.ts"]
