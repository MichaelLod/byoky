import { Hono } from 'hono';
import crypto from 'node:crypto';
import {
  getProvider,
  resolveRoute,
  type Credential as CoreCredential,
  type Group as CoreGroup,
  DEFAULT_GROUP_ID,
} from '@byoky/core';
import {
  getCredentialsByUser,
  resolveGroupForOrigin,
  createAppSession,
} from '../db/index.js';
import { signJwt, hashToken } from '../jwt.js';
import { authMiddleware } from '../middleware/auth.js';
import { userRateLimitMiddleware } from '../middleware/rate-limit.js';
import { normalizeOrigin } from '../origin.js';

const APP_SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const connect = new Hono();

connect.use('/*', authMiddleware);
connect.use('/*', userRateLimitMiddleware);

/**
 * Per-app handshake. Authenticates with a user_session token, returns an
 * app_session token scoped to a specific origin plus availability for the
 * providers the app requested.
 *
 * Origin source: the browser's CORS Origin header is authoritative when
 * present (the browser controls it; JS cannot forge it). Node SDK consumers
 * pass the body field. When both are present they MUST agree — otherwise
 * a script running on origin A could mint an app session keyed to origin
 * B and have the user's wallet UI mis-attribute usage.
 *
 * Availability for each requested provider is computed by running the
 * routing resolver against the user's credentials and the resolved group.
 * An app that asked for openai but is bound to a group routing to
 * anthropic shows openai:available iff the user has an anthropic
 * credential — i.e. the SDK sees the request will succeed.
 */
connect.post('/', async (c) => {
  const userId = c.get('userId');
  const userSessionId = c.get('sessionId');

  const body = await c.req.json<{
    appOrigin?: string;
    providers?: { id: string; required?: boolean }[];
  }>().catch(() => ({}) as { appOrigin?: string; providers?: { id: string; required?: boolean }[] });

  const headerOrigin = c.req.header('origin') ? normalizeOrigin(c.req.header('origin')!) : '';
  const bodyOrigin = body.appOrigin ? normalizeOrigin(body.appOrigin) : '';

  // If both are present they must agree. The browser-set Origin header is
  // load-bearing in the browser SDK path; allowing the body to win would
  // let a page-side script claim an arbitrary origin. Both go through
  // normalizeOrigin first so casing/trailing-slash variance doesn't reject
  // otherwise-matching origins.
  if (bodyOrigin && headerOrigin && bodyOrigin !== headerOrigin) {
    return c.json({
      error: {
        code: 'ORIGIN_MISMATCH',
        message: 'appOrigin body field does not match Origin request header',
      },
    }, 400);
  }

  const origin = headerOrigin || bodyOrigin || '';

  if (!origin) {
    return c.json({
      error: {
        code: 'MISSING_ORIGIN',
        message: 'appOrigin body field or Origin request header is required',
      },
    }, 400);
  }

  const userCredentials = await getCredentialsByUser(userId);

  // The credentials table stores raw rows; the resolver expects the core
  // Credential discriminated union. The resolver only reads providerId/id,
  // so the cast is safe — translating to the full union would force a
  // decryption the resolver doesn't need.
  const credForResolver: CoreCredential[] = userCredentials.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    label: row.label,
    authMethod: row.authMethod as 'api_key',
    encryptedKey: row.encryptedKey,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
  }));

  const groupRow = await resolveGroupForOrigin(userId, origin);

  // The default group is sentinel-empty (providerId === ''). Pass undefined
  // to the resolver in that case so it skips group logic and falls through
  // to direct credential lookup.
  const groupForResolver: CoreGroup | undefined =
    groupRow && groupRow.id !== DEFAULT_GROUP_ID && groupRow.providerId
      ? {
          id: groupRow.id,
          name: groupRow.name,
          providerId: groupRow.providerId,
          credentialId: groupRow.credentialId ?? undefined,
          model: groupRow.model ?? undefined,
          createdAt: groupRow.createdAt,
        }
      : undefined;

  const requestedProviders = body.providers ?? [];
  const providers: Record<string, { available: boolean; authMethod: string }> = {};

  for (const req of requestedProviders) {
    if (!getProvider(req.id)) continue;
    const decision = resolveRoute(req.id, groupForResolver, credForResolver);
    if (decision) {
      providers[req.id] = {
        available: true,
        authMethod: decision.credential.authMethod,
      };
    } else {
      providers[req.id] = { available: false, authMethod: 'api_key' };
    }
  }

  const appSessionId = crypto.randomUUID();
  const token = signJwt(userId, appSessionId, APP_SESSION_DURATION_MS, 'app');
  // browserBound = handshake carried a browser `Origin` header. Proxy
  // requests against this session will have to match Origin too — closes
  // the stolen-token-via-non-browser-client loophole in the middleware.
  const browserBound = !!headerOrigin;
  // Pass appSessionId so the DB row's id matches the JWT's `sid` claim.
  // appAuthMiddleware verifies they agree.
  await createAppSession(
    userId,
    userSessionId,
    origin,
    hashToken(token),
    Date.now() + APP_SESSION_DURATION_MS,
    appSessionId,
    browserBound,
  );

  return c.json({
    appSessionToken: token,
    appSessionId,
    origin,
    groupId: groupRow?.id ?? DEFAULT_GROUP_ID,
    providers,
  });
});

export { connect };
