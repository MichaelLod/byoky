import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './routes/auth.js';
import { credentials } from './routes/credentials.js';
import { proxy } from './routes/proxy.js';
import { connect } from './routes/connect.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';

const app = new Hono();

app.use('/*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

app.use('/*', rateLimitMiddleware);

app.route('/auth', auth);
app.route('/credentials', credentials);
app.route('/proxy', proxy);
app.route('/connect', connect);

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
});

app.notFound((c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
});

export { app };
