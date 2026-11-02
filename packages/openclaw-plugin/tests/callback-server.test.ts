import { describe, it, expect, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';

// The plugin bundles these bridge modules at build time; test against their
// source so the bridge needn't be built first.
vi.mock('openclaw/plugin-sdk/core', () => ({ emptyPluginConfigSchema: () => ({}) }));
vi.mock('@byoky/bridge/token', () => ({ loadOrCreateToken: () => 'test-token' }));
vi.mock('@byoky/bridge/native-manifest', async () => await import('../../bridge/src/native-manifest.js'));
vi.mock('@byoky/bridge/loopback-page', async () => await import('../../bridge/src/loopback-page.js'));

const { startCallbackServer, probeBridgeSession, CALLBACK_PORT } = await import('../src/index.js');
type CallbackResult = Awaited<ReturnType<typeof startCallbackServer>>;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function send(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

async function start(extra: { timeoutMs?: number; requestProviderId?: string | null } = {}) {
  const port = await freePort();
  const opened: string[] = [];
  const pageErrors: string[] = [];
  const state: { result?: CallbackResult } = {};
  const done = startCallbackServer({
    requestProviderId: extra.requestProviderId ?? null,
    openUrl: (url) => { opened.push(url); },
    onPageError: (m) => pageErrors.push(m),
    port,
    timeoutMs: extra.timeoutMs ?? 10_000,
  }).then((r) => { state.result = r; return r; });
  await expect.poll(() => opened.length).toBe(1);
  const page = await send(port, '/');
  const nonce = page.body.match(/nonce: "([A-Za-z0-9_-]+)"/)?.[1] ?? '';
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => send(port, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, ...headers },
    body: JSON.stringify(body),
  });
  return { port, opened, pageErrors, state, done, page, nonce, post };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('login page server', () => {
  it('listens on a fixed port so OpenClaw stays the same app in the wallet', () => {
    expect(CALLBACK_PORT).toBe(19282);
  });

  it('opens the page and resolves with the providers it reports', async () => {
    const h = await start();
    expect(h.opened).toEqual([`http://127.0.0.1:${h.port}`]);
    expect(h.page.status).toBe(200);
    expect(h.page.headers).not.toHaveProperty('access-control-allow-origin');
    const res = await h.post('/callback', { nonce: h.nonce, providers: ['anthropic', 'openai'], bridgePort: 19290 });
    expect(res.status).toBe(200);
    expect(await h.done).toEqual({ ok: true, providers: ['anthropic', 'openai'], port: 19290 });
  });

  it('drops unknown providers and an invalid bridge port', async () => {
    const h = await start();
    await h.post('/callback', { nonce: h.nonce, providers: ['anthropic', 'evil', 7, '__proto__'], bridgePort: 22 });
    expect(await h.done).toEqual({ ok: true, providers: ['anthropic'], port: 19280 });
  });

  describe.each([
    ['a text/plain body', { headers: { 'content-type': 'text/plain' } }],
    ['another origin', { headers: { origin: 'https://evil.example' } }],
    ['a missing nonce', { body: { providers: ['anthropic'], bridgePort: 1 } }],
  ])('refuses %s', (_name, variant: { headers?: Record<string, string>; body?: unknown }) => {
    it('with 403, and keeps waiting', async () => {
      const h = await start();
      const res = await h.post('/callback', variant.body ?? { nonce: h.nonce, providers: ['openai'] }, variant.headers);
      expect(res.status).toBe(403);
      await tick();
      expect(h.state.result).toBeUndefined();
      await h.post('/callback', { nonce: h.nonce, providers: ['anthropic'] });
      expect(await h.done).toMatchObject({ ok: true, providers: ['anthropic'] });
    });
  });

  it('refuses a preflight and another Host name', async () => {
    const h = await start();
    const preflight = await send(h.port, '/callback', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(405);
    expect(preflight.headers).not.toHaveProperty('access-control-allow-origin');
    const rebound = await send(h.port, '/', { headers: { host: `evil.example:${h.port}` } });
    expect(rebound.status).toBe(403);
    await h.post('/callback', { nonce: h.nonce, providers: ['anthropic'] });
    await h.done;
  });

  it('shows a page error at once, keeps waiting, and still takes a later success', async () => {
    const h = await start();
    await h.post('/callback', { nonce: h.nonce, error: 'Wallet is locked\u001b[2J' });
    await tick();
    expect(h.pageErrors).toEqual(['Wallet is locked[2J']);
    expect(h.state.result).toBeUndefined();
    await h.post('/callback', { nonce: h.nonce, providers: ['anthropic'] });
    expect(await h.done).toMatchObject({ ok: true });
  });

  it('ends with the last page error when no retry comes', async () => {
    const h = await start({ timeoutMs: 200 });
    await h.post('/callback', { nonce: h.nonce, error: 'Bridge not installed' });
    expect(await h.done).toEqual({
      ok: false,
      reason: 'page-error',
      message: 'The browser tab reported: Bridge not installed',
    });
  });

  it('times out when the page never reports', async () => {
    const h = await start({ timeoutMs: 150 });
    const result = await h.done;
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(result.ok === false && result.message).toMatch(/^Timed out waiting for the browser tab/);
  });

  it('counts the timeout from the last click', async () => {
    const h = await start({ timeoutMs: 300 });
    await tick(200);
    await h.post('/started', { nonce: h.nonce });
    await tick(200);
    expect(h.state.result).toBeUndefined();
    await h.done;
    expect(h.state.result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('says another login may be running when the port is taken', async () => {
    const h = await start();
    await expect(startCallbackServer({ requestProviderId: null, openUrl: () => {}, port: h.port }))
      .rejects.toThrow(/Port \d+ is already in use — another OpenClaw login/);
    await h.post('/callback', { nonce: h.nonce, providers: ['anthropic'] });
    await h.done;
  });

  it('reports page errors from the page script, except a cancel', async () => {
    const h = await start();
    expect(h.page.body).toContain("report('/callback', { error: msg })");
    expect(h.page.body).toContain("msg === 'User cancelled'");
    await h.post('/callback', { nonce: h.nonce, providers: ['anthropic'] });
    await h.done;
  });
});

describe('probeBridgeSession', () => {
  async function bridge(status: number, body: string): Promise<{ server: Server; port: number }> {
    const server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    return { server, port: (server.address() as { port: number }).port };
  }

  it.each([
    [401, '{"code":"bridge_token_invalid"}', 'bad-token'],
    [401, '{"code":"bridge_session_expired"}', 'stale'],
    [502, '{"error":"Session has expired"}', 'stale'],
    [502, '{"error":"Session not found or wallet locked"}', 'stale'],
    [502, '{"error":"Unauthorized session key"}', 'stale'],
    [502, '{"error":"upstream exploded"}', 'ok'],
    // The wallet refused the request, but the session is live (F017).
    [429, '{"error":"Token allowance exceeded","code":"QUOTA_EXCEEDED"}', 'ok'],
    [403, '{"error":"Provider not available in this session","code":"PROVIDER_UNAVAILABLE"}', 'ok'],
    [200, '{"data":[]}', 'ok'],
  ])('maps %s %s to %s', async (status, body, expected) => {
    const { server, port } = await bridge(status, body);
    try {
      expect(await probeBridgeSession(port, 'anthropic')).toBe(expected);
    } finally {
      server.close();
    }
  });
});
