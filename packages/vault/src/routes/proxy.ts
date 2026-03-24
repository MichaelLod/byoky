import { Hono } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { stream } from 'hono/streaming';
import { validateProxyUrl, buildHeaders, parseModel, parseUsage } from '@byoky/core';
import {
  getCredentialByUserAndProvider,
  updateCredentialLastUsed,
  logRequest,
} from '../db/index.js';
import { getCachedKey } from '../session-keys.js';
import { decryptWithKey } from '../crypto.js';
import { authMiddleware } from '../middleware/auth.js';

const proxy = new Hono();

proxy.use('/*', authMiddleware);

proxy.post('/', async (c) => {
  const userId = c.get('userId');
  const sessionId = c.get('sessionId');

  const body = await c.req.json<{
    providerId?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }>();

  const { providerId, url, method, headers: reqHeaders, body: reqBody } = body;

  if (!providerId || !url) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'providerId and url are required' } }, 400);
  }

  if (!validateProxyUrl(providerId, url)) {
    return c.json({ error: { code: 'INVALID_URL', message: 'URL does not match provider' } }, 403);
  }

  const credential = await getCredentialByUserAndProvider(userId, providerId);
  if (!credential) {
    return c.json({ error: { code: 'NO_CREDENTIAL', message: `No credential found for provider: ${providerId}` } }, 404);
  }

  const cryptoKey = getCachedKey(userId);
  if (!cryptoKey) {
    return c.json({ error: { code: 'SESSION_KEY_EXPIRED', message: 'Encryption key expired. Please log in again.' } }, 401);
  }

  let apiKey: string;
  try {
    apiKey = await decryptWithKey(credential.encryptedKey, cryptoKey);
  } catch {
    return c.json({ error: { code: 'DECRYPT_FAILED', message: 'Failed to decrypt credential' } }, 500);
  }

  const upstreamHeaders = buildHeaders(
    providerId,
    reqHeaders ?? {},
    apiKey,
    credential.authMethod,
  );

  const model = parseModel(reqBody);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(url, {
      method: method ?? 'POST',
      headers: upstreamHeaders,
      body: reqBody,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream request failed';
    await logRequest(userId, sessionId, providerId, url, method ?? 'POST', 502, undefined, undefined, model);
    return c.json({ error: { code: 'UPSTREAM_ERROR', message } }, 502);
  }

  await updateCredentialLastUsed(credential.id);

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  const isStreaming = contentType.includes('text/event-stream');

  if (isStreaming && upstreamResponse.body) {
    c.header('content-type', contentType);
    c.status(upstreamResponse.status as StatusCode);

    return stream(c, async (s) => {
      const reader = upstreamResponse.body!.getReader();
      const decoder = new TextDecoder();
      let collected = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          collected += text;
          await s.write(value);
        }
      } finally {
        reader.releaseLock();
      }

      const usage = parseUsage(providerId, collected);
      await logRequest(
        userId, sessionId, providerId, url, method ?? 'POST',
        upstreamResponse.status,
        usage?.inputTokens, usage?.outputTokens, model,
      );
    });
  }

  // Non-streaming response
  const responseBody = await upstreamResponse.text();
  const usage = parseUsage(providerId, responseBody);
  await logRequest(
    userId, sessionId, providerId, url, method ?? 'POST',
    upstreamResponse.status,
    usage?.inputTokens, usage?.outputTokens, model,
  );

  return new Response(responseBody, {
    status: upstreamResponse.status,
    headers: { 'content-type': contentType || 'application/json' },
  });
});

export { proxy };
