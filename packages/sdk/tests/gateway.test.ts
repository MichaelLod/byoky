import { describe, it, expect, vi } from 'vitest';
import { ByokyGateway, createGatewayFetch } from '../src/gateway.js';

const GW = 'https://gw.byoky.test/v1';
const PROVIDER = 'https://api.openai.com/v1';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createGatewayFetch — happy path', () => {
  it('sends the byk_ key to the gateway and returns its response', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: url.toString(), auth: new Headers(init?.headers).get('authorization') });
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;

    const f = createGatewayFetch({ key: 'byk_live_abc', baseUrl: GW, fetchImpl });
    const res = await f(`${GW}/chat/completions`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(seen[0].url).toBe(`${GW}/chat/completions`);
    expect(seen[0].auth).toBe('Bearer byk_live_abc');
  });
});

describe('createGatewayFetch — fail-open bypass', () => {
  it('falls back to the provider on a network error, swapping to the real key', async () => {
    const bypasses: unknown[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url.toString().startsWith(GW)) throw new Error('ECONNREFUSED');
      // provider call
      return jsonResponse(200, { via: 'provider', auth: new Headers(init?.headers).get('authorization') });
    }) as unknown as typeof fetch;

    const f = createGatewayFetch({
      key: 'byk_live_abc', baseUrl: GW,
      failOpen: { apiKey: 'sk-real', baseUrl: PROVIDER },
      onBypass: (i) => bypasses.push(i), fetchImpl,
    });
    const res = await f(`${GW}/chat/completions`, { method: 'POST' });
    const body = await res.json();
    expect(body.via).toBe('provider');
    expect(body.auth).toBe('Bearer sk-real');           // swapped byk_ → real key
    expect(bypasses).toEqual([{ url: `${PROVIDER}/chat/completions`, reason: 'network' }]);
  });

  it('falls back on a 503 GATEWAY_DEGRADED', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (url.toString().startsWith(GW)) return jsonResponse(503, { error: { code: 'GATEWAY_DEGRADED' } });
      return jsonResponse(200, { via: 'provider' });
    }) as unknown as typeof fetch;

    const f = createGatewayFetch({ key: 'byk_live_abc', baseUrl: GW, failOpen: { apiKey: 'sk-real', baseUrl: PROVIDER }, fetchImpl });
    const res = await f(`${GW}/chat/completions`, { method: 'POST' });
    expect((await res.json()).via).toBe('provider');
  });

  it('does NOT bypass a normal provider error (e.g. 400) — returns it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: { code: 'invalid_request' } })) as unknown as typeof fetch;
    const f = createGatewayFetch({ key: 'byk_live_abc', baseUrl: GW, failOpen: { apiKey: 'sk-real', baseUrl: PROVIDER }, fetchImpl });
    const res = await f(`${GW}/chat/completions`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('re-throws when the gateway is down and no failOpen is configured', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const f = createGatewayFetch({ key: 'byk_live_abc', baseUrl: GW, fetchImpl });
    await expect(f(`${GW}/chat/completions`, { method: 'POST' })).rejects.toThrow('down');
  });
});

describe('ByokyGateway', () => {
  it('exposes baseUrl and chat()/messages() helpers', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => { urls.push(url.toString()); return jsonResponse(200, {}); }) as unknown as typeof fetch;
    const b = new ByokyGateway({ key: 'byk_live_x', baseUrl: GW, fetchImpl });
    await b.chat({ model: 'gpt-5.5', messages: [] });
    await b.messages({ model: 'claude-sonnet-4-6', messages: [] });
    expect(urls).toEqual([`${GW}/chat/completions`, `${GW}/messages`]);
  });
});
