import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Security headers for Netlify (emitted as dist/_headers) and `vite preview`.
 * The CSP is generated at build time so connect-src can be pinned to the exact
 * WebSocket origin – no wildcards, no third parties.
 */
function securityHeaders(wsUrl: string): Plugin {
  const ws = new URL(wsUrl);
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "manifest-src 'self'",
    `connect-src 'self' ${ws.protocol}//${ws.host}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  const headers: Record<string, string> = {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy':
      'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=(), xr-spatial-tracking=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off',
  };

  const file = [
    '/*',
    ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`),
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/manifest.webmanifest',
    '  Content-Type: application/manifest+json',
    '',
  ].join('\n');

  return {
    name: 'security-headers',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: file });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [k, v] of Object.entries(headers)) {
          if (k !== 'Strict-Transport-Security') res.setHeader(k, v.replace('; upgrade-insecure-requests', ''));
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const wsUrl = env.VITE_WS_URL || 'ws://localhost:8787/ws';

  if (command === 'build' && mode === 'production' && !wsUrl.startsWith('wss://') && !process.env.ALLOW_INSECURE_WS) {
    throw new Error(
      `VITE_WS_URL must be a wss:// URL for production builds (got "${wsUrl}"). ` +
        'Set it in Netlify environment variables, or ALLOW_INSECURE_WS=1 for a local test build.',
    );
  }

  return {
    plugins: [react(), securityHeaders(wsUrl)],
    build: {
      target: 'es2022',
      sourcemap: false,
      modulePreload: { polyfill: false },
      assetsInlineLimit: 0,
    },
    server: {
      port: 5173,
      strictPort: true,
      // Allow importing the shared protocol module, nothing else outside client/.
      fs: { allow: ['.', '../shared'] },
    },
    preview: { port: 4173, strictPort: true },
  };
});
