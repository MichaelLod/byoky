import { Hono } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { stream } from 'hono/streaming';
import crypto from 'node:crypto';
import { upstreamFetch } from '../upstream-proxy.js';
import {
  validateProxyUrl,
  buildHeaders,
  parseModel,
  parseUsage,
  resolveRoute,
  buildNoCredentialMessage,
  rewriteProxyUrl,
  familyOf,
  translateRequest,
  translateResponse,
  createStreamTranslator,
  TranslationError,
  DEFAULT_GROUP_ID,
  type Credential as CoreCredential,
  type Group as CoreGroup,
  type ProviderId,
  type ModelFamily,
  type TranslationContext,
} from '@byoky/core';
import {
  getCredentialsByUser,
  resolveGroupForOrigin,
  updateCredentialLastUsed,
  logRequest,
} from '../db/index.js';
import { getCachedKey, recoverCachedKey } from '../session-keys.js';
import { decryptWithKey } from '../crypto.js';
import { appAuthMiddleware } from '../middleware/app-auth.js';

const proxy = new Hono();

proxy.use('/*', appAuthMiddleware);

proxy.post('/', async (c) => {
  const userId = c.get('appSessionUserId');
  const appSessionId = c.get('appSessionId');
  const origin = c.get('appSessionOrigin');

  const body = await c.req.json<{
    providerId?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }>();

  const { providerId: requestedProviderId, url, method, headers: reqHeaders, body: reqBody } = body;

  if (!requestedProviderId || !url) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'providerId and url are required' } }, 400);
  }

  if (!validateProxyUrl(requestedProviderId, url)) {
    return c.json({ error: { code: 'INVALID_URL', message: 'URL does not match provider' } }, 403);
  }

  // ─── Routing resolution ────────────────────────────────────────────────

  const credentialRows = await getCredentialsByUser(userId);
  const credForResolver: CoreCredential[] = credentialRows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    label: row.label,
    authMethod: row.authMethod as 'api_key',
    encryptedKey: row.encryptedKey,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
  }));

  const groupRow = await resolveGroupForOrigin(userId, origin);
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

  const decision = resolveRoute(requestedProviderId, groupForResolver, credForResolver);

  if (!decision) {
    const userProviderIds = Array.from(new Set(credentialRows.map((r) => r.providerId)));
    const message = buildNoCredentialMessage(
      requestedProviderId as ProviderId,
      userProviderIds as ProviderId[],
      groupForResolver,
    );
    await logRequest({
      userId,
      appSessionId,
      appOrigin: origin,
      providerId: requestedProviderId,
      groupId: groupRow?.id,
      url,
      method: method ?? 'POST',
      status: 404,
    });
    return c.json({ error: { code: 'NO_CREDENTIAL', message } }, 404);
  }

  // The credential row from the resolver is keyed back to the DB row by id.
  const dbCredential = credentialRows.find((r) => r.id === decision.credential.id)!;

  const cryptoKey = getCachedKey(userId) ?? await recoverCachedKey(userId);
  if (!cryptoKey) {
    return c.json({ error: { code: 'SESSION_KEY_EXPIRED', message: 'Encryption key expired. Please log in again.' } }, 401);
  }

  let apiKey: string;
  try {
    apiKey = await decryptWithKey(dbCredential.encryptedKey, cryptoKey);
  } catch {
    return c.json({ error: { code: 'DECRYPT_FAILED', message: 'Failed to decrypt credential' } }, 500);
  }

  // ─── Per-route URL/body/header rewriting ───────────────────────────────

  // Decide the upstream provider id (translation/swap target, or the
  // requested provider if neither). All three branches eventually fall into
  // the same fetch+log+stream path; the differences are: which URL we hit,
  // which model goes into the body, whether we run the translation
  // pipeline, and which provider id we use to build auth headers.
  const isTranslating = !!decision.translation;
  const isSwapping = !!decision.swap;
  const upstreamProviderId =
    decision.translation?.dstProviderId ?? decision.swap?.dstProviderId ?? requestedProviderId;
  const upstreamModel =
    decision.translation?.dstModel ?? decision.swap?.dstModel ?? parseModel(reqBody);

  // Effective request body: substituted (swap) or translated (cross-family).
  let effectiveBody = reqBody;
  let translationContext: TranslationContext | undefined;
  const requestId = crypto.randomUUID();

  if (isTranslating && decision.translation) {
    const srcFamily = familyOf(requestedProviderId as ProviderId);
    const dstFamily = familyOf(decision.translation.dstProviderId);
    if (!srcFamily || !dstFamily) {
      return c.json({ error: { code: 'TRANSLATION_FAILED', message: 'Cannot resolve translation families' } }, 502);
    }
    translationContext = {
      srcFamily: srcFamily as ModelFamily,
      dstFamily: dstFamily as ModelFamily,
      srcModel: parseModel(reqBody),
      dstModel: decision.translation.dstModel,
      isStreaming: detectStreamingRequest(reqBody),
      requestId,
    };
    if (effectiveBody) {
      try {
        effectiveBody = translateRequest(translationContext, effectiveBody);
      } catch (err) {
        const code = err instanceof TranslationError ? err.code : 'TRANSLATION_FAILED';
        const message = err instanceof Error ? err.message : 'Translation failed';
        return c.json({ error: { code, message } }, 502);
      }
    }
  } else if (isSwapping && decision.swap?.dstModel && effectiveBody) {
    effectiveBody = rewriteModelInJsonBody(effectiveBody, decision.swap.dstModel);
  }

  // Effective URL. Translation and swap both rewrite the URL because the
  // SDK constructed it against the source provider's base. Direct routing
  // forwards the SDK's URL unchanged.
  let effectiveUrl = url;
  if (isTranslating || isSwapping) {
    const rewritten = rewriteProxyUrl(
      upstreamProviderId,
      upstreamModel ?? '',
      detectStreamingRequest(effectiveBody),
    );
    if (!rewritten) {
      return c.json(
        { error: { code: 'TRANSLATION_FAILED', message: `Cannot rewrite URL for ${upstreamProviderId}` } },
        502,
      );
    }
    effectiveUrl = rewritten;
  }

  const upstreamHeaders = buildHeaders(
    upstreamProviderId,
    reqHeaders ?? {},
    apiKey,
    dbCredential.authMethod,
  );

  // ─── Upstream fetch ────────────────────────────────────────────────────

  let upstreamResponse: Response;
  try {
    upstreamResponse = await upstreamFetch(effectiveUrl, {
      method: method ?? 'POST',
      headers: upstreamHeaders,
      body: effectiveBody,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream request failed';
    await logRequest({
      userId,
      appSessionId,
      appOrigin: origin,
      providerId: requestedProviderId,
      actualProviderId: isTranslating || isSwapping ? upstreamProviderId : undefined,
      model: parseModel(reqBody),
      actualModel: isTranslating || isSwapping ? upstreamModel : undefined,
      groupId: groupRow?.id,
      url,
      method: method ?? 'POST',
      status: 502,
    });
    return c.json({ error: { code: 'UPSTREAM_ERROR', message } }, 502);
  }

  await updateCredentialLastUsed(dbCredential.id);

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  const isStreaming = contentType.includes('text/event-stream');

  // ─── Streaming response ───────────────────────────────────────────────

  if (isStreaming && upstreamResponse.body) {
    c.header('content-type', contentType);
    c.status(upstreamResponse.status as StatusCode);

    const streamTranslator = translationContext
      ? createStreamTranslator(translationContext)
      : undefined;

    return stream(c, async (s) => {
      const reader = upstreamResponse.body!.getReader();
      const decoder = new TextDecoder();
      let collected = '';
      const encoder = new TextEncoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Always decode for usage parsing + (optionally) stream translation.
          // The decoder buffers across reads, so SSE frames split mid-byte
          // by chunk boundaries are reassembled correctly. Crucially we do
          // NOT split on lines first — splitting collapses blank-line frame
          // separators (the iOS gotcha that landed in commit 4d240f4).
          const chunkText = decoder.decode(value, { stream: true });
          collected += chunkText;

          if (streamTranslator) {
            const translated = streamTranslator.process(chunkText);
            if (translated.length > 0) {
              await s.write(encoder.encode(translated));
            }
          } else {
            await s.write(value);
          }
        }
        if (streamTranslator) {
          const trailing = streamTranslator.flush();
          if (trailing.length > 0) {
            await s.write(encoder.encode(trailing));
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Usage parsing runs against the upstream (destination) bytes, since
      // that's what the upstream provider's tokenizer reported. The
      // dst-side parser is the one that knows the upstream's token-count
      // wire format.
      const usage = parseUsage(upstreamProviderId, collected);
      await logRequest({
        userId,
        appSessionId,
        appOrigin: origin,
        providerId: requestedProviderId,
        actualProviderId: isTranslating || isSwapping ? upstreamProviderId : undefined,
        model: parseModel(reqBody),
        actualModel: isTranslating || isSwapping ? upstreamModel : undefined,
        groupId: groupRow?.id,
        url,
        method: method ?? 'POST',
        status: upstreamResponse.status,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      });
    });
  }

  // ─── Non-streaming response ───────────────────────────────────────────

  const responseBody = await upstreamResponse.text();

  // Translation: parse upstream response, re-emit as source dialect.
  let outBody = responseBody;
  if (translationContext) {
    try {
      outBody = translateResponse(translationContext, responseBody);
    } catch (err) {
      const code = err instanceof TranslationError ? err.code : 'TRANSLATION_FAILED';
      const message = err instanceof Error ? err.message : 'Translation failed';
      return c.json({ error: { code, message } }, 502);
    }
  }

  const usage = parseUsage(upstreamProviderId, responseBody);
  await logRequest({
    userId,
    appSessionId,
    appOrigin: origin,
    providerId: requestedProviderId,
    actualProviderId: isTranslating || isSwapping ? upstreamProviderId : undefined,
    model: parseModel(reqBody),
    actualModel: isTranslating || isSwapping ? upstreamModel : undefined,
    groupId: groupRow?.id,
    url,
    method: method ?? 'POST',
    status: upstreamResponse.status,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  });

  return new Response(outBody, {
    status: upstreamResponse.status,
    headers: { 'content-type': contentType || 'application/json' },
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function detectStreamingRequest(body: string | undefined): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as { stream?: boolean };
    return parsed.stream === true;
  } catch {
    return false;
  }
}

/**
 * Surgically rewrite the top-level `model` field of a JSON request body to
 * `newModel`. Returns the original body unchanged if parsing fails — we'd
 * rather pass through and let the destination return a real error than
 * silently corrupt the request. Used by the same-family swap path when the
 * group pins a destination model.
 */
function rewriteModelInJsonBody(body: string, newModel: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    parsed.model = newModel;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export { proxy };
