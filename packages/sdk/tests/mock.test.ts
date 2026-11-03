// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { createMockSession } from '../src/mock.js';

// esbuild comes with tsup, the repo's bundler.
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve('tsup'))('esbuild') as typeof import('esbuild');

/**
 * Bundles connectMock the way an app's browser build does: NODE_ENV
 * inlined, no `process` at runtime. Without a NODE_ENV the bundle is left
 * as plain browser ESM would be (platform 'neutral': esbuild's browser
 * platform would define NODE_ENV itself). Returns what calling it does.
 */
async function runInBrowserBundle(nodeEnv: string | undefined): Promise<string> {
  const result = await esbuild.build({
    stdin: {
      contents: `
        import { createMockSession } from './src/mock.ts';
        try {
          const session = createMockSession({ keys: { openai: 'sk-test' } });
          globalThis.outcome = 'created:' + Object.keys(session.providers).join(',');
        } catch (err) {
          globalThis.outcome = 'refused:' + err.message;
        }
      `,
      resolveDir: resolve(__dirname, '..'),
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    write: false,
    minify: true,
    logLevel: 'silent',
    ...(nodeEnv === undefined
      ? { platform: 'neutral' as const, mainFields: ['module', 'main'], conditions: ['import'] }
      : { platform: 'browser' as const, define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) } }),
  });
  const context: Record<string, unknown> = {
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    console,
  };
  vm.runInNewContext(result.outputFiles[0].text, context);
  return context.outcome as string;
}

describe('connectMock production guard', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  it('refuses in a production browser bundle, which has no process', async () => {
    expect(await runInBrowserBundle('production')).toBe('refused:Byoky.connectMock() must not be used in production builds.');
  }, 20_000);

  it('runs in a development browser bundle and without a bundler', async () => {
    expect(await runInBrowserBundle('development')).toBe('created:openai');
    expect(await runInBrowserBundle(undefined)).toBe('created:openai');
  }, 20_000);

  it('refuses in Node when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => createMockSession({ keys: { openai: 'sk-test' } })).toThrow('must not be used in production');
    process.env.NODE_ENV = 'test';
    expect(createMockSession({ keys: { openai: 'sk-test' } }).providers.openai.available).toBe(true);
  });
});

describe('connectMock session', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is done after disconnect(), like a real session', async () => {
    const upstream = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', upstream);
    const session = createMockSession({ keys: { openai: 'sk-test' } });
    const fetchFn = session.createFetch('openai');
    await fetchFn('https://api.openai.com/v1/models');
    expect(upstream).toHaveBeenCalledTimes(1);

    session.disconnect();
    await expect(fetchFn('https://api.openai.com/v1/models')).rejects.toMatchObject({ code: 'NO_SESSION' });
    await expect(session.createFetch('openai')('https://api.openai.com/v1/models')).rejects.toMatchObject({ code: 'NO_SESSION' });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(await session.isConnected()).toBe(false);
  });
});

// Mistral's SDK (and other Speakeasy-generated ones) calls fetch with a bare Request.
describe('connectMock fetch with a Request input', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function upstream() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}');
    }));
    return calls;
  }
  const bodyText = (init: RequestInit) => new TextDecoder().decode(init.body as Uint8Array);

  it('keeps its method, body and headers, and adds the Bearer key', async () => {
    const calls = upstream();
    const session = createMockSession({ keys: { mistral: 'k' } });
    await session.createFetch('mistral')(new Request('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-trace': '1' },
      body: '{"model":"mistral-small-latest"}',
    }));

    const [{ url, init }] = calls;
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(bodyText(init)).toBe('{"model":"mistral-small-latest"}');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-trace')).toBe('1');
    expect(headers.get('authorization')).toBe('Bearer k');
  });

  it('forwards its signal', async () => {
    const calls = upstream();
    const controller = new AbortController();
    await createMockSession({ keys: { mistral: 'k' } }).createFetch('mistral')(
      new Request('https://api.mistral.ai/v1/models', { signal: controller.signal }),
    );
    const { signal } = calls[0].init;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('sets x-api-key for Anthropic and keeps the Request\'s anthropic-version', async () => {
    const calls = upstream();
    await createMockSession({ keys: { anthropic: 'sk-ant' } }).createFetch('anthropic')(
      new Request('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'anthropic-version': '2024-01-01', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const headers = new Headers(calls[0].init.headers);
    expect(calls[0].init.method).toBe('POST');
    expect(headers.get('x-api-key')).toBe('sk-ant');
    expect(headers.get('anthropic-version')).toBe('2024-01-01');
  });

  it('still adds the Gemini key parameter', async () => {
    const calls = upstream();
    await createMockSession({ keys: { gemini: 'g-key' } }).createFetch('gemini')(
      new Request('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"contents":[]}',
      }),
    );
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('key')).toBe('g-key');
    expect(calls[0].init.method).toBe('POST');
    expect(bodyText(calls[0].init)).toBe('{"contents":[]}');
  });

  it('lets init override the Request, as fetch does', async () => {
    const calls = upstream();
    await createMockSession({ keys: { openai: 'sk' } }).createFetch('openai')(
      new Request('https://api.openai.com/v1/chat/completions', { method: 'POST', body: 'old' }),
      { body: 'new', headers: { 'content-type': 'text/plain' } },
    );
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('new');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer sk');
  });
});
