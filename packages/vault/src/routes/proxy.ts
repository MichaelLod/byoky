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
import { calculateCost } from '../billing/pricing.js';
import { deductBalance } from '../billing/ledger.js';
import { transferToConnectedAccount } from '../billing/stripe.js';
import { getDb } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { developerApps } from '../db/billing-schema.js';

/** Map of providerId → env var name for platform wholesale keys. */
const PLATFORM_KEY_ENV: Record<string, string> = {
  anthropic: 'PLATFORM_KEY_ANTHROPIC',
  openai: 'PLATFORM_KEY_OPENAI',
  gemini: 'PLATFORM_KEY_GOOGLE',
  mistral: 'PLATFORM_KEY_MISTRAL',
  cohere: 'PLATFORM_KEY_COHERE',
  xai: 'PLATFORM_KEY_XAI',
  deepseek: 'PLATFORM_KEY_DEEPSEEK',
  groq: 'PLATFORM_KEY_GROQ',
  together: 'PLATFORM_KEY_TOGETHER',
  fireworks: 'PLATFORM_KEY_FIREWORKS',
  perplexity: 'PLATFORM_KEY_PERPLEXITY',
  openrouter: 'PLATFORM_KEY_OPENROUTER',
};

function getPlatformKey(providerId: string): string | undefined {
  const envVar = PLATFORM_KEY_ENV[providerId];
  return envVar ? process.env[envVar] : undefined;
}

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
    appId?: string; // Developer app ID for attribution + discount
  }>();

  const { providerId, url, method, headers: reqHeaders, body: reqBody, appId } = body;

  if (!providerId || !url) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'providerId and url are required' } }, 400);
  }

  if (!validateProxyUrl(providerId, url)) {
    return c.json({ error: { code: 'INVALID_URL', message: 'URL does not match provider' } }, 403);
  }

  const model = parseModel(reqBody);

  // --- Resolve API key: BYOK first, then credit-mode ---

  let apiKey: string;
  let creditMode = false;

  const credential = await getCredentialByUserAndProvider(userId, providerId);

  if (credential) {
    // BYOK path — user has their own key
    const cryptoKey = getCachedKey(userId);
    if (!cryptoKey) {
      return c.json({ error: { code: 'SESSION_KEY_EXPIRED', message: 'Encryption key expired. Please log in again.' } }, 401);
    }
    try {
      apiKey = await decryptWithKey(credential.encryptedKey, cryptoKey);
    } catch {
      return c.json({ error: { code: 'DECRYPT_FAILED', message: 'Failed to decrypt credential' } }, 500);
    }
  } else {
    // Credit-mode path — use platform key, charge user balance
    const platformKey = getPlatformKey(providerId);
    if (!platformKey) {
      return c.json({ error: { code: 'NO_CREDENTIAL', message: `No credential or credit balance available for provider: ${providerId}` } }, 404);
    }
    apiKey = platformKey;
    creditMode = true;
  }

  const upstreamHeaders = buildHeaders(
    providerId,
    reqHeaders ?? {},
    apiKey,
    credential?.authMethod ?? 'api_key',
  );

  // --- Make upstream request ---

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

  if (credential) {
    await updateCredentialLastUsed(credential.id);
  }

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  const isStreaming = contentType.includes('text/event-stream');

  /**
   * Post-response billing: log request, deduct balance if credit-mode,
   * transfer commission to developer if applicable.
   */
  async function postResponseBilling(
    usage: { inputTokens: number; outputTokens: number } | undefined,
  ) {
    const requestLogId = await logRequest(
      userId, sessionId ?? '', providerId!, url!, method ?? 'POST',
      upstreamResponse.status,
      usage?.inputTokens, usage?.outputTokens, model,
    );

    if (creditMode && usage && upstreamResponse.status >= 200 && upstreamResponse.status < 300) {
      const cost = await calculateCost(providerId!, model, usage.inputTokens, usage.outputTokens, appId);
      if (cost && cost.netCents > 0) {
        try {
          await deductBalance(
            userId, cost, providerId!, model,
            usage.inputTokens, usage.outputTokens,
            appId, requestLogId,
          );

          // Transfer developer payout if applicable
          if (cost.developerPayoutCents > 0 && appId) {
            const [app] = await getDb()
              .select({ stripeConnectAccountId: developerApps.stripeConnectAccountId })
              .from(developerApps)
              .where(eq(developerApps.id, appId))
              .limit(1);

            if (app?.stripeConnectAccountId) {
              transferToConnectedAccount(
                app.stripeConnectAccountId,
                cost.developerPayoutCents,
                { appId: appId!, userId, providerId: providerId! },
              ).catch((err) => {
                console.error(`Developer payout failed for app ${appId}:`, err);
              });
            }
          }
        } catch (err) {
          console.error(`Balance deduction failed for user ${userId}:`, err);
          // Don't fail the response — post-deduct model accepts this risk
        }
      }
    }
  }

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
      await postResponseBilling(usage);
    });
  }

  // Non-streaming response
  const responseBody = await upstreamResponse.text();
  const usage = parseUsage(providerId, responseBody);
  await postResponseBilling(usage);

  return new Response(responseBody, {
    status: upstreamResponse.status,
    headers: { 'content-type': contentType || 'application/json' },
  });
});

export { proxy };
