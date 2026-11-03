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

describe('background: the estimate a cancelled request is charged', () => {
  const OTHER = 'https://other.example';
  const totals = (h: Harness) => h.local.data.usageTotals as Record<string, Record<string, number>> | undefined;
  const body = (maxTokens: string) => `{"model":"claude-x","max_tokens":${maxTokens},"messages":[{"role":"user","content":"hi"}]}`;

  /** Send `rawBody` from APP, cancel it once it reached the upstream, and wait for its 499 entry. */
  async function cancelAfterUpstream(h: Harness, rawBody: string) {
    let hang = true;
    const hits = abortableFetch(h, async (signal) => {
      if (!hang) return jsonResponse({ usage: { input_tokens: 10, output_tokens: 10 } });
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    });
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const { port } = h.proxy(APP, chat(payload.sessionKey, { body: rawBody }));
    await h.until(() => hits() === 1, 5_000, 'the upstream call');
    port.close();
    await h.until(() => requestLog(h)[0]?.status === 499, 5_000, 'a 499 entry');
    hang = false;
  }

  // R3-01: max_tokens 1e400 parses as Infinity. Charged on cancel, it made
  // every later usage write throw, so no app's usage was counted any more.
  it('ignores an output limit that isn\'t a finite number, and every app is still counted', async () => {
    const h = await startBackground({
      local: await walletStorage([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-1' }], {
        tokenAllowances: [{ origin: OTHER, totalLimit: 100_000 }],
      }),
    });
    await h.unlock();
    const rawBody = body('1e400');
    await cancelAfterUpstream(h, rawBody);
    const prompt = Math.ceil(rawBody.length / 4);
    await h.until(() => totals(h)?.[APP]?.anthropic === prompt, 5_000, 'the prompt charged');

    const other = await connectApproved(h, OTHER, { providers: [{ id: 'anthropic', required: true }] });
    expect((await h.proxy(OTHER, chat(other.payload.sessionKey)).result).done).toBe(true);
    await h.until(() => totals(h)?.[OTHER]?.anthropic === 20, 5_000, 'the other app counted');
    expect(totals(h)).toEqual({ [APP]: { anthropic: prompt }, [OTHER]: { anthropic: 20 } });
    expect(h.session!.data._pendingUsage).toEqual({});
    expect(requestLog(h).find((e) => e.status === 499)).toMatchObject({ inputTokens: prompt, outputTokens: 0 });
    expect((await h.internal('getAllowances')).limitsHold).toBeNull();
  });

  it('caps an absurd output limit at a million tokens', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-1' }]) });
    await h.unlock();
    const rawBody = body('1e300');
    await cancelAfterUpstream(h, rawBody);
    await h.until(() => totals(h)?.[APP]?.anthropic === Math.ceil(rawBody.length / 4) + 1_000_000, 5_000, 'the capped estimate charged');
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

describe('background: bridge HTTP proxy sessions', () => {
  // F085: an expired session answered 'Session has expired', then 'Session
  // not found or wallet locked', both of which the bridge turned into a
  // retryable 502 that blamed the lock.
  it('answers an expired session with a 401 the bridge can act on', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-1' }]) });
    await h.unlock();
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
    };
    const { payload } = await connectApproved(h, 'http://localhost:3000', { providers: [{ id: 'anthropic', required: true }] });
    // Started by the app's own page (through the content script).
    const started = await h.internal('startBridgeProxy', { sessionKey: payload.sessionKey, port: 19280 }, senderFor('http://localhost:3000'));
    expect(started).toEqual({ success: true, port: 19280 });
    const bridge = h.nativeConnections.find((c) => c.fromExtension.some((m) => m.type === 'start-proxy'))!;

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
    bridge.reply({
      type: 'proxy_http', requestId: 'r1', sessionKey: payload.sessionKey, providerId: 'anthropic',
      url: ANTHROPIC_URL, method: 'POST', headers: {}, body: '{}',
    });
    await h.until(() => bridge.fromExtension.some((m) => m.requestId === 'r1'), 5_000, 'the reply');
    expect(bridge.fromExtension.find((m) => m.requestId === 'r1')).toEqual({
      type: 'proxy_http_error', requestId: 'r1', status: 401, code: 'bridge_session_expired', error: 'Bridge session expired',
    });
    expect(h.fetch).not.toHaveBeenCalled();
    // The bridge's authorization went with the session.
    await h.until(() => h.session!.data._bridges === undefined, 5_000, 'the bridge session forgotten');
  });
});

// F062: neither side closed a finished request's port, so one port pair
// (and the request it carried) stayed open per call for the life of the
// worker or the tab.
describe('background: a finished request\'s port', () => {
  async function connected() {
    const h = await startBackground({ local: await walletStorage([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-1' }]) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    return { h, sessionKey: payload.sessionKey as string };
  }

  const sse = (...events: string[]) => new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(new TextEncoder().encode(e));
      controller.close();
    },
  });
  const STREAM = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
  ];

  it('is closed by the background once usage is counted, success or not', async () => {
    const { h, sessionKey } = await connected();
    h.fetch.mockImplementation(async () => jsonResponse({ usage: { input_tokens: 3, output_tokens: 4 } }));
    const json = h.proxy(APP, chat(sessionKey, { body: '{"model":"claude-x","max_tokens":10,"messages":[]}' }));
    expect((await json.result).done).toBe(true);
    await h.until(() => json.port.closedByBackground, 5_000, 'the port closed');
    // Closed after the usage was recorded, which the close didn't change.
    expect(usage(h)).toBe(7);
    expect(requestLog(h)[0]).toMatchObject({ status: 200, inputTokens: 3, outputTokens: 4 });

    h.fetch.mockImplementation(async () => new Response(sse(...STREAM), { headers: { 'content-type': 'text/event-stream' } }));
    const stream = h.proxy(APP, chat(sessionKey));
    expect((await stream.result).done).toBe(true);
    await h.until(() => stream.port.closedByBackground, 5_000, 'the port closed');
    expect(usage(h)).toBe(19);
    // DONE was the last thing the page got; no error followed it.
    expect(stream.port.received.at(-1).type).toBe('BYOKY_PROXY_RESPONSE_DONE');
  });

  it('is closed after a refusal or a failed stream too', async () => {
    const { h, sessionKey } = await connected();
    const refused = h.proxy(APP, chat(sessionKey, { url: 'https://api.anthropic.com/v1/files', method: 'GET' }));
    expect((await refused.result).error.error.code).toBe('ENDPOINT_NOT_ALLOWED');
    await h.until(() => refused.port.closedByBackground, 5_000, 'the port closed');

    const expired = h.proxy(APP, chat('not-a-session'));
    expect((await expired.result).error.error.code).toBe('SESSION_EXPIRED');
    await h.until(() => expired.port.closedByBackground, 5_000, 'the port closed');

    h.fetch.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(STREAM[0]));
        controller.error(new TypeError('network error'));
      },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const cut = h.proxy(APP, chat(sessionKey));
    expect((await cut.result).error.error.code).toBe('PROXY_ERROR');
    await h.until(() => cut.port.closedByBackground, 5_000, 'the port closed');
    expect(requestLog(h)[0].status).toBe(200);
  });
});
