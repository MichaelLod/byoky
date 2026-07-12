/**
 * Byoky enterprise gateway client.
 *
 * The simplest way to use Byoky is a base-URL swap: point any OpenAI-compatible
 * client at `…/v1` and use a `byk_` key. This helper adds the one thing a raw
 * swap can't: **client-side fail-open**. If the Byoky gateway is unreachable
 * (network error or a 503 GATEWAY_DEGRADED), the request transparently retries
 * against the provider directly using the app's own provider key — so AI keeps
 * working even during a gateway outage. Byoky becomes a reliability *upgrade*,
 * never a new single point of failure.
 *
 *   const byoky = new ByokyGateway({
 *     key: 'byk_live_…',
 *     baseUrl: 'https://gateway.byoky.com/v1',
 *     failOpen: { apiKey: process.env.OPENAI_API_KEY, baseUrl: 'https://api.openai.com/v1' },
 *   });
 *   const openai = new OpenAI({ apiKey: 'byk_live_…', baseURL: byoky.baseUrl, fetch: byoky.fetch });
 */

export interface FailOpenConfig {
  /** The app's real provider key, used ONLY when the gateway is unreachable. */
  apiKey: string;
  /** Provider base URL to fall back to, e.g. https://api.openai.com/v1 */
  baseUrl: string;
}

export interface GatewayOptions {
  /** Byoky key (byk_live_…). */
  key: string;
  /** Gateway base URL. Default https://gateway.byoky.com/v1 */
  baseUrl?: string;
  /** Optional direct-provider fallback for client-side fail-open. */
  failOpen?: FailOpenConfig;
  /** Called when a request bypasses the gateway (for logging/alerting). */
  onBypass?: (info: { url: string; reason: 'network' | 'degraded' }) => void;
  /** fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = 'https://gateway.byoky.com/v1';

/**
 * Build a `fetch` that talks to the Byoky gateway and fails open to the
 * provider on outage. Pass it to any OpenAI-compatible client as `fetch`.
 */
export function createGatewayFetch(opts: GatewayOptions): typeof fetch {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const baseFetch = opts.fetchImpl ?? fetch;

  const bypass = (input: RequestInfo | URL, init: RequestInit | undefined, reason: 'network' | 'degraded'): Promise<Response> => {
    const fo = opts.failOpen!;
    const url = typeof input === 'string' ? input : input.toString();
    const target = url.replace(baseUrl, fo.baseUrl.replace(/\/$/, ''));
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${fo.apiKey}`); // swap byk_ → real provider key
    opts.onBypass?.({ url: target, reason });
    return baseFetch(target, { ...init, headers });
  };

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Ensure the byk_ key is present (clients that set apiKey already will).
    const headers = new Headers(init?.headers);
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${opts.key}`);
    const gwInit = { ...init, headers };

    try {
      const res = await baseFetch(input, gwInit);
      if (res.status === 503 && opts.failOpen) {
        const body = await res.clone().json().catch(() => null) as { error?: { code?: string } } | null;
        if (body?.error?.code === 'GATEWAY_DEGRADED') return bypass(input, gwInit, 'degraded');
      }
      return res;
    } catch (err) {
      if (opts.failOpen) return bypass(input, gwInit, 'network');
      throw err;
    }
  };
}

export class ByokyGateway {
  readonly baseUrl: string;
  readonly key: string;
  /** Drop-in fetch (gateway + fail-open). Pass to an OpenAI-compatible client. */
  readonly fetch: typeof fetch;

  constructor(opts: GatewayOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.key = opts.key;
    this.fetch = createGatewayFetch(opts);
  }

  /** OpenAI-format chat completion (governed + fail-open). */
  async chat(body: Record<string, unknown>): Promise<Response> {
    return this.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** Anthropic-format messages (governed + fail-open). */
  async messages(body: Record<string, unknown>): Promise<Response> {
    return this.fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
