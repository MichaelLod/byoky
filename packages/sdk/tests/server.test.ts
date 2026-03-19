// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ByokyServer } from '../src/server.js';
import type { WebSocketLike } from '@byoky/core';
import { WS_READY_STATE } from '@byoky/core';

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
