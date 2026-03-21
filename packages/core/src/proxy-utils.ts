import type { RequestLogEntry, TokenAllowance } from './types.js';
import { PROVIDERS } from './providers.js';

/**
 * Validate that a proxy request URL targets the registered provider's base URL.
 * Prevents API key exfiltration by rejecting requests to arbitrary domains.
 */
export function validateProxyUrl(providerId: string, url: string): boolean {
  const provider = PROVIDERS[providerId];
  if (!provider) return false;
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:') return false;
    const base = new URL(provider.baseUrl);
    return target.origin === base.origin;
  } catch {
    return false;
  }
}

/**
 * Build the real auth headers for a provider API request.
 * Strips any fake session-key headers and injects the real API key.
 */
export function buildHeaders(
  providerId: string,
  requestHeaders: Record<string, string>,
  apiKey: string,
  authMethod: string = 'api_key',
): Record<string, string> {
  // Normalize header keys to lowercase to prevent case-sensitive bypass
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    headers[key.toLowerCase()] = value;
  }

  // Remove any auth headers the SDK might have set (they're fake session keys)
  delete headers['authorization'];
  delete headers['x-api-key'];
  delete headers['api-key'];

  // Strip browser/SDK headers that can trigger rejection from provider APIs
  delete headers['origin'];
  delete headers['referer'];
  // Remove SDK telemetry headers that leak the real client environment
  for (const key of Object.keys(headers)) {
    if (key.startsWith('x-stainless-')) delete headers[key];
  }
  delete headers['sec-fetch-mode'];
  delete headers['accept-language'];
  delete headers['accept-encoding'];
  // Always strip content-length — fetch() recalculates it from the actual body,
  // and the body may have been modified (e.g. system prompt injection)
  delete headers['content-length'];

  if (providerId === 'anthropic') {
    if (authMethod === 'oauth') {
      headers['authorization'] = `Bearer ${apiKey}`;
      headers['user-agent'] = 'claude-cli/2.1.76';
      headers['x-app'] = 'cli';
      headers['accept'] = 'application/json';
      headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      headers['x-api-key'] = apiKey;
    }
    headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
  } else if (providerId === 'azure_openai') {
    headers['api-key'] = apiKey;
  } else {
    headers['authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * Parse the model name from a request body (JSON).
 */
export function parseModel(body?: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    return parsed.model ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse token usage from a provider API response body.
 * Handles both regular JSON responses and SSE streaming responses.
 */
export function parseUsage(
  providerId: string,
  body: string,
): { inputTokens: number; outputTokens: number } | undefined {
  try {
    // For streaming responses (SSE), try to find usage in the last data chunk
    if (body.includes('data: ')) {
      const lines = body.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
      // Anthropic streaming: message_stop event has usage in a preceding message_delta
      // OpenAI streaming: last chunk may include usage
      for (let i = lines.length - 1; i >= 0; i--) {
        const json = lines[i].replace('data: ', '');
        try {
          const parsed = JSON.parse(json);
          const usage = extractUsageFromParsed(providerId, parsed);
          if (usage) return usage;
        } catch {
          continue;
        }
      }
      return undefined;
    }

    const parsed = JSON.parse(body);
    return extractUsageFromParsed(providerId, parsed);
  } catch {
    return undefined;
  }
}

/**
 * Extract token usage from a parsed provider response object.
 */
export function extractUsageFromParsed(
  providerId: string,
  parsed: Record<string, unknown>,
): { inputTokens: number; outputTokens: number } | undefined {
  // Anthropic: { usage: { input_tokens, output_tokens } }
  if (providerId === 'anthropic') {
    const usage = parsed.usage as Record<string, number> | undefined;
    if (usage?.input_tokens != null && usage?.output_tokens != null) {
      return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
    }
  }

  // Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
  if (providerId === 'gemini') {
    const meta = parsed.usageMetadata as Record<string, number> | undefined;
    if (meta?.promptTokenCount != null) {
      return {
        inputTokens: meta.promptTokenCount,
        outputTokens: meta.candidatesTokenCount ?? 0,
      };
    }
  }

  // OpenAI-compatible (openai, groq, together, deepseek, xai, perplexity, fireworks, openrouter, mistral, azure_openai):
  // { usage: { prompt_tokens, completion_tokens } }
  const usage = parsed.usage as Record<string, number> | undefined;
  if (usage?.prompt_tokens != null && usage?.completion_tokens != null) {
    return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
  }

  return undefined;
}

/**
 * Check whether a request is allowed given token allowances and usage history.
 * Pure computation — no storage access.
 */
export function computeAllowanceCheck(
  allowance: TokenAllowance | undefined,
  entries: Pick<RequestLogEntry, 'providerId' | 'inputTokens' | 'outputTokens'>[],
  providerId: string,
): { allowed: boolean; reason?: string } {
  if (!allowance) return { allowed: true };

  let totalUsed = 0;
  const byProvider: Record<string, number> = {};
  for (const entry of entries) {
    const tokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
    totalUsed += tokens;
    byProvider[entry.providerId] = (byProvider[entry.providerId] ?? 0) + tokens;
  }

  if (allowance.totalLimit != null && totalUsed >= allowance.totalLimit) {
    return { allowed: false, reason: `Token allowance exceeded for ${allowance.origin}` };
  }

  const providerLimit = allowance.providerLimits?.[providerId];
  if (providerLimit != null && (byProvider[providerId] ?? 0) >= providerLimit) {
    return { allowed: false, reason: `Token allowance for ${providerId} exceeded` };
  }

  return { allowed: true };
}
