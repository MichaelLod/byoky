// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { Byoky } from '../src/byoky.js';

// Runs the SDK against the extension's real content script, with a fake
// browser.runtime standing in for the background. The two sides are only
// ever tested apart otherwise, which is how a disconnect the content script
// dropped went unnoticed.

type Listener = (...args: unknown[]) => void;

class FakePort {
  posted: Array<Record<string, unknown>> = [];
  disconnected = false;
  private messageListeners: Listener[] = [];
  private disconnectListeners: Listener[] = [];
  onMessage = { addListener: (fn: Listener) => { this.messageListeners.push(fn); } };
  onDisconnect = { addListener: (fn: Listener) => { this.disconnectListeners.push(fn); } };

  constructor(readonly name: string) {}

  postMessage(msg: Record<string, unknown>) { this.posted.push(msg); }
  disconnect() { this.disconnected = true; }

  /** The background sends a message on this port. */
  emit(msg: unknown) {
    for (const fn of this.messageListeners) fn(msg, this);
  }

  /** The background end goes away (worker shutdown, extension reload). */
  drop() {
    this.disconnected = true;
    for (const fn of this.disconnectListeners) fn(this);
  }
}

type ContentListener = (event: { source: unknown; data: unknown; ports: unknown[] }) => void;

/** The content script's end of a MessagePort an SDK registered or replies on. */
function fakeSdkPort() {
  const port = {
    postMessage: vi.fn(),
    close: vi.fn(),
    onmessage: null as ((e: { data: unknown }) => void) | null,
    closeListeners: [] as Array<() => void>,
    addEventListener(type: string, fn: () => void) { if (type === 'close') port.closeListeners.push(fn); },
    /** The SDK posts on its end. */
    fromSdk(data: unknown) { port.onmessage?.({ data }); },
  };
  return port;
}

describe('SDK ↔ content script', () => {
  let contentScript: { main(): void };
  let ports: FakePort[];
  let runtime: { id: string | undefined; connect(info: { name: string }): FakePort };

  beforeAll(async () => {
    vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
    contentScript = (await import('../../extension/entrypoints/content.ts')).default;
  });

  beforeEach(() => {
    ports = [];
    runtime = {
      id: 'test-extension-id',
      connect({ name }) {
        const port = new FakePort(name);
        ports.push(port);
        return port;
      },
    };
    vi.stubGlobal('browser', { runtime });
    (window as unknown as Record<string, unknown>).__byoky__ = { isByoky: true };
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__byoky__;
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  /** Starts a content script and returns its window message listener. */
  function startContentScript(): ContentListener {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    contentScript.main();
    const call = addEventListener.mock.calls.find(([type]) => type === 'message');
    addEventListener.mockRestore();
    return call![1] as unknown as ContentListener;
  }

  function portsNamed(name: string) {
    return ports.filter((p) => p.name === name);
  }

  const tick = () => new Promise((r) => setTimeout(r, 10));

  describe('with the SDK', () => {
    beforeEach(() => {
      const listener = startContentScript();
      // Deliver the SDK's window.postMessage calls to the content script the
      // way a browser does: as a task, from this window, with the ports.
      vi.spyOn(window, 'postMessage').mockImplementation((...args: unknown[]) => {
        const [data, , transfer] = args as [unknown, string, unknown[] | undefined];
        setTimeout(() => listener({ source: window, data, ports: transfer ?? [] }), 0);
      });
    });

    async function connect(sessionKey: string) {
      const pending = new Byoky().connect();
      await tick();
      const port = portsNamed('byoky-message')[0];
      port.emit({
        type: 'BYOKY_CONNECT_RESPONSE',
        requestId: port.posted[0].requestId,
        payload: {
          sessionKey,
          proxyUrl: 'extension-proxy',
          providers: { anthropic: { available: true, authMethod: 'api_key' } },
        },
      });
      return pending;
    }

    it('session.disconnect() reaches the background', async () => {
      const session = await connect('byk_live');

      session.disconnect();
      await tick();

      const sent = portsNamed('byoky-message').flatMap((p) => p.posted);
      expect(sent).toContainEqual(expect.objectContaining({
        type: 'BYOKY_DISCONNECT',
        payload: { sessionKey: 'byk_live' },
      }));
    });

    it('aborting a request closes its proxy port without an error reply', async () => {
      const session = await connect('byk_abort');
      const controller = new AbortController();

      const pending = session.createFetch('anthropic')('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      });
      await tick();

      const proxyPort = portsNamed('byoky-proxy')[0];
      expect(proxyPort.posted[0]).toMatchObject({ type: 'BYOKY_PROXY_REQUEST', sessionKey: 'byk_abort' });

      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await tick();
      expect(proxyPort.disconnected).toBe(true);
    });

    it('session.disconnect() closes the notify connection, so the worker can sleep', async () => {
      const session = await connect('byk_notify');
      await tick();
      const notify = portsNamed('byoky-notify')[0];
      expect(notify.disconnected).toBe(false);

      session.disconnect();
      await tick();
      expect(notify.disconnected).toBe(true);
    });

    it('passes base64 response chunks through to the app byte-exact', async () => {
      const session = await connect('byk_audio');
      const pending = session.createFetch('anthropic')('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
      await tick();

      const proxyPort = portsNamed('byoky-proxy')[0];
      const requestId = proxyPort.posted[0].requestId;
      const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x80]);
      proxyPort.emit({ type: 'BYOKY_PROXY_RESPONSE_META', requestId, status: 200, statusText: 'OK', headers: { 'content-type': 'audio/mpeg' } });
      proxyPort.emit({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId, chunk: btoa(String.fromCharCode(...bytes)), chunkEncoding: 'base64' });
      proxyPort.emit({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId });

      const response = await pending;
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });

    it('a dropped proxy port after the headers fails the body', async () => {
      const session = await connect('byk_drop');

      const pending = session.createFetch('anthropic')('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{"stream":true}',
      });
      await tick();

      const proxyPort = portsNamed('byoky-proxy')[0];
      const requestId = proxyPort.posted[0].requestId;
      proxyPort.emit({
        type: 'BYOKY_PROXY_RESPONSE_META',
        requestId,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/event-stream' },
      });
      proxyPort.emit({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId, chunk: 'data: {}\n\n' });
      const response = await pending;

      proxyPort.drop();
      await expect(response.text()).rejects.toMatchObject({ message: 'Extension disconnected' });
    });
  });

  describe('after an extension update (orphaned content script)', () => {
    // Chrome leaves the old content script running in open tabs, cut off:
    // runtime.id is gone and runtime.connect() throws.
    function orphan(how: 'no-id' | 'throws') {
      if (how === 'no-id') runtime.id = undefined;
      runtime.connect = () => { throw new Error('Extension context invalidated.'); };
    }

    function send(listener: ContentListener, data: Record<string, unknown>) {
      const replyPort = fakeSdkPort();
      expect(() => listener({ source: window, data, ports: [replyPort] })).not.toThrow();
      return replyPort.postMessage.mock.calls.map(([msg]) => msg);
    }

    it.each(['no-id', 'throws'] as const)('answers every request at once (%s)', (how) => {
      const listener = startContentScript();
      orphan(how);

      expect(send(listener, {
        type: 'BYOKY_PROXY_REQUEST', requestId: 'p1', sessionKey: 'byk', providerId: 'openai', url: 'https://api.openai.com/v1/models', method: 'GET',
      })).toEqual([{
        type: 'BYOKY_PROXY_RESPONSE_ERROR', requestId: 'p1', status: 503,
        error: { code: 'WALLET_RELOADED', message: 'Byoky was updated. Reload this page.' },
      }]);
      expect(send(listener, { type: 'BYOKY_CONNECT_REQUEST', id: 'c1', requestId: 'c1', payload: {} })).toEqual([{
        type: 'BYOKY_ERROR', requestId: 'c1',
        payload: { code: 'WALLET_RELOADED', message: 'Byoky was updated. Reload this page.' },
      }]);
      expect(send(listener, { type: 'BYOKY_SESSION_USAGE', requestId: 'u1', payload: { sessionKey: 'byk' } }))
        .toMatchObject([{ type: 'BYOKY_ERROR', requestId: 'u1', payload: { code: 'WALLET_RELOADED' } }]);
      expect(send(listener, { type: 'BYOKY_SESSION_STATUS', requestId: 's1', payload: { sessionKey: 'byk' } }))
        .toEqual([{ type: 'BYOKY_SESSION_STATUS_RESPONSE', requestId: 's1', payload: { connected: false } }]);
      expect(send(listener, { type: 'BYOKY_DISCONNECT', id: 'd1', requestId: 'd1', payload: { sessionKey: 'byk' } })).toEqual([]);
    });

    it('tells registered SDKs when the notify port drops for good', () => {
      const listener = startContentScript();
      const sdkPort = fakeSdkPort();
      listener({ source: window, data: { type: 'BYOKY_REGISTER_NOTIFY' }, ports: [sdkPort] });

      orphan('no-id');
      portsNamed('byoky-notify')[0].drop();
      expect(sdkPort.postMessage).toHaveBeenCalledWith({ type: 'BYOKY_WALLET_RELOADED' });
    });

    describe('with the SDK', () => {
      beforeEach(() => {
        const listener = startContentScript();
        vi.spyOn(window, 'postMessage').mockImplementation((...args: unknown[]) => {
          const [data, , transfer] = args as [unknown, string, unknown[] | undefined];
          setTimeout(() => listener({ source: window, data, ports: transfer ?? [] }), 0);
        });
      });

      it('connect() rejects at once with WALLET_RELOADED', async () => {
        orphan('no-id');
        const started = Date.now();
        await expect(new Byoky().connect()).rejects.toMatchObject({
          code: 'WALLET_RELOADED',
          message: 'Byoky was updated. Reload this page.',
        });
        expect(Date.now() - started).toBeLessThan(1000);
      });

      it('a call answers 503 WALLET_RELOADED at once and ends the session', async () => {
        const pending = new Byoky().connect();
        await tick();
        const port = portsNamed('byoky-message')[0];
        port.emit({
          type: 'BYOKY_CONNECT_RESPONSE',
          requestId: port.posted[0].requestId,
          payload: { sessionKey: 'byk_live', proxyUrl: 'extension-proxy', providers: {} },
        });
        const session = await pending;
        const onDisconnect = vi.fn();
        session.onDisconnect(onDisconnect);

        orphan('throws');
        const response = await session.createFetch('openai')('https://api.openai.com/v1/models');
        expect(response.status).toBe(503);
        expect((await response.json()).error.code).toBe('WALLET_RELOADED');
        expect(onDisconnect).toHaveBeenCalledTimes(1);
        // No reconnect attempt: only the original connect went out.
        expect(portsNamed('byoky-message')).toHaveLength(1);
        // The saved session is kept for after the reload.
        expect(sessionStorage.getItem('byoky:session')).not.toBeNull();
      });

      it('tryReconnect gives up at once and keeps the saved session', async () => {
        sessionStorage.setItem('byoky:session', JSON.stringify({ sessionKey: 'byk_saved', proxyUrl: 'x', providers: {} }));
        orphan('no-id');
        expect(await new Byoky().tryReconnect()).toBeNull();
        expect(sessionStorage.getItem('byoky:session')).not.toBeNull();
      });
    });
  });

  it('forwards a bare disconnect from older SDKs without answering it', () => {
    const listener = startContentScript();
    const dispatch = vi.spyOn(document, 'dispatchEvent');

    listener({
      source: window,
      data: { type: 'BYOKY_DISCONNECT', payload: { sessionKey: 'byk_old' } },
      ports: [],
    });

    const port = portsNamed('byoky-message')[0];
    expect(port.posted).toEqual([{ type: 'BYOKY_DISCONNECT', payload: { sessionKey: 'byk_old' } }]);

    port.drop();
    expect(dispatch).not.toHaveBeenCalled();
  });

  describe('notify port', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    function registerSdk(listener: ContentListener) {
      const sdkPort = fakeSdkPort();
      listener({ source: window, data: { type: 'BYOKY_REGISTER_NOTIFY' }, ports: [sdkPort] });
      return sdkPort;
    }

    it('reopens after the worker shuts down and keeps forwarding', () => {
      const listener = startContentScript();
      const sdkPort = registerSdk(listener);

      vi.advanceTimersByTime(30_000);
      portsNamed('byoky-notify')[0].drop();
      vi.advanceTimersByTime(1_000);

      const notify = portsNamed('byoky-notify');
      expect(notify).toHaveLength(2);
      const revoked = { type: 'BYOKY_SESSION_REVOKED', payload: { sessionKey: 'byk_x' } };
      notify[1].emit(revoked);
      expect(sdkPort.postMessage).toHaveBeenCalledWith(revoked);
    });

    it('backs off while the background cannot be reached', () => {
      const listener = startContentScript();
      registerSdk(listener);

      portsNamed('byoky-notify')[0].drop();
      vi.advanceTimersByTime(1_000);
      expect(portsNamed('byoky-notify')).toHaveLength(2);

      portsNamed('byoky-notify')[1].drop();
      vi.advanceTimersByTime(1_999);
      expect(portsNamed('byoky-notify')).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(portsNamed('byoky-notify')).toHaveLength(3);
    });

    it('stops once the extension context is invalidated', () => {
      const listener = startContentScript();
      registerSdk(listener);

      runtime.id = undefined;
      portsNamed('byoky-notify')[0].drop();
      vi.advanceTimersByTime(10 * 60_000);
      registerSdk(listener);

      expect(portsNamed('byoky-notify')).toHaveLength(1);
    });

    it('closes once every SDK in the frame has unregistered, and stays closed', () => {
      const listener = startContentScript();
      const first = registerSdk(listener);
      const second = registerSdk(listener);
      const notify = portsNamed('byoky-notify')[0];

      first.fromSdk({ type: 'BYOKY_UNREGISTER_NOTIFY' });
      expect(first.close).toHaveBeenCalled();
      expect(notify.disconnected).toBe(false);

      second.fromSdk({ type: 'BYOKY_UNREGISTER_NOTIFY' });
      expect(notify.disconnected).toBe(true);
      vi.advanceTimersByTime(10 * 60_000);
      expect(portsNamed('byoky-notify')).toHaveLength(1);

      // Nothing is forwarded to the released ports any more.
      notify.emit({ type: 'BYOKY_SESSION_REVOKED', payload: { sessionKey: 'byk' } });
      expect(first.postMessage).not.toHaveBeenCalled();
      expect(second.postMessage).not.toHaveBeenCalled();
    });

    it('cancels a pending reopen when the last SDK unregisters', () => {
      const listener = startContentScript();
      const sdkPort = registerSdk(listener);

      portsNamed('byoky-notify')[0].drop();
      sdkPort.fromSdk({ type: 'BYOKY_UNREGISTER_NOTIFY' });
      vi.advanceTimersByTime(10 * 60_000);
      expect(portsNamed('byoky-notify')).toHaveLength(1);
    });

    it('releases a port whose page end closed, where the browser reports it', () => {
      const listener = startContentScript();
      const sdkPort = registerSdk(listener);

      for (const fn of sdkPort.closeListeners) fn();
      expect(portsNamed('byoky-notify')[0].disconnected).toBe(true);
    });

    it('stays closed until an SDK in the frame registers', () => {
      const listener = startContentScript();

      portsNamed('byoky-notify')[0].drop();
      vi.advanceTimersByTime(10 * 60_000);
      expect(portsNamed('byoky-notify')).toHaveLength(1);

      registerSdk(listener);
      expect(portsNamed('byoky-notify')).toHaveLength(2);
    });
  });
});
