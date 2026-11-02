import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  jsonResponse,
  connectApproved,
  senderFor,
  type Harness,
} from './helpers/background-harness';

// F088: a translated request whose upstream answered with an error body
// that isn't the destination's JSON (an HTML 502 from a CDN) failed with
// TRANSLATION_FAILED after the headers had been sent.

const APP = 'http://localhost:3000';
const HTML_502 = '<html><body>502 Bad Gateway</body></html>';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** An app calling Anthropic, routed to OpenAI. */
async function routedApp(): Promise<{ h: Harness; sessionKey: string }> {
  const h = await startBackground({
    local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }], {
      groups: [
        { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
        { id: 'g', name: 'g', providerId: 'openai', model: 'gpt-5.5', createdAt: 1 },
      ],
      appGroups: { [APP]: 'g' },
    }),
  });
  await h.unlock();
  const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic' }] });
  return { h, sessionKey: payload.sessionKey };
}

const ANTHROPIC_CHAT = {
  providerId: 'anthropic',
  url: 'https://api.anthropic.com/v1/messages',
  body: JSON.stringify({ model: 'claude-x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
};

describe('background: upstream errors on translated requests', () => {
  it('passes a non-JSON error body through', async () => {
    const { h, sessionKey } = await routedApp();
    h.fetch.mockImplementation(async () => new Response(HTML_502, { status: 502, headers: { 'content-type': 'text/html' } }));
    const r = await h.proxy(APP, { sessionKey, ...ANTHROPIC_CHAT }).result;
    expect(r.meta.status).toBe(502);
    expect(r.text).toBe(HTML_502);
    expect(r.done).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('still hands the app a provider error in its own dialect', async () => {
    const { h, sessionKey } = await routedApp();
    h.fetch.mockImplementation(async () => jsonResponse(
      { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } },
      401,
    ));
    const r = await h.proxy(APP, { sessionKey, ...ANTHROPIC_CHAT }).result;
    expect(r.meta.status).toBe(401);
    expect(JSON.parse(r.text)).toMatchObject({ type: 'error', error: { message: 'Incorrect API key provided' } });
  });

  // R4-04: the error's type is the app dialect's for the HTTP status, not
  // the upstream's (OpenAI calls a bad key invalid_request_error).
  it('gives a translated error the app dialect\'s type for its status', async () => {
    const { h, sessionKey } = await routedApp();
    h.fetch.mockImplementation(async () => jsonResponse(
      { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } },
      401,
    ));
    const r = await h.proxy(APP, { sessionKey, ...ANTHROPIC_CHAT }).result;
    expect(r.meta.status).toBe(401);
    expect(JSON.parse(r.text)).toEqual({ type: 'error', error: { type: 'authentication_error', message: 'Incorrect API key provided' } });
  });

  it('does so on the bridge HTTP path too', async () => {
    const { h, sessionKey } = await routedApp();
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
    };
    expect((await h.internal('startBridgeProxy', { sessionKey, port: 19280 }, senderFor(APP))).success).toBe(true);
    const bridge = h.nativeConnections.find((c) => c.fromExtension.some((m) => m.type === 'start-proxy'))!;
    h.fetch.mockImplementation(async () => jsonResponse({ error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } }, 429));
    bridge.reply({ type: 'proxy_http', requestId: 'r1', sessionKey, method: 'POST', headers: {}, ...ANTHROPIC_CHAT });
    await h.until(() => bridge.fromExtension.some((m) => m.requestId === 'r1' && (m.type === 'proxy_http_response_done' || m.type === 'proxy_http_error')), 5_000, 'the end of the response');
    const replies = bridge.fromExtension.filter((m) => m.requestId === 'r1');
    expect(replies[0]).toMatchObject({ type: 'proxy_http_response_meta', status: 429 });
    expect(JSON.parse(replies[1].chunk as string)).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit reached' } });
  });

  it('passes a non-JSON error body through on the bridge HTTP path', async () => {
    const { h, sessionKey } = await routedApp();
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
    };
    expect((await h.internal('startBridgeProxy', { sessionKey, port: 19280 }, senderFor(APP))).success).toBe(true);
    const bridge = h.nativeConnections.find((c) => c.fromExtension.some((m) => m.type === 'start-proxy'))!;
    h.fetch.mockImplementation(async () => new Response(HTML_502, { status: 502, headers: { 'content-type': 'text/html' } }));
    bridge.reply({ type: 'proxy_http', requestId: 'r1', sessionKey, method: 'POST', headers: {}, ...ANTHROPIC_CHAT });
    await h.until(() => bridge.fromExtension.some((m) => m.requestId === 'r1' && (m.type === 'proxy_http_response_done' || m.type === 'proxy_http_error')), 5_000, 'the end of the response');
    const replies = bridge.fromExtension.filter((m) => m.requestId === 'r1');
    expect(replies.map((m) => m.type)).toEqual(['proxy_http_response_meta', 'proxy_http_response_chunk', 'proxy_http_response_done']);
    expect(replies[1].chunk).toBe(HTML_502);
  });
});

// F010: Gemini answers a failed streamGenerateContent with a plain JSON
// error labelled text/event-stream (live 2026-11-02: 400, 404, 429, 503).
// It went through the stream translator, which dropped it: an Anthropic
// app got an empty body, an OpenAI app a made-up stream ending in [DONE].
describe('background: a routed stream\'s upstream error', () => {
  const GEMINI_429 = JSON.stringify({
    error: { code: 429, message: 'You exceeded your current quota.', status: 'RESOURCE_EXHAUSTED' },
  });
  const geminiError = () => new Response(GEMINI_429, { status: 429, headers: { 'content-type': 'text/event-stream' } });

  async function routedToGemini(appProvider: string) {
    const h = await startBackground({
      local: await walletStorage([{ id: 'gm', providerId: 'gemini', key: 'AIza-g' }], {
        groups: [
          { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
          { id: 'g', name: 'g', providerId: 'gemini', model: 'gemini-3.6-flash', createdAt: 1 },
        ],
        appGroups: { [APP]: 'g' },
      }),
    });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: appProvider }] });
    h.fetch.mockImplementation(async () => geminiError());
    return { h, sessionKey: payload.sessionKey as string };
  }

  const STREAM = {
    anthropic: {
      providerId: 'anthropic', url: 'https://api.anthropic.com/v1/messages',
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    },
    openai: {
      providerId: 'openai', url: 'https://api.openai.com/v1/chat/completions',
      body: JSON.stringify({ model: 'gpt-5.5', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    },
  };

  it('reaches an Anthropic app as its own error, with Gemini\'s message', async () => {
    const { h, sessionKey } = await routedToGemini('anthropic');
    const r = await h.proxy(APP, { sessionKey, ...STREAM.anthropic }).result;
    expect(h.fetch.mock.calls[0][0]).toContain(':streamGenerateContent');
    expect(r.meta.status).toBe(429);
    expect(JSON.parse(r.text)).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'You exceeded your current quota.' } });
    expect(r.done).toBe(true);
  });

  it('reaches an OpenAI app as an error, not a stream ending in [DONE]', async () => {
    const { h, sessionKey } = await routedToGemini('openai');
    const r = await h.proxy(APP, { sessionKey, ...STREAM.openai }).result;
    expect(r.meta.status).toBe(429);
    expect(r.text).not.toContain('[DONE]');
    expect(JSON.parse(r.text).error).toMatchObject({ message: 'You exceeded your current quota.' });
  });

  it('does so on the bridge HTTP path too', async () => {
    const { h, sessionKey } = await routedToGemini('anthropic');
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
    };
    expect((await h.internal('startBridgeProxy', { sessionKey, port: 19280 }, senderFor(APP))).success).toBe(true);
    const bridge = h.nativeConnections.find((c) => c.fromExtension.some((m) => m.type === 'start-proxy'))!;
    bridge.reply({ type: 'proxy_http', requestId: 'r1', sessionKey, method: 'POST', headers: {}, ...STREAM.anthropic });
    await h.until(() => bridge.fromExtension.some((m) => m.requestId === 'r1' && (m.type === 'proxy_http_response_done' || m.type === 'proxy_http_error')), 5_000, 'the end of the response');
    const replies = bridge.fromExtension.filter((m) => m.requestId === 'r1');
    expect(replies.map((m) => m.type)).toEqual(['proxy_http_response_meta', 'proxy_http_response_chunk', 'proxy_http_response_done']);
    expect(JSON.parse(replies[1].chunk as string)).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'You exceeded your current quota.' } });
  });

  // The setup-token path (through the bridge host) only reaches Anthropic,
  // which sends JSON errors; it takes the same rule all the same.
  it('does so for a setup-token reply relayed by the bridge', async () => {
    const h = await startBackground({
      local: await walletStorage([{ id: 'oat', providerId: 'anthropic', key: 'sk-ant-oat01-x', authMethod: 'oauth' }], {
        groups: [
          { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
          { id: 'g', name: 'g', providerId: 'anthropic', model: 'claude-haiku-4-5', createdAt: 1 },
        ],
        appGroups: { [APP]: 'g' },
      }),
    });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai' }] });
    const error = JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'proxy') {
        conn.reply({ type: 'proxy_response_meta', requestId: msg.requestId, status: 529, headers: { 'content-type': 'text/event-stream' } });
        conn.reply({ type: 'proxy_response_chunk', requestId: msg.requestId, chunk: error });
        conn.reply({ type: 'proxy_response_done', requestId: msg.requestId });
      }
    };
    const r = await h.proxy(APP, { sessionKey: payload.sessionKey, ...STREAM.openai }).result;
    expect(r.meta.status).toBe(529);
    expect(r.text).not.toContain('[DONE]');
    expect(JSON.parse(r.text).error).toMatchObject({ message: 'Overloaded' });
  });
});
