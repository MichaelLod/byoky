import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { request, type Server, type IncomingHttpHeaders } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startProxyServer,
  handleProxyResponse,
  isValidProxyPort,
  sliceForNativeMessaging,
  type ProxyRequestOut,
  type ProxyBodyChunkOut,
  type ProxyMessageOut,
} from '../src/proxy-server.js';

const TOKEN = 'k3Yh8vW2n0QpLr5sT7uX9zA1bC3dE5fG7hJ9kM1nP3q';

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
  raw: Buffer;
}

function send(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'POST', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
          raw: Buffer.concat(chunks),
        }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

// Every byte value, starting like an MP3 frame (0xff 0xfb is not UTF-8).
const BINARY = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.from(Array.from({ length: 256 }, (_, i) => i))]);

// Stands in for the extension: records what the bridge sends over native
// messaging and answers each request with a small JSON body.
let sent: ProxyMessageOut[] = [];

function fakeExtension(msg: ProxyMessageOut): void {
  sent.push(msg);
  if (msg.type !== 'proxy_http') return;
  // The provider is still thinking: no headers yet.
  if (msg.url.endsWith('/v1/silent')) return;
  if (msg.url.endsWith('/v1/audio/speech')) {
    handleProxyResponse({
      type: 'proxy_http_response_meta',
      requestId: msg.requestId,
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    });
    for (const part of [BINARY.subarray(0, 100), BINARY.subarray(100)]) {
      handleProxyResponse({
        type: 'proxy_http_response_chunk',
        requestId: msg.requestId,
        chunk: part.toString('base64'),
        chunkEncoding: 'base64',
      });
    }
    handleProxyResponse({ type: 'proxy_http_response_done', requestId: msg.requestId });
    return;
  }
  if (msg.url.endsWith('/v1/stream')) {
    // A stream that never finishes on its own.
    handleProxyResponse({
      type: 'proxy_http_response_meta',
      requestId: msg.requestId,
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    handleProxyResponse({ type: 'proxy_http_response_chunk', requestId: msg.requestId, chunk: 'data: 1\n\n' });
    return;
  }
  if (msg.url.endsWith('/v1/models')) {
    handleProxyResponse({
      type: 'proxy_http_error',
      requestId: msg.requestId,
      error: 'only chat requests can be routed to another provider',
      status: 400,
      code: 'ROUTING_UNSUPPORTED',
    });
    return;
  }
  handleProxyResponse({
    type: 'proxy_http_response_meta',
    requestId: msg.requestId,
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  handleProxyResponse({ type: 'proxy_http_response_chunk', requestId: msg.requestId, chunk: '{"ok":true}' });
  handleProxyResponse({ type: 'proxy_http_response_done', requestId: msg.requestId });
}

let server: Server;
let port: number;

beforeAll(async () => {
  port = await freePort();
  server = await startProxyServer({
    port,
    sessionKey: 'session-key',
    providers: ['anthropic', 'gemini'],
    token: TOKEN,
    sendToExtension: fakeExtension,
  });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  sent = [];
});

describe('bridge token', () => {
  it('rejects a request without a token', async () => {
    const res = await send(port, '/anthropic/v1/messages', { body: '{}' });
    expect(res.status).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.code).toBe('bridge_token_invalid');
    expect(json.hint).toContain('byoky-bridge token');
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['x-api-key', 'byoky'],
    ['x-api-key', TOKEN.slice(0, -1) + 'X'],
    ['x-api-key', TOKEN + 'X'],
    ['authorization', 'Bearer byoky-proxy'],
    // The token must come as a Bearer credential, not bare.
    ['authorization', TOKEN],
  ])('rejects a wrong token in %s', async (header, value) => {
    const res = await send(port, '/anthropic/v1/messages', { headers: { [header]: value }, body: '{}' });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['x-api-key', TOKEN],
    ['authorization', `Bearer ${TOKEN}`],
    ['x-goog-api-key', TOKEN],
    ['api-key', TOKEN],
  ])('accepts the token in %s and strips it before forwarding', async (header, value) => {
    const res = await send(port, '/anthropic/v1/messages', { headers: { [header]: value }, body: '{}' });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    const forwarded = sent.find((m): m is ProxyRequestOut => m.type === 'proxy_http');
    expect(forwarded?.url).toBe('https://api.anthropic.com/v1/messages');
    for (const name of ['x-api-key', 'authorization', 'x-goog-api-key', 'api-key']) {
      expect(forwarded?.headers).not.toHaveProperty(name);
    }
  });

  it('checks the token before revealing which providers the session has', async () => {
    const res = await send(port, '/openai/v1/chat/completions', { body: '{}' });
    expect(res.status).toBe(401);
    const authed = await send(port, '/openai/v1/chat/completions', { headers: { 'x-api-key': TOKEN }, body: '{}' });
    expect(authed.status).toBe(404);
  });

  it('lists providers on /health only with the token', async () => {
    const open = await send(port, '/health', { method: 'GET' });
    expect(open.status).toBe(200);
    expect(JSON.parse(open.body)).toEqual({ status: 'ok' });
    const authed = await send(port, '/health', { method: 'GET', headers: { 'x-api-key': TOKEN } });
    expect(JSON.parse(authed.body)).toEqual({ status: 'ok', providers: ['anthropic', 'gemini'] });
  });
});

describe('extension replies', () => {
  it('tells the extension it reports direct fetches', async () => {
    await send(port, '/anthropic/v1/messages', { headers: { 'x-api-key': TOKEN }, body: '{}' });
    expect((sent[0] as ProxyRequestOut).reportsDirectFetch).toBe(true);
  });

  it('passes an error status and code through to the client', async () => {
    const res = await send(port, '/anthropic/v1/models', { method: 'GET', headers: { 'x-api-key': TOKEN } });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'only chat requests can be routed to another provider',
      code: 'ROUTING_UNSUPPORTED',
    });
  });
});

describe('client hang-up', () => {
  it('tells the extension to cancel when the client leaves mid-stream', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/anthropic/v1/stream', method: 'POST', headers: { 'x-api-key': TOKEN } },
        (res) => res.once('data', () => { req.destroy(); resolve(); }),
      );
      req.on('error', () => {});
      req.once('error', reject);
      req.end('{}');
    });
    const forwarded = sent.find((m): m is ProxyRequestOut => m.type === 'proxy_http');
    await expect.poll(() => sent.find((m) => m.type === 'proxy_http_cancel'), { timeout: 2000 })
      .toEqual({ type: 'proxy_http_cancel', requestId: forwarded?.requestId });
  });

  it('sends no cancel for a response that finished', async () => {
    await send(port, '/anthropic/v1/messages', { headers: { 'x-api-key': TOKEN }, body: '{}' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.some((m) => m.type === 'proxy_http_cancel')).toBe(false);
  });
});

describe('timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const cancels = () => sent.filter((m) => m.type === 'proxy_http_cancel');

  it('waits 10 minutes for the headers, then answers 504 and cancels once', async () => {
    let settled = false;
    const reply = send(port, '/anthropic/v1/silent', { headers: { 'x-api-key': TOKEN }, body: '{}' })
      .finally(() => { settled = true; });
    await expect.poll(() => sent.length).toBe(1);
    const { requestId } = sent[0] as ProxyRequestOut;

    // A non-streaming reply that takes longer than 2 minutes is not cut off.
    await vi.advanceTimersByTimeAsync(120_000);
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);
    expect(cancels()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(480_000);
    const res = await reply;
    expect(res.status).toBe(504);
    expect(res.headers['x-should-retry']).toBe('false');
    expect(cancels()).toEqual([{ type: 'proxy_http_cancel', requestId }]);
  });

  it('drops a stream that stalls for 2 minutes after its headers and cancels it', async () => {
    let closed = false;
    const client = request(
      { host: '127.0.0.1', port, path: '/anthropic/v1/stream', method: 'POST', headers: { 'x-api-key': TOKEN } },
      (res) => {
        res.resume();
        res.on('close', () => { closed = true; });
      },
    );
    client.on('error', () => {});
    client.end('{}');
    await expect.poll(() => sent.length).toBe(1);
    const { requestId } = sent[0] as ProxyRequestOut;

    await vi.advanceTimersByTimeAsync(119_000);
    await new Promise((r) => setImmediate(r));
    expect(closed).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect.poll(() => closed).toBe(true);
    expect(cancels()).toEqual([{ type: 'proxy_http_cancel', requestId }]);
  });
});

describe('browser callers', () => {
  it.each([
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    'moz-extension://0b5e4f8a-1234-4abc-9def-1234567890ab',
    'safari-web-extension://ABCDEF',
    'https://evil.example',
    'null',
  ])('refuses Origin %s even with the token', async (origin) => {
    const res = await send(port, '/anthropic/v1/messages', {
      headers: { origin, 'x-api-key': TOKEN },
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

describe('large request bodies', () => {
  it('splits a body over 1 MiB into native messages that each fit and reassemble exactly', async () => {
    const text = 'line with "quotes", \\ backslashes, umlauts äöü and 🦅\n'.repeat(60_000);
    const body = JSON.stringify({ messages: [{ role: 'user', content: text }] });
    const res = await send(port, '/anthropic/v1/messages', {
      headers: { 'x-api-key': TOKEN, 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200);

    for (const msg of sent) {
      expect(Buffer.byteLength(JSON.stringify(msg))).toBeLessThanOrEqual(1024 * 1024);
    }
    const last = sent[sent.length - 1] as ProxyRequestOut;
    expect(last.type).toBe('proxy_http');
    expect(last.bodyChunked).toBe(true);
    expect(last.body).toBeUndefined();
    const chunks = sent.slice(0, -1) as ProxyBodyChunkOut[];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.type === 'proxy_http_body_chunk' && c.requestId === last.requestId)).toBe(true);
    expect(chunks.map((c) => c.chunk).join('')).toBe(body);
  });

  it('sends a small body inline', async () => {
    await send(port, '/anthropic/v1/messages', { headers: { 'x-api-key': TOKEN }, body: '{"a":1}' });
    expect(sent).toHaveLength(1);
    expect((sent[0] as ProxyRequestOut).body).toBe('{"a":1}');
  });

  it('never splits a surrogate pair', () => {
    const text = 'a'.repeat(128 * 1024 - 1) + '🦅'.repeat(10);
    const slices = sliceForNativeMessaging(text);
    expect(slices.join('')).toBe(text);
    for (const slice of slices) {
      const last = slice.charCodeAt(slice.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });
});

describe('provider base URLs', () => {
  let custom: Server;
  let customPort: number;

  beforeAll(async () => {
    customPort = await freePort();
    custom = await startProxyServer({
      port: customPort,
      sessionKey: 'session-key',
      providers: ['azure_openai', 'ollama', 'lm_studio', 'openrouter', 'not_a_provider'],
      token: TOKEN,
      sendToExtension: fakeExtension,
    });
  });

  afterAll(() => {
    custom.close();
  });

  it.each([
    ['/azure_openai/openai/v1/chat/completions', 'https://YOUR_RESOURCE.openai.azure.com/openai/v1/chat/completions'],
    ['/ollama/v1/chat/completions', 'http://localhost:11434/v1/chat/completions'],
    ['/lm_studio/v1/chat/completions', 'http://localhost:1234/v1/chat/completions'],
    ['/openrouter/v1/chat/completions', 'https://openrouter.ai/api/v1/chat/completions'],
  ])('forwards %s on the registry base URL', async (path, url) => {
    const res = await send(customPort, path, { headers: { 'x-api-key': TOKEN }, body: '{}' });
    expect(res.status).toBe(200);
    expect((sent[0] as ProxyRequestOut).url).toBe(url);
  });

  it('refuses a provider the registry does not know', async () => {
    const res = await send(customPort, '/not_a_provider/v1/x', { headers: { 'x-api-key': TOKEN }, body: '{}' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe('binary bodies', () => {
  const multipart = Buffer.concat([
    Buffer.from('--b\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\n\r\n'),
    BINARY,
    Buffer.from('\r\n--b--\r\n'),
  ]);

  it('sends a body that is not UTF-8 as base64, byte for byte', async () => {
    await send(port, '/anthropic/v1/messages', {
      headers: { 'x-api-key': TOKEN, 'content-type': 'multipart/form-data; boundary=b' },
      body: multipart,
    });
    const forwarded = sent[0] as ProxyRequestOut;
    expect(forwarded.bodyEncoding).toBe('base64');
    expect(Buffer.from(forwarded.body!, 'base64').equals(multipart)).toBe(true);
  });

  it('keeps a large binary body base64 across body chunks', async () => {
    const big = Buffer.concat(Array.from({ length: 5_000 }, () => BINARY));
    await send(port, '/anthropic/v1/messages', { headers: { 'x-api-key': TOKEN }, body: big });
    const last = sent[sent.length - 1] as ProxyRequestOut;
    expect(last).toMatchObject({ bodyChunked: true, bodyEncoding: 'base64' });
    const joined = (sent.slice(0, -1) as ProxyBodyChunkOut[]).map((c) => c.chunk).join('');
    expect(Buffer.from(joined, 'base64').equals(big)).toBe(true);
  });

  it('sends UTF-8 text as it is and says it takes binary replies', async () => {
    await send(port, '/anthropic/v1/messages', { headers: { 'x-api-key': TOKEN }, body: '{"q":"äöü 🦅"}' });
    const forwarded = sent[0] as ProxyRequestOut;
    expect(forwarded.body).toBe('{"q":"äöü 🦅"}');
    expect(forwarded.bodyEncoding).toBeUndefined();
    expect(forwarded.acceptsBinaryChunks).toBe(true);
  });

  it('writes base64 response chunks to the client as bytes', async () => {
    const res = await send(port, '/anthropic/v1/audio/speech', { headers: { 'x-api-key': TOKEN }, body: '{}' });
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.raw.equals(BINARY)).toBe(true);
  });
});

describe('port validation', () => {
  it.each([1024, 19280, 65535])('accepts %s', (p) => {
    expect(isValidProxyPort(p)).toBe(true);
  });

  it.each([0, 80, 1023, 65536, 19280.5, NaN, '19280', '/tmp/byoky.sock', null, undefined])(
    'rejects %s',
    (p) => {
      expect(isValidProxyPort(p)).toBe(false);
    },
  );

  it('refuses a socket path instead of creating it', async () => {
    const socketPath = join(tmpdir(), `byoky-bridge-test-${process.pid}.sock`);
    await expect(startProxyServer({
      port: socketPath as unknown as number,
      sessionKey: 'k',
      providers: ['anthropic'],
      token: TOKEN,
      sendToExtension: () => {},
    })).rejects.toThrow('Invalid port');
    expect(existsSync(socketPath)).toBe(false);
  });

  it('rejects with EADDRINUSE when the port is taken', async () => {
    await expect(startProxyServer({
      port,
      sessionKey: 'k',
      providers: ['anthropic'],
      token: TOKEN,
      sendToExtension: () => {},
    })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
