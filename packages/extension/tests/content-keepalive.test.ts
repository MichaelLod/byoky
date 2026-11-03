// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// F001: the background is stopped 30 s after its last extension event
// (Chrome's MV3 worker, Safari's non-persistent page), and a port that is
// merely open isn't one. The content script now pings each port it waits
// on, and only while it waits.

type Listener = (...args: unknown[]) => void;

class FakeEvent {
  listeners: Listener[] = [];
  addListener(fn: Listener) { this.listeners.push(fn); }
  removeListener(fn: Listener) { this.listeners = this.listeners.filter((l) => l !== fn); }
  emit(...args: unknown[]) { for (const l of [...this.listeners]) l(...args); }
}

class FakePort {
  onMessage = new FakeEvent();
  onDisconnect = new FakeEvent();
  posted: any[] = [];
  connected = true;
  constructor(readonly name: string) {}
  postMessage(msg: unknown) {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    this.posted.push(msg);
  }
  disconnect() { this.connected = false; }
  /** The background answers. */
  reply(msg: unknown) { this.onMessage.emit(msg, this); }
  /** The background end goes away. */
  drop() { this.connected = false; this.onDisconnect.emit(this); }
  pings() { return this.posted.filter((m) => m?.type === 'BYOKY_KEEPALIVE').length; }
}

let ports: FakePort[] = [];

// One content script for the file: each run adds its own window listener.
beforeAll(async () => {
  vi.stubGlobal('browser', {
    runtime: {
      id: 'byoky-test-extension',
      connect: ({ name }: { name: string }) => {
        const p = new FakePort(name);
        ports.push(p);
        return p;
      },
      sendMessage: vi.fn(async () => undefined),
    },
  });
  vi.stubGlobal('defineContentScript', (def: unknown) => def);
  const mod = (await import('../entrypoints/content')) as unknown as { default: { main: () => void } };
  mod.default.main();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  ports = [];
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function fromPage(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { data, source: window }));
}

function lastPort(name: string): FakePort {
  const p = ports.filter((x) => x.name === name).at(-1);
  if (!p) throw new Error(`no ${name} port`);
  return p;
}

function proxyRequest(requestId = 'r1') {
  fromPage({
    type: 'BYOKY_PROXY_REQUEST',
    requestId,
    sessionKey: 'byk_test',
    providerId: 'openai',
    url: 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
  });
  return lastPort('byoky-proxy');
}

describe('content script keepalive (F001)', () => {
  it('pings a request\'s port while it waits for the response, and stops when it ends', () => {
    const port = proxyRequest();
    expect(port.posted[0].type).toBe('BYOKY_PROXY_REQUEST');
    vi.advanceTimersByTime(45_000);
    expect(port.pings()).toBe(3);

    port.reply({ type: 'BYOKY_PROXY_RESPONSE_META', requestId: 'r1', status: 200, headers: {} });
    vi.advanceTimersByTime(15_000);
    expect(port.pings()).toBe(4);

    port.reply({ type: 'BYOKY_PROXY_RESPONSE_DONE', requestId: 'r1' });
    vi.advanceTimersByTime(120_000);
    expect(port.pings()).toBe(4);
  });

  it('stops on an error, a closed port and a cancel', () => {
    const errored = proxyRequest('e1');
    errored.reply({ type: 'BYOKY_PROXY_RESPONSE_ERROR', requestId: 'e1', status: 502, error: { code: 'PROXY_ERROR' } });

    const dropped = proxyRequest('d1');
    dropped.drop();

    const cancelled = proxyRequest('c1');
    fromPage({ type: 'BYOKY_PROXY_CANCEL', requestId: 'c1' });
    expect(cancelled.connected).toBe(false);

    vi.advanceTimersByTime(120_000);
    expect([errored.pings(), dropped.pings(), cancelled.pings()]).toEqual([0, 0, 0]);
  });

  it('pings a connect\'s port until the answer comes, or the port closes', () => {
    const channel = new MessageChannel();
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'BYOKY_CONNECT_REQUEST', id: 'c1', payload: { providers: [] } },
      source: window,
      ports: [channel.port1],
    }));
    const answered = lastPort('byoky-message');
    vi.advanceTimersByTime(100_000);
    expect(answered.pings()).toBe(6);
    answered.reply({ type: 'BYOKY_CONNECT_RESPONSE', requestId: 'c1', payload: {} });
    vi.advanceTimersByTime(60_000);
    expect(answered.pings()).toBe(6);

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'BYOKY_CONNECT_REQUEST', id: 'c2', payload: { providers: [] } },
      source: window,
      ports: [new MessageChannel().port1],
    }));
    const gone = lastPort('byoky-message');
    vi.advanceTimersByTime(15_000);
    gone.drop();
    vi.advanceTimersByTime(60_000);
    expect(gone.pings()).toBe(1);
    channel.port1.close();
  });
});
