// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Byoky, type ByokySession } from '../src/byoky.js';
import { ByokyError, ByokyErrorCode } from '@byoky/core';

describe('Byoky', () => {
  // Count these (or a filter of them) with .length, not toHaveLength: a
  // failing toHaveLength prints the array, and vitest's formatter overflows
  // its stack on the MessagePorts in it.
  let postedMessages: Array<{ data: Record<string, unknown>; port?: MessagePort }>;

  beforeEach(() => {
    postedMessages = [];
    // Set up the byoky extension marker
    (window as Record<string, unknown>).__byoky__ = {
      version: '0.1.0',
      isByoky: true,
    };
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
    delete (window as Record<string, unknown>).__byoky__;
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('creates an instance with default options', () => {
    const byoky = new Byoky();
    expect(byoky).toBeDefined();
  });

  it('creates an instance with custom timeout', () => {
    const byoky = new Byoky({ timeout: 5000 });
    expect(byoky).toBeDefined();
  });

  it('throws WALLET_NOT_INSTALLED when extension is missing', async () => {
    delete (window as Record<string, unknown>).__byoky__;
    vi.spyOn(window, 'open').mockImplementation(() => null);

    const byoky = new Byoky();

    await expect(byoky.connect()).rejects.toMatchObject({
      code: ByokyErrorCode.WALLET_NOT_INSTALLED,
    });
  });

  it('sends a connect request via postMessage', async () => {
    const byoky = new Byoky();

    const connectPromise = byoky.connect({
      providers: [{ id: 'anthropic', required: true }],
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(postedMessages.length).toBe(1);
    const msg = postedMessages[0].data;
    expect(msg.type).toBe('BYOKY_CONNECT_REQUEST');
    expect((msg.payload as Record<string, unknown>).providers).toEqual([
      { id: 'anthropic', required: true },
    ]);

    // Simulate successful response via MessagePort
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: msg.requestId,
      payload: {
        sessionKey: 'byk_abc123',
        proxyUrl: 'extension-proxy',
        providers: {
          anthropic: { available: true, authMethod: 'oauth' },
        },
      },
    });

    const session = await connectPromise;
    expect(session.sessionKey).toBe('byk_abc123');
    expect(session.providers.anthropic.available).toBe(true);
    expect(typeof session.createFetch).toBe('function');
    expect(typeof session.disconnect).toBe('function');
    expect(typeof session.isConnected).toBe('function');
    expect(typeof session.getUsage).toBe('function');
    expect(typeof session.onDisconnect).toBe('function');
  });

  it('lists every requested provider, marking the ones the wallet left out unavailable', async () => {
    const connectPromise = new Byoky().connect({
      providers: [{ id: 'anthropic', required: true }, { id: 'openai', required: false }],
    });
    await new Promise((r) => setTimeout(r, 10));
    // The mobile wallets list only the providers they hold a key for.
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: postedMessages[0].data.requestId,
      payload: { sessionKey: 'byk_mobile', proxyUrl: 'extension-proxy', providers: { openai: { available: true, authMethod: 'api_key' } } },
    });
    const session = await connectPromise;
    expect(session.providers.anthropic.available).toBe(false);
    expect(session.providers.openai.available).toBe(true);

    const updates: unknown[] = [];
    session.onProvidersUpdated((p) => updates.push(p));
    simulateNotification({
      type: 'BYOKY_PROVIDERS_UPDATED',
      payload: { sessionKey: 'byk_mobile', providers: { gemini: { available: true, authMethod: 'api_key' } } },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(session.providers.anthropic).toEqual({ available: false, authMethod: 'api_key' });
    expect(session.providers.openai).toEqual({ available: false, authMethod: 'api_key' });
    expect(session.providers.gemini.available).toBe(true);
    expect(updates).toEqual([session.providers]);
  });

  it('rejects when user denies connection', async () => {
    const byoky = new Byoky();

    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0].data;
    simulateResponse({
      type: 'BYOKY_ERROR',
      requestId: msg.requestId,
      payload: {
        code: ByokyErrorCode.USER_REJECTED,
        message: 'User rejected',
      },
    });

    await expect(connectPromise).rejects.toMatchObject({
      code: ByokyErrorCode.USER_REJECTED,
    });
  });

  it('reports a code outside ByokyErrorCode as UNKNOWN, keeping the code in details', async () => {
    const connectPromise = new Byoky().connect();
    await new Promise((r) => setTimeout(r, 10));
    simulateResponse({
      type: 'BYOKY_ERROR',
      requestId: postedMessages[0].data.requestId,
      payload: { code: 'SOMETHING_NEW', message: 'A newer wallet said no' },
    });

    const err = await connectPromise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ByokyError);
    expect(err).toMatchObject({ code: ByokyErrorCode.UNKNOWN, message: 'A newer wallet said no', details: { code: 'SOMETHING_NEW' } });
  });

  it('keeps a known code and its retryAfter', async () => {
    const connectPromise = new Byoky().connect();
    await new Promise((r) => setTimeout(r, 10));
    simulateResponse({
      type: 'BYOKY_ERROR',
      requestId: postedMessages[0].data.requestId,
      payload: { code: 'RATE_LIMITED', message: 'Please wait a moment before trying again.', retryAfter: 42 },
    });

    await expect(connectPromise).rejects.toMatchObject({ code: ByokyErrorCode.RATE_LIMITED, details: { retryAfter: 42 } });
  });

  it('getUsage rejects with ByokyErrors, not plain Errors', async () => {
    const connectPromise = new Byoky().connect();
    await new Promise((r) => setTimeout(r, 10));
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: postedMessages[0].data.requestId,
      payload: { sessionKey: 'byk_usage', proxyUrl: 'extension-proxy', providers: {} },
    });
    const session = await connectPromise;

    const missing = session.getUsage();
    await new Promise((r) => setTimeout(r, 10));
    const query = postedMessages.find((m) => m.data.type === 'BYOKY_SESSION_USAGE')!;
    simulateResponse({ type: 'BYOKY_SESSION_USAGE_RESPONSE', requestId: query.data.requestId, payload: null });
    await expect(missing).rejects.toMatchObject({ name: 'ByokyError', code: ByokyErrorCode.NO_SESSION });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const silent = session.getUsage().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await silent).toMatchObject({ name: 'ByokyError', code: ByokyErrorCode.PROXY_ERROR, message: 'Usage query timed out' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out if no response received', async () => {
    const byoky = new Byoky({ timeout: 50 });

    await expect(byoky.connect()).rejects.toMatchObject({
      message: expect.stringContaining('timed out'),
    });
  }, 5000);

  it('session.disconnect sends a disconnect message', async () => {
    const byoky = new Byoky();

    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0].data;
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: msg.requestId,
      payload: {
        sessionKey: 'byk_disconnect_test',
        proxyUrl: 'extension-proxy',
        providers: {},
      },
    });

    const session = await connectPromise;
    session.disconnect();
    // The message target is resolved asynchronously now (the SDK waits for
    // the popup to prove its extension origin before choosing a target), so
    // the postMessage lands a tick after disconnect() returns.
    await new Promise((r) => setTimeout(r, 10));

    const disconnectMsg = postedMessages.find(
      (m) => m.data.type === 'BYOKY_DISCONNECT',
    );
    expect(disconnectMsg).toBeDefined();
    expect(
      (disconnectMsg!.data.payload as Record<string, string>).sessionKey,
    ).toBe('byk_disconnect_test');
    // Older extensions drop a disconnect that has neither a reply port nor
    // an id (content-script.test.ts runs it through the real content script).
    expect(disconnectMsg!.port).toBeDefined();
    expect(typeof disconnectMsg!.data.id).toBe('string');
  });

  it('session.onDisconnect fires when wallet revokes session', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0].data;
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: msg.requestId,
      payload: {
        sessionKey: 'byk_revoke_test',
        proxyUrl: 'extension-proxy',
        providers: {},
      },
    });

    const session = await connectPromise;
    const callback = vi.fn();
    session.onDisconnect(callback);

    // Simulate wallet revoking the session via the notification port
    simulateNotification({
      type: 'BYOKY_SESSION_REVOKED',
      payload: { sessionKey: 'byk_revoke_test' },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('session.onDisconnect fires when Byoky was reloaded, keeping the saved session', async () => {
    const connectPromise = new Byoky().connect();
    await new Promise((r) => setTimeout(r, 10));
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: postedMessages[0].data.requestId,
      payload: { sessionKey: 'byk_reloaded', proxyUrl: 'extension-proxy', providers: {} },
    });
    const session = await connectPromise;
    const callback = vi.fn();
    session.onDisconnect(callback);

    simulateNotification({ type: 'BYOKY_WALLET_RELOADED' });
    await new Promise((r) => setTimeout(r, 10));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('byoky:session')).not.toBeNull();
  });

  describe('notify port release', () => {
    const latest = (type: string) => postedMessages.filter((m) => m.data.type === type).at(-1)!;

    async function connectSession(
      sessionKey: string,
      open: () => Promise<ByokySession | null> = () => new Byoky().connect(),
    ) {
      const connectPromise = open();
      await new Promise((r) => setTimeout(r, 10));
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: latest('BYOKY_CONNECT_REQUEST').data.requestId,
        payload: { sessionKey, proxyUrl: 'extension-proxy', providers: { anthropic: { available: true, authMethod: 'api_key' } } },
      });
      const session = (await connectPromise)!;
      await new Promise((r) => setTimeout(r, 10));
      // What the content script receives on its end of the notify port.
      const received: unknown[] = [];
      const notifyPort = latest('BYOKY_REGISTER_NOTIFY').port!;
      notifyPort.onmessage = (e) => received.push(e.data);
      return { session, received };
    }

    const unregister = { type: 'BYOKY_UNREGISTER_NOTIFY' };

    it('unregisters on disconnect()', async () => {
      const { session, received } = await connectSession('byk_n1');
      session.disconnect();
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toEqual([unregister]);
    });

    it('unregisters the previous session when the same instance connects again', async () => {
      const byoky = new Byoky();
      const first = await connectSession('byk_n4', () => byoky.connect());
      const second = await connectSession('byk_n4', () => byoky.tryReconnect());
      expect(first.received).toEqual([unregister]);
      expect(second.received).toEqual([]);

      const third = await connectSession('byk_n4', () => byoky.connect());
      expect(second.received).toEqual([unregister]);

      // Disconnecting a replaced session leaves the live one registered.
      first.session.disconnect();
      second.session.disconnect();
      await new Promise((r) => setTimeout(r, 10));
      expect(third.received).toEqual([]);
      third.session.disconnect();
      await new Promise((r) => setTimeout(r, 10));
      expect(third.received).toEqual([unregister]);
      expect(first.received).toEqual([unregister]);
    });

    it('unregisters when the wallet revokes the session', async () => {
      const { received } = await connectSession('byk_n2');
      simulateNotification({ type: 'BYOKY_SESSION_REVOKED', payload: { sessionKey: 'byk_n2' } });
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toEqual([unregister]);
    });

    it('unregisters when reconnecting fails for good', async () => {
      const { session, received } = await connectSession('byk_n3');
      void session.createFetch('anthropic')('https://api.anthropic.com/v1/messages');
      await new Promise((r) => setTimeout(r, 10));
      const proxy = postedMessages.find((m) => m.data.type === 'BYOKY_PROXY_REQUEST')!;
      proxy.port!.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR', requestId: proxy.data.requestId, status: 401,
        error: { code: 'SESSION_EXPIRED', message: 'expired' },
      });
      await new Promise((r) => setTimeout(r, 10));
      const reconnect = postedMessages.filter((m) => m.data.type === 'BYOKY_CONNECT_REQUEST')[1];
      reconnect.port!.postMessage({
        type: 'BYOKY_ERROR', requestId: reconnect.data.requestId,
        payload: { code: 'USER_REJECTED', message: 'no' },
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toEqual([unregister]);
    });
  });

  it('session.onDisconnect returns an unsubscribe function', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0].data;
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: msg.requestId,
      payload: {
        sessionKey: 'byk_unsub_test',
        proxyUrl: 'extension-proxy',
        providers: {},
      },
    });

    const session = await connectPromise;
    const callback = vi.fn();
    const unsub = session.onDisconnect(callback);
    unsub();

    simulateNotification({
      type: 'BYOKY_SESSION_REVOKED',
      payload: { sessionKey: 'byk_unsub_test' },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(callback).not.toHaveBeenCalled();
  });

  it('session.isConnected sends a status query', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0].data;
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: msg.requestId,
      payload: {
        sessionKey: 'byk_status_test',
        proxyUrl: 'extension-proxy',
        providers: {},
      },
    });

    const session = await connectPromise;
    const statusPromise = session.isConnected();

    await new Promise((r) => setTimeout(r, 10));

    // Find the status request
    const statusEntry = postedMessages.find(
      (m) => m.data.type === 'BYOKY_SESSION_STATUS',
    );
    expect(statusEntry).toBeDefined();

    simulateResponse({
      type: 'BYOKY_SESSION_STATUS_RESPONSE',
      requestId: statusEntry!.data.requestId,
      payload: { connected: true },
    });

    expect(await statusPromise).toBe(true);
  });

  it('session.onDisconnect ignores revocations for other sessions', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0].data;
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: msg.requestId,
      payload: {
        sessionKey: 'byk_mine',
        proxyUrl: 'extension-proxy',
        providers: {},
      },
    });

    const session = await connectPromise;
    const callback = vi.fn();
    session.onDisconnect(callback);

    simulateNotification({
      type: 'BYOKY_SESSION_REVOKED',
      payload: { sessionKey: 'byk_other' },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(callback).not.toHaveBeenCalled();
  });

  it('auto-reconnects on SESSION_EXPIRED and retries the request', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const connectMsg = postedMessages[0].data;
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: connectMsg.requestId,
      payload: {
        sessionKey: 'byk_old',
        proxyUrl: 'extension-proxy',
        providers: { anthropic: { available: true, authMethod: 'api_key' as const } },
      },
    });

    const session = await connectPromise;
    const anthropicFetch = session.createFetch('anthropic');

    // Make a request that will get SESSION_EXPIRED
    const fetchPromise = anthropicFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{"model":"claude-sonnet-4-20250514"}',
    });

    await new Promise((r) => setTimeout(r, 10));

    // Find the proxy request
    const proxyMsg = postedMessages.find((m) => m.data.type === 'BYOKY_PROXY_REQUEST');
    expect(proxyMsg).toBeDefined();
    expect(proxyMsg!.data.sessionKey).toBe('byk_old');

    // Respond with SESSION_EXPIRED
    proxyMsg!.port!.postMessage({
      type: 'BYOKY_PROXY_RESPONSE_ERROR',
      requestId: proxyMsg!.data.requestId,
      status: 401,
      error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' },
    });

    await new Promise((r) => setTimeout(r, 10));

    // SDK should have sent a reconnectOnly connect request
    const reconnectMsg = postedMessages.find(
      (m) => m.data.type === 'BYOKY_CONNECT_REQUEST' && m.data !== connectMsg,
    );
    expect(reconnectMsg).toBeDefined();
    expect((reconnectMsg!.data.payload as Record<string, unknown>).reconnectOnly).toBe(true);

    // Respond with a new session
    reconnectMsg!.port!.postMessage({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: reconnectMsg!.data.requestId,
      payload: {
        sessionKey: 'byk_new',
        proxyUrl: 'extension-proxy',
        providers: { anthropic: { available: true, authMethod: 'api_key' as const } },
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    // SDK should have retried the proxy request with the new session key
    const retryMsg = postedMessages.find(
      (m) => m.data.type === 'BYOKY_PROXY_REQUEST' && m.data.sessionKey === 'byk_new',
    );
    expect(retryMsg).toBeDefined();

    // Respond with success
    retryMsg!.port!.postMessage({
      type: 'BYOKY_PROXY_RESPONSE_META',
      requestId: retryMsg!.data.requestId,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
    retryMsg!.port!.postMessage({
      type: 'BYOKY_PROXY_RESPONSE_CHUNK',
      requestId: retryMsg!.data.requestId,
      chunk: '{"ok":true}',
    });
    retryMsg!.port!.postMessage({
      type: 'BYOKY_PROXY_RESPONSE_DONE',
      requestId: retryMsg!.data.requestId,
    });

    const response = await fetchPromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(session.sessionKey).toBe('byk_new');
  });

  it('fires onDisconnect when auto-reconnect fails', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const connectMsg = postedMessages[0].data;
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: connectMsg.requestId,
      payload: {
        sessionKey: 'byk_dead',
        proxyUrl: 'extension-proxy',
        providers: { anthropic: { available: true, authMethod: 'api_key' as const } },
      },
    });

    const session = await connectPromise;
    const disconnectCb = vi.fn();
    session.onDisconnect(disconnectCb);

    const anthropicFetch = session.createFetch('anthropic');
    const fetchPromise = anthropicFetch('https://api.anthropic.com/v1/messages');

    await new Promise((r) => setTimeout(r, 10));

    const proxyMsg = postedMessages.find((m) => m.data.type === 'BYOKY_PROXY_REQUEST');
    proxyMsg!.port!.postMessage({
      type: 'BYOKY_PROXY_RESPONSE_ERROR',
      requestId: proxyMsg!.data.requestId,
      status: 401,
      error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' },
    });

    await new Promise((r) => setTimeout(r, 10));

    // Fail the reconnect attempt
    const reconnectMsg = postedMessages.find(
      (m) => m.data.type === 'BYOKY_CONNECT_REQUEST' && m.data !== connectMsg,
    );
    reconnectMsg!.port!.postMessage({
      type: 'BYOKY_ERROR',
      requestId: reconnectMsg!.data.requestId,
      payload: { code: 'NO_SESSION', message: 'No active session' },
    });

    await new Promise((r) => setTimeout(r, 10));

    // NO_SESSION falls back to a full connect; the user rejects that too
    const fullConnectMsg = postedMessages.find(
      (m) => m.data.type === 'BYOKY_CONNECT_REQUEST' && m.data !== connectMsg && m.data !== reconnectMsg!.data,
    );
    expect((fullConnectMsg!.data.payload as Record<string, unknown>).reconnectOnly).toBeUndefined();
    fullConnectMsg!.port!.postMessage({
      type: 'BYOKY_ERROR',
      requestId: fullConnectMsg!.data.requestId,
      payload: { code: 'USER_REJECTED', message: 'User rejected the connection request' },
    });

    const response = await fetchPromise;
    expect(response.status).toBe(401);
    expect(disconnectCb).toHaveBeenCalledTimes(1);
  });

  describe('abort while the session is renewed', () => {
    const tick = () => new Promise((r) => setTimeout(r, 10));
    const ofType = (type: string) => postedMessages.filter((m) => m.data.type === type);
    const answer = (entry: { data: Record<string, unknown>; port?: MessagePort }, msg: Record<string, unknown>) =>
      entry.port!.postMessage({ ...msg, requestId: entry.data.requestId });

    /** A request whose session the wallet dropped (locked); the wallet now waits for the user. */
    async function waitingForUser(signal: AbortSignal, options?: { timeout?: number }) {
      const connectPromise = new Byoky(options).connect({ providers: [{ id: 'anthropic' }] });
      await tick();
      answer(ofType('BYOKY_CONNECT_REQUEST')[0], {
        type: 'BYOKY_CONNECT_RESPONSE',
        payload: { sessionKey: 'byk_locked', proxyUrl: 'extension-proxy', providers: { anthropic: { available: true, authMethod: 'api_key' } } },
      });
      const session = await connectPromise;

      let settled: string | null = null;
      const fetchPromise = session.createFetch('anthropic')('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}', signal });
      fetchPromise.then((r) => { settled = `resolved:${r.status}`; }, (e: unknown) => { settled = `rejected:${(e as Error)?.name}`; });
      await tick();
      answer(ofType('BYOKY_PROXY_REQUEST')[0], {
        type: 'BYOKY_PROXY_RESPONSE_ERROR', status: 401,
        error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' },
      });
      await tick();
      answer(ofType('BYOKY_CONNECT_REQUEST')[1], { type: 'BYOKY_ERROR', payload: { code: 'NO_SESSION', message: 'No active session' } });
      await tick();
      expect(ofType('BYOKY_CONNECT_REQUEST').length).toBe(3);
      expect(settled).toBeNull();
      return { session, fetchPromise, settled: () => settled };
    }

    it('rejects with an AbortError at once, and sends nothing once the user approves', async () => {
      const controller = new AbortController();
      const { session, fetchPromise, settled } = await waitingForUser(controller.signal);

      controller.abort();
      await tick();
      expect(settled()).toBe('rejected:AbortError');
      await expect(fetchPromise).rejects.toMatchObject({ name: 'AbortError' });

      // The renewal still finishes, for the session's other requests.
      answer(ofType('BYOKY_CONNECT_REQUEST')[2], {
        type: 'BYOKY_CONNECT_RESPONSE',
        payload: { sessionKey: 'byk_renewed', proxyUrl: 'extension-proxy', providers: { anthropic: { available: true, authMethod: 'api_key' } } },
      });
      await tick();
      expect(session.sessionKey).toBe('byk_renewed');
      expect(ofType('BYOKY_PROXY_REQUEST').length).toBe(1);
    });

    it('rejects with an AbortError, not the 401, when the renewal then fails', async () => {
      const controller = new AbortController();
      const { fetchPromise } = await waitingForUser(controller.signal, { timeout: 200 });

      controller.abort();
      // The connect times out after the abort.
      await new Promise((r) => setTimeout(r, 250));
      await expect(fetchPromise).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects with the reason the signal was aborted with', async () => {
      const controller = new AbortController();
      const { fetchPromise } = await waitingForUser(controller.signal);

      const reason = new Error('user pressed stop');
      controller.abort(reason);
      await expect(fetchPromise).rejects.toBe(reason);
    });
  });

  it('passes requestTimeout to the session fetch', async () => {
    const connectPromise = new Byoky({ requestTimeout: 50 }).connect();
    await new Promise((r) => setTimeout(r, 10));
    simulateResponse({
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: postedMessages[0].data.requestId,
      payload: { sessionKey: 'byk_rt', proxyUrl: 'extension-proxy', providers: {} },
    });
    const session = await connectPromise;

    await expect(session.createFetch('openai')('https://api.openai.com/v1/models'))
      .rejects.toMatchObject({ code: ByokyErrorCode.PROXY_ERROR, message: expect.stringContaining('timed out') });
  });

  describe('createRelay', () => {
    class MockWebSocket {
      static last: MockWebSocket;
      readyState = 0;
      sent: string[] = [];
      onopen: ((e: unknown) => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose: ((e: { code: number; reason: string }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor(public url: string) { MockWebSocket.last = this; }
      send(data: string) { this.sent.push(data); }
      close() { this.readyState = 3; }
      open() { this.readyState = 1; this.onopen?.({}); }
    }

    beforeEach(() => { vi.stubGlobal('WebSocket', MockWebSocket); });
    afterEach(() => { vi.unstubAllGlobals(); });

    const tick = () => new Promise((r) => setTimeout(r, 10));
    const proxyRequests = () => postedMessages.filter((m) => m.data.type === 'BYOKY_PROXY_REQUEST');
    const connectRequests = () => postedMessages.filter((m) => m.data.type === 'BYOKY_CONNECT_REQUEST');

    function relayRequest(ws: MockWebSocket, requestId: string) {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'relay:request', requestId, providerId: 'openai',
          url: 'https://api.openai.com/v1/chat/completions', method: 'POST', headers: {}, body: '{}',
        }),
      });
    }

    function answerOk(entry: { data: Record<string, unknown>; port?: MessagePort }) {
      entry.port!.postMessage({ type: 'BYOKY_PROXY_RESPONSE_META', requestId: entry.data.requestId, status: 200, statusText: 'OK', headers: {} });
      entry.port!.postMessage({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId: entry.data.requestId });
    }

    it('reconnects on SESSION_EXPIRED and keeps using the live session key', async () => {
      const connectPromise = new Byoky().connect({ providers: [{ id: 'openai', required: true }] });
      await tick();
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: connectRequests()[0].data.requestId,
        payload: { sessionKey: 'byk_old', proxyUrl: 'extension-proxy', providers: { openai: { available: true, authMethod: 'api_key' } } },
      });
      const session = await connectPromise;

      const relay = session.createRelay('ws://localhost:3001/ws/relay');
      const ws = MockWebSocket.last;
      ws.open();
      expect(ws.sent[0]).not.toContain('byk_old');

      // The wallet locked: the old key is dead.
      relayRequest(ws, 'relay-1');
      await tick();
      const first = proxyRequests()[0];
      expect(first.data.sessionKey).toBe('byk_old');
      first.port!.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: first.data.requestId,
        status: 401,
        error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' },
      });
      await tick();

      expect(connectRequests().length).toBe(2);
      const reconnect = connectRequests()[1];
      reconnect.port!.postMessage({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: reconnect.data.requestId,
        payload: { sessionKey: 'byk_new', proxyUrl: 'extension-proxy', providers: { openai: { available: true, authMethod: 'api_key' } } },
      });
      await tick();

      const retry = proxyRequests()[1];
      expect(retry.data.sessionKey).toBe('byk_new');
      answerOk(retry);
      await tick();
      expect(ws.sent.map((m) => JSON.parse(m)).find((m) => m.type === 'relay:response:meta' && m.requestId === 'relay-1'))
        .toMatchObject({ status: 200 });

      // The next relayed request goes out with the new key straight away.
      relayRequest(ws, 'relay-2');
      await tick();
      expect(proxyRequests()[2].data.sessionKey).toBe('byk_new');
      expect(connectRequests().length).toBe(2);
      relay.close();
    });

    it('is closed by session.disconnect(), and a disconnected session opens none', async () => {
      const connectPromise = new Byoky().connect({ providers: [{ id: 'openai', required: true }] });
      await tick();
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: connectRequests()[0].data.requestId,
        payload: { sessionKey: 'byk_relay', proxyUrl: 'extension-proxy', providers: { openai: { available: true, authMethod: 'api_key' } } },
      });
      const session = await connectPromise;
      const relay = session.createRelay('ws://localhost:3001/ws/relay');
      const ws = MockWebSocket.last;
      ws.open();
      const onClose = vi.fn();
      relay.onClose(onClose);

      session.disconnect();
      expect(ws.readyState).toBe(3);
      expect(relay.status).toBe('disconnected');
      expect(onClose).toHaveBeenCalledTimes(1);

      // A request the backend still sends goes nowhere.
      relayRequest(ws, 'relay-late');
      await tick();
      expect(proxyRequests().length).toBe(0);
      expect(connectRequests().length).toBe(1);

      expect(() => session.createRelay('ws://localhost:3001/ws/relay'))
        .toThrow(expect.objectContaining({ code: ByokyErrorCode.NO_SESSION }));
    });
  });

  describe('after session.disconnect()', () => {
    const tick = () => new Promise((r) => setTimeout(r, 10));
    const ofType = (type: string) => postedMessages.filter((m) => m.data.type === type);
    const answer = (entry: { data: Record<string, unknown>; port?: MessagePort }, msg: Record<string, unknown>) =>
      entry.port!.postMessage({ ...msg, requestId: entry.data.requestId });
    const expired = { type: 'BYOKY_PROXY_RESPONSE_ERROR', status: 401, error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' } };
    const granted = (sessionKey: string) => ({
      type: 'BYOKY_CONNECT_RESPONSE',
      payload: { sessionKey, proxyUrl: 'extension-proxy', providers: { anthropic: { available: true, authMethod: 'api_key' } } },
    });

    async function connected() {
      const connectPromise = new Byoky().connect({ providers: [{ id: 'anthropic' }] });
      await tick();
      answer(ofType('BYOKY_CONNECT_REQUEST')[0], granted('byk_ended'));
      return connectPromise;
    }

    it('rejects its fetches with NO_SESSION and sends nothing to the wallet', async () => {
      const session = await connected();
      const fetchFn = session.createFetch('anthropic');
      session.disconnect();

      await expect(fetchFn('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' }))
        .rejects.toMatchObject({ name: 'ByokyError', code: ByokyErrorCode.NO_SESSION });
      await expect(session.createFetch('anthropic')('https://api.anthropic.com/v1/models'))
        .rejects.toMatchObject({ code: ByokyErrorCode.NO_SESSION });
      await tick();
      expect(ofType('BYOKY_PROXY_REQUEST').length).toBe(0);
      expect(ofType('BYOKY_CONNECT_REQUEST').length).toBe(1);
      expect(ofType('BYOKY_DISCONNECT').length).toBe(1);

      // A second disconnect() sends nothing more.
      session.disconnect();
      await tick();
      expect(ofType('BYOKY_DISCONNECT').length).toBe(1);
    });

    it('does not renew it for a request that was already on its way', async () => {
      const session = await connected();
      const fetchPromise = session.createFetch('anthropic')('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
      await tick();
      session.disconnect();
      answer(ofType('BYOKY_PROXY_REQUEST')[0], expired);

      expect((await fetchPromise).status).toBe(401);
      await tick();
      expect(ofType('BYOKY_CONNECT_REQUEST').length).toBe(1);
    });

    it('drops a renewal the wallet answers after it', async () => {
      const session = await connected();
      const onUpdate = vi.fn();
      session.onProvidersUpdated(onUpdate);
      const fetchPromise = session.createFetch('anthropic')('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
      await tick();
      answer(ofType('BYOKY_PROXY_REQUEST')[0], expired);
      await tick();
      answer(ofType('BYOKY_CONNECT_REQUEST')[1], { type: 'BYOKY_ERROR', payload: { code: 'NO_SESSION', message: 'No active session' } });
      await tick();
      // The wallet now asks the user; the app disconnects meanwhile, and the user approves.
      session.disconnect();
      answer(ofType('BYOKY_CONNECT_REQUEST')[2], granted('byk_revived'));

      expect((await fetchPromise).status).toBe(401);
      expect(session.sessionKey).toBe('byk_ended');
      expect(onUpdate).not.toHaveBeenCalled();
      expect(sessionStorage.getItem('byoky:session')).toBeNull();
      expect(ofType('BYOKY_PROXY_REQUEST').length).toBe(1);
    });
  });

  describe('createFetch bodies', () => {
    async function connectSession(sessionKey: string) {
      const connectPromise = new Byoky().connect();
      await new Promise((r) => setTimeout(r, 10));
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: postedMessages[0].data.requestId,
        payload: {
          sessionKey,
          proxyUrl: 'extension-proxy',
          providers: { openai: { available: true, authMethod: 'api_key' as const } },
        },
      });
      return connectPromise;
    }

    function proxyRequests() {
      return postedMessages.filter((m) => m.data.type === 'BYOKY_PROXY_REQUEST');
    }

    it('sends a binary stream body as exact base64, not lossy text', async () => {
      const session = await connectSession('byk_stream');
      const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xff, 0xfe, 0x00, 0x80]);

      void session.createFetch('openai')('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 5)); c.enqueue(bytes.slice(5)); c.close(); } }),
        duplex: 'half',
      } as RequestInit);
      await new Promise((r) => setTimeout(r, 10));

      const [req] = proxyRequests();
      expect(req.data.bodyEncoding).toBe('base64');
      expect(Array.from(atob(req.data.body as string), (c) => c.charCodeAt(0))).toEqual(Array.from(bytes));
    });

    it('resends a Request input with its body after reconnecting', async () => {
      const session = await connectSession('byk_req_old');

      const fetchPromise = session.createFetch('openai')(new Request('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"model":"gpt-4o"}',
      }));
      await new Promise((r) => setTimeout(r, 10));

      const [first] = proxyRequests();
      expect(first.data).toMatchObject({ method: 'POST', body: '{"model":"gpt-4o"}', sessionKey: 'byk_req_old' });
      first.port!.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: first.data.requestId,
        status: 401,
        error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' },
      });
      await new Promise((r) => setTimeout(r, 10));

      const reconnect = postedMessages.filter((m) => m.data.type === 'BYOKY_CONNECT_REQUEST')[1];
      reconnect.port!.postMessage({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: reconnect.data.requestId,
        payload: { sessionKey: 'byk_req_new', proxyUrl: 'extension-proxy', providers: {} },
      });
      await new Promise((r) => setTimeout(r, 10));

      const retry = proxyRequests()[1];
      expect(retry.data).toMatchObject({ method: 'POST', body: '{"model":"gpt-4o"}', sessionKey: 'byk_req_new' });
      retry.port!.postMessage({ type: 'BYOKY_PROXY_RESPONSE_META', requestId: retry.data.requestId, status: 200, statusText: 'OK', headers: {} });
      retry.port!.postMessage({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId: retry.data.requestId });
      expect((await fetchPromise).status).toBe(200);
    });
  });

  describe('session persistence', () => {
    it('persists session to sessionStorage on connect', async () => {
      const byoky = new Byoky();
      const connectPromise = byoky.connect();

      await new Promise((r) => setTimeout(r, 10));

      const msg = postedMessages[0].data;
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: msg.requestId,
        payload: {
          sessionKey: 'byk_persist_test',
          proxyUrl: 'extension-proxy',
          providers: { anthropic: { available: true, authMethod: 'api_key' as const } },
        },
      });

      await connectPromise;

      const stored = sessionStorage.getItem('byoky:session');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.sessionKey).toBe('byk_persist_test');
    });

    it('clears sessionStorage on disconnect', async () => {
      const byoky = new Byoky();
      const connectPromise = byoky.connect();

      await new Promise((r) => setTimeout(r, 10));

      const msg = postedMessages[0].data;
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: msg.requestId,
        payload: {
          sessionKey: 'byk_clear_test',
          proxyUrl: 'extension-proxy',
          providers: {},
        },
      });

      const session = await connectPromise;
      expect(sessionStorage.getItem('byoky:session')).not.toBeNull();

      session.disconnect();
      expect(sessionStorage.getItem('byoky:session')).toBeNull();
    });

    it('clears sessionStorage on session revocation', async () => {
      const byoky = new Byoky();
      const connectPromise = byoky.connect();

      await new Promise((r) => setTimeout(r, 10));

      const msg = postedMessages[0].data;
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: msg.requestId,
        payload: {
          sessionKey: 'byk_revoke_persist',
          proxyUrl: 'extension-proxy',
          providers: {},
        },
      });

      await connectPromise;
      expect(sessionStorage.getItem('byoky:session')).not.toBeNull();

      simulateNotification({
        type: 'BYOKY_SESSION_REVOKED',
        payload: { sessionKey: 'byk_revoke_persist' },
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(sessionStorage.getItem('byoky:session')).toBeNull();
    });

    it('tryReconnect returns null when no session exists', async () => {
      const byoky = new Byoky({ timeout: 100 });
      const reconnectPromise = byoky.tryReconnect();

      await new Promise((r) => setTimeout(r, 10));

      // Respond to the reconnectOnly request with NO_SESSION
      const msg = postedMessages.find(
        (m) => m.data.type === 'BYOKY_CONNECT_REQUEST',
      );
      if (msg) {
        msg.port!.postMessage({
          type: 'BYOKY_ERROR',
          requestId: msg.data.requestId,
          payload: { code: 'NO_SESSION', message: 'No active session' },
        });
      }

      const result = await reconnectPromise;
      expect(result).toBeNull();
    });

    it('tryReconnect restores from extension reconnectOnly', async () => {
      const byoky = new Byoky();
      const reconnectPromise = byoky.tryReconnect();

      await new Promise((r) => setTimeout(r, 10));

      const msg = postedMessages.find(
        (m) => m.data.type === 'BYOKY_CONNECT_REQUEST',
      );
      expect(msg).toBeDefined();
      expect((msg!.data.payload as Record<string, unknown>).reconnectOnly).toBe(true);

      msg!.port!.postMessage({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: msg!.data.requestId,
        payload: {
          sessionKey: 'byk_reconnected',
          proxyUrl: 'extension-proxy',
          providers: { openai: { available: true, authMethod: 'api_key' as const } },
        },
      });

      const session = await reconnectPromise;
      expect(session).not.toBeNull();
      expect(session!.sessionKey).toBe('byk_reconnected');
      expect(sessionStorage.getItem('byoky:session')).not.toBeNull();
    });

    it('tryReconnect returns null without a wallet and posts nothing', async () => {
      delete (window as Record<string, unknown>).__byoky__;
      const byoky = new Byoky({ timeout: 100 });

      const result = await byoky.tryReconnect();

      expect(result).toBeNull();
      expect(postedMessages.length).toBe(0);
    });

    it('updates sessionStorage on auto-reconnect', async () => {
      const byoky = new Byoky();
      const connectPromise = byoky.connect();

      await new Promise((r) => setTimeout(r, 10));

      const connectMsg = postedMessages[0].data;
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: connectMsg.requestId,
        payload: {
          sessionKey: 'byk_old_key',
          proxyUrl: 'extension-proxy',
          providers: { anthropic: { available: true, authMethod: 'api_key' as const } },
        },
      });

      const session = await connectPromise;
      const anthropicFetch = session.createFetch('anthropic');

      // Make a request that gets SESSION_EXPIRED
      const fetchPromise = anthropicFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{"model":"claude-sonnet-4-20250514"}',
      });

      await new Promise((r) => setTimeout(r, 10));

      const proxyMsg = postedMessages.find((m) => m.data.type === 'BYOKY_PROXY_REQUEST');
      proxyMsg!.port!.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: proxyMsg!.data.requestId,
        status: 401,
        error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' },
      });

      await new Promise((r) => setTimeout(r, 10));

      // Respond to reconnect with new session
      const reconnectMsg = postedMessages.find(
        (m) => m.data.type === 'BYOKY_CONNECT_REQUEST' && m.data !== connectMsg,
      );
      reconnectMsg!.port!.postMessage({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: reconnectMsg!.data.requestId,
        payload: {
          sessionKey: 'byk_new_key',
          proxyUrl: 'extension-proxy',
          providers: { anthropic: { available: true, authMethod: 'api_key' as const } },
        },
      });

      await new Promise((r) => setTimeout(r, 10));

      // Complete the retried request
      const retryMsg = postedMessages.find(
        (m) => m.data.type === 'BYOKY_PROXY_REQUEST' && m.data.sessionKey === 'byk_new_key',
      );
      retryMsg!.port!.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_META',
        requestId: retryMsg!.data.requestId,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      });
      retryMsg!.port!.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_CHUNK',
        requestId: retryMsg!.data.requestId,
        chunk: '{"ok":true}',
      });
      retryMsg!.port!.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_DONE',
        requestId: retryMsg!.data.requestId,
      });

      await fetchPromise;

      // sessionStorage should now have the new key
      const stored = JSON.parse(sessionStorage.getItem('byoky:session')!);
      expect(stored.sessionKey).toBe('byk_new_key');
    });
  });

  // A page reload: a new Byoky instance restores the session that one
  // connected before, with only sessionStorage carried over.
  describe('restored sessions', () => {
    const tick = () => new Promise((r) => setTimeout(r, 10));
    const ofType = (type: string) => postedMessages.filter((m) => m.data.type === type);
    const answer = (entry: { data: Record<string, unknown>; port?: MessagePort }, msg: Record<string, unknown>) =>
      entry.port!.postMessage({ ...msg, requestId: entry.data.requestId });
    const connected = (sessionKey: string, providers: Record<string, unknown>) =>
      ({ type: 'BYOKY_CONNECT_RESPONSE', payload: { sessionKey, proxyUrl: 'extension-proxy', providers } });
    const api = { available: true, authMethod: 'api_key' };
    const fullConnects = () => ofType('BYOKY_CONNECT_REQUEST')
      .filter((m) => !(m.data.payload as Record<string, unknown>).reconnectOnly);

    async function connectThenReload(providers: Array<{ id: string; required?: boolean }>, granted: Record<string, unknown>) {
      const first = new Byoky().connect({ providers });
      await tick();
      answer(ofType('BYOKY_CONNECT_REQUEST')[0], connected('byk_page1', granted));
      await first;
      postedMessages.length = 0;
    }

    /** The wallet locked: the next request finds the session gone, and so does the probe. */
    async function lockAndRequest(session: ByokySession) {
      const onDisconnect = vi.fn();
      session.onDisconnect(onDisconnect);
      const fetchPromise = session.createFetch('anthropic')('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
      await tick();
      answer(ofType('BYOKY_PROXY_REQUEST')[0], {
        type: 'BYOKY_PROXY_RESPONSE_ERROR', status: 401,
        error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' },
      });
      await tick();
      const probe = ofType('BYOKY_CONNECT_REQUEST').at(-1)!;
      expect(probe.data.payload).toEqual({ reconnectOnly: true });
      answer(probe, { type: 'BYOKY_ERROR', payload: { code: 'NO_SESSION', message: 'No active session' } });
      await tick();
      return { fetchPromise, onDisconnect };
    }

    async function approveAndFinish(fetchPromise: Promise<Response>) {
      answer(ofType('BYOKY_CONNECT_REQUEST').at(-1)!, connected('byk_renewed', { anthropic: api }));
      await tick();
      const retry = ofType('BYOKY_PROXY_REQUEST')[1];
      expect(retry.data.sessionKey).toBe('byk_renewed');
      answer(retry, { type: 'BYOKY_PROXY_RESPONSE_META', status: 200, statusText: 'OK', headers: {} });
      answer(retry, { type: 'BYOKY_PROXY_RESPONSE_DONE' });
      return fetchPromise;
    }

    it('connects again with the original request when tryReconnect\'s session finds the wallet locked', async () => {
      await connectThenReload([{ id: 'anthropic', required: true }, { id: 'openai' }], { anthropic: api, openai: api });

      const restoring = new Byoky().tryReconnect();
      await tick();
      answer(ofType('BYOKY_CONNECT_REQUEST')[0], connected('byk_page1', { anthropic: api, openai: api }));
      const session = (await restoring)!;

      const { fetchPromise, onDisconnect } = await lockAndRequest(session);
      const full = fullConnects();
      expect(full.length).toBe(1);
      expect(full[0].data.payload).toEqual({ providers: [{ id: 'anthropic', required: true }, { id: 'openai' }] });

      expect((await approveAndFinish(fetchPromise)).status).toBe(200);
      expect(onDisconnect).not.toHaveBeenCalled();
      expect(session.sessionKey).toBe('byk_renewed');
      expect(JSON.parse(sessionStorage.getItem('byoky:session')!).sessionKey).toBe('byk_renewed');
    });

    it('connects again for the providers a session from reconnect(saved) has', async () => {
      // Saved by the app itself, in another tab: no request in this tab's sessionStorage.
      const saved = { sessionKey: 'byk_saved', proxyUrl: 'extension-proxy', providers: { anthropic: api } };

      const restoring = new Byoky().reconnect(saved as never);
      await tick();
      answer(ofType('BYOKY_SESSION_STATUS')[0], { type: 'BYOKY_SESSION_STATUS_RESPONSE', payload: { connected: true } });
      const session = (await restoring)!;

      const { fetchPromise, onDisconnect } = await lockAndRequest(session);
      const full = fullConnects();
      expect(full.length).toBe(1);
      expect(full[0].data.payload).toEqual({ providers: [{ id: 'anthropic' }] });

      expect((await approveAndFinish(fetchPromise)).status).toBe(200);
      expect(onDisconnect).not.toHaveBeenCalled();
    });

    it('lists a requested provider the wallet left out of the restored session as unavailable', async () => {
      await connectThenReload([{ id: 'anthropic', required: true }, { id: 'openai' }], { openai: api });

      const restoring = new Byoky().tryReconnect();
      await tick();
      // The mobile wallets answer a probe with the providers they hold keys for.
      answer(ofType('BYOKY_CONNECT_REQUEST')[0], connected('byk_page1', { openai: api }));
      const session = (await restoring)!;

      expect(session.providers.anthropic).toEqual({ available: false, authMethod: 'api_key' });
      expect(session.providers.openai.available).toBe(true);
    });

    it('forgets the request on disconnect()', async () => {
      await connectThenReload([{ id: 'anthropic' }], { anthropic: api });
      expect(JSON.parse(sessionStorage.getItem('byoky:request')!)).toEqual({ providers: [{ id: 'anthropic' }] });

      const restoring = new Byoky().tryReconnect();
      await tick();
      answer(ofType('BYOKY_CONNECT_REQUEST')[0], connected('byk_page1', { anthropic: api }));
      (await restoring)!.disconnect();

      expect(sessionStorage.getItem('byoky:session')).toBeNull();
      expect(sessionStorage.getItem('byoky:request')).toBeNull();
    });
  });

  describe('connect modal', () => {
    function modalCard(): HTMLElement | null {
      for (const el of Array.from(document.body.children)) {
        const card = el.shadowRoot?.querySelector('.card');
        if (card) return card as HTMLElement;
      }
      return null;
    }

    function clickButton(label: string) {
      const btn = Array.from(modalCard()!.querySelectorAll('button'))
        .find((b) => b.textContent === label);
      expect(btn).toBeDefined();
      btn!.click();
    }

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('shows install guidance without a wallet and rejects with WALLET_NOT_INSTALLED on cancel', async () => {
      delete (window as Record<string, unknown>).__byoky__;
      const byoky = new Byoky();

      const connectPromise = byoky.connect({ modal: true });

      expect(modalCard()!.textContent).toContain('Byoky wallet not found');
      expect(postedMessages.length).toBe(0);

      clickButton('Cancel');
      await expect(connectPromise).rejects.toMatchObject({
        code: ByokyErrorCode.WALLET_NOT_INSTALLED,
      });
      expect(modalCard()).toBeNull();
    });

    it('connects once the wallet is detected on recheck', async () => {
      delete (window as Record<string, unknown>).__byoky__;
      const byoky = new Byoky();

      const connectPromise = byoky.connect({ modal: true });

      clickButton('I\'ve installed it');
      expect(modalCard()!.textContent).toContain('reload this page');
      expect(postedMessages.length).toBe(0);

      (window as Record<string, unknown>).__byoky__ = { isByoky: true };
      clickButton('I\'ve installed it');
      await new Promise((r) => setTimeout(r, 10));

      const connectMsg = postedMessages.find((m) => m.data.type === 'BYOKY_CONNECT_REQUEST');
      expect(connectMsg).toBeDefined();
      simulateResponse({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: connectMsg!.data.requestId,
        payload: {
          sessionKey: 'byk_modal',
          proxyUrl: 'extension-proxy',
          providers: { anthropic: { available: true, authMethod: 'api_key' as const } },
        },
      });

      const session = await connectPromise;
      expect(session.sessionKey).toBe('byk_modal');
    });
  });

  function simulateResponse(data: Record<string, unknown>) {
    const entry = postedMessages.find(
      (m) => m.data.requestId === data.requestId,
    );
    entry?.port?.postMessage(data);
  }

  function simulateNotification(data: Record<string, unknown>) {
    const notifyEntry = postedMessages.find(
      (m) => m.data.type === 'BYOKY_REGISTER_NOTIFY',
    );
    notifyEntry?.port?.postMessage(data);
  }
});
