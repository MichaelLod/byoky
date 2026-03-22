// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Byoky } from '../src/byoky.js';
import { ByokyErrorCode } from '@byoky/core';

describe('Byoky', () => {
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

    const disconnectMsg = postedMessages.find(
      (m) => m.data.type === 'BYOKY_DISCONNECT',
    );
    expect(disconnectMsg).toBeDefined();
    expect(
      (disconnectMsg!.data.payload as Record<string, string>).sessionKey,
    ).toBe('byk_disconnect_test');
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
