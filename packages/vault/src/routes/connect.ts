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

const APP_SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const connect = new Hono();

connect.use('/*', authMiddleware);

/**
 * Per-app handshake. Authenticates with a user_session token, returns an
 * app_session token scoped to a specific origin plus availability for the
 * providers the app requested.
 *
 * Origin source: prefer the body field for precision, fall back to the
 * browser's CORS Origin header. Node SDK consumers must pass the body
 * field; browser SDK consumers get the header for free.
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

  const headerOrigin = c.req.header('origin');
  const origin = (body.appOrigin || headerOrigin || '').trim();

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
  const token = signJwt(userId, appSessionId, APP_SESSION_DURATION_MS);
  await createAppSession(
    userId,
    userSessionId,
    origin,
    hashToken(token),
    Date.now() + APP_SESSION_DURATION_MS,
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
