import type { Context, Next } from 'hono';
import { verifyJwt, hashToken } from '../jwt.js';
import { getSessionByTokenHash, updateSessionActivity } from '../db/index.js';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    sessionId: string;
  }
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } }, 401);
  }

  const token = header.slice(7);
  const payload = verifyJwt(token);
  if (!payload) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  const session = await getSessionByTokenHash(hashToken(token));
  if (!session || session.expiresAt < Date.now()) {
    return c.json({ error: { code: 'SESSION_EXPIRED', message: 'Session expired' } }, 401);
  }

  await updateSessionActivity(session.id);
  c.set('userId', payload.sub);
  c.set('sessionId', payload.sid);

  await next();
}
