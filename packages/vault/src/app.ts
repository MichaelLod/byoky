import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './routes/auth.js';
import { credentials } from './routes/credentials.js';
import { proxy } from './routes/proxy.js';
import { connect } from './routes/connect.js';
import { groups } from './routes/groups.js';
import { gifts } from './routes/gifts.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { scrubProxyDetails } from './upstream-proxy.js';

const app = new Hono();

// Allow-list of extension IDs (comma-separated) we publish. Set via
// VAULT_ALLOWED_EXTENSION_IDS=abc...,def...  When unset (or in non-production
// builds) we fall back to permissive matching so local extension dev still
// works — that fallback is gated on NODE_ENV below.
const ALLOWED_EXTENSION_IDS = (process.env.VAULT_ALLOWED_EXTENSION_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const IS_PROD = process.env.NODE_ENV === 'production';

function originAllowed(origin: string): boolean {
  if (origin === 'https://byoky.com') return true;
  if (origin.endsWith('.byoky.com') && origin.startsWith('https://')) return true;

  // Localhost only outside production. In prod this would let any locally-
  // running service (or local-network malware) talk to the vault from a
  // user's authenticated session.
  if (!IS_PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }

  // Browser extensions: when an allow-list is configured, require the origin's
  // extension id to be on it. Without an allow-list (e.g. local dev or a
  // pre-publish build), permit any chrome/moz/safari-web extension origin.
  const extMatch = /^(chrome|moz|safari-web)-extension:\/\/([a-z0-9._-]+)\/?$/i.exec(origin);
  if (extMatch) {
    if (ALLOWED_EXTENSION_IDS.length === 0) return !IS_PROD;
    return ALLOWED_EXTENSION_IDS.includes(extMatch[2]);
  }

  return false;
}

app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    return originAllowed(origin) ? origin : undefined;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

app.use('/*', rateLimitMiddleware);

app.route('/auth', auth);
app.route('/credentials', credentials);
app.route('/proxy', proxy);
app.route('/connect', connect);
app.route('/groups', groups);
app.route('/gifts', gifts);

app.onError((err, c) => {
  // Scrub PROXY_URL credentials/host before logging. undici/node-fetch
  // errors regularly include the proxy URL in DNS/TLS failure messages,
  // which would otherwise leak the residential-proxy basic-auth pair.
  const message = err instanceof Error ? scrubProxyDetails(err.message) : String(err);
  const stack = err instanceof Error && err.stack ? scrubProxyDetails(err.stack) : undefined;
  console.error('Unhandled error:', message);
  if (stack) console.error(stack);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
});

app.notFound((c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
});

export { app };
