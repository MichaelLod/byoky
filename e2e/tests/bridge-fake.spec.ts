import { test, expect, type Page } from '@playwright/test';
import { LIVE, cleanupWallet, launchWallet, loadApiKeys, startServer, type ApiKeys, type Wallet } from '../fixtures';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The CLI/desktop path against the fakes: a local client → the real
// byoky-bridge host (started by the browser over native messaging) → the
// extension → the provider, and back.
//
// - API keys: the extension makes the upstream call from its service worker,
//   so fake-providers.ts answers it, as on the page path.
// - A Claude setup token: the bridge host makes the call itself, from Node.
//   bridge-upstream-preload.mjs points it at a fake upstream run here, which
//   streams its SSE in pieces, as a real server does.
//
// The bridge host gets a HOME of its own, so its token is not the user's.
// Clients send the requests the Anthropic and OpenAI SDKs send.

declare const chrome: {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
};

const PASSWORD = 'Bridge-Fake-e2e-1';
const PRELOAD = path.resolve(__dirname, '../bridge-upstream-preload.mjs');
const SETUP_TOKEN = 'sk-ant-oat01-e2e-fake-setup-token';
const CLAUDE_CODE_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

interface Bridge {
  wallet: Wallet;
  home: string;
  /** http://127.0.0.1:<port> */
  base: string;
  token: string;
  sessionKey: string;
  origin: string;
}

async function createWallet(w: Wallet) {
  await w.popup.bringToFront();
  await expect(w.popup.locator('button:has-text("Get Started")')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Get Started")');
  await w.popup.fill('#password', PASSWORD);
  await w.popup.click('button:has-text("Continue")');
  await w.popup.fill('#confirm', PASSWORD);
  await w.popup.click('button:has-text("Create wallet")');
  await expect(w.popup.locator('text=No API keys or tokens yet')).toBeVisible({ timeout: 30_000 });
}

function internal<T = Record<string, unknown>>(popup: Page, action: string, payload?: Record<string, unknown>): Promise<T> {
  return popup.evaluate(
    async ({ action: a, payload: p }) => (await chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: a, payload: p })) as T,
    { action, payload },
  );
}

async function addCredential(w: Wallet, providerId: string, value: string, authMethod: 'api_key' | 'oauth') {
  const result = await internal<{ success?: boolean; error?: string }>(w.popup, 'addCredential', {
    providerId, label: `Bridge ${providerId} ${authMethod}`, value, authMethod,
  });
  expect(result.error ?? null).toBeNull();
}

/** Connects the test page (the app the bridge session belongs to), approving in the popup. */
async function connectPage(w: Wallet, providers: string[]): Promise<string> {
  await w.page.bringToFront();
  await w.page.evaluate((p) => {
    void (window as unknown as { _byoky: { connect: (p: string[]) => Promise<void> } })._byoky.connect(p);
  }, providers);
  await w.popup.bringToFront();
  await expect(w.popup.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Approve")');
  await w.page.waitForFunction(
    () => {
      const s = (window as unknown as { _testState: { connected: boolean; error: string | null } })._testState;
      return s?.connected === true || s?.error != null;
    },
    { timeout: 20_000 },
  );
  const state = await w.page.evaluate(
    () => (window as unknown as { _testState: { session: { sessionKey: string } | null; error: string | null } })._testState,
  );
  if (!state.session) throw new Error(`connect failed: ${state.error}`);
  return state.session.sessionKey;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** What `byoky-bridge connect`'s page does once the wallet approved it. */
async function startBridgeProxy(page: Page, sessionKey: string, port: number): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(({ sessionKey: key, port: p }) => new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const onReply = (event: Event) => {
      const msg = (event as CustomEvent<{ requestId?: string; payload?: { success: boolean; error?: string } }>).detail;
      if (msg?.requestId !== requestId) return;
      document.removeEventListener('byoky-message', onReply);
      resolve(msg.payload ?? { success: false, error: 'no reply' });
    };
    document.addEventListener('byoky-message', onReply);
    window.postMessage({
      type: 'BYOKY_INTERNAL_FROM_PAGE', requestId, action: 'startBridgeProxy', payload: { sessionKey: key, port: p },
    }, window.location.origin);
    setTimeout(() => reject(new Error('startBridgeProxy timed out')), 20_000);
  }), { sessionKey, port });
}

async function openBridge(label: string, credentials: Array<[string, string, 'api_key' | 'oauth']>, upstream?: string): Promise<Bridge> {
  // byoky-e2e-*: the stale-dir sweep and CI's leftover check cover it.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'byoky-e2e-bridge-home-'));
  const bridgeEnv: Record<string, string> = { HOME: home };
  if (upstream) {
    bridgeEnv.NODE_OPTIONS = `--import ${pathToFileURL(PRELOAD).href}`;
    bridgeEnv.BYOKY_E2E_ANTHROPIC_UPSTREAM = upstream;
  }
  const wallet = await launchWallet(label, await startServer(), { bridgeEnv });
  await createWallet(wallet);
  for (const [providerId, value, authMethod] of credentials) await addCredential(wallet, providerId, value, authMethod);
  const sessionKey = await connectPage(wallet, [...new Set(credentials.map(([id]) => id))]);
  const port = await freePort();
  expect(await startBridgeProxy(wallet.page, sessionKey, port)).toEqual({ success: true, port });
  const token = fs.readFileSync(path.join(home, '.byoky-bridge', 'token'), 'utf8').trim();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const origin = await wallet.page.evaluate(() => window.location.origin);
  return { wallet, home, base: `http://127.0.0.1:${port}`, token, sessionKey, origin };
}

async function closeBridge(bridge: Bridge | undefined) {
  if (!bridge) return;
  await cleanupWallet(bridge.wallet);
  fs.rmSync(bridge.home, { recursive: true, force: true });
}

/** Headers the Anthropic SDK sends with the bridge token as its API key. */
const anthropicHeaders = (token: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  'anthropic-version': '2023-06-01',
  'x-api-key': token,
  ...extra,
});

const ask = (extra: Record<string, unknown> = {}) => JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 32,
  messages: [{ role: 'user', content: 'Reply with OK.' }],
  ...extra,
});

/** Concatenated text deltas of an Anthropic SSE transcript. */
function sseText(raw: string): string {
  return raw.split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as { type?: string; delta?: { type?: string; text?: string } })
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
    .map((e) => e.delta!.text)
    .join('');
}

interface LogEntry {
  appOrigin: string;
  providerId: string;
  actualProviderId?: string;
  status: number;
  inputTokens?: number;
  outputTokens?: number;
}

test.describe.configure({ mode: 'serial' });

test.describe('bridge: API keys, fake providers', () => {
  test.skip(LIVE, 'runs against the fakes; the live bridge is openclaw-flow');

  let keys: ApiKeys;
  let bridge: Bridge;

  test.beforeAll(async () => {
    keys = loadApiKeys();
    bridge = await openBridge('bridge', [
      ['anthropic', keys.anthropic, 'api_key'],
      ['openai', keys.openai, 'api_key'],
    ]);
  });

  test.afterAll(async () => {
    await closeBridge(bridge);
  });

  test('an Anthropic JSON call goes out with the wallet key, never the bridge token', async () => {
    const res = await fetch(`${bridge.base}/anthropic/v1/messages`, {
      method: 'POST', headers: anthropicHeaders(bridge.token), body: ask(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: Array<{ text: string }> };
    expect(body.content[0].text).toBe('OK');

    const seen = bridge.wallet.fakes!.requests.filter((r) => r.provider === 'anthropic');
    expect(seen).toHaveLength(1);
    expect(seen[0].headers['x-api-key']).toBe(keys.anthropic);
    expect((seen[0].body as { model: string }).model).toBe('claude-haiku-4-5-20251001');
  });

  test('a client without the bridge token is refused before anything reaches the wallet', async () => {
    const before = bridge.wallet.fakes!.requests.length;
    const res = await fetch(`${bridge.base}/anthropic/v1/messages`, {
      method: 'POST', headers: anthropicHeaders('not-the-token'), body: ask(),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { code: string }).code).toBe('bridge_token_invalid');
    expect(bridge.wallet.fakes!.requests.length).toBe(before);
  });

  test('an Anthropic stream comes back as SSE', async () => {
    const res = await fetch(`${bridge.base}/anthropic/v1/messages`, {
      method: 'POST', headers: anthropicHeaders(bridge.token), body: ask({ stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const raw = await res.text();
    expect(sseText(raw)).toBe('OK');
    expect(raw).toContain('event: message_stop');
  });

  test('an OpenAI call goes out with the wallet key', async () => {
    const res = await fetch(`${bridge.base}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bridge.token}` },
      body: JSON.stringify({ model: 'gpt-5.4-mini', max_completion_tokens: 32, messages: [{ role: 'user', content: 'Reply with OK.' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { choices: Array<{ message: { content: string } }> };
    expect(body.choices[0].message.content).toBe('OK');
    const seen = bridge.wallet.fakes!.requests.filter((r) => r.provider === 'openai');
    expect(seen.at(-1)!.headers['authorization']).toBe(`Bearer ${keys.openai}`);
  });

  test('a group routing Anthropic to OpenAI translates the call both ways', async () => {
    const { group } = await internal<{ group: { id: string } }>(bridge.wallet.popup, 'createGroup', {
      name: 'Bridge to OpenAI', providerId: 'openai', model: 'gpt-5.4-mini',
    });
    expect((await internal(bridge.wallet.popup, 'setAppGroup', { origin: bridge.origin, groupId: group.id })).error ?? null).toBeNull();
    try {
      const openaiBefore = bridge.wallet.fakes!.requests.filter((r) => r.provider === 'openai').length;
      const res = await fetch(`${bridge.base}/anthropic/v1/messages`, {
        method: 'POST', headers: anthropicHeaders(bridge.token), body: ask(),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { type: string; role: string; content: Array<{ type: string; text: string }> };
      expect(body).toMatchObject({ type: 'message', role: 'assistant' });
      expect(body.content[0]).toEqual({ type: 'text', text: 'OK' });

      const openai = bridge.wallet.fakes!.requests.filter((r) => r.provider === 'openai');
      expect(openai).toHaveLength(openaiBefore + 1);
      expect((openai.at(-1)!.body as { model: string }).model).toBe('gpt-5.4-mini');
    } finally {
      await internal(bridge.wallet.popup, 'setAppGroup', { origin: bridge.origin, groupId: 'default' });
    }
  });

  test('a client that hangs up stops the upstream call', async () => {
    const held = bridge.wallet.fakes!.holdNext('anthropic');
    const aborted = bridge.wallet.ctx.waitForEvent('requestfailed', {
      predicate: (req) => req.url().startsWith('https://api.anthropic.com/'),
      timeout: 15_000,
    });
    const client = new AbortController();
    const call = fetch(`${bridge.base}/anthropic/v1/messages`, {
      method: 'POST', headers: anthropicHeaders(bridge.token), body: ask(), signal: client.signal,
    }).catch((e: unknown) => e);
    await held.seen;
    client.abort();
    expect(await call).toBeInstanceOf(Error);
    // The bridge sends proxy_http_cancel; the extension aborts its fetch.
    const failed = await aborted;
    held.release();
    expect(failed.failure()?.errorText).toMatch(/ABORTED|cancel/i);
  });

  test('the wallet logs the bridge calls under the app, with the translated one', async () => {
    const { log } = await internal<{ log: LogEntry[] }>(bridge.wallet.popup, 'getRequestLog');
    const mine = log.filter((e) => e.appOrigin === bridge.origin);
    expect(mine.filter((e) => e.providerId === 'anthropic' && !e.actualProviderId && e.status === 200).length).toBeGreaterThanOrEqual(2);
    expect(mine.some((e) => e.providerId === 'openai' && e.status === 200)).toBe(true);
    expect(mine.some((e) => e.providerId === 'anthropic' && e.actualProviderId === 'openai' && e.status === 200)).toBe(true);
  });

  test('nothing the providers saw holds the bridge token or the session key', async () => {
    for (const r of bridge.wallet.fakes!.requests) {
      const sent = JSON.stringify({ headers: r.headers, body: r.body });
      expect(sent, `${r.method} ${r.url}`).not.toContain(bridge.token);
      expect(sent, `${r.method} ${r.url}`).not.toContain(bridge.sessionKey);
    }
  });
});

// ── Setup token: the bridge host calls the (fake) upstream itself ──

interface UpstreamRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: {
    system?: unknown;
    messages?: Array<{ role: string; content: unknown }>;
    tools?: Array<{ name: string }>;
    stream?: boolean;
  };
  /** The connection closed before the answer was finished. */
  hungUp: boolean;
}

interface FakeUpstream {
  url: string;
  requests: UpstreamRequest[];
  /** Stop the next stream after its first event, until the client hangs up. */
  stallNext(): void;
  close(): Promise<void>;
}

const UPSTREAM_USAGE = { input_tokens: 21, output_tokens: 5 };

/**
 * A fake api.anthropic.com for the bridge host's own fetches. Answers a tool
 * call to the first tool it was given (by the name it was given), as JSON or
 * as SSE written in small pieces with pauses, split mid-event.
 */
async function startFakeUpstream(): Promise<FakeUpstream> {
  const requests: UpstreamRequest[] = [];
  let stall = false;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', async () => {
      const seen: UpstreamRequest = {
        method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}'), hungUp: false,
      };
      requests.push(seen);
      res.on('close', () => { if (!res.writableFinished) seen.hungUp = true; });
      const tool = seen.body.tools?.[0]?.name;
      const content = [
        { type: 'text', text: 'Reading it.' },
        ...(tool ? [{ type: 'tool_use', id: 'toolu_e2e', name: tool, input: { path: 'README.md' } }] : []),
      ];
      if (!seen.body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_e2e_upstream', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001',
          content, stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null, usage: UPSTREAM_USAGE,
        }));
        return;
      }
      const events: Array<[string, unknown]> = [
        ['message_start', { type: 'message_start', message: { id: 'msg_e2e_upstream', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [], stop_reason: null, usage: { input_tokens: UPSTREAM_USAGE.input_tokens, output_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading ' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'it.' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ...(tool ? [
          ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_e2e', name: tool, input: {} } }],
          ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"README.md"}' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        ] as Array<[string, unknown]> : []),
        ['message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: UPSTREAM_USAGE.output_tokens } }],
        ['message_stop', { type: 'message_stop' }],
      ];
      const transcript = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
      if (stall) {
        // The first event and a piece of the next, then nothing until the
        // client hangs up.
        stall = false;
        res.write(transcript.slice(0, transcript.indexOf('\n\n') + 12));
        return;
      }
      // Pieces of 37 bytes: event lines and JSON break across chunks.
      for (let i = 0; i < transcript.length; i += 37) {
        if (res.destroyed) return;
        res.write(transcript.slice(i, i + 37));
        await new Promise((r) => setTimeout(r, 5));
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    requests,
    stallNext() { stall = true; },
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

test.describe('bridge: Claude setup token, fake upstream', () => {
  test.skip(LIVE, 'runs against a fake upstream; the live setup-token path is openclaw-flow');

  let upstream: FakeUpstream;
  let bridge: Bridge;

  test.beforeAll(async () => {
    upstream = await startFakeUpstream();
    bridge = await openBridge('bridge-oat', [['anthropic', SETUP_TOKEN, 'oauth']], upstream.url);
  });

  test.afterAll(async () => {
    await closeBridge(bridge);
    await upstream?.close();
  });

  // What OpenClaw sends: its own tool names and system prompt, and a beta
  // that would put a subscription on long-context billing.
  const agentRequest = (extra: Record<string, unknown> = {}) => ask({
    system: 'You are a helpful agent.',
    tools: [{ name: 'read', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
    ...extra,
  });
  const agentHeaders = (token: string) => anthropicHeaders(token, { 'anthropic-beta': 'context-1m-2025-08-07' });

  test('the request reaches Anthropic shaped as Claude Code, with the token as Bearer', async () => {
    const res = await fetch(`${bridge.base}/anthropic/v1/messages`, {
      method: 'POST', headers: agentHeaders(bridge.token), body: agentRequest(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: Array<{ type: string; name?: string }> };
    // Anthropic answered with the alias; the client gets its own name back.
    expect(body.content.find((b) => b.type === 'tool_use')?.name).toBe('read');

    expect(upstream.requests).toHaveLength(1);
    const sent = upstream.requests[0];
    expect(sent.url).toBe('/v1/messages');
    expect(sent.headers['authorization']).toBe(`Bearer ${SETUP_TOKEN}`);
    expect(sent.headers['x-api-key']).toBeUndefined();
    expect(sent.headers['user-agent']).toMatch(/^claude-cli\//);
    expect(sent.headers['x-app']).toBe('cli');
    const betas = String(sent.headers['anthropic-beta']).split(',');
    expect(betas).toContain('oauth-2025-04-20');
    expect(betas).not.toContain('context-1m-2025-08-07');
    expect(sent.body.system).toBe(CLAUDE_CODE_PREFIX);
    expect(JSON.stringify(sent.body.messages?.[0].content)).toContain('<system_context>\\nYou are a helpful agent.');
    expect(sent.body.tools?.map((t) => t.name)).toEqual(['Read']);
    expect(JSON.stringify(sent)).not.toContain(bridge.token);
  });

  test('a stream split mid-event arrives whole, with the tool name mapped back', async () => {
    const res = await fetch(`${bridge.base}/anthropic/v1/messages`, {
      method: 'POST', headers: agentHeaders(bridge.token), body: agentRequest({ stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const raw = await res.text();
    expect(sseText(raw)).toBe('Reading it.');
    expect(raw).toContain('"name":"read"');
    expect(raw).not.toContain('"name":"Read"');
    expect(raw).toContain('event: message_stop');
  });

  test('the wallet logs the usage the bridge read from the response', async () => {
    await expect.poll(async () => {
      const { log } = await internal<{ log: LogEntry[] }>(bridge.wallet.popup, 'getRequestLog');
      return log.filter((e) => e.appOrigin === bridge.origin && e.providerId === 'anthropic')
        .map((e) => [e.status, e.inputTokens, e.outputTokens]);
    }, { timeout: 10_000 }).toEqual([
      [200, UPSTREAM_USAGE.input_tokens, UPSTREAM_USAGE.output_tokens],
      [200, UPSTREAM_USAGE.input_tokens, UPSTREAM_USAGE.output_tokens],
    ]);
  });

  test('a client that hangs up mid-stream stops the bridge host\'s own call', async () => {
    upstream.stallNext();
    const client = new AbortController();
    const res = await fetch(`${bridge.base}/anthropic/v1/messages`, {
      method: 'POST', headers: agentHeaders(bridge.token), body: agentRequest({ stream: true }), signal: client.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    client.abort();
    await expect.poll(() => upstream.requests.at(-1)?.hungUp, { timeout: 10_000 }).toBe(true);
  });
});
