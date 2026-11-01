import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  jsonResponse,
  connectApproved,
  requestLog,
  senderFor,
  type FakeNativeConnection,
  type Harness,
} from './helpers/background-harness';

const APP = 'https://app.example';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function chat(sessionKey: string, extra: Record<string, unknown> = {}) {
  return {
    sessionKey,
    providerId: 'anthropic',
    url: ANTHROPIC_URL,
    body: JSON.stringify({ model: 'claude-x', max_tokens: 4096, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    ...extra,
  };
}

const usage = (h: Harness) => (h.local.data.usageTotals as Record<string, Record<string, number>> | undefined)?.[APP]?.anthropic ?? 0;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch that behaves like the real one with an AbortSignal, counting what reached "upstream". */
function abortableFetch(h: Harness, respond: (signal: AbortSignal) => Promise<Response>) {
  let hits = 0;
  h.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
    const signal = init!.signal!;
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    hits++;
    return respond(signal);
  });
  return () => hits;
}

describe('background: a request cancelled before it went upstream', () => {
  // F077: a cancel during the key decryption made fetch() reject at once
  // with nothing sent, but the request was charged prompt + max_tokens and
  // logged as 499 all the same.
  it('is neither charged nor logged, and its allowance hold is released', async () => {
    const h = await startBackground({
      local: await walletStorage([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-1' }], {
        tokenAllowances: [{ origin: APP, totalLimit: 4100 }],
      }),
    });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const hits = abortableFetch(h, async () => jsonResponse({ usage: { input_tokens: 1, output_tokens: 1 } }));

    const { port } = h.proxy(APP, chat(payload.sessionKey));
    port.close();
    await delay(300);
    expect(hits()).toBe(0);
    expect(requestLog(h)).toHaveLength(0);
    expect(usage(h)).toBe(0);

    // Nothing is held: the next request fits the allowance.
    expect((await h.proxy(APP, chat(payload.sessionKey)).result).done).toBe(true);
    expect(hits()).toBe(1);
  });

  it('is charged when cancelled after the upstream got it', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-1' }]) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const hits = abortableFetch(h, (signal) => new Promise<Response>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const { port } = h.proxy(APP, chat(payload.sessionKey));
    await h.until(() => hits() === 1, 5_000, 'the upstream call');
    port.close();
    await h.until(() => requestLog(h)[0]?.status === 499, 5_000, 'a 499 entry');
    await h.until(() => usage(h) > 4096, 5_000, 'the estimate charged');
  });
});

// --- Setup-token requests, which go through the bridge ---

const SETUP_TOKEN = [{ id: 'oat', providerId: 'anthropic', key: 'sk-ant-oat01-test', authMethod: 'oauth' as const }];

/** Connections that got the request itself (not just the probe). */
const proxied = (h: Harness) => h.nativeConnections.filter((c) => c.fromExtension.some((m) => m.type === 'proxy'));

describe('background: setup-token requests through the bridge', () => {
  // F079: once the headers had arrived, a dying native host left the app's
  // response body open forever.
  it('ends the app\'s response with an error when the bridge dies mid-response', async () => {
    const h = await startBackground({ local: await walletStorage(SETUP_TOKEN) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'proxy') {
        conn.reply({ type: 'proxy_response_meta', requestId: msg.requestId, status: 200, headers: { 'content-type': 'text/event-stream' } });
        conn.reply({ type: 'proxy_response_chunk', requestId: msg.requestId, chunk: 'event: ping\ndata: {}\n\n' });
        conn.crash();
      }
    };
    const r = await h.proxy(APP, chat(payload.sessionKey)).result;
    expect(r.meta.status).toBe(200);
    expect(r.text).toBe('event: ping\ndata: {}\n\n');
    expect(r.error).toMatchObject({ status: 502, error: { code: 'BRIDGE_ERROR', message: 'Bridge disconnected mid-response' } });
    // What it used is still recorded.
    await h.until(() => requestLog(h)[0]?.status === 200, 5_000, 'the log entry');
  });

  // F080: a cancel during the bridge probe was lost; the request still went
  // to the bridge and ran against the user's subscription.
  it('drops a request cancelled during the bridge probe, unbilled', async () => {
    const h = await startBackground({ local: await walletStorage(SETUP_TOKEN) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') setTimeout(() => conn.reply({ type: 'pong' }), 300);
    };
    const { port } = h.proxy(APP, chat(payload.sessionKey));
    await delay(50);
    port.close();
    await delay(600);
    expect(proxied(h)).toHaveLength(0);
    expect(requestLog(h)).toHaveLength(0);
    expect(usage(h)).toBe(0);
  });

  it('shuts the bridge down and charges a request cancelled after it was sent', async () => {
    const h = await startBackground({ local: await walletStorage(SETUP_TOKEN) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const { port } = h.proxy(APP, chat(payload.sessionKey));
    await h.until(() => proxied(h).length === 1, 5_000, 'the request at the bridge');
    port.close();
    const [conn] = proxied(h) as FakeNativeConnection[];
    await h.until(() => conn.closedByExtension, 5_000, 'the bridge shut down');
    await h.until(() => requestLog(h)[0]?.status === 499, 5_000, 'a 499 entry');
  });
});

