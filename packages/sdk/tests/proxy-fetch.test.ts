// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProxyFetch } from '../src/proxy-fetch.js';

describe('createProxyFetch', () => {
  let postedMessages: Array<{ data: Record<string, unknown>; port?: MessagePort }>;

  beforeEach(() => {
    postedMessages = [];
    // Intercept postMessage to capture outgoing messages and transferred ports
    vi.spyOn(window, 'postMessage').mockImplementation(
      (...args: unknown[]) => {
        const data = args[0] as Record<string, unknown>;
        const transfer = args[2] as Transferable[] | undefined;
        const port = transfer?.[0] as MessagePort | undefined;
        postedMessages.push({ data, port });
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const proxyFetch = createProxyFetch('anthropic', { current: 'byk_test' });
    expect(typeof proxyFetch).toBe('function');
  });

  it('posts a BYOKY_PROXY_REQUEST message', async () => {
    const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });

    const fetchPromise = proxyFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514' }),
    });

    // Wait a tick for the async body reading
    await new Promise((r) => setTimeout(r, 10));

    expect(postedMessages.length).toBe(1);
    const msg = postedMessages[0].data;
    expect(msg.type).toBe('BYOKY_PROXY_REQUEST');
    expect(msg.providerId).toBe('anthropic');
    expect(msg.sessionKey).toBe('byk_session');
    expect(msg.method).toBe('POST');
    expect(msg.url).toBe('https://api.anthropic.com/v1/messages');

    const requestId = msg.requestId as string;

    // Simulate response from extension via MessagePort
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_META',
      requestId,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_CHUNK',
      requestId,
      chunk: '{"content":"Hello!"}',
    });
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_DONE',
      requestId,
    });

    const response = await fetchPromise;
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toBe('{"content":"Hello!"}');
  });

  it('handles error responses', async () => {
    const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });

    const fetchPromise = proxyFetch('https://api.openai.com/v1/chat/completions');

    await new Promise((r) => setTimeout(r, 10));

    const requestId = postedMessages[0].data.requestId as string;
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_ERROR',
      requestId,
      status: 401,
      error: { code: 'INVALID_KEY', message: 'Invalid API key' },
    });

    const response = await fetchPromise;
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe('INVALID_KEY');
  });

  it('handles streaming chunks', async () => {
    const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });

    const fetchPromise = proxyFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{"stream":true}',
    });

    await new Promise((r) => setTimeout(r, 10));

    const requestId = postedMessages[0].data.requestId as string;

    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_META',
      requestId,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/event-stream' },
    });

    const response = await fetchPromise;
    expect(response.status).toBe(200);

    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_CHUNK',
      requestId,
      chunk: 'data: {"type":"content"}',
    });
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_CHUNK',
      requestId,
      chunk: '\ndata: {"type":"done"}',
    });
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_DONE',
      requestId,
    });

    const text = await response.text();
    expect(text).toBe('data: {"type":"content"}\ndata: {"type":"done"}');
  });

  it('ignores messages for other request ids', async () => {
    const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });

    const fetchPromise = proxyFetch('https://api.anthropic.com/v1/messages');

    await new Promise((r) => setTimeout(r, 10));

    const port = postedMessages[0].port!;

    // Message for a different request — should be ignored
    port.postMessage({
      type: 'BYOKY_PROXY_RESPONSE_META',
      requestId: 'other-id',
      status: 500,
      statusText: 'Error',
      headers: {},
    });

    const requestId = postedMessages[0].data.requestId as string;
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_META',
      requestId,
      status: 201,
      statusText: 'Created',
      headers: {},
    });
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_DONE',
      requestId,
    });

    const response = await fetchPromise;
    expect(response.status).toBe(201);
  });

  function simulateResponse(data: Record<string, unknown>) {
    const entry = postedMessages.find(
      (m) => m.data.requestId === data.requestId,
    );
    entry?.port?.postMessage(data);
  }
});
