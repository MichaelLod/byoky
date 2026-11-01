// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_RELAY_MESSAGE_SIZE, parseRelayMessage, WS_READY_STATE } from '@byoky/core';

const upstreamBody = vi.hoisted(() => ({ current: '' as BodyInit, contentType: undefined as string | undefined }));
const proxyCalls = vi.hoisted(() => [] as Array<{ url: string; init?: RequestInit }>);

vi.mock('../src/proxy-fetch.js', () => ({
  createProxyFetch: () => async (url: string, init?: RequestInit) => {
    proxyCalls.push({ url, init });
    const headers = upstreamBody.contentType ? { 'content-type': upstreamBody.contentType } : undefined;
    return new Response(upstreamBody.current, { status: 200, headers });
  },
}));

import { createRelayClient } from '../src/relay-client.js';
import { ByokyServer } from '../src/server.js';

class MockWebSocket {
  static last: MockWebSocket;
  readyState: number = WS_READY_STATE.CONNECTING;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(public url: string) { MockWebSocket.last = this; }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = WS_READY_STATE.CLOSED; }
  open() { this.readyState = WS_READY_STATE.OPEN; this.onopen?.({}); }
}

describe('createRelayClient', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    upstreamBody.contentType = undefined;
  });

  it('announces its relayId in relay:hello instead of the session key', () => {
    const relay = createRelayClient('ws://localhost:3001/ws/relay', 'byk_secret_session', {});
    MockWebSocket.last.open();

    const hello = JSON.parse(MockWebSocket.last.sent[0]);
    expect(relay.relayId).toMatch(/^relay_[0-9a-f]{32}$/);
    expect(hello.type).toBe('relay:hello');
    expect(hello.sessionId).toBe(relay.relayId);
    expect(MockWebSocket.last.sent[0]).not.toContain('byk_secret_session');
    relay.close();
  });

  it('splits response chunks the server would drop as oversized', async () => {
    // A surrogate pair right at the first split point, then text that doubles
    // in size when JSON-escaped.
    upstreamBody.current = 'a'.repeat(MAX_RELAY_MESSAGE_SIZE / 8 - 1) + '\u{1F600}' + '"\n'.repeat(400_000);

    const relay = createRelayClient('ws://localhost:3001/ws/relay', 'byk_secret_session', {
      anthropic: { available: true, authMethod: 'api_key' },
    });
    const ws = MockWebSocket.last;
    ws.open();
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'relay:request',
        requestId: 'req-1',
        providerId: 'anthropic',
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: {},
        body: '{}',
      }),
    });

    await vi.waitFor(() => {
      expect(ws.sent.some((m) => m.includes('relay:response:done'))).toBe(true);
    });

    const chunkMessages = ws.sent.filter((m) => m.includes('relay:response:chunk'));
    expect(chunkMessages.length).toBeGreaterThan(1);
    const chunks = chunkMessages.map((m) => {
      expect(m.length).toBeLessThanOrEqual(MAX_RELAY_MESSAGE_SIZE);
      const parsed = parseRelayMessage(m);
      expect(parsed?.type).toBe('relay:response:chunk');
      return (parsed as { chunk: string }).chunk;
    });
    expect(chunks.join('')).toBe(upstreamBody.current as string);
    // No chunk may end on half a surrogate pair.
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    relay.close();
  });

  describe('relayed request bodies', () => {
    function relayRequest(extra: Record<string, unknown>) {
      proxyCalls.length = 0;
      upstreamBody.current = '{}';
      const relay = createRelayClient('ws://localhost:3001/ws/relay', 'byk_secret_session', {});
      const ws = MockWebSocket.last;
      ws.open();
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'relay:request',
          requestId: 'req-body',
          providerId: 'openai',
          url: 'https://api.openai.com/v1/audio/transcriptions',
          method: 'POST',
          headers: {},
          ...extra,
        }),
      });
      return { relay, ws };
    }

    it('turns a base64 body back into the exact bytes', async () => {
      const { relay, ws } = relayRequest({ body: btoa('RIFF\xff\xfe\x00\x80'), bodyEncoding: 'base64' });
      await vi.waitFor(() => expect(ws.sent.some((m) => m.includes('relay:response:done'))).toBe(true));

      const body = proxyCalls[0].init!.body as Uint8Array;
      expect(Array.from(body)).toEqual([0x52, 0x49, 0x46, 0x46, 0xff, 0xfe, 0x00, 0x80]);
      relay.close();
    });

    it('turns a formdata body back into FormData with the file', async () => {
      const entries = [
        { name: 'model', value: 'whisper-1', type: 'text' },
        { name: 'file', value: btoa('\xff\xfb'), type: 'file', filename: 'speech.mp3', contentType: 'audio/mpeg' },
      ];
      const { relay, ws } = relayRequest({ body: JSON.stringify(entries), bodyEncoding: 'formdata' });
      await vi.waitFor(() => expect(ws.sent.some((m) => m.includes('relay:response:done'))).toBe(true));

      const form = proxyCalls[0].init!.body as FormData;
      expect(form.get('model')).toBe('whisper-1');
      const file = form.get('file') as File;
      expect(file.name).toBe('speech.mp3');
      expect(file.type).toBe('audio/mpeg');
      expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([0xff, 0xfb]);
      relay.close();
    });
  });

  describe('binary responses', () => {
    function relayAudio(bytes: Uint8Array) {
      upstreamBody.current = bytes as Uint8Array<ArrayBuffer>;
      upstreamBody.contentType = 'audio/mpeg';
      const relay = createRelayClient('ws://localhost:3001/ws/relay', 'byk_secret_session', {});
      const ws = MockWebSocket.last;
      ws.open();
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'relay:request', requestId: 'req-tts', providerId: 'openai',
          url: 'https://api.openai.com/v1/audio/speech', method: 'POST', headers: {}, body: '{}',
        }),
      });
      return { relay, ws };
    }

    it('sends a non-text response as base64 chunks, each under the size limit', async () => {
      const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256);
      const { relay, ws } = relayAudio(bytes);
      await vi.waitFor(() => expect(ws.sent.some((m) => m.includes('relay:response:done'))).toBe(true));

      const chunks = ws.sent.filter((m) => m.includes('relay:response:chunk')).map((m) => {
        expect(m.length).toBeLessThanOrEqual(MAX_RELAY_MESSAGE_SIZE);
        return parseRelayMessage(m) as { chunk: string; chunkEncoding?: string };
      });
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((c) => c.chunkEncoding === 'base64')).toBe(true);
      const received = chunks.flatMap((c) => Array.from(atob(c.chunk), (ch) => ch.charCodeAt(0)));
      expect(received).toEqual(Array.from(bytes));
      relay.close();
    });

    it('arrives byte-exact at the backend', async () => {
      const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
      const { relay, ws } = relayAudio(bytes);

      // Feed what the relay client sent into a real ByokyServer.
      const serverWs = {
        readyState: WS_READY_STATE.OPEN,
        send: (data: string) => { ws.onmessage?.({ data }); },
        close() {},
        onopen: null, onmessage: null as ((e: { data: unknown }) => void) | null, onclose: null, onerror: null,
      };
      const clientPromise = new ByokyServer({ pingInterval: 0 }).handleConnection(serverWs);
      const forward = (data: string) => serverWs.onmessage?.({ data });
      ws.sent.splice(0).forEach(forward);
      ws.send = (data: string) => forward(data);
      const client = await clientPromise;

      upstreamBody.current = bytes as Uint8Array<ArrayBuffer>;
      const response = await client.createFetch('openai')('https://api.openai.com/v1/audio/speech', { method: 'POST', body: '{}' });
      expect(response.headers.get('content-type')).toBe('audio/mpeg');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      relay.close();
    });
  });
});
