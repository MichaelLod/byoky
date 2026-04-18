import type { Context, Next } from 'hono';
import { verifyJwt, hashToken } from '../jwt.js';
import { getUserSessionByTokenHash, updateUserSessionActivity } from '../db/index.js';

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
  const payload = verifyJwt(token, 'user');
  if (!payload) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  const session = await getUserSessionByTokenHash(hashToken(token));
  if (!session || session.expiresAt < Date.now()) {
    return c.json({ error: { code: 'SESSION_EXPIRED', message: 'Session expired' } }, 401);
  }

  // Defense in depth: if the JWT's signed claims disagree with the row that
  // hash-mapped to it, refuse rather than trust either side alone. Mirrors
  // the check in app-auth.
  if (payload.sub !== session.userId || payload.sid !== session.id) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Token claims do not match session' } }, 401);
  }

  // Fire-and-forget: this is a write on every authenticated request and we
  // don't want a slow DB to block the response.
  void updateUserSessionActivity(session.id).catch((err) => {
    console.error('updateUserSessionActivity failed:', err instanceof Error ? err.message : 'unknown');
  });
  // Trust the row, not the JWT payload — the row was looked up by token-hash
  // and is the authoritative anchor.
  c.set('userId', session.userId);
  c.set('sessionId', session.id);

  await next();
}
