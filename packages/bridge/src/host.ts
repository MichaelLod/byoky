/**
 * Native Messaging Host for Byoky Bridge.
 *
 * Communicates with the Byoky browser extension via Chrome/Firefox native
 * messaging protocol (stdin/stdout with length-prefixed JSON).
 *
 * Two modes:
 * 1. OAuth token proxy: Fetches Anthropic API from Node.js to bypass TLS
 *    fingerprint detection that blocks browser-originated requests.
 * 2. HTTP proxy: Local gateway for any CLI/desktop/server app to make LLM
 *    calls through the user's wallet. The bridge is a dumb relay — the
 *    extension makes the actual API call. Keys never touch the bridge.
 */

import {
  startProxyServer,
  handleProxyResponse,
  type ProxyRequestOut,
  type ProxyResponseMessage,
} from './proxy-server.js';
import { createToolNameSSERewriter } from '@byoky/core';

interface BridgeRequest {
  type: 'proxy';
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  /** Reverse map (alias → original) for rewriting tool_use names in SSE response chunks. */
  toolNameMap?: Record<string, string>;
}

interface DirectFetchRequest {
  type: 'proxy_direct_fetch';
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Reverse map (alias → original) for rewriting tool_use names in SSE response chunks. */
  toolNameMap?: Record<string, string>;
}

interface BridgeResponseMeta {
  type: 'proxy_response_meta';
  requestId: string;
  status: number;
  headers: Record<string, string>;
}

interface BridgeResponseChunk {
  type: 'proxy_response_chunk';
  requestId: string;
  chunk: string;
}

interface BridgeResponseDone {
  type: 'proxy_response_done';
  requestId: string;
}

interface BridgeError {
  type: 'proxy_error';
  requestId: string;
  error: string;
}

interface BridgePong {
  type: 'pong';
  version: string;
}

interface StartProxyRequest {
  type: 'start-proxy';
  port: number;
  sessionKey: string;
  providers: string[];
}

interface StartProxyResponse {
  type: 'proxy-started';
  port: number;
}

// --- Native messaging I/O ---

function readMessage(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Read 4-byte length prefix
    const lengthBuf = Buffer.alloc(4);
    let bytesRead = 0;

    function readLength() {
      const chunk = process.stdin.read(4 - bytesRead);
      if (!chunk) {
        process.stdin.once('readable', readLength);
        return;
      }
      chunk.copy(lengthBuf, bytesRead);
      bytesRead += chunk.length;

      if (bytesRead < 4) {
        process.stdin.once('readable', readLength);
        return;
      }

      const msgLength = lengthBuf.readUInt32LE(0);
      if (msgLength === 0) {
        resolve(null);
        return;
      }
      if (msgLength > 20_971_520) {
        reject(new Error(`Message too large: ${msgLength} bytes (max 20MB)`));
        return;
      }

      readBody(msgLength);
    }

    function readBody(length: number) {
      let body = Buffer.alloc(0);

      function readChunk() {
        const chunk = process.stdin.read(length - body.length);
        if (!chunk) {
          process.stdin.once('readable', readChunk);
          return;
        }
        body = Buffer.concat([body, chunk]);

        if (body.length < length) {
          process.stdin.once('readable', readChunk);
          return;
        }

        try {
          resolve(JSON.parse(body.toString('utf-8')));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${(e as Error).message}`));
        }
      }

      readChunk();
    }

    process.stdin.once('readable', readLength);
    process.stdin.on('end', () => resolve(null));
  });
}

function writeMessage(msg: unknown): void {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(buf.length, 0);
  process.stdout.write(lengthBuf);
  process.stdout.write(buf);
}

// --- Request handling ---

async function handleMessage(msg: unknown): Promise<void> {
  if (!msg || typeof msg !== 'object') return;

  const message = msg as { type: string };

  if (message.type === 'ping') {
    writeMessage({ type: 'pong', version: '0.3.0' } satisfies BridgePong);
    return;
  }

  // OAuth token proxy (Web SDK path — extension delegates fetch to Node.js)
  if (message.type === 'proxy') {
    const req = msg as BridgeRequest;
    await handleStreamingFetch(
      req.requestId, req.url, req.method, req.headers, req.body, 'bridge', req.toolNameMap,
    );
    return;
  }

  // Direct fetch (CLI path — extension resolves creds, bridge does the fetch directly)
  if (message.type === 'proxy_direct_fetch') {
    const req = msg as DirectFetchRequest;
    await handleStreamingFetch(
      req.requestId, req.url, req.method, req.headers, req.body, 'proxy_http', req.toolNameMap,
    );
    return;
  }

  // Start HTTP proxy server for CLI tools (OpenClaw)
  if (message.type === 'start-proxy') {
    const req = msg as StartProxyRequest;
    handleStartProxy(req);
    return;
  }

  // Streaming response from extension for an HTTP proxy request
  if (
    msg && typeof msg === 'object' && 'type' in msg &&
    (
      (msg as { type: string }).type === 'proxy_http_response_meta' ||
      (msg as { type: string }).type === 'proxy_http_response_chunk' ||
      (msg as { type: string }).type === 'proxy_http_response_done' ||
      (msg as { type: string }).type === 'proxy_http_error'
    )
  ) {
    handleProxyResponse(msg as ProxyResponseMessage);
    return;
  }
}

/**
 * Streaming fetch handler used by both bridge paths.
 *
 * - mode 'bridge': sends proxy_response_meta/chunk/done messages back to
 *   extension via native messaging (Web SDK path)
 * - mode 'proxy_http': sends proxy_http_response_meta/chunk/done directly
 *   to proxy-server (CLI path, eliminates double hop)
 */
async function handleStreamingFetch(
  requestId: string,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  mode: 'bridge' | 'proxy_http',
  toolNameMap: Record<string, string> = {},
): Promise<void> {
  const send = (msg: unknown) => {
    if (mode === 'bridge') {
      writeMessage(msg);
    } else {
      handleProxyResponse(msg as ProxyResponseMessage);
    }
  };

  const prefix = mode === 'bridge' ? 'proxy_response' : 'proxy_http_response';
  const errorType = mode === 'bridge' ? 'proxy_error' : 'proxy_http_error';

  // SSE rewriter that translates Claude-Code aliases back to the framework's
  // original tool names. Identity passthrough when the map is empty.
  const rewriter = createToolNameSSERewriter(toolNameMap);

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: controller.signal,
    });

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });

    send({ type: `${prefix}_meta`, requestId, status: res.status, headers: resHeaders });

    if (res.body) {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const raw = decoder.decode(value, { stream: true });
        const rewritten = rewriter.process(raw);
        if (rewritten) send({ type: `${prefix}_chunk`, requestId, chunk: rewritten });
      }
      const tail = rewriter.flush();
      if (tail) send({ type: `${prefix}_chunk`, requestId, chunk: tail });
    }

    send({ type: `${prefix}_done`, requestId });
  } catch (e) {
    send({ type: errorType, requestId, error: 'Fetch request failed' });
  } finally {
    clearTimeout(fetchTimeout);
  }
}

function handleStartProxy(req: StartProxyRequest): void {
  try {
    startProxyServer({
      port: req.port,
      sessionKey: req.sessionKey,
      providers: req.providers,
      sendToExtension: (msg: ProxyRequestOut) => writeMessage(msg),
    });

    writeMessage({
      type: 'proxy-started',
      port: req.port,
    } satisfies StartProxyResponse);
  } catch (e) {
    writeMessage({
      type: 'proxy_error',
      requestId: 'start-proxy',
      error: 'Failed to start proxy server',
    });
  }
}

// --- Main loop ---

async function main() {
  // Ensure stdin is in binary mode for native messaging
  process.stdin.resume();

  while (true) {
    const msg = await readMessage();
    if (msg === null) break; // stdin closed = extension disconnected
    await handleMessage(msg);
  }

  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`byoky-bridge fatal: ${e.message}\n`);
  process.exit(1);
});
