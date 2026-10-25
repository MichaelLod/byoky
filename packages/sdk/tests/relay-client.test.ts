// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_RELAY_MESSAGE_SIZE, parseRelayMessage, WS_READY_STATE } from '@byoky/core';

const upstreamBody = vi.hoisted(() => ({ current: '' }));

vi.mock('../src/proxy-fetch.js', () => ({
  createProxyFetch: () => async () => new Response(upstreamBody.current, { status: 200 }),
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
});
