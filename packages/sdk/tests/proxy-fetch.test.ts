// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProxyFetch } from '../src/proxy-fetch.js';

describe('createProxyFetch', () => {
  // Count these (or a filter of them) with .length, not toHaveLength: a
  // failing toHaveLength prints the array, and vitest's formatter overflows
  // its stack on the MessagePorts in it.
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

  it('errors the body when the request fails after the headers', async () => {
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
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_CHUNK',
      requestId,
      chunk: 'data: {"type":"content"}',
    });
    simulateResponse({
      type: 'BYOKY_PROXY_RESPONSE_ERROR',
      requestId,
      status: 500,
      error: { code: 'PROXY_ERROR', message: 'Extension disconnected' },
    });

    const response = await fetchPromise;
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toMatchObject({
      code: 'PROXY_ERROR',
      message: 'Extension disconnected',
    });
  });

  it('errors the body with UNKNOWN for a code outside ByokyErrorCode, keeping the code', async () => {
    const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
    const fetchPromise = proxyFetch('https://api.openai.com/v1/chat/completions');
    await new Promise((r) => setTimeout(r, 10));
    const requestId = postedMessages[0].data.requestId as string;

    simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_META', requestId, status: 200, statusText: 'OK', headers: {} });
    simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_ERROR', requestId, status: 502, error: { code: 'INVALID_JSON', message: 'bad upstream JSON' } });

    const response = await fetchPromise;
    await expect(response.text()).rejects.toMatchObject({
      name: 'ByokyError', code: 'UNKNOWN', message: 'bad upstream JSON', details: { code: 'INVALID_JSON' },
    });
  });

  describe('fetch compatibility', () => {
    async function sentRequest() {
      await new Promise((r) => setTimeout(r, 10));
      return postedMessages[0].data;
    }

    it('reads method, headers and body from a bare Request input', async () => {
      const proxyFetch = createProxyFetch('mistral', { current: 'byk_session' });
      void proxyFetch(new Request('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-trace': '1' },
        body: '{"model":"mistral-small"}',
      }));

      const msg = await sentRequest();
      expect(msg.method).toBe('POST');
      expect(msg.headers).toMatchObject({ 'content-type': 'application/json', 'x-trace': '1' });
      expect(msg.body).toBe('{"model":"mistral-small"}');
      expect(msg.bodyEncoding).toBeUndefined();
    });

    it('lets init override a Request input, as fetch does', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      void proxyFetch(new Request('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{"a":1}' }), {
        body: '{"b":2}',
        headers: { 'content-type': 'application/json' },
      });

      const msg = await sentRequest();
      expect(msg.method).toBe('POST');
      expect(msg.body).toBe('{"b":2}');
      expect(msg.headers).toEqual({ 'content-type': 'application/json' });
    });

    it('honours the signal of a Request input', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      const controller = new AbortController();
      controller.abort();
      await expect(proxyFetch(new Request('https://api.openai.com/v1/models', { signal: controller.signal })))
        .rejects.toMatchObject({ name: 'AbortError' });
    });

    it('sends a Uint8Array JSON body as text', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      void proxyFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode('{"model":"gpt-4o"}'),
      });

      const msg = await sentRequest();
      expect(msg.body).toBe('{"model":"gpt-4o"}');
      expect(msg.bodyEncoding).toBeUndefined();
    });

    it('sends a binary DataView body as exact base64', async () => {
      const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xff, 0xfe, 0x00, 0x80]);
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      void proxyFetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: new DataView(bytes.buffer, 0, bytes.length),
      });

      const msg = await sentRequest();
      expect(msg.bodyEncoding).toBe('base64');
      expect(Array.from(atob(msg.body as string), (c) => c.charCodeAt(0))).toEqual(Array.from(bytes));
    });

    it('sends text-typed bytes that are not valid UTF-8 as base64 instead of mangling them', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      void proxyFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: new Uint8Array([0x7b, 0xff, 0x7d]),
      });

      const msg = await sentRequest();
      expect(msg.bodyEncoding).toBe('base64');
      expect(msg.body).toBe(btoa('\x7b\xff\x7d'));
    });

    it('sets the content type fetch would for URLSearchParams and typed Blob bodies', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      void proxyFetch('https://api.openai.com/v1/a', { method: 'POST', body: new URLSearchParams({ a: '1' }) });
      void proxyFetch('https://api.openai.com/v1/b', { method: 'POST', body: new Blob(['{}'], { type: 'application/json' }) });
      void proxyFetch('https://api.openai.com/v1/c', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: new URLSearchParams({ a: '1' }),
      });
      await new Promise((r) => setTimeout(r, 10));

      const byUrl = (path: string) => postedMessages.find((m) => m.data.url === `https://api.openai.com/v1/${path}`)!.data;
      const [a, b, c] = ['a', 'b', 'c'].map(byUrl);
      expect(a).toMatchObject({ body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' } });
      expect(b).toMatchObject({ body: '{}', headers: { 'content-type': 'application/json' } });
      expect(c).toMatchObject({ body: 'a=1', headers: { 'content-type': 'text/plain' } });
    });

    it('rejects a body type fetch would not take instead of dropping it', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      await expect(proxyFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: { model: 'gpt-4o' } as unknown as BodyInit,
      })).rejects.toMatchObject({ code: 'PROXY_ERROR' });
      expect(postedMessages.length).toBe(0);
    });

    it('resolves a 204 with an empty body', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      const fetchPromise = proxyFetch('https://api.openai.com/v1/chat/completions');
      const msg = await sentRequest();

      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_META', requestId: msg.requestId, status: 204, statusText: 'No Content', headers: {} });
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId: msg.requestId });

      const response = await fetchPromise;
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
    });

    it('rejects instead of hanging when the response cannot be built', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      const fetchPromise = proxyFetch('https://api.openai.com/v1/chat/completions');
      const msg = await sentRequest();

      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_META', requestId: msg.requestId, status: 99, statusText: 'x', headers: {} });

      await expect(fetchPromise).rejects.toMatchObject({ code: 'PROXY_ERROR' });
    });
  });

  describe('binary responses', () => {
    const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    // An MP3 frame header: every frame starts with the 0xFF sync byte,
    // which can never appear in UTF-8.
    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x0f, 0xf0, 0x00]);
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

    it.each([
      ['bytes 0..255', allBytes],
      ['an MP3 frame header', mp3],
    ])('passes %s through byte-exact', async (_label, bytes) => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      const fetchPromise = proxyFetch('https://api.openai.com/v1/audio/speech', { method: 'POST', body: '{}' });
      await new Promise((r) => setTimeout(r, 10));
      const requestId = postedMessages[0].data.requestId as string;

      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_META', requestId, status: 200, statusText: 'OK', headers: { 'content-type': 'audio/mpeg' } });
      // Split at an odd offset: each chunk is base64 of its own bytes.
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId, chunk: b64(bytes.slice(0, 5)), chunkEncoding: 'base64' });
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId, chunk: b64(bytes.slice(5)), chunkEncoding: 'base64' });
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId });

      const response = await fetchPromise;
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });

    it('rejects instead of hanging on a bad chunk before the headers', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      const fetchPromise = proxyFetch('https://api.openai.com/v1/audio/speech', { method: 'POST', body: '{}' });
      await new Promise((r) => setTimeout(r, 10));
      const requestId = postedMessages[0].data.requestId as string;

      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId, chunk: '%%%', chunkEncoding: 'base64' });

      await expect(fetchPromise).rejects.toMatchObject({ code: 'PROXY_ERROR' });
      await new Promise((r) => setTimeout(r, 10));
      expect(postedMessages.filter((m) => m.data.type === 'BYOKY_PROXY_CANCEL').length).toBe(1);
    });

    it('rejects instead of hanging on a done before the headers', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      let state = 'pending';
      const fetchPromise = proxyFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{}' });
      fetchPromise.catch(() => {}).finally(() => { state = 'settled'; });
      await new Promise((r) => setTimeout(r, 10));
      const requestId = postedMessages[0].data.requestId as string;

      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId });
      await new Promise((r) => setTimeout(r, 10));
      expect(state).toBe('settled');
      await expect(fetchPromise).rejects.toMatchObject({ code: 'PROXY_ERROR', message: 'Invalid response from the wallet' });
    });

    it('errors the body on a chunk that is not base64', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      const fetchPromise = proxyFetch('https://api.openai.com/v1/audio/speech', { method: 'POST', body: '{}' });
      await new Promise((r) => setTimeout(r, 10));
      const requestId = postedMessages[0].data.requestId as string;

      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_META', requestId, status: 200, statusText: 'OK', headers: { 'content-type': 'audio/mpeg' } });
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId, chunk: '%%%', chunkEncoding: 'base64' });

      const response = await fetchPromise;
      await expect(response.arrayBuffer()).rejects.toMatchObject({ code: 'PROXY_ERROR' });
    });
  });

  describe('header timeout', () => {
    // Port messages travel on the real event loop; only setTimeout is faked.
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
    afterEach(() => { vi.useRealTimers(); });

    function cancels() {
      return postedMessages.filter((m) => m.data.type === 'BYOKY_PROXY_CANCEL');
    }

    it.each([
      ['130 s', 130_000],
      ['9 minutes', 9 * 60_000],
    ])('waits for headers that take %s (a slow non-streaming generation)', async (_label, delay) => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      let state = 'pending';
      const fetchPromise = proxyFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{"model":"o3"}' });
      fetchPromise.then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
      await settle();
      const requestId = postedMessages[0].data.requestId as string;

      await vi.advanceTimersByTimeAsync(delay);
      expect(state).toBe('pending');
      expect(cancels().length).toBe(0);

      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_META', requestId, status: 200, statusText: 'OK', headers: {} });
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId, chunk: '{"ok":true}' });
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId });
      await settle();

      expect(state).toBe('resolved');
      expect(await (await fetchPromise).json()).toEqual({ ok: true });
      // One upstream request: nothing was cancelled, so nothing retries.
      expect(postedMessages.filter((m) => m.data.type === 'BYOKY_PROXY_REQUEST').length).toBe(1);
    });

    it('gives up after 10 minutes with a ByokyError and cancels the request', async () => {
      const proxyFetch = createProxyFetch('openai', { current: 'byk_session' });
      const fetchPromise = proxyFetch('https://api.openai.com/v1/chat/completions');
      const outcome = fetchPromise.catch((err: unknown) => err);
      await settle();

      await vi.advanceTimersByTimeAsync(600_000);
      const err = await outcome;
      expect(err).toMatchObject({ name: 'ByokyError', code: 'PROXY_ERROR', message: expect.stringContaining('reload the page') });
      await settle();
      expect(cancels().length).toBe(1);
    });

    it('takes its timeout from the options, and 0 waits forever', async () => {
      const short = createProxyFetch('openai', { current: 'byk_session' }, { timeout: 5_000 });
      const shortOutcome = short('https://api.openai.com/v1/models').catch((err: unknown) => err);
      const never = createProxyFetch('openai', { current: 'byk_session' }, { timeout: 0 });
      let neverState = 'pending';
      never('https://api.openai.com/v1/models').then(() => { neverState = 'settled'; }, () => { neverState = 'settled'; });
      await settle();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(await shortOutcome).toMatchObject({ code: 'PROXY_ERROR' });
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(neverState).toBe('pending');
    });
  });

  describe('abort signal', () => {
    function cancelMessages() {
      return postedMessages.filter((m) => m.data.type === 'BYOKY_PROXY_CANCEL');
    }

    it('rejects at once when the signal is already aborted', async () => {
      const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });
      const controller = new AbortController();
      controller.abort();

      await expect(
        proxyFetch('https://api.anthropic.com/v1/messages', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      await new Promise((r) => setTimeout(r, 10));
      expect(postedMessages.length).toBe(0);
    });

    it('rejects and cancels when aborted before the headers', async () => {
      const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });
      const controller = new AbortController();

      const fetchPromise = proxyFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      });

      await new Promise((r) => setTimeout(r, 10));
      const requestId = postedMessages[0].data.requestId as string;

      controller.abort();
      await expect(fetchPromise).rejects.toMatchObject({ name: 'AbortError' });

      await new Promise((r) => setTimeout(r, 10));
      expect(cancelMessages().map((m) => m.data)).toEqual([
        { type: 'BYOKY_PROXY_CANCEL', requestId },
      ]);
    });

    it('rejects with the reason the signal was aborted with', async () => {
      const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });
      const controller = new AbortController();

      const fetchPromise = proxyFetch('https://api.anthropic.com/v1/messages', {
        signal: controller.signal,
      });

      await new Promise((r) => setTimeout(r, 10));
      const reason = new Error('user left the page');
      controller.abort(reason);

      await expect(fetchPromise).rejects.toBe(reason);
    });

    it('errors the body and cancels when aborted mid-stream', async () => {
      const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });
      const controller = new AbortController();

      const fetchPromise = proxyFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{"stream":true}',
        signal: controller.signal,
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
      simulateResponse({
        type: 'BYOKY_PROXY_RESPONSE_CHUNK',
        requestId,
        chunk: 'data: {"type":"content"}',
      });

      const response = await fetchPromise;
      controller.abort();

      await expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
      await new Promise((r) => setTimeout(r, 10));
      expect(cancelMessages().map((m) => m.data)).toEqual([
        { type: 'BYOKY_PROXY_CANCEL', requestId },
      ]);
    });

    it('does nothing once the response is complete', async () => {
      const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });
      const controller = new AbortController();

      const fetchPromise = proxyFetch('https://api.anthropic.com/v1/messages', {
        signal: controller.signal,
      });

      await new Promise((r) => setTimeout(r, 10));
      const requestId = postedMessages[0].data.requestId as string;

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
        chunk: '{"ok":true}',
      });
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId });

      const response = await fetchPromise;
      await new Promise((r) => setTimeout(r, 10));
      controller.abort();

      expect(await response.json()).toEqual({ ok: true });
      await new Promise((r) => setTimeout(r, 10));
      expect(cancelMessages().length).toBe(0);
    });
  });

  // As with fetch, an app that stops reading the body stops the request.
  describe('body cancel', () => {
    const tick = () => new Promise((r) => setTimeout(r, 10));
    const cancelMessages = () => postedMessages.filter((m) => m.data.type === 'BYOKY_PROXY_CANCEL');

    async function streaming(signal?: AbortSignal) {
      const proxyFetch = createProxyFetch('anthropic', { current: 'byk_session' });
      const fetchPromise = proxyFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{"stream":true}', signal });
      await tick();
      const requestId = postedMessages[0].data.requestId as string;
      simulateResponse({
        type: 'BYOKY_PROXY_RESPONSE_META', requestId, status: 200, statusText: 'OK',
        headers: { 'content-type': 'text/event-stream' },
      });
      const chunk = (n: number) => simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId, chunk: `data: ${n}\n\n` });
      return { response: await fetchPromise, requestId, chunk };
    }

    it('cancels the request once when the app cancels the body', async () => {
      const controller = new AbortController();
      const { response, requestId } = await streaming(controller.signal);

      await response.body!.cancel();
      await tick();
      expect(cancelMessages().map((m) => m.data)).toEqual([{ type: 'BYOKY_PROXY_CANCEL', requestId }]);

      // The abort listener is gone: a later abort sends nothing more.
      controller.abort();
      await tick();
      expect(cancelMessages().length).toBe(1);
    });

    it('cancels the request when the reader is cancelled mid-stream, and ignores later chunks', async () => {
      const { response, requestId, chunk } = await streaming();
      const reader = response.body!.getReader();
      chunk(1);
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: 1\n\n');

      await reader.cancel();
      await tick();
      expect(cancelMessages().map((m) => m.data)).toEqual([{ type: 'BYOKY_PROXY_CANCEL', requestId }]);
      expect(() => chunk(2)).not.toThrow();
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId });
      await tick();
      expect(cancelMessages().length).toBe(1);
    });

    it('cancels the request when a for-await loop over the body ends early', async () => {
      const { response, requestId, chunk } = await streaming();
      chunk(1);
      chunk(2);
      for await (const value of response.body as unknown as AsyncIterable<Uint8Array>) {
        expect(new TextDecoder().decode(value)).toBe('data: 1\n\n');
        break;
      }
      await tick();
      expect(cancelMessages().map((m) => m.data)).toEqual([{ type: 'BYOKY_PROXY_CANCEL', requestId }]);
    });

    it('sends nothing for a body cancelled after the response finished', async () => {
      const { response, requestId, chunk } = await streaming();
      chunk(1);
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId });
      await tick();
      await response.body!.cancel();
      await tick();
      expect(cancelMessages().length).toBe(0);
    });

    it('sends nothing when the wallet fails the request after the headers', async () => {
      const { response, requestId } = await streaming();
      simulateResponse({ type: 'BYOKY_PROXY_RESPONSE_ERROR', requestId, status: 500, error: { code: 'PROXY_ERROR', message: 'upstream died' } });
      await expect(response.text()).rejects.toMatchObject({ code: 'PROXY_ERROR' });
      await tick();
      expect(cancelMessages().length).toBe(0);
    });
  });

  function simulateResponse(data: Record<string, unknown>) {
    const entry = postedMessages.find(
      (m) => m.data.requestId === data.requestId,
    );
    entry?.port?.postMessage(data);
  }
});
