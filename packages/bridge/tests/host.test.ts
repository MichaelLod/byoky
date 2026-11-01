import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, request, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createHost, stripIncompatibleBetas, type Host } from '../src/host-core.js';

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

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

type Msg = Record<string, unknown> & { type: string };

// Starts like an MP3 frame; 0xff never occurs in UTF-8.
const AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0xc3, 0x28, 0xa0, 0xa1, 0xe2, 0x28, 0xa1, 0xf0]);

const SSE_TOOL_FRAME =
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"Bash","input":{}}}\n\n';

// Stands in for the provider API.
let upstreamHits: string[] = [];
let upstream: Server;
let base: string;
let otherHits = 0;
let other: Server;
let otherBase: string;

beforeAll(async () => {
  ({ server: other, base: otherBase } = await listen((_req, res) => {
    otherHits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"leaked":true}');
  }));
  ({ server: upstream, base } = await listen((req, res) => {
    upstreamHits.push(req.url ?? '');
    const url = req.url ?? '';
    if (url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }));
    } else if (url === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // The tool frame arrives split in two network reads.
      res.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\n\n');
      res.write(SSE_TOOL_FRAME.slice(0, 60));
      setTimeout(() => {
        res.write(SSE_TOOL_FRAME.slice(60));
        res.end('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n');
      }, 20);
    } else if (url === '/big') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'ä"\\'.repeat(400_000) }));
    } else if (url === '/limited') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate limited', usage: { input_tokens: 10, output_tokens: 5 } }));
    } else if (url === '/audio') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.write(AUDIO.subarray(0, 3));
      res.end(AUDIO.subarray(3));
    } else if (url === '/slow-headers') {
      // A non-streaming reply: headers only once the model has finished.
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      }, 300);
    } else if (url === '/no-headers') {
      // Never answers.
    } else if (url === '/stall-body') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: 1\n\n');
      // ...and nothing more.
    } else if (url === '/redirect') {
      res.writeHead(302, { location: `${otherBase}/json` });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  }));
});

afterAll(() => {
  upstream.closeAllConnections();
  upstream.close();
  other.close();
});

let messages: Msg[];
let host: Host;

beforeEach(() => {
  messages = [];
  upstreamHits = [];
  otherHits = 0;
  host = createHost({
    writeMessage: (m) => messages.push(m as Msg),
    loadToken: () => TOKEN,
    firstByteTimeoutMs: 600,
    idleTimeoutMs: 200,
  });
});

afterEach(() => {
  host.close();
});

const ofType = (type: string) => messages.filter((m) => m.type === type);
const body = () => ofType('proxy_response_chunk').map((m) => m.chunk).join('');

describe('stripIncompatibleBetas', () => {
  const url = 'https://api.anthropic.com/v1/messages';

  it('drops the long-context beta on an OAuth request to Anthropic', () => {
    const out = stripIncompatibleBetas(url, {
      authorization: 'Bearer sk-ant-oat01-x',
      'anthropic-beta': 'oauth-2025-04-20, context-1m-2025-08-07,claude-code-20250219',
    });
    expect(out['anthropic-beta']).toBe('oauth-2025-04-20,claude-code-20250219');
  });

  it('removes the header when that beta was its only value', () => {
    const out = stripIncompatibleBetas(url, {
      Authorization: 'Bearer sk-ant-oat01-x',
      'Anthropic-Beta': 'context-1m-2025-08-07',
    });
    expect(out).not.toHaveProperty('anthropic-beta');
    expect(out).not.toHaveProperty('Anthropic-Beta');
  });

  it('leaves API-key requests and other hosts alone', () => {
    const apiKey = { 'x-api-key': 'sk-ant-api03-x', 'anthropic-beta': 'context-1m-2025-08-07' };
    expect(stripIncompatibleBetas(url, apiKey)).toBe(apiKey);
    const other = { authorization: 'Bearer x', 'anthropic-beta': 'context-1m-2025-08-07' };
    expect(stripIncompatibleBetas('https://api.openai.com/v1/chat/completions', other)).toBe(other);
  });

  it('applies to the request the bridge actually sends', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    const spied = createHost({ writeMessage: () => {}, loadToken: () => TOKEN, fetch: fetchSpy });
    await spied.handleMessage({
      type: 'proxy', requestId: 'r', url, method: 'POST', body: '{}',
      headers: { authorization: 'Bearer sk-ant-oat01-x', 'anthropic-beta': 'context-1m-2025-08-07' },
    });
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ authorization: 'Bearer sk-ant-oat01-x' });
    expect(init.redirect).toBe('error');
  });
});

describe('page path (proxy)', () => {
  it('rewrites tool names in a JSON reply', async () => {
    await host.handleMessage({
      type: 'proxy', requestId: 'r1', url: `${base}/json`, method: 'POST', headers: {}, body: '{}',
      toolNameMap: { Read: 'read' },
    });
    expect(ofType('proxy_response_meta')[0]).toMatchObject({ requestId: 'r1', status: 200 });
    expect(JSON.parse(body()).content[0].name).toBe('read');
    expect(ofType('proxy_response_done')).toHaveLength(1);
  });

  it('rewrites a tool name split across SSE reads', async () => {
    await host.handleMessage({
      type: 'proxy', requestId: 'r2', url: `${base}/sse`, method: 'POST', headers: {}, body: '{}',
      toolNameMap: { Bash: 'exec' },
    });
    const out = body();
    expect(out).toContain('"name":"exec"');
    expect(out).not.toContain('"name":"Bash"');
    expect(out).toContain('message_delta');
  });

  it('slices a reply over 1 MiB into messages that each fit', async () => {
    await host.handleMessage({
      type: 'proxy', requestId: 'r3', url: `${base}/big`, method: 'GET', headers: {}, body: '',
    });
    const chunks = ofType('proxy_response_chunk');
    expect(chunks.length).toBeGreaterThan(1);
    for (const m of chunks) expect(Buffer.byteLength(JSON.stringify(m))).toBeLessThanOrEqual(1024 * 1024);
    expect(JSON.parse(body()).text).toHaveLength(1_200_000);
  });

  it('does not follow a redirect', async () => {
    await host.handleMessage({
      type: 'proxy', requestId: 'r4', url: `${base}/redirect`, method: 'POST', headers: { 'x-api-key': 'sk-secret' }, body: '{}',
    });
    expect(ofType('proxy_error')).toEqual([{ type: 'proxy_error', requestId: 'r4', error: 'Fetch request failed' }]);
    expect(otherHits).toBe(0);
  });

  it('waits longer for the headers than between chunks', async () => {
    await host.handleMessage({
      type: 'proxy', requestId: 'r6', url: `${base}/slow-headers`, method: 'POST', headers: {}, body: '{}',
    });
    expect(ofType('proxy_error')).toHaveLength(0);
    expect(body()).toBe('{"ok":true}');
  });

  it('gives up on headers that never come', async () => {
    const started = Date.now();
    await host.handleMessage({
      type: 'proxy', requestId: 'r7', url: `${base}/no-headers`, method: 'POST', headers: {}, body: '{}',
    });
    expect(ofType('proxy_error')).toEqual([{ type: 'proxy_error', requestId: 'r7', error: 'Fetch request failed' }]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(550);
  });

  it('aborts a response that stops sending', async () => {
    await host.handleMessage({
      type: 'proxy', requestId: 'r5', url: `${base}/stall-body`, method: 'POST', headers: {}, body: '{}',
    });
    expect(ofType('proxy_response_meta')).toHaveLength(1);
    expect(ofType('proxy_error')).toEqual([{ type: 'proxy_error', requestId: 'r5', error: 'Fetch request failed' }]);
  });
});

describe('direct fetch (proxy_direct_fetch)', () => {
  it('reports status, completion, size and usage', async () => {
    await host.handleMessage({
      type: 'proxy_direct_fetch', requestId: 'd1', url: `${base}/sse`, method: 'POST', headers: {}, body: '{}',
      providerId: 'anthropic',
    });
    const [done] = ofType('proxy_direct_done');
    expect(done).toMatchObject({
      requestId: 'd1', status: 200, complete: true, usage: { inputTokens: 7, outputTokens: 3 },
    });
    expect(done.responseChars).toBeGreaterThan(100);
  });

  it('reports no usage for an error status', async () => {
    await host.handleMessage({
      type: 'proxy_direct_fetch', requestId: 'd2', url: `${base}/limited`, method: 'POST', headers: {}, body: '{}',
      providerId: 'anthropic',
    });
    const [done] = ofType('proxy_direct_done');
    expect(done).toMatchObject({ requestId: 'd2', status: 429, complete: true });
    expect(done.usage).toBeUndefined();
  });

  it('reports 502 and incomplete when the fetch fails', async () => {
    await host.handleMessage({
      type: 'proxy_direct_fetch', requestId: 'd3', url: `${base}/redirect`, method: 'POST', headers: {},
      providerId: 'anthropic',
    });
    expect(ofType('proxy_direct_done')[0]).toMatchObject({ status: 502, complete: false, responseChars: 0 });
  });
});

describe('start-proxy', () => {
  it.each([
    { port: 80, sessionKey: 's', providers: ['anthropic'] },
    { port: '19280', sessionKey: 's', providers: ['anthropic'] },
    { port: 19280, sessionKey: '', providers: ['anthropic'] },
    { port: 19280, sessionKey: 's', providers: 'anthropic' },
    { port: 19280, sessionKey: 's', providers: [1] },
  ])('rejects %o', async (req) => {
    await host.handleMessage({ type: 'start-proxy', ...req });
    expect(messages).toEqual([{ type: 'proxy_error', requestId: 'start-proxy', error: 'Invalid start-proxy request' }]);
  });

  it('starts once and acks a repeat for the same session', async () => {
    const port = await freePort();
    await host.handleMessage({ type: 'start-proxy', port, sessionKey: 's', providers: ['anthropic'] });
    await host.handleMessage({ type: 'start-proxy', port, sessionKey: 's', providers: ['anthropic'] });
    expect(messages).toEqual([{ type: 'proxy-started', port }, { type: 'proxy-started', port }]);
  });

  it('passes a binary reply through byte for byte', async () => {
    const port = await freePort();
    await host.handleMessage({ type: 'start-proxy', port, sessionKey: 's', providers: ['anthropic'] });
    const received = new Promise<Buffer>((resolve, reject) => {
      const client = request({
        host: '127.0.0.1', port, path: '/anthropic/v1/files/f1/content', method: 'GET',
        headers: { 'x-api-key': TOKEN },
      }, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => resolve(Buffer.concat(parts)));
      });
      client.on('error', reject);
      client.end();
    });
    await expect.poll(() => ofType('proxy_http').length).toBe(1);
    await host.handleMessage({
      type: 'proxy_direct_fetch', requestId: ofType('proxy_http')[0].requestId, url: `${base}/audio`,
      method: 'GET', headers: {}, providerId: 'anthropic',
    });
    expect((await received).equals(AUDIO)).toBe(true);
    expect(ofType('proxy_direct_done')[0]).toMatchObject({ status: 200, complete: true });
  });

  it('stops a direct fetch when the client hangs up', async () => {
    const port = await freePort();
    await host.handleMessage({ type: 'start-proxy', port, sessionKey: 's', providers: ['anthropic'] });

    // The client's request reaches the extension as proxy_http; the extension
    // answers with a direct fetch to a stream that never ends.
    let fetching: Promise<void> | undefined;
    const client = request({
      host: '127.0.0.1', port, path: '/anthropic/v1/messages', method: 'POST',
      headers: { 'x-api-key': TOKEN },
    }, (res) => res.once('data', () => client.destroy()));
    client.on('error', () => {});
    client.end('{}');

    await expect.poll(() => ofType('proxy_http').length).toBe(1);
    const requestId = ofType('proxy_http')[0].requestId as string;
    fetching = host.handleMessage({
      type: 'proxy_direct_fetch', requestId, url: `${base}/stall-body`, method: 'POST', headers: {}, body: '{}',
      providerId: 'anthropic',
    });

    await expect.poll(() => ofType('proxy_http_cancel')).toEqual([{ type: 'proxy_http_cancel', requestId }]);
    await fetching;
    expect(ofType('proxy_direct_done')[0]).toMatchObject({ requestId, status: 200, complete: false });
  });
});
