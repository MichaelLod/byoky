// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_RELAY_MESSAGE_SIZE, parseRelayMessage, WS_READY_STATE } from '@byoky/core';

const upstreamBody = vi.hoisted(() => ({ current: '' }));
const proxyCalls = vi.hoisted(() => [] as Array<{ url: string; init?: RequestInit }>);

vi.mock('../src/proxy-fetch.js', () => ({
  createProxyFetch: () => async (url: string, init?: RequestInit) => {
    proxyCalls.push({ url, init });
    return new Response(upstreamBody.current, { status: 200 });
  },
}));

import { createRelayClient } from '../src/relay-client.js';

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
    expect(chunks.join('')).toBe(upstreamBody.current);
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
});
