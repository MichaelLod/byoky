// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ByokyServer } from '../src/server.js';
import type { WebSocketLike } from '@byoky/core';
import { MAX_RELAY_MESSAGE_SIZE, WS_READY_STATE } from '@byoky/core';

function createMockWebSocket(): WebSocketLike & { simulateMessage(data: unknown): void; sentMessages: string[] } {
  const ws: WebSocketLike & { simulateMessage(data: unknown): void; sentMessages: string[] } = {
    readyState: WS_READY_STATE.OPEN,
    sentMessages: [],
    send(data: string) { this.sentMessages.push(data); },
    close() { this.readyState = WS_READY_STATE.CLOSED; if (this.onclose) this.onclose({ code: 1000, reason: '' }); },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    simulateMessage(data: unknown) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
    },
  };
  return ws;
}

describe('ByokyServer', () => {
  let server: ByokyServer;
  let ws: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    server = new ByokyServer({ pingInterval: 0, helloTimeout: 5000 });
    ws = createMockWebSocket();
  });

  it('resolves with client after receiving relay:hello', async () => {
    const clientPromise = server.handleConnection(ws);

    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'test-session',
      providers: {
        anthropic: { available: true, authMethod: 'api_key' },
      },
    });

    const client = await clientPromise;
    expect(client.sessionId).toBe('test-session');
    expect(client.providers.anthropic.available).toBe(true);
    expect(client.connected).toBe(true);
  });

  it('rejects if hello times out', async () => {
    const server = new ByokyServer({ pingInterval: 0, helloTimeout: 50 });
    const clientPromise = server.handleConnection(ws);

    await expect(clientPromise).rejects.toThrow('relay:hello');
  });

  it('createFetch sends relay:request and assembles response', async () => {
    const clientPromise = server.handleConnection(ws);
    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'sess-1',
      providers: { anthropic: { available: true, authMethod: 'api_key' } },
    });
    const client = await clientPromise;

    const fetchFn = client.createFetch('anthropic');
    const responsePromise = fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514' }),
    });

    // Wait a tick for the async readBody to resolve and the message to be sent
    await new Promise((r) => setTimeout(r, 10));

    // Parse the sent request
    const sentReq = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    expect(sentReq.type).toBe('relay:request');
    expect(sentReq.providerId).toBe('anthropic');
    expect(sentReq.url).toBe('https://api.anthropic.com/v1/messages');

    const requestId = sentReq.requestId;

    // Simulate response from frontend
    ws.simulateMessage({
      type: 'relay:response:meta',
      requestId,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });

    ws.simulateMessage({
      type: 'relay:response:chunk',
      requestId,
      chunk: '{"content":"Hello"}',
    });

    ws.simulateMessage({
      type: 'relay:response:done',
      requestId,
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('{"content":"Hello"}');
  });

  it('handles relay errors', async () => {
    const clientPromise = server.handleConnection(ws);
    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'sess-1',
      providers: { anthropic: { available: true, authMethod: 'api_key' } },
    });
    const client = await clientPromise;

    const fetchFn = client.createFetch('anthropic');
    const responsePromise = fetchFn('https://api.anthropic.com/v1/messages');

    await new Promise((r) => setTimeout(r, 10));
    const sentReq = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

    ws.simulateMessage({
      type: 'relay:response:error',
      requestId: sentReq.requestId,
      error: { code: 'PROXY_ERROR', message: 'Something went wrong' },
    });

    await expect(responsePromise).rejects.toThrow('Something went wrong');
  });

  it('responds to pings', async () => {
    const clientPromise = server.handleConnection(ws);
    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'sess-1',
      providers: {},
    });
    await clientPromise;

    ws.simulateMessage({ type: 'relay:ping', ts: 12345 });

    const pong = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    expect(pong.type).toBe('relay:pong');
    expect(pong.ts).toBe(12345);
  });

  it('fires onClose when WebSocket closes', async () => {
    const clientPromise = server.handleConnection(ws);
    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'sess-1',
      providers: {},
    });
    const client = await clientPromise;

    const closeFn = vi.fn();
    client.onClose(closeFn);

    ws.close();

    expect(closeFn).toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });

  it('rejects a request too large for the relay instead of sending it', async () => {
    const clientPromise = server.handleConnection(ws);
    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'sess-1',
      providers: { anthropic: { available: true, authMethod: 'api_key' } },
    });
    const client = await clientPromise;
    const sentBefore = ws.sentMessages.length;

    const fetchFn = client.createFetch('anthropic');
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(MAX_RELAY_MESSAGE_SIZE) }] });

    await expect(fetchFn('https://api.anthropic.com/v1/messages', { method: 'POST', body }))
      .rejects.toThrow('too large for the relay');
    expect(ws.sentMessages.length).toBe(sentBefore);
  });

  it('times out a request the browser never answers', async () => {
    const server = new ByokyServer({ pingInterval: 0, requestTimeout: 50 });
    const clientPromise = server.handleConnection(ws);
    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'sess-1',
      providers: { anthropic: { available: true, authMethod: 'api_key' } },
    });
    const client = await clientPromise;

    const fetchFn = client.createFetch('anthropic');
    await expect(fetchFn('https://api.anthropic.com/v1/messages')).rejects.toThrow('timed out');
  });

  it('keeps a stream open while chunks arrive and fails it once it stalls', async () => {
    const server = new ByokyServer({ pingInterval: 0, requestTimeout: 80 });
    const clientPromise = server.handleConnection(ws);
    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'sess-1',
      providers: { anthropic: { available: true, authMethod: 'api_key' } },
    });
    const client = await clientPromise;

    const fetchFn = client.createFetch('anthropic');
    const responsePromise = fetchFn('https://api.anthropic.com/v1/messages');
    await new Promise((r) => setTimeout(r, 10));
    const { requestId } = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

    ws.simulateMessage({ type: 'relay:response:meta', requestId, status: 200, statusText: 'OK', headers: {} });
    const response = await responsePromise;
    const reader = response.body!.getReader();

    // Five chunks 40 ms apart outlast the 80 ms timeout only because each resets it.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 40));
      ws.simulateMessage({ type: 'relay:response:chunk', requestId, chunk: `data: ${i}\n\n` });
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe(`data: ${i}\n\n`);
    }

    await expect(reader.read()).rejects.toThrow('timed out');
  });

  describe('relay:hello', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('is accepted once: a second hello neither renames the session nor adds a ping timer', async () => {
      vi.useFakeTimers();
      const server = new ByokyServer({ pingInterval: 1000, helloTimeout: 5000 });
      const clientPromise = server.handleConnection(ws);
      ws.simulateMessage({ type: 'relay:hello', sessionId: 'first', providers: {} });
      const client = await clientPromise;

      for (let i = 0; i < 5; i++) {
        ws.simulateMessage({ type: 'relay:hello', sessionId: `again-${i}`, providers: { x: { available: true, authMethod: 'api_key' } } });
      }
      expect(client.sessionId).toBe('first');
      expect(client.providers).toEqual({});

      const pings = () => ws.sentMessages.filter((m) => m.includes('relay:ping')).length;
      vi.advanceTimersByTime(1000);
      expect(pings()).toBe(1);

      ws.close();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores a hello whose providers is not an object map', async () => {
      const server = new ByokyServer({ pingInterval: 0, helloTimeout: 50 });
      const clientPromise = server.handleConnection(ws);
      ws.simulateMessage({ type: 'relay:hello', sessionId: 'x', providers: null });
      await expect(clientPromise).rejects.toThrow('relay:hello');
    });

    it('rejects at once and leaves no timer when the socket closes before the hello', async () => {
      vi.useFakeTimers();
      const clientPromise = server.handleConnection(ws);
      ws.close();
      await expect(clientPromise).rejects.toThrow('closed before relay:hello');
      ws.simulateMessage({ type: 'relay:hello', sessionId: 'late', providers: {} });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('request bodies', () => {
    async function relayedRequest(input: RequestInfo | URL, init?: RequestInit) {
      const clientPromise = server.handleConnection(ws);
      ws.simulateMessage({ type: 'relay:hello', sessionId: 'sess-1', providers: {} });
      const client = await clientPromise;
      void client.createFetch('openai')(input, init).catch(() => {});
      await new Promise((r) => setTimeout(r, 10));
      return JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    }

    const decode = (b64: string) => Array.from(atob(b64), (c) => c.charCodeAt(0));
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xff, 0xfe, 0x00, 0x80]);

    it('relays a binary Uint8Array body as exact base64', async () => {
      const req = await relayedRequest('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav,
      });
      expect(req.bodyEncoding).toBe('base64');
      expect(decode(req.body)).toEqual(Array.from(wav));
    });

    it('relays a FormData body with its file name and type', async () => {
      const form = new FormData();
      form.append('model', 'whisper-1');
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');

      const req = await relayedRequest('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', body: form });
      expect(req.bodyEncoding).toBe('formdata');
      const entries = JSON.parse(req.body);
      expect(entries[0]).toEqual({ name: 'model', value: 'whisper-1', type: 'text' });
      expect(entries[1]).toMatchObject({ name: 'file', type: 'file', filename: 'speech.wav', contentType: 'audio/wav' });
      expect(decode(entries[1].value)).toEqual(Array.from(wav));
    });

    it('relays a ReadableStream body', async () => {
      const req = await relayedRequest('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"model":"gpt-4o"}')); c.close(); } }),
        duplex: 'half',
      } as RequestInit);
      expect(req.body).toBe('{"model":"gpt-4o"}');
      expect(req.bodyEncoding).toBeUndefined();
    });

    it('relays a bare Request input with its method, headers and body', async () => {
      const req = await relayedRequest(new Request('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"model":"gpt-4o"}',
      }));
      expect(req).toMatchObject({
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'content-type': 'application/json' },
        body: '{"model":"gpt-4o"}',
      });
    });
  });

  describe('malformed messages from the client', () => {
    async function connectAndRequest() {
      const clientPromise = server.handleConnection(ws);
      ws.simulateMessage({ type: 'relay:hello', sessionId: 'sess-1', providers: {} });
      const client = await clientPromise;
      const responsePromise = client.createFetch('anthropic')('https://api.anthropic.com/v1/messages');
      await new Promise((r) => setTimeout(r, 10));
      const { requestId } = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      return { responsePromise, requestId };
    }

    it('never throws out of onmessage and keeps the request alive on a bad error message', async () => {
      const { responsePromise, requestId } = await connectAndRequest();

      expect(() => ws.simulateMessage({ type: 'relay:response:error', requestId })).not.toThrow();
      expect(() => ws.simulateMessage({ type: 'relay:response:error', requestId, error: null })).not.toThrow();

      ws.simulateMessage({ type: 'relay:response:error', requestId, error: { code: 'PROXY_ERROR', message: 'real error' } });
      await expect(responsePromise).rejects.toThrow('real error');
    });

    it.each([
      ['status 99', { status: 99, statusText: 'OK', headers: {} }],
      ['status 600', { status: 600, statusText: 'OK', headers: {} }],
      ['a CRLF status text', { status: 200, statusText: 'OK\r\nX-Injected: 1', headers: {} }],
    ])('rejects the fetch on %s', async (_label, meta) => {
      const { responsePromise, requestId } = await connectAndRequest();

      expect(() => ws.simulateMessage({ type: 'relay:response:meta', requestId, ...meta })).not.toThrow();
      await expect(responsePromise).rejects.toMatchObject({ code: 'PROXY_ERROR', message: 'Invalid relay response' });
    });

    it('skips an invalid header name instead of failing', async () => {
      const { responsePromise, requestId } = await connectAndRequest();

      expect(() => ws.simulateMessage({
        type: 'relay:response:meta',
        requestId,
        status: 200,
        statusText: 'OK',
        headers: { 'bad header': 'x', 'content-type': 'application/json' },
      })).not.toThrow();
      ws.simulateMessage({ type: 'relay:response:chunk', requestId, chunk: '{}' });
      ws.simulateMessage({ type: 'relay:response:done', requestId });

      const response = await responsePromise;
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.text()).toBe('{}');
    });

    it('resolves a 204 with an empty body', async () => {
      const { responsePromise, requestId } = await connectAndRequest();

      expect(() => ws.simulateMessage({ type: 'relay:response:meta', requestId, status: 204, statusText: 'No Content', headers: {} })).not.toThrow();
      ws.simulateMessage({ type: 'relay:response:done', requestId });

      const response = await responsePromise;
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    });
  });

  it('rejects pending requests when WebSocket closes', async () => {
    const clientPromise = server.handleConnection(ws);
    ws.simulateMessage({
      type: 'relay:hello',
      sessionId: 'sess-1',
      providers: { anthropic: { available: true, authMethod: 'api_key' } },
    });
    const client = await clientPromise;

    const fetchFn = client.createFetch('anthropic');
    const responsePromise = fetchFn('https://api.anthropic.com/v1/messages');

    ws.close();

    await expect(responsePromise).rejects.toThrow('closed');
  });
});
