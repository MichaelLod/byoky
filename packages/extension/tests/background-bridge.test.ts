import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  connectApproved,
  requestLog,
  senderFor,
  type FakeNativeConnection,
  type Harness,
} from './helpers/background-harness';
import { ROUTING_MAC_KEY } from '../lib/routing-state';

// The bridge HTTP proxy (CLI tools through `byoky-bridge`): what happens to
// the requests of a bridge connection that ends.

const APP = 'http://localhost:3000';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A host that answers the probe and acknowledges start-proxy. */
function bridgeHost(msg: any, conn: FakeNativeConnection) {
  if (msg.type === 'ping') conn.reply({ type: 'pong' });
  if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
}

/** Starts the bridge proxy for `sessionKey`, as the app's page does; resolves with the new connection. */
async function startBridge(h: Harness, sessionKey: string, origin = APP, port = 19280): Promise<FakeNativeConnection> {
  h.nativeHost = bridgeHost;
  const before = new Set(h.nativeConnections);
  expect(await h.internal('startBridgeProxy', { sessionKey, port }, senderFor(origin))).toEqual({ success: true, port });
  return h.nativeConnections.find((c) => !before.has(c) && c.fromExtension.some((m) => m.type === 'start-proxy'))!;
}

/** The bridge relays a client's request to the extension. */
function bridgeRequest(bridge: FakeNativeConnection, sessionKey: string, requestId: string, req: Record<string, unknown>) {
  bridge.reply({ type: 'proxy_http', requestId, sessionKey, method: 'POST', headers: {}, reportsDirectFetch: true, ...req });
}

const usage = (h: Harness, provider: string) =>
  (h.local.data.usageTotals as Record<string, Record<string, number>> | undefined)?.[APP]?.[provider] ?? 0;

// --- Claude setup tokens: the bridge makes the call and reports back ---

const SETUP_TOKEN = [{ id: 'oat', providerId: 'anthropic', key: 'sk-ant-oat01-test', authMethod: 'oauth' as const }];
/** Asks for 4000 output tokens: over the 1000-token allowance once held. */
const BIG = JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 4000, messages: [{ role: 'user', content: 'hi' }] });
const SMALL = JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });

async function setupTokenApp(): Promise<{ h: Harness; sessionKey: string }> {
  const h = await startBackground({
    local: await walletStorage(SETUP_TOKEN, { tokenAllowances: [{ origin: APP, totalLimit: 1000 }] }),
  });
  await h.unlock();
  const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic' }] });
  return { h, sessionKey: payload.sessionKey };
}

/** Sends a setup-token request on `bridge`; resolves once the extension answered it. */
async function directFetch(h: Harness, bridge: FakeNativeConnection, sessionKey: string, requestId: string, body: string) {
  bridgeRequest(bridge, sessionKey, requestId, { providerId: 'anthropic', url: ANTHROPIC_URL, body });
  await h.until(() => bridge.fromExtension.some((m) => m.requestId === requestId), 5_000, `the extension's answer to ${requestId}`);
  return bridge.fromExtension.find((m) => m.requestId === requestId);
}

describe('background: a setup-token request the bridge fetches itself', () => {
  it('is logged and charged from the bridge\'s report, and its hold released', async () => {
    const { h, sessionKey } = await setupTokenApp();
    const bridge = await startBridge(h, sessionKey);
    expect((await directFetch(h, bridge, sessionKey, 'r1', BIG)).type).toBe('proxy_direct_fetch');

    bridge.reply({ type: 'proxy_direct_done', requestId: 'r1', status: 200, complete: true, responseChars: 40, usage: { inputTokens: 12, outputTokens: 30 } });
    await h.until(() => usage(h, 'anthropic') === 42, 5_000, 'the usage charged');
    expect(requestLog(h)).toEqual([expect.objectContaining({ status: 200, inputTokens: 12, outputTokens: 30 })]);
    // The hold is gone: the next request fits the allowance.
    expect((await directFetch(h, bridge, sessionKey, 'r2', SMALL)).type).toBe('proxy_direct_fetch');
  });

  it('is logged as failed, and its hold released, when the host dies', async () => {
    const { h, sessionKey } = await setupTokenApp();
    const first = await startBridge(h, sessionKey);
    expect((await directFetch(h, first, sessionKey, 'r1', BIG)).type).toBe('proxy_direct_fetch');

    first.crash();
    await h.until(() => requestLog(h).length === 1, 5_000, 'the log entry');
    expect(requestLog(h)[0]).toMatchObject({ status: 502 });

    const second = await startBridge(h, sessionKey);
    expect((await directFetch(h, second, sessionKey, 'r2', SMALL)).type).toBe('proxy_direct_fetch');
  });

  // F037: replacing the connection (`byoky-bridge connect` again, an
  // OpenClaw login) shut the old host down without settling its requests:
  // the hold stayed for the worker's lifetime, so an app with no usage was
  // refused for its allowance, and the request was never logged.
  it('is logged as failed, and its hold released, when a new start replaces the connection', async () => {
    const { h, sessionKey } = await setupTokenApp();
    const first = await startBridge(h, sessionKey);
    expect((await directFetch(h, first, sessionKey, 'r1', BIG)).type).toBe('proxy_direct_fetch');

    const second = await startBridge(h, sessionKey);
    expect(first.closedByExtension).toBe(true);
    await h.until(() => requestLog(h).length === 1, 5_000, 'the log entry');
    expect(requestLog(h)[0]).toMatchObject({ status: 502 });

    expect((await directFetch(h, second, sessionKey, 'r2', SMALL)).type).toBe('proxy_direct_fetch');
  });
});

// --- API keys: the extension makes the call and streams it to the bridge ---

/** An upstream SSE stream the test feeds; its signal shows whether it was aborted. */
function streamingUpstream(h: Harness) {
  const upstream: { signal?: AbortSignal; push?: (s: string) => void } = {};
  h.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
    upstream.signal = init?.signal ?? undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        upstream.push = (s) => controller.enqueue(enc.encode(s));
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        upstream.push('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  return upstream;
}

async function openaiApp(): Promise<{ h: Harness; sessionKey: string }> {
  const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
  await h.unlock();
  const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai' }] });
  return { h, sessionKey: payload.sessionKey };
}

const STREAM_BODY = JSON.stringify({ model: 'gpt-5.5', stream: true, messages: [{ role: 'user', content: 'hi' }] });

async function streamingRequest(h: Harness, bridge: FakeNativeConnection, sessionKey: string, requestId: string) {
  bridgeRequest(bridge, sessionKey, requestId, { providerId: 'openai', url: OPENAI_URL, body: STREAM_BODY });
  await h.until(() => bridge.fromExtension.some((m) => m.requestId === requestId && m.type === 'proxy_http_response_chunk'),
    5_000, 'the first chunk');
}

describe('background: an API-key request streaming to the bridge', () => {
  it('stops its upstream call, and is charged what it used, when the host dies', async () => {
    const { h, sessionKey } = await openaiApp();
    const upstream = streamingUpstream(h);
    const bridge = await startBridge(h, sessionKey);
    await streamingRequest(h, bridge, sessionKey, 'r1');

    bridge.crash();
    await h.until(() => upstream.signal?.aborted === true, 5_000, 'the upstream call aborted');
    await h.until(() => usage(h, 'openai') > 0, 5_000, 'the partial usage charged');
    expect(requestLog(h)).toEqual([expect.objectContaining({ status: 200 })]);
  });

  // F037: the old connection's requests kept streaming, and posted their
  // chunks to the new host under ids it never issued.
  it('stops its upstream call, and sends nothing to the new host, when a new start replaces the connection', async () => {
    const { h, sessionKey } = await openaiApp();
    const upstream = streamingUpstream(h);
    const first = await startBridge(h, sessionKey);
    await streamingRequest(h, first, sessionKey, 'r1');

    const second = await startBridge(h, sessionKey);
    await h.until(() => upstream.signal?.aborted === true, 5_000, 'the upstream call aborted');
    await h.until(() => usage(h, 'openai') > 0, 5_000, 'the partial usage charged');
    await h.settle(20);
    expect(second.fromExtension.filter((m) => m.requestId === 'r1')).toEqual([]);
  });
});

// --- Refusals ---

/** Sends one request on `bridge`; resolves with the extension's first answer to it. */
async function bridgeAnswer(h: Harness, bridge: FakeNativeConnection, sessionKey: string, req: Record<string, unknown>) {
  const requestId = crypto.randomUUID();
  bridgeRequest(bridge, sessionKey, requestId, req);
  await h.until(() => bridge.fromExtension.some((m) => m.requestId === requestId), 5_000, 'the answer');
  return bridge.fromExtension.find((m) => m.requestId === requestId);
}

const OPENAI_CHAT = { providerId: 'openai', url: OPENAI_URL, body: JSON.stringify({ model: 'gpt-5.5', max_tokens: 10, messages: [] }) };
const ANTHROPIC_CHAT = { providerId: 'anthropic', url: ANTHROPIC_URL, body: JSON.stringify({ model: 'claude-x', max_tokens: 10, messages: [] }) };

async function bridgeApp(local: Record<string, unknown>, providers: string[]) {
  const h = await startBackground({ local });
  await h.unlock();
  const { payload } = await connectApproved(h, APP, { providers: providers.map((id) => ({ id })) });
  const bridge = await startBridge(h, payload.sessionKey);
  return { h, bridge, sessionKey: payload.sessionKey as string };
}

const OPENAI_KEY = [{ id: 'o1', providerId: 'openai', key: 'sk-o' }];
/** An app calling `src`, routed by its group to `dst`'s key. */
const routedTo = (dst: string) => ({
  groups: [
    { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
    { id: 'g', name: 'g', providerId: dst, model: dst === 'openai' ? 'gpt-5.5' : 'claude-x', createdAt: 1 },
  ],
  appGroups: { [APP]: 'g' },
});

// F017: these went to the bridge with no status, which it answers with a
// 502, and CLI tools retry a 502. The page path answers them 429 or 403.
describe('background: refusals on the bridge carry a status and code', () => {
  it('a spending limit reached: 429 QUOTA_EXCEEDED, as on the page path', async () => {
    const { h, bridge, sessionKey } = await bridgeApp(await walletStorage(OPENAI_KEY, {
      tokenAllowances: [{ origin: APP, totalLimit: 10 }],
      usageTotals: { [APP]: { openai: 50 } },
    }), ['openai']);
    expect(await bridgeAnswer(h, bridge, sessionKey, OPENAI_CHAT)).toMatchObject({
      type: 'proxy_http_error', status: 429, code: 'QUOTA_EXCEEDED', error: expect.stringMatching(/allowance/i),
    });
    const page = await h.proxy(APP, { sessionKey, ...OPENAI_CHAT }).result;
    expect(page.error).toMatchObject({ status: 429, error: { code: 'QUOTA_EXCEEDED' } });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('a spending limit reached by a setup-token request: 429 QUOTA_EXCEEDED', async () => {
    const { h, bridge, sessionKey } = await bridgeApp(await walletStorage(SETUP_TOKEN, {
      tokenAllowances: [{ origin: APP, totalLimit: 10 }],
      usageTotals: { [APP]: { anthropic: 50 } },
    }), ['anthropic']);
    expect(await bridgeAnswer(h, bridge, sessionKey, ANTHROPIC_CHAT)).toMatchObject({
      type: 'proxy_http_error', status: 429, code: 'QUOTA_EXCEEDED',
    });
    expect(bridge.fromExtension.some((m) => m.type === 'proxy_direct_fetch')).toBe(false);
  });

  it('apps paused after the limits were tampered with: 429 QUOTA_EXCEEDED, as on the page path', async () => {
    const local = await walletStorage(OPENAI_KEY, { tokenAllowances: [{ origin: APP, totalLimit: 1000 }] });
    delete local[ROUTING_MAC_KEY];
    const { h, bridge, sessionKey } = await bridgeApp(local, ['openai']);
    expect(await bridgeAnswer(h, bridge, sessionKey, OPENAI_CHAT)).toMatchObject({
      type: 'proxy_http_error', status: 429, code: 'QUOTA_EXCEEDED', error: expect.stringMatching(/paused/),
    });
  });

  it('a provider the session doesn\'t have: 403 PROVIDER_UNAVAILABLE', async () => {
    const { h, bridge, sessionKey } = await bridgeApp(await walletStorage(OPENAI_KEY), ['openai']);
    expect(await bridgeAnswer(h, bridge, sessionKey, {
      providerId: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent', body: '{}',
    })).toMatchObject({ type: 'proxy_http_error', status: 403, code: 'PROVIDER_UNAVAILABLE' });
  });

  it('a URL off the provider\'s host: 403 INVALID_URL', async () => {
    const { h, bridge, sessionKey } = await bridgeApp(await walletStorage(OPENAI_KEY), ['openai']);
    expect(await bridgeAnswer(h, bridge, sessionKey, { ...OPENAI_CHAT, url: 'https://evil.example/v1/chat/completions' }))
      .toMatchObject({ type: 'proxy_http_error', status: 403, code: 'INVALID_URL' });
  });

  it('a request that can\'t be translated for the routed provider: 400 with the translation\'s code', async () => {
    const { h, bridge, sessionKey } = await bridgeApp(await walletStorage(OPENAI_KEY, routedTo('openai')), ['anthropic']);
    expect(await bridgeAnswer(h, bridge, sessionKey, { ...ANTHROPIC_CHAT, body: 'not json' }))
      .toMatchObject({ type: 'proxy_http_error', status: 400, code: 'INVALID_JSON' });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('a translated request to a setup token: 400 TRANSLATION_NOT_SUPPORTED', async () => {
    const { h, bridge, sessionKey } = await bridgeApp(await walletStorage(SETUP_TOKEN, routedTo('anthropic')), ['openai']);
    expect(await bridgeAnswer(h, bridge, sessionKey, OPENAI_CHAT))
      .toMatchObject({ type: 'proxy_http_error', status: 400, code: 'TRANSLATION_NOT_SUPPORTED' });
  });
});
