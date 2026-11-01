// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
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
