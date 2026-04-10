// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Byoky } from '../src/byoky.js';

/**
 * Minimal mock WebSocket that lets us drive the relay pairing flow
 * from the test side.
 */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor(public url: string) {
    // Auto-open on next tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string) { this.sent.push(data); }

  close(_code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
    for (const cb of this.listeners.get('close') ?? []) cb(new Event('close'));
  }

  addEventListener(type: string, cb: (ev: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: (ev: unknown) => void) {
    this.listeners.get(type)?.delete(cb);
  }

  /** Simulate receiving a message from the relay server. */
  _receive(data: Record<string, unknown>) {
    const event = new MessageEvent('message', { data: JSON.stringify(data) });
    this.onmessage?.(event);
    for (const cb of this.listeners.get('message') ?? []) cb(event);
  }
}

// Capture the MockWebSocket instance created by the SDK
let mockWs: MockWebSocket;

describe('relay vault fallback', () => {
  beforeEach(() => {
    // No extension installed — forces relay path
    delete (window as Record<string, unknown>).__byoky__;
    sessionStorage.clear();

    // Mock WebSocket constructor
    vi.stubGlobal('WebSocket', class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        mockWs = this;
      }
    });
    // WebSocket constants needed by SDK
    (globalThis as Record<string, unknown>).WebSocket = Object.assign(
      (globalThis as Record<string, unknown>).WebSocket as object,
      { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 },
    );
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function pairViaRelay(byoky: Byoky): Promise<ReturnType<typeof byoky.connect>> {
    const connectPromise = byoky.connect({
      onPairingReady: () => {},
      useRelay: true,
    });

    // Wait for WebSocket to open and SDK to send relay:auth
    await vi.waitFor(() => expect(mockWs.sent.length).toBeGreaterThan(0));

    // Relay server confirms auth
    mockWs._receive({ type: 'relay:auth:result', success: true });

    // Phone sends pair:hello
    mockWs._receive({
      type: 'relay:pair:hello',
      providers: {
        anthropic: { available: true, authMethod: 'api_key' },
      },
    });

    return connectPromise;
  }

  it('stores vault fallback when relay:vault:offer is received', async () => {
    const byoky = new Byoky();
    const session = await pairViaRelay(byoky);

    // Verify pair:ack was sent
    const ackSent = mockWs.sent.some(m => JSON.parse(m).type === 'relay:pair:ack');
    expect(ackSent).toBe(true);

    // Phone sends vault offer
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    const fakeToken = `${header}.${payload}.sig`;

    mockWs._receive({
      type: 'relay:vault:offer',
      vaultUrl: 'https://vault.byoky.com',
      appSessionToken: fakeToken,
    });

    await new Promise(r => setTimeout(r, 10));

    // Vault session should be saved to sessionStorage
    const stored = sessionStorage.getItem('byoky:vault-session');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.vaultUrl).toBe('https://vault.byoky.com');
    expect(parsed.appSessionToken).toBe(fakeToken);

    session.disconnect();
  });

  it('switches to vault mode when phone goes offline with vault fallback', async () => {
    const byoky = new Byoky();
    const session = await pairViaRelay(byoky);

    const disconnectCb = vi.fn();
    session.onDisconnect(disconnectCb);

    // Phone sends vault offer
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    const fakeToken = `${header}.${payload}.sig`;

    mockWs._receive({
      type: 'relay:vault:offer',
      vaultUrl: 'https://vault.byoky.com',
      appSessionToken: fakeToken,
    });

    await new Promise(r => setTimeout(r, 10));

    // Phone goes offline
    mockWs._receive({ type: 'relay:peer:status', online: false });

    await new Promise(r => setTimeout(r, 10));

    // Session should NOT disconnect
    expect(disconnectCb).not.toHaveBeenCalled();

    // Session should still report connected
    const connected = await session.isConnected();
    expect(connected).toBe(true);

    session.disconnect();
  });

  it('disconnects when phone goes offline WITHOUT vault fallback', async () => {
    const byoky = new Byoky();
    const session = await pairViaRelay(byoky);

    const disconnectCb = vi.fn();
    session.onDisconnect(disconnectCb);

    // Phone goes offline — no vault offer was sent
    mockWs._receive({ type: 'relay:peer:status', online: false });

    await new Promise(r => setTimeout(r, 10));

    // Session SHOULD disconnect
    expect(disconnectCb).toHaveBeenCalledTimes(1);
  });

  it('recovers vault fallback from sessionStorage when offer never arrived', async () => {
    // Simulate a previously saved vault session (from an earlier connection)
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    const fakeToken = `${header}.${payload}.sig`;

    sessionStorage.setItem('byoky:vault-session', JSON.stringify({
      appSessionToken: fakeToken,
      vaultUrl: 'https://vault.byoky.com',
      sessionKey: 'relay_vault_saved',
      proxyUrl: 'https://vault.byoky.com/proxy',
      providers: { anthropic: { available: true, authMethod: 'api_key' } },
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }));

    const byoky = new Byoky();
    const session = await pairViaRelay(byoky);

    const disconnectCb = vi.fn();
    session.onDisconnect(disconnectCb);

    // Phone goes offline — NO vault offer was sent via WebSocket
    mockWs._receive({ type: 'relay:peer:status', online: false });

    await new Promise(r => setTimeout(r, 10));

    // Session should NOT disconnect — it recovered from sessionStorage
    expect(disconnectCb).not.toHaveBeenCalled();

    const connected = await session.isConnected();
    expect(connected).toBe(true);

    session.disconnect();
  });

  it('switches back to relay when phone comes back online', async () => {
    const byoky = new Byoky();
    const session = await pairViaRelay(byoky);

    // Vault offer
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    mockWs._receive({
      type: 'relay:vault:offer',
      vaultUrl: 'https://vault.byoky.com',
      appSessionToken: `${header}.${payload}.sig`,
    });

    await new Promise(r => setTimeout(r, 10));

    // Phone goes offline → vault mode
    mockWs._receive({ type: 'relay:peer:status', online: false });

    // Phone comes back online → relay mode
    mockWs._receive({ type: 'relay:peer:status', online: true });

    await new Promise(r => setTimeout(r, 10));

    // Should still be connected, no disconnect
    const disconnectCb = vi.fn();
    session.onDisconnect(disconnectCb);
    expect(disconnectCb).not.toHaveBeenCalled();

    session.disconnect();
  });

  it('vault fallback uses vault fetch for API calls when phone is offline', async () => {
    const byoky = new Byoky();
    const session = await pairViaRelay(byoky);

    // Vault offer
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    const fakeToken = `${header}.${payload}.sig`;
    mockWs._receive({
      type: 'relay:vault:offer',
      vaultUrl: 'https://vault.test',
      appSessionToken: fakeToken,
    });

    await new Promise(r => setTimeout(r, 10));

    // Phone goes offline
    mockWs._receive({ type: 'relay:peer:status', online: false });
    await new Promise(r => setTimeout(r, 10));

    // Intercept the vault proxy call
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const proxyFetch = session.createFetch('anthropic');
    const res = await proxyFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"model":"claude-sonnet-4-20250514","messages":[]}',
    });

    expect(res.status).toBe(200);

    // Should have called the vault proxy URL, not the Anthropic URL directly
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('https://vault.test/proxy');
    const body = JSON.parse(calledInit!.body as string);
    expect(body.providerId).toBe('anthropic');
    expect(body.url).toBe('https://api.anthropic.com/v1/messages');

    fetchSpy.mockRestore();
    session.disconnect();
  });
});
