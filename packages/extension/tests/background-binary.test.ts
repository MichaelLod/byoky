import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  jsonResponse,
  connectApproved,
  senderFor,
  type FakeNativeConnection,
  type Harness,
} from './helpers/background-harness';
import { bytesToBase64, isTextContentType } from '../lib/binary-body';

// F024: every upstream body went through TextDecoder, and the bridge's
// request body was taken as text, so audio (and any other bytes that
// aren't UTF-8) arrived with each invalid byte replaced by U+FFFD.

const APP = 'http://localhost:3000';
const SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
/** An MP3 frame header, then every byte value. */
const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...Array.from({ length: 256 }, (_, i) => i)]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function audioResponse(): Response {
  return new Response(AUDIO, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}

async function openaiApp(): Promise<{ h: Harness; sessionKey: string }> {
  const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
  await h.unlock();
  const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai' }] });
  return { h, sessionKey: payload.sessionKey };
}

async function startBridge(h: Harness, sessionKey: string): Promise<FakeNativeConnection> {
  h.nativeHost = (msg, conn) => {
    if (msg.type === 'ping') conn.reply({ type: 'pong' });
    if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
  };
  expect((await h.internal('startBridgeProxy', { sessionKey, port: 19280 }, senderFor(APP))).success).toBe(true);
  return h.nativeConnections.find((c) => c.fromExtension.some((m) => m.type === 'start-proxy'))!;
}

async function bridgeExchange(h: Harness, bridge: FakeNativeConnection, req: Record<string, unknown>) {
  const requestId = crypto.randomUUID();
  bridge.reply({ type: 'proxy_http', requestId, method: 'POST', headers: {}, ...req });
  await h.until(() => bridge.fromExtension.some((m) => m.requestId === requestId
    && (m.type === 'proxy_http_response_done' || m.type === 'proxy_http_error')), 5_000, 'the end of the response');
  return bridge.fromExtension.filter((m) => m.requestId === requestId);
}

describe('binary body helpers', () => {
  it('tells text from binary content types like the SDK does', () => {
    for (const t of ['', 'text/event-stream', 'application/json; charset=utf-8', 'application/x-ndjson', 'application/xml']) {
      expect(isTextContentType(t), t).toBe(true);
    }
    for (const t of ['audio/mpeg', 'image/png', 'application/octet-stream']) expect(isTextContentType(t), t).toBe(false);
  });

  it('round-trips bytes through base64', () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(fromBase64(bytesToBase64(big))).toEqual(big);
  });
});

describe('background: binary bodies', () => {
  it('sends a binary upstream reply to the app as exact base64 chunks', async () => {
    const { h, sessionKey } = await openaiApp();
    h.fetch.mockImplementation(async () => audioResponse());
    const r = await h.proxy(APP, { sessionKey, providerId: 'openai', url: SPEECH_URL, body: JSON.stringify({ model: 'tts-1', input: 'hi', voice: 'alloy' }) }).result;
    expect(r.done).toBe(true);
    expect(r.chunks.length).toBeGreaterThan(0);
    for (const c of r.chunks) expect(c.chunkEncoding).toBe('base64');
    expect(concat(r.chunks.map((c) => fromBase64(c.chunk)))).toEqual(AUDIO);
  });

  it('keeps text replies as text', async () => {
    const { h, sessionKey } = await openaiApp();
    h.fetch.mockImplementation(async () => jsonResponse({ choices: [] }));
    const r = await h.proxy(APP, { sessionKey, providerId: 'openai', url: 'https://api.openai.com/v1/chat/completions', body: '{}' }).result;
    expect(r.chunks.every((c) => c.chunkEncoding === undefined)).toBe(true);
    expect(JSON.parse(r.text)).toEqual({ choices: [] });
  });

  it('rebuilds a base64 request body from the bridge byte for byte', async () => {
    const { h, sessionKey } = await openaiApp();
    const bridge = await startBridge(h, sessionKey);
    let sent: Uint8Array | undefined;
    h.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      sent = new Uint8Array(await new Response(init!.body).arrayBuffer());
      return jsonResponse({ text: 'hello' });
    });
    const replies = await bridgeExchange(h, bridge, {
      sessionKey, providerId: 'openai', url: 'https://api.openai.com/v1/audio/transcriptions',
      body: bytesToBase64(AUDIO), bodyEncoding: 'base64',
    });
    expect(replies.at(-1).type).toBe('proxy_http_response_done');
    expect(sent).toEqual(AUDIO);
  });

  it('sends a binary reply to a bridge that takes base64 chunks, and text to an older one', async () => {
    const { h, sessionKey } = await openaiApp();
    const bridge = await startBridge(h, sessionKey);
    h.fetch.mockImplementation(async () => audioResponse());
    const req = { sessionKey, providerId: 'openai', url: SPEECH_URL, body: '{"input":"hi"}' };

    const binary = (await bridgeExchange(h, bridge, { ...req, acceptsBinaryChunks: true }))
      .filter((m) => m.type === 'proxy_http_response_chunk');
    for (const c of binary) expect(c.chunkEncoding).toBe('base64');
    expect(concat(binary.map((c) => fromBase64(c.chunk)))).toEqual(AUDIO);

    const legacy = (await bridgeExchange(h, bridge, req)).filter((m) => m.type === 'proxy_http_response_chunk');
    expect(legacy.every((c) => c.chunkEncoding === undefined && typeof c.chunk === 'string')).toBe(true);
  });

  it('refuses to route a binary bridge body', async () => {
    const h = await startBackground({
      local: await walletStorage([{ id: 'g1', providerId: 'groq', key: 'gsk' }, { id: 'o1', providerId: 'openai', key: 'sk-o' }], {
        groups: [{ id: 'default', name: 'Default', providerId: '', createdAt: 1 }, { id: 'g', name: 'g', providerId: 'groq', createdAt: 1 }],
        appGroups: { [APP]: 'g' },
      }),
    });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai' }] });
    const bridge = await startBridge(h, payload.sessionKey);
    const [reply] = await bridgeExchange(h, bridge, {
      sessionKey: payload.sessionKey, providerId: 'openai', url: 'https://api.openai.com/v1/chat/completions',
      body: bytesToBase64(AUDIO), bodyEncoding: 'base64',
    });
    expect(reply).toMatchObject({ type: 'proxy_http_error', status: 400, code: 'ROUTING_UNSUPPORTED' });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('passes a setup-token bridge reply\'s base64 chunks on as base64', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'oat', providerId: 'anthropic', key: 'sk-ant-oat01-x', authMethod: 'oauth' }]) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic' }] });
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'proxy') {
        conn.reply({ type: 'proxy_response_meta', requestId: msg.requestId, status: 200, headers: { 'content-type': 'application/octet-stream' } });
        conn.reply({ type: 'proxy_response_chunk', requestId: msg.requestId, chunk: bytesToBase64(AUDIO), chunkEncoding: 'base64' });
        conn.reply({ type: 'proxy_response_done', requestId: msg.requestId });
      }
    };
    const r = await h.proxy(APP, { sessionKey: payload.sessionKey, providerId: 'anthropic', url: 'https://api.anthropic.com/v1/messages', body: '{"messages":[]}' }).result;
    expect(r.chunks).toEqual([expect.objectContaining({ chunkEncoding: 'base64' })]);
    expect(fromBase64(r.chunks[0].chunk)).toEqual(AUDIO);
  });
});
