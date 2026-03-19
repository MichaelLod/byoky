// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Byoky } from '../src/byoky.js';
import { ByokyErrorCode } from '@byoky/core';

describe('Byoky', () => {
  let postedMessages: Array<Record<string, unknown>>;

  beforeEach(() => {
    postedMessages = [];
    // Set up the byoky extension marker
    (window as Record<string, unknown>).__byoky__ = {
      version: '0.1.0',
      isByoky: true,
    };
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      postedMessages.push(data as Record<string, unknown>);
    });
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
    const msg = postedMessages[0];
    expect(msg.type).toBe('BYOKY_CONNECT_REQUEST');
    expect((msg.payload as Record<string, unknown>).providers).toEqual([
      { id: 'anthropic', required: true },
    ]);

    // Simulate successful response
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

    const msg = postedMessages[0];
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

    const msg = postedMessages[0];
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

    expect(postedMessages.length).toBe(2);
    const disconnectMsg = postedMessages[1];
    expect(disconnectMsg.type).toBe('BYOKY_DISCONNECT');
    expect(
      (disconnectMsg.payload as Record<string, string>).sessionKey,
    ).toBe('byk_disconnect_test');
  });

  it('session.onDisconnect fires when wallet revokes session', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0];
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

    // Simulate wallet revoking the session
    simulateResponse({
      type: 'BYOKY_SESSION_REVOKED',
      payload: { sessionKey: 'byk_revoke_test' },
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('session.onDisconnect returns an unsubscribe function', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0];
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

    simulateResponse({
      type: 'BYOKY_SESSION_REVOKED',
      payload: { sessionKey: 'byk_unsub_test' },
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('session.isConnected sends a status query', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0];
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
    const statusMsg = postedMessages.find(
      (m) => m.type === 'BYOKY_SESSION_STATUS',
    );
    expect(statusMsg).toBeDefined();

    simulateResponse({
      type: 'BYOKY_SESSION_STATUS_RESPONSE',
      requestId: statusMsg!.requestId,
      payload: { connected: true },
    });

    expect(await statusPromise).toBe(true);
  });

  it('session.onDisconnect ignores revocations for other sessions', async () => {
    const byoky = new Byoky();
    const connectPromise = byoky.connect();

    await new Promise((r) => setTimeout(r, 10));

    const msg = postedMessages[0];
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

    simulateResponse({
      type: 'BYOKY_SESSION_REVOKED',
      payload: { sessionKey: 'byk_other' },
    });

    expect(callback).not.toHaveBeenCalled();
  });

  function simulateResponse(data: Record<string, unknown>) {
    document.dispatchEvent(new CustomEvent('byoky-message', { detail: data }));
  }
});
