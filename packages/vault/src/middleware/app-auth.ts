import type { Context, Next } from 'hono';
import { verifyJwt, hashToken } from '../jwt.js';
import { getAppSessionByTokenHash, updateAppSessionActivity } from '../db/index.js';
import { normalizeOrigin } from '../origin.js';

declare module 'hono' {
  interface ContextVariableMap {
    appSessionId: string;
    appSessionUserId: string;
    appSessionOrigin: string;
    appSessionBrowserBound: boolean;
  }
}

/**
 * Authenticates requests against an app_session token (not a user_session
 * token). Used for /proxy: each app has its own short-lived token, derived
 * from the user's login session via /connect, scoped to a single origin.
 *
 * The origin is captured at handshake time and stored on the app_session
 * row, so /proxy never has to trust the request body for routing decisions.
 *
 * Four independent checks gate every request:
 *   1. JWT signature verifies under our secret
 *   2. The token's hash matches a non-expired app_session row
 *   3. The JWT's embedded claims (sub, sid) agree with that row — defense
 *      in depth so a future hash-collision or DB-shortcut bug can't smuggle
 *      a token from a different user/session
 *   4. If the request carried an Origin header (browser SDKs always do
 *      under CORS), it must match the origin captured at handshake time.
 *      This blocks the obvious replay where an XSS-stolen token gets
 *      replayed from another page in the same browser. Node SDKs don't set
 *      Origin and fall through to the stored value.
 */
export async function appAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } }, 401);
  }

  const token = header.slice(7);
  const payload = verifyJwt(token, 'app');
  if (!payload) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  const session = await getAppSessionByTokenHash(hashToken(token));
  if (!session || session.expiresAt < Date.now()) {
    return c.json({ error: { code: 'SESSION_EXPIRED', message: 'App session expired' } }, 401);
  }

  // Even though the hash lookup binds the token to this row, re-check that
  // the JWT's signed claims agree. A mismatch implies the signed payload
  // and the row identity disagree — refuse rather than trust either alone.
  if (payload.sub !== session.userId || payload.sid !== session.id) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Token claims do not match session' } }, 401);
  }

  // Origin binding. Two paths:
  //  - browserBound sessions (handshake carried a browser Origin): the
  //    browser forces Origin on every CORS request and JS cannot forge it,
  //    so a stolen token replayed from curl/Node (no Origin) or from a
  //    different origin in the same browser MUST be rejected. This is the
  //    load-bearing XSS-theft mitigation.
  //  - non-browserBound sessions (Node SDKs that handshaked with `appOrigin`
  //    body field): Origin is not expected. If the caller happens to send
  //    one anyway, it must still match. We cannot demand Origin here
  //    without breaking Node SDKs.
  //
  // Both sides go through normalizeOrigin so casing/trailing-slash variance
  // doesn't reject legitimate clients. The session.origin was already
  // normalized at handshake time, but defensive normalization here costs
  // nothing and survives migrations of older rows.
  const requestOrigin = c.req.header('origin');
  const browserBound = session.browserBound === true;
  if (browserBound && !requestOrigin) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Origin header required for this session' } }, 401);
  }
  if (requestOrigin && normalizeOrigin(requestOrigin) !== normalizeOrigin(session.origin)) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Origin does not match session' } }, 401);
  }

  // Fire-and-forget: this is a write on every proxied request and we don't
  // want a slow DB to add latency. A failed activity bump just means the
  // last-active timestamp lags slightly; it doesn't gate anything.
  void updateAppSessionActivity(session.id).catch((err) => {
    console.error('updateAppSessionActivity failed:', err instanceof Error ? err.message : 'unknown');
  });
  c.set('appSessionId', session.id);
  c.set('appSessionUserId', session.userId);
  c.set('appSessionOrigin', session.origin);
  c.set('appSessionBrowserBound', browserBound);

  await next();
}
