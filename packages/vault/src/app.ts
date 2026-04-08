import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './routes/auth.js';
import { credentials } from './routes/credentials.js';
import { proxy } from './routes/proxy.js';
import { connect } from './routes/connect.js';
import { gifts } from './routes/gifts.js';
import { billing } from './routes/billing.js';
import { developer } from './routes/developer.js';
import { groupsRouter } from './routes/groups.js';
import { marketplace } from './routes/marketplace.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';

const app = new Hono();

app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    if (origin === 'https://byoky.com') return origin;
    if (origin.endsWith('.byoky.com') && origin.startsWith('https://')) return origin;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    if (/^(chrome|moz|safari-web)-extension:\/\//.test(origin)) return origin;
    return undefined;
  },
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

app.use('/*', rateLimitMiddleware);

app.route('/auth', auth);
app.route('/credentials', credentials);
app.route('/proxy', proxy);
app.route('/connect', connect);
app.route('/gifts', gifts);
app.route('/billing', billing);
app.route('/developer', developer);
app.route('/groups', groupsRouter);
app.route('/marketplace', marketplace);

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
});

app.notFound((c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
});

export { app };
