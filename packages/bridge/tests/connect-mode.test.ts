import { describe, it, expect, beforeEach } from 'vitest';
import { request, type IncomingHttpHeaders } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { runHandshake, cleanPageMessage, DEFAULT_HANDSHAKE_PORT } from '../src/connect-mode.js';

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

/** Starts a handshake and tracks whether it has settled. */
async function start(handshakeTimeoutMs = 10_000) {
  const port = await freePort();
  const opened: string[] = [];
  const state: { settled: boolean; error?: Error } = { settled: false };
  const done = runHandshake({
    port: 19280,
    providers: ['anthropic'],
    handshakePort: port,
    openBrowser: (url) => opened.push(url),
    handshakeTimeoutMs,
  }).then(
    () => { state.settled = true; },
    (e: Error) => { state.settled = true; state.error = e; },
  );
  await expect.poll(() => opened.length).toBe(1);
  const page = await send(port, '/');
  const nonce = page.body.match(/nonce: "([A-Za-z0-9_-]+)"/)?.[1] ?? '';
  const origin = `http://127.0.0.1:${port}`;
  const post = (body: unknown, headers: Record<string, string> = {}) => send(port, '/done', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...headers },
    body: JSON.stringify(body),
  });
  return { port, opened, state, done, page, nonce, origin, post };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('connect handshake', () => {
  it('serves the page on a fixed port, so every run is the same app', async () => {
    const port = await freePort();
    const urls: string[] = [];
    for (let run = 0; run < 2; run++) {
      const opened: string[] = [];
      const done = runHandshake({
        port: 19280, providers: ['anthropic'], handshakePort: port, openBrowser: (u) => opened.push(u),
      });
      await expect.poll(() => opened.length).toBe(1);
      const nonce = (await send(port, '/')).body.match(/nonce: "([A-Za-z0-9_-]+)"/)![1];
      await send(port, '/done', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify({ nonce }),
      });
      await done;
      urls.push(opened[0]);
    }
    expect(urls).toEqual([`http://127.0.0.1:${port}`, `http://127.0.0.1:${port}`]);
  });

  it('uses port 19281 unless told otherwise', () => {
    expect(DEFAULT_HANDSHAKE_PORT).toBe(19281);
  });

  it('says another connect may be running when the port is taken', async () => {
    const h = await start();
    await expect(runHandshake({
      port: 19280, providers: ['anthropic'], handshakePort: h.port, openBrowser: () => {},
    })).rejects.toThrow(/Port \d+ is already in use — another `byoky-bridge connect` may be running/);
    await h.post({ nonce: h.nonce });
    await h.done;
  });

  it('resolves when the page reports success', async () => {
    const h = await start();
    expect(h.page.status).toBe(200);
    expect(h.nonce).toHaveLength(32);
    const res = await h.post({ nonce: h.nonce });
    expect(res.status).toBe(200);
    await h.done;
    expect(h.state).toEqual({ settled: true });
  });

  it('sends no CORS headers and refuses a preflight', async () => {
    const h = await start();
    const preflight = await send(h.port, '/done', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(405);
    expect(preflight.headers).not.toHaveProperty('access-control-allow-origin');
    expect(h.page.headers).not.toHaveProperty('access-control-allow-origin');
    await h.post({ nonce: h.nonce });
    await h.done;
  });

  describe.each([
    ['a text/plain body', { headers: { 'content-type': 'text/plain' } }],
    ['another origin', { headers: { origin: 'https://evil.example' } }],
    ['a missing nonce', { body: {} }],
    ['a wrong nonce', { body: { nonce: 'x'.repeat(32) } }],
  ])('refuses %s', (_name, variant: { headers?: Record<string, string>; body?: unknown }) => {
    it('with 403, and keeps waiting', async () => {
      const h = await start();
      const res = await h.post(variant.body ?? { nonce: h.nonce, error: 'forged' }, variant.headers);
      expect(res.status).toBe(403);
      await tick();
      expect(h.state.settled).toBe(false);
      await h.post({ nonce: h.nonce });
      await h.done;
      expect(h.state.error).toBeUndefined();
    });
  });

  it('refuses a request under another Host name (DNS rebinding)', async () => {
    const h = await start();
    const res = await send(h.port, '/', { headers: { host: `evil.example:${h.port}` } });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain(h.nonce);
    await h.post({ nonce: h.nonce });
    await h.done;
  });

  it('rejects with the page error, stripped of terminal escapes', async () => {
    const h = await start();
    await h.post({ nonce: h.nonce, error: '\u001b[2J\u001b[HWallet is locked\u0007\u001b]0;pwned\u0007' });
    await h.done;
    expect(h.state.error?.message).toBe('[2J[HWallet is locked]0;pwned');
    expect(h.state.error?.message).not.toMatch(/[\u0000-\u001f]/);
  });

  it('times out when the page never answers', async () => {
    const h = await start(150);
    await h.done;
    expect(h.state.error?.message).toMatch(/^Timed out after/);
  });

  it('tells the page to rerun the command after an error instead of offering a retry', async () => {
    const h = await start();
    expect(h.page.body).toContain('run byoky-bridge connect again in your terminal');
    await h.post({ nonce: h.nonce });
    await h.done;
  });
});

describe('cleanPageMessage', () => {
  it('drops control and bidi characters and caps the length', () => {
    expect(cleanPageMessage('a\u0000b\u009bc‮d⁦e')).toBe('abcde');
    const long = cleanPageMessage('x'.repeat(1000));
    expect(long).toHaveLength(300);
    expect(long.endsWith('…')).toBe(true);
  });
});

beforeEach(() => {
  // runHandshake prints the URL for the user; keep test output clean.
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) =>
    typeof chunk === 'string' && chunk.startsWith('Open this URL') ? true : (write as (...a: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stderr.write;
  return () => { process.stderr.write = write; };
});
