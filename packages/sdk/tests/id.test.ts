// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomId } from '../src/id.js';
import { Byoky } from '../src/byoky.js';
import { createProxyFetch } from '../src/proxy-fetch.js';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// On an http:// page other than localhost the page isn't a secure context
// and crypto.randomUUID is undefined; getRandomValues is still there.
function stubInsecureContext() {
  const real = globalThis.crypto;
  vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
}

describe('randomId', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns a v4 UUID', () => {
    expect(randomId()).toMatch(V4);
  });

  it('returns distinct v4 UUIDs without crypto.randomUUID', () => {
    stubInsecureContext();
    expect(crypto.randomUUID).toBeUndefined();
    const ids = new Set(Array.from({ length: 50 }, () => randomId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
  });
});

describe('SDK in an insecure context', () => {
  let posted: Array<Record<string, unknown>>;

  beforeEach(() => {
    posted = [];
    (window as unknown as Record<string, unknown>).__byoky__ = { isByoky: true };
    vi.spyOn(window, 'postMessage').mockImplementation((...args: unknown[]) => {
      posted.push(args[0] as Record<string, unknown>);
    });
    stubInsecureContext();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__byoky__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connect() posts a connect request instead of throwing', async () => {
    void new Byoky({ timeout: 50 }).connect().catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(posted[0]).toMatchObject({ type: 'BYOKY_CONNECT_REQUEST' });
    expect(posted[0].requestId).toMatch(V4);
  });

  it('a proxied request posts a proxy request instead of throwing', async () => {
    void createProxyFetch('openai', { current: 'byk_x' })('https://api.openai.com/v1/models').catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(posted[0]).toMatchObject({ type: 'BYOKY_PROXY_REQUEST' });
    expect(posted[0].requestId).toMatch(V4);
  });
});
