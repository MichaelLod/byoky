import { Hono, type Context, type Next } from 'hono';
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
  getProvider,
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
import { userRateLimitMiddleware } from '../middleware/rate-limit.js';

const proxy = new Hono();

proxy.use('/*', bodyLimitMiddleware);
proxy.use('/*', appAuthMiddleware);
// Per-user rate limit, mounted AFTER appAuth so it can key on the
// authenticated user id rather than the spoofable XFF header used by the
// global IP-keyed limiter.
proxy.use('/*', userRateLimitMiddleware);

// Methods an app session is allowed to issue against a provider API. LLM
// traffic is POST; a handful of provider endpoints (list models, GET a file)
// use GET. Anything else (DELETE/PATCH/PUT) could destroy user state on the
// upstream account and has no legitimate SDK use, so it is refused.
const ALLOWED_METHODS = new Set(['POST', 'GET']);

// Rolling-tail cap for the copy of the upstream stream we keep to run
// parseUsage() over. Usage frames always land near the end of the response
// (the providers all emit usage on the final/penultimate SSE frame), so a
// tail window is sufficient and caps per-request memory regardless of how
// chatty the upstream gets.
const USAGE_TAIL_BYTES = 256 * 1024;

// Hard ceiling on the JSON envelope a client may POST to /proxy. The envelope
// wraps an LLM request body — even very large multimodal payloads (image
// blocks, big tool result transcripts) fit comfortably inside this. Without
// the cap, a client can stream gigabytes into c.req.json() and OOM the vault.
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024; // 16 MB

// Hard ceiling on a non-streaming upstream response we will buffer in memory
// before returning to the client. Streaming responses bypass this (they're
// piped through). LLM JSON responses are a few MB at the very high end.
const MAX_NONSTREAM_RESPONSE_BYTES = 32 * 1024 * 1024; // 32 MB

/**
 * Reject requests whose Content-Length declares more than the cap. Bodies
 * without a Content-Length (chunked) are checked while reading. We do this
 * before c.req.json() to avoid buffering the whole body in memory first.
 */
async function bodyLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  const cl = c.req.header('content-length');
  if (cl) {
    const n = parseInt(cl, 10);
    if (!Number.isFinite(n) || n < 0) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid Content-Length' } }, 400);
    }
    if (n > MAX_REQUEST_BODY_BYTES) {
      return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 16 MB cap' } }, 413);
    }
  }
  await next();
}

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

  const effectiveMethod = (method ?? 'POST').toUpperCase();
  if (!ALLOWED_METHODS.has(effectiveMethod)) {
    return c.json({ error: { code: 'METHOD_NOT_ALLOWED', message: `Method ${effectiveMethod} not allowed` } }, 405);
  }

  // Pre-check: for providers with a fixed upstream host we can reject
  // bad URLs before touching the DB. For providers whose host is
  // per-credential (Azure OpenAI), we only enforce https here and re-run
  // validateProxyUrl after we've picked the credential — otherwise the
  // provider's placeholder baseUrl would reject every real tenant.
  const requestedProvider = getProvider(requestedProviderId);
  if (!requestedProvider) {
    return c.json({ error: { code: 'INVALID_URL', message: 'URL does not match provider' } }, 403);
  }
  if (requestedProvider.requiresCustomBaseUrl) {
    try {
      if (new URL(url).protocol !== 'https:') throw new Error('not https');
    } catch {
      return c.json({ error: { code: 'INVALID_URL', message: 'URL must be an https URL' } }, 403);
    }
  } else if (!validateProxyUrl(requestedProviderId, url)) {
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
    void logRequest({
      userId,
      appSessionId,
      appOrigin: origin,
      providerId: requestedProviderId,
      groupId: groupRow?.id,
      url,
      method: effectiveMethod,
      status: 404,
    }).catch(() => { /* logging failure shouldn't surface to caller */ });
    return c.json({ error: { code: 'NO_CREDENTIAL', message } }, 404);
  }

  // The credential row from the resolver is keyed back to the DB row by id.
  const dbCredential = credentialRows.find((r) => r.id === decision.credential.id)!;

  // Post-credential URL validation: if the credential's provider has a
  // per-tenant baseUrl (Azure OpenAI), the only safe host is the one on
  // the credential row. Run the full origin check now.
  if (requestedProvider.requiresCustomBaseUrl) {
    if (!dbCredential.baseUrl || !validateProxyUrl(requestedProviderId, url, dbCredential.baseUrl)) {
      return c.json({ error: { code: 'INVALID_URL', message: 'URL does not match credential baseUrl' } }, 403);
    }
  }

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
  } else if (decision.modelOverride && effectiveBody) {
    // Direct path, same provider, but the group pins a model. The group is
    // the strongest routing force — override the SDK's choice.
    effectiveBody = rewriteModelInJsonBody(effectiveBody, decision.modelOverride);
  }

  // Effective URL. Translation and swap both rewrite the URL because the
  // SDK constructed it against the source provider's base. Direct routing
  // forwards the SDK's URL unchanged.
  let effectiveUrl = url;
  if (isTranslating || isSwapping) {
    // If the destination provider has a per-tenant host (Azure), hand the
    // rewriter the credential's baseUrl — the registered placeholder
    // ("https://YOUR_RESOURCE…") is not a real host.
    const dstProvider = getProvider(upstreamProviderId);
    const dstOverride = dstProvider?.requiresCustomBaseUrl ? dbCredential.baseUrl ?? undefined : undefined;
    const rewritten = rewriteProxyUrl(
      upstreamProviderId,
      upstreamModel ?? '',
      detectStreamingRequest(effectiveBody),
      dstOverride,
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
      method: effectiveMethod,
      headers: upstreamHeaders,
      body: effectiveMethod === 'GET' ? undefined : effectiveBody,
      // Propagate client cancellation through to the upstream, so a client
      // disconnect stops token generation we'd otherwise keep paying for.
      signal: c.req.raw.signal,
    });
  } catch {
    // Fire-and-forget: don't make the error response wait on a DB write.
    void logRequest({
      userId,
      appSessionId,
      appOrigin: origin,
      providerId: requestedProviderId,
      actualProviderId: isTranslating || isSwapping ? upstreamProviderId : requestedProviderId,
      model: parseModel(reqBody),
      actualModel:
        isTranslating || isSwapping
          ? upstreamModel
          : decision.modelOverride,
      groupId: groupRow?.id,
      url,
      method: effectiveMethod,
      status: 502,
    }).catch(() => { /* logging failure shouldn't surface to caller */ });
    // Surface a generic message to the client — `err.message` can leak the
    // outbound residential proxy hostname/credentials in DNS/TLS errors.
    return c.json({ error: { code: 'UPSTREAM_ERROR', message: 'Upstream request failed' } }, 502);
  }

  // Fire-and-forget: a slow DB shouldn't add latency to every proxied call.
  void updateCredentialLastUsed(dbCredential.id).catch(() => { /* non-fatal */ });

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  // Strict media-type match (split off any "; charset=..." parameter) so a
  // crafted "application/text/event-stream-fake" doesn't sneak past as SSE.
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  const isStreaming = mediaType === 'text/event-stream';

  // ─── Streaming response ───────────────────────────────────────────────

  if (isStreaming && upstreamResponse.body) {
    c.header('content-type', contentType);
    // Defense in depth: a malicious upstream (or a compromised/typoed
    // provider) can return a content-type like text/html. nosniff stops the
    // browser from rendering proxy bodies as HTML.
    c.header('x-content-type-options', 'nosniff');
    c.status(clampStatus(upstreamResponse.status));

    const streamTranslator = translationContext
      ? createStreamTranslator(translationContext)
      : undefined;

    return stream(c, async (s) => {
      const reader = upstreamResponse.body!.getReader();
      const decoder = new TextDecoder();
      // Rolling tail: we only retain the last USAGE_TAIL_BYTES of the decoded
      // upstream for post-stream usage parsing. Full accumulation is a memory
      // DoS vector on long/abusive streams.
      let tail = '';
      const encoder = new TextEncoder();
      let streamError: unknown;

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
          tail += chunkText;
          if (tail.length > USAGE_TAIL_BYTES) {
            tail = tail.slice(tail.length - USAGE_TAIL_BYTES);
          }

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
      } catch (err) {
        streamError = err;
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
        // Usage parsing runs against the upstream (destination) bytes, since
        // that's what the upstream provider's tokenizer reported. The
        // dst-side parser is the one that knows the upstream's token-count
        // wire format. We log from finally so a mid-stream abort (client
        // disconnect, upstream reset) still produces an accounting row.
        const usage = parseUsage(upstreamProviderId, tail);
        await logRequest({
          userId,
          appSessionId,
          appOrigin: origin,
          providerId: requestedProviderId,
          actualProviderId: isTranslating || isSwapping ? upstreamProviderId : requestedProviderId,
          model: parseModel(reqBody),
          actualModel:
            isTranslating || isSwapping
              ? upstreamModel
              : decision.modelOverride,
          groupId: groupRow?.id,
          url,
          method: effectiveMethod,
          status: streamError ? 499 : upstreamResponse.status,
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
        });
      }
    });
  }

  // ─── Non-streaming response ───────────────────────────────────────────

  // Bounded read: stream the upstream body and abort if it exceeds
  // MAX_NONSTREAM_RESPONSE_BYTES, rather than letting upstreamResponse.text()
  // buffer an unbounded payload. A misbehaving (or compromised) upstream
  // could otherwise OOM the vault by sending a multi-GB response.
  let responseBody: string;
  try {
    responseBody = await readBoundedText(upstreamResponse, MAX_NONSTREAM_RESPONSE_BYTES);
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === 'RESPONSE_TOO_LARGE';
    return c.json(
      {
        error: {
          code: tooLarge ? 'UPSTREAM_RESPONSE_TOO_LARGE' : 'UPSTREAM_ERROR',
          message: tooLarge ? 'Upstream response exceeds size cap' : 'Upstream read failed',
        },
      },
      tooLarge ? 502 : 502,
    );
  }

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
    actualProviderId: isTranslating || isSwapping ? upstreamProviderId : requestedProviderId,
    model: parseModel(reqBody),
    actualModel:
      isTranslating || isSwapping
        ? upstreamModel
        : decision.modelOverride,
    groupId: groupRow?.id,
    url,
    method: effectiveMethod,
    status: upstreamResponse.status,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  });

  return new Response(outBody, {
    status: clampStatus(upstreamResponse.status),
    headers: {
      'content-type': contentType || 'application/json',
      'x-content-type-options': 'nosniff',
    },
  });
});

function clampStatus(status: number): StatusCode {
  const n = Number.isFinite(status) ? Math.floor(status) : 502;
  if (n < 200 || n > 599) return 502 as StatusCode;
  return n as StatusCode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const MAX_BODY_PARSE_SIZE = 10_485_760; // 10 MB — matches core/proxy-utils

function detectStreamingRequest(body: string | undefined): boolean {
  if (!body || body.length > MAX_BODY_PARSE_SIZE) return false;
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
  if (body.length > MAX_BODY_PARSE_SIZE) return body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    parsed.model = newModel;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

/**
 * Read a Response body as text, but bail out with `RESPONSE_TOO_LARGE` once
 * the cumulative byte count exceeds `maxBytes`. Streaming via getReader()
 * lets us stop reading (and abort the underlying upstream) the moment we
 * cross the threshold, instead of letting Response.text() buffer the whole
 * payload first.
 */
async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Cancel both directions so the upstream connection releases.
        try { await reader.cancel(); } catch { /* already done */ }
        throw new Error('RESPONSE_TOO_LARGE');
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  return out;
}

export { proxy };
