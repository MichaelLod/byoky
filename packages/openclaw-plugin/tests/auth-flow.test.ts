import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAuthContext, ProviderAuthResult } from 'openclaw/plugin-sdk/core';
import { getManifestLocations, registerHostAt } from '../../bridge/src/native-manifest.js';
import { DEFAULT_MODELS, getModel, modelsForProvider } from '../../core/src/models.js';
import { FakeWallet, type WalletKind } from '../../bridge/tests/helpers/fake-wallet.js';
import { openLoginPage } from '../../bridge/tests/helpers/login-page.js';

vi.mock('openclaw/plugin-sdk/core', () => ({ emptyPluginConfigSchema: () => ({}) }));
vi.mock('@byoky/bridge/token', () => ({ loadOrCreateToken: () => 'test-token' }));
vi.mock('@byoky/bridge/native-manifest', async () => await import('../../bridge/src/native-manifest.js'));
vi.mock('@byoky/bridge/loopback-page', async () => await import('../../bridge/src/loopback-page.js'));

const { createByokyPlugin } = await import('../src/index.js');

type Run = (ctx: ProviderAuthContext) => Promise<ProviderAuthResult>;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

// Each test serves the login page on a free port, not on the real
// CALLBACK_PORT, where an OpenClaw login on this machine may be waiting.
let callbackPort: number;
let plugin: ReturnType<typeof createByokyPlugin>;

/** The auth run() of each provider the plugin registers, by id. */
function authRuns(): Record<string, Run> {
  const runs: Record<string, Run> = {};
  plugin.register({
    registerProvider: (p: { id: string; auth: Array<{ run: Run }> }) => { runs[p.id] = p.auth[0].run; },
    registerCommand: () => {},
  } as never);
  return runs;
}

function post(path: string, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port: callbackPort, path, method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${callbackPort}` },
    }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

function pageHtml(): Promise<string> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: callbackPort, path: '/' }, (res) => {
      let html = '';
      res.on('data', (c: Buffer) => { html += c.toString(); });
      res.on('end', () => resolve(html));
    }).on('error', reject).end();
  });
}

async function pageNonce(): Promise<string> {
  return (await pageHtml()).match(/nonce: "([A-Za-z0-9_-]+)"/)![1];
}

let home: string;
let savedHome: string | undefined;
let opened: string[];
let updates: string[];
let stops: string[];

function context(config: object = {}): ProviderAuthContext {
  return {
    config,
    prompter: {
      note: async () => {},
      confirm: async () => true,
      progress: () => ({ update: (m: string) => updates.push(m), stop: (m?: string) => stops.push(m ?? '') }),
    },
    openUrl: async (url: string) => { opened.push(url); },
    runtime: {},
    isRemote: false,
    oauth: {},
  } as unknown as ProviderAuthContext;
}

/** A home where Chrome is installed and already has the host registered. */
function registeredHome(): void {
  const chrome = getManifestLocations(home, platform()).find((l) => l.browser === 'Chrome')!;
  mkdirSync(chrome.profileDirs[0], { recursive: true });
  registerHostAt(home, platform(), '/opt/byoky-bridge.js');
}

beforeEach(async () => {
  callbackPort = await freePort();
  plugin = createByokyPlugin({ callbackPort });
  home = mkdtempSync(join(tmpdir(), 'byoky-oc-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = home;
  opened = [];
  updates = [];
  stops = [];
  // No bridge is running: the health check fails, so login opens the page.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe('login', () => {
  it('configures every provider the page reports, with Azure on its v1 path and capped max_tokens', async () => {
    registeredHome();
    const run = authRuns().byoky(context({ plugins: { entries: { byoky: { config: { anthropicMaxTokens: 2048 } } } } }));
    await expect.poll(() => opened.length).toBe(1);
    expect(opened[0]).toBe(`http://127.0.0.1:${callbackPort}`);
    expect(await post('/callback', { nonce: await pageNonce(), providers: ['anthropic', 'azure_openai'], bridgePort: 19280 }))
      .toBe(200);

    const result = await run;
    const providers = (result.configPatch as { models: { providers: Record<string, { baseUrl: string; apiKey: string; models: Array<{ maxTokens: number }> }> } }).models.providers;
    expect(providers['byoky-azure_openai'].baseUrl).toBe('http://127.0.0.1:19280/azure_openai/openai/v1');
    expect(providers['byoky-anthropic'].baseUrl).toBe('http://127.0.0.1:19280/anthropic');
    expect(providers['byoky-anthropic'].apiKey).toBe('test-token');
    expect(providers['byoky-anthropic'].models.every((m) => m.maxTokens === 2048)).toBe(true);
    expect(stops).toContain('Wallet connected');
  });

  it('configures the models of Byoky\'s registry, with its context windows, output limits and image input', async () => {
    registeredHome();
    const run = authRuns().byoky(context());
    await expect.poll(() => opened.length).toBe(1);
    await post('/callback', { nonce: await pageNonce(), providers: ['anthropic', 'openai', 'gemini'], bridgePort: 19280 });
    const result = await run;
    type Model = { id: string; input: string[]; contextWindow: number; maxTokens: number };
    const providers = (result.configPatch as { models: { providers: Record<string, { models: Model[] }> } }).models.providers;

    for (const providerId of ['anthropic', 'openai', 'gemini'] as const) {
      const catalog = providers[`byoky-${providerId}`].models;
      const registry = modelsForProvider(providerId);
      // The registry drops shut-down models, so nothing here is one.
      expect(catalog.map((m) => m.id).sort(), providerId).toEqual(registry.map((m) => m.id).sort());
      for (const m of catalog) {
        const entry = getModel(m.id)!;
        expect(m.contextWindow, m.id).toBe(entry.contextWindow);
        expect(m.input.includes('image'), m.id).toBe(entry.capabilities.vision);
        // Anthropic's are capped by anthropicMaxTokens (default 4096).
        expect(m.maxTokens, m.id).toBe(providerId === 'anthropic' ? 4096 : entry.maxOutput);
      }
    }
    // A model new projects can call, not one limited to past users.
    expect(providers['byoky-gemini'].models[0].id).toBe(DEFAULT_MODELS.gemini);
    expect(result.defaultModel).toBe('byoky-anthropic/claude-opus-5-5');
  });

  it('fails with the error the page reported, not "not in your wallet"', async () => {
    registeredHome();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = authRuns()['byoky-anthropic'](context());
    const outcome = run.then(() => 'resolved', (e: Error) => e.message);
    await expect.poll(() => opened.length).toBe(1);
    await post('/callback', { nonce: await pageNonce(), error: 'Bridge not installed' });
    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]).toContain('The browser tab reported: Bridge not installed');

    await vi.advanceTimersByTimeAsync(180_000);
    expect(await outcome).toBe('The browser tab reported: Bridge not installed');
  });

  it('says a provider is missing only when the page succeeded without it', async () => {
    registeredHome();
    const run = authRuns()['byoky-openai'](context());
    const outcome = run.then(() => 'resolved', (e: Error) => e.message);
    await expect.poll(() => opened.length).toBe(1);
    await post('/callback', { nonce: await pageNonce(), providers: ['anthropic'] });
    expect(await outcome).toBe('OpenAI not available in your Byoky wallet');
  });

  it('the plugin OpenClaw loads serves the login page on CALLBACK_PORT', async () => {
    registeredHome();
    const { default: loaded, CALLBACK_PORT } = await import('../src/index.js');
    let run: Run | undefined;
    loaded.register({
      registerProvider: (p: { id: string; auth: Array<{ run: Run }> }) => { if (p.id === 'byoky') run = p.auth[0].run; },
      registerCommand: () => {},
    } as never);
    // Stop just before the page server starts, so the real port stays free.
    const ctx = context();
    ctx.prompter.progress = (message: string) => {
      if (message.startsWith('Waiting for approval')) throw new Error(message);
      return { update: () => {}, stop: () => {} };
    };
    await expect(run!(ctx)).rejects.toThrow(`(http://127.0.0.1:${CALLBACK_PORT})`);
  });

  it('registers the native host with the browsers that are installed', async () => {
    const brave = getManifestLocations(home, platform()).find((l) => l.browser === 'Brave')!;
    mkdirSync(brave.profileDirs[0], { recursive: true });
    const run = authRuns().byoky(context());
    await expect.poll(() => opened.length).toBe(1);
    expect(stops).toContain('Registered with Brave');
    expect(existsSync(brave.path)).toBe(true);
    await post('/callback', { nonce: await pageNonce(), providers: ['openai'] });
    await run;
  });
});

describe('what the plugin says about keys', () => {
  // A Claude setup token goes to the bridge for each request, so only API
  // keys stay in the wallet.
  const unqualified = /(?<!API )\bkeys? (never leaves?|stays? in)/i;

  it('claims only that API keys stay in the extension', () => {
    const texts: string[] = [plugin.description];
    plugin.register({
      registerProvider: (p: { auth: Array<{ hint?: string }>; wizard: { setup: { groupHint?: string; choiceHint?: string } } }) => {
        texts.push(...p.auth.map((a) => a.hint ?? ''), p.wizard.setup.groupHint ?? '', p.wizard.setup.choiceHint ?? '');
      },
      registerCommand: () => {},
    } as never);
    expect(texts.filter((t) => unqualified.test(t))).toEqual([]);
    expect(texts.filter((t) => t.includes('API keys stay in the extension')).length).toBeGreaterThan(1);
  });

  it('mentions the setup token on the login page and in the login notes', async () => {
    registeredHome();
    const run = authRuns().byoky(context());
    await expect.poll(() => opened.length).toBe(1);
    const html = await pageHtml();
    await post('/callback', { nonce: html.match(/nonce: "([A-Za-z0-9_-]+)"/)![1], providers: ['anthropic'] });
    const notes = (await run).notes ?? [];

    for (const text of [html, notes.join('\n')]) {
      expect(text).not.toMatch(unqualified);
      expect(text).toContain('API keys stay in your');
      expect(text).toContain('setup token');
    }
  });
});

describe('login page in the browser', () => {
  type Providers = Record<string, { baseUrl: string }>;

  /** One OpenClaw login, approved in its page. */
  async function login(providerId: string, wallet: FakeWallet): Promise<Providers> {
    const before = opened.length;
    const run = authRuns()[providerId](context());
    await expect.poll(() => opened.length).toBe(before + 1);
    const page = openLoginPage(await pageHtml(), callbackPort, wallet);
    page.click();
    try {
      const result = await run;
      return (result.configPatch as { models: { providers: Providers } }).models.providers;
    } finally {
      page.close();
    }
  }

  it.each<[WalletKind, number]>([['reuses-any-session', 1], ['widens-session', 0]])(
    'logging in to byoky-openai after byoky-anthropic gets OpenAI from a wallet that %s, and the bridge keeps Anthropic',
    async (kind, disconnects) => {
      registeredHome();
      const wallet = new FakeWallet({ kind, keys: ['anthropic', 'openai'] });
      expect(Object.keys(await login('byoky-anthropic', wallet))).toEqual(['byoky-anthropic']);
      expect(Object.keys(await login('byoky-openai', wallet))).toEqual(['byoky-openai']);

      expect(wallet.disconnects).toBe(disconnects);
      expect(wallet.session?.requested.sort()).toEqual(['anthropic', 'openai']);
      expect(wallet.bridgeSessionKey).toBe(wallet.session?.key);
    },
  );

  it('logging in to every provider after one asks the wallet about all of them', async () => {
    registeredHome();
    const wallet = new FakeWallet({ kind: 'reuses-any-session', keys: ['anthropic', 'openai', 'gemini'] });
    await login('byoky-anthropic', wallet);
    const providers = await login('byoky', wallet);
    expect(Object.keys(providers).sort()).toEqual(['byoky-anthropic', 'byoky-gemini', 'byoky-openai']);
  });
});
