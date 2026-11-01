import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAuthContext, ProviderAuthResult } from 'openclaw/plugin-sdk/core';
import { getManifestLocations, registerHostAt } from '../../bridge/src/native-manifest.js';
import { FakeWallet, type WalletKind } from '../../bridge/tests/helpers/fake-wallet.js';
import { openLoginPage } from '../../bridge/tests/helpers/login-page.js';

vi.mock('openclaw/plugin-sdk/core', () => ({ emptyPluginConfigSchema: () => ({}) }));
vi.mock('@byoky/bridge/token', () => ({ loadOrCreateToken: () => 'test-token' }));
vi.mock('@byoky/bridge/native-manifest', async () => await import('../../bridge/src/native-manifest.js'));
vi.mock('@byoky/bridge/loopback-page', async () => await import('../../bridge/src/loopback-page.js'));

const { default: plugin, CALLBACK_PORT } = await import('../src/index.js');

type Run = (ctx: ProviderAuthContext) => Promise<ProviderAuthResult>;

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
      host: '127.0.0.1', port: CALLBACK_PORT, path, method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${CALLBACK_PORT}` },
    }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

function pageHtml(): Promise<string> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: CALLBACK_PORT, path: '/' }, (res) => {
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

beforeEach(() => {
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
    expect(opened[0]).toBe('http://127.0.0.1:19282');
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

describe('login page in the browser', () => {
  type Providers = Record<string, { baseUrl: string }>;

  /** One OpenClaw login, approved in its page. */
  async function login(providerId: string, wallet: FakeWallet): Promise<Providers> {
    const before = opened.length;
    const run = authRuns()[providerId](context());
    await expect.poll(() => opened.length).toBe(before + 1);
    const page = openLoginPage(await pageHtml(), CALLBACK_PORT, wallet);
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
