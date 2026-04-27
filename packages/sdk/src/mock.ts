/**
 * Dev-only mock session: lets apps run their full code path without installing
 * the extension or running the bridge. Provider keys come from the caller —
 * either via the `keys` option or the `BYOKY_DEV_KEYS` env var.
 *
 * Format for the env var: `provider:key,provider:key,…`
 *   BYOKY_DEV_KEYS=anthropic:sk-ant-...,openai:sk-...
 *
 * The fetch returned by `createFetch` calls the provider's API directly with
 * the supplied key — no proxy, no extension, no bridge. Useful for local dev
 * and CI; meaningless in production (refuse to run when NODE_ENV=production).
 */

import { ByokyError, ByokyErrorCode } from '@byoky/core';
import type { ByokySession } from './byoky.js';
import { fetchModelsList } from './list-models-fetch.js';

export interface MockConnectOptions {
  /**
   * Map of provider ID → API key. If omitted, the SDK reads
   * `process.env.BYOKY_DEV_KEYS` (Node.js only).
   */
  keys?: Record<string, string>;
  /**
   * Per-provider base URL override for providers without a fixed upstream
   * (Azure OpenAI, Ollama, LM Studio). Replaces the host portion of the
   * outgoing URL before the request is made.
   */
  baseUrls?: Record<string, string>;
}

const PLACEHOLDER_HOSTS = [
  'localhost:11434',
  'localhost:1234',
  'YOUR_RESOURCE.openai.azure.com',
];

function parseDevKeysEnv(): Record<string, string> | null {
  if (typeof process === 'undefined' || !process.env || !process.env.BYOKY_DEV_KEYS) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const pair of process.env.BYOKY_DEV_KEYS.split(',')) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const id = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (id && value) out[id] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function maybeRewriteHost(url: string, baseUrl: string | undefined): string {
  if (!baseUrl) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  // Only rewrite if the URL points at one of the placeholder hosts. This
  // protects callers who pass an already-correct URL through createFetch.
  const isPlaceholder = PLACEHOLDER_HOSTS.some((p) => parsed.host === p || url.includes(p));
  if (!isPlaceholder) return url;
  let target: URL;
  try {
    target = new URL(baseUrl);
  } catch {
    return url;
  }
  parsed.protocol = target.protocol;
  parsed.host = target.host;
  return parsed.toString();
}

function makeMockFetch(
  providerId: string,
  key: string,
  baseUrl: string | undefined,
): typeof fetch {
  return async (input, init) => {
    let url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url;
    url = maybeRewriteHost(url, baseUrl);

    const headers = new Headers(init?.headers);

    if (providerId === 'anthropic') {
      headers.set('x-api-key', key);
      if (!headers.has('anthropic-version')) {
        headers.set('anthropic-version', '2023-06-01');
      }
    } else if (providerId === 'gemini') {
      // Gemini takes the key as a query param rather than a header.
      const u = new URL(url);
      u.searchParams.set('key', key);
      url = u.toString();
    } else {
      // Default to OpenAI-compatible Bearer auth — covers openai, mistral, xai,
      // deepseek, perplexity, groq, together, fireworks, openrouter,
      // azure_openai, cohere, ollama, lm_studio.
      headers.set('Authorization', `Bearer ${key}`);
    }

    return fetch(url, { ...init, headers });
  };
}

export function createMockSession(options: MockConnectOptions = {}): ByokySession {
  const isProd =
    typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production';
  if (isProd) {
    throw new ByokyError(
      ByokyErrorCode.UNKNOWN,
      'Byoky.connectMock() must not be used in production builds.',
    );
  }

  const keys = options.keys ?? parseDevKeysEnv();
  if (!keys || Object.keys(keys).length === 0) {
    throw new ByokyError(
      ByokyErrorCode.PROVIDER_UNAVAILABLE,
      'connectMock() requires API keys. Pass `keys: { anthropic: "sk-..." }` or set BYOKY_DEV_KEYS=anthropic:sk-...,openai:sk-...',
    );
  }

  const sessionKey = `mock-${
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;

  const providers: ByokySession['providers'] = {};
  for (const id of Object.keys(keys)) {
    providers[id] = { available: true, authMethod: 'api_key' };
  }

  const noop: () => () => void = () => () => {};

  const session: ByokySession = {
    sessionKey,
    proxyUrl: 'mock://',
    providers,
    createFetch: (providerId) => {
      const key = keys[providerId];
      if (!key) {
        throw new ByokyError(
          ByokyErrorCode.PROVIDER_UNAVAILABLE,
          `No mock key configured for "${providerId}". Add it to BYOKY_DEV_KEYS or the keys option.`,
        );
      }
      return makeMockFetch(providerId, key, options.baseUrls?.[providerId]);
    },
    listModels: (providerId) => fetchModelsList(session.createFetch(providerId), providerId),
    createRelay: () => {
      throw new ByokyError(
        ByokyErrorCode.UNKNOWN,
        'createRelay() is not supported in mock mode — relays go through a real wallet.',
      );
    },
    disconnect: () => {},
    isConnected: async () => true,
    getUsage: async () => ({ requests: 0, inputTokens: 0, outputTokens: 0, byProvider: {} }),
    onDisconnect: noop,
    onProvidersUpdated: noop,
  };
  return session;
}
