import type { Context, Next } from 'hono';
import { verifyJwt, hashToken } from '../jwt.js';
import { getAppSessionByTokenHash, updateAppSessionActivity } from '../db/index.js';

declare module 'hono' {
  interface ContextVariableMap {
    appSessionId: string;
    appSessionUserId: string;
    appSessionOrigin: string;
  }
}

/**
 * Authenticates requests against an app_session token (not a user_session
 * token). Used for /proxy: each app has its own short-lived token, derived
 * from the user's login session via /connect, scoped to a single origin.
 *
 * The origin is captured at handshake time and stored on the app_session
 * row, so /proxy never has to trust the request body for routing decisions.
 */
export async function appAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } }, 401);
  }

  const token = header.slice(7);
  const payload = verifyJwt(token);
  if (!payload) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  const session = await getAppSessionByTokenHash(hashToken(token));
  if (!session || session.expiresAt < Date.now()) {
    return c.json({ error: { code: 'SESSION_EXPIRED', message: 'App session expired' } }, 401);
  }

  await updateAppSessionActivity(session.id);
  c.set('appSessionId', session.id);
  c.set('appSessionUserId', session.userId);
  c.set('appSessionOrigin', session.origin);

  await next();
}
