/**
 * HTTP Proxy Server for Byoky Bridge.
 *
 * Generic local gateway for CLI tools, desktop apps, and local servers
 * to make LLM API calls through the user's Byoky wallet. The bridge
 * is a dumb relay — it forwards requests to the browser extension via
 * native messaging. The extension injects the real API key and makes
 * the actual API call, so API keys never touch the bridge process. (A
 * Claude setup token does: Anthropic needs a non-browser TLS client for
 * it, so the extension hands it to host-core.ts for the request.)
 *
 * Flow:
 *   Local App → HTTP → Bridge → Native Messaging → Extension → fetch(real API)
 *                                                     ↓
 *   Local App ← HTTP ← Bridge ← Native Messaging ← Extension ← response
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PROVIDERS } from '@byoky/core';

export interface ProxyRequestOut {
  type: 'proxy_http';
  requestId: string;
  sessionKey: string;
  providerId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** The body is not UTF-8 text (an audio upload, say) and is sent as base64. */
  bodyEncoding?: 'base64';
  /** The body was sent ahead in `proxy_http_body_chunk` messages. */
  bodyChunked?: true;
  /**
   * This bridge answers `proxy_direct_fetch` with `proxy_direct_done`, so
   * the extension can wait for the real status and usage before logging.
   */
  reportsDirectFetch: true;
  /** A binary response may come back as base64 chunks (`chunkEncoding`). */
  acceptsBinaryChunks: true;
}

export interface ProxyBodyChunkOut {
  type: 'proxy_http_body_chunk';
  requestId: string;
  chunk: string;
}

/** The client hung up before its response finished: stop the upstream call. */
export interface ProxyCancelOut {
  type: 'proxy_http_cancel';
  requestId: string;
}

export type ProxyMessageOut = ProxyRequestOut | ProxyBodyChunkOut | ProxyCancelOut;

// Streaming response messages from extension (or direct fetch)
export interface ProxyResponseMetaIn {
  type: 'proxy_http_response_meta';
  requestId: string;
  status: number;
  headers: Record<string, string>;
}

export interface ProxyResponseChunkIn {
  type: 'proxy_http_response_chunk';
  requestId: string;
  chunk: string;
  /** `chunk` holds base64 bytes of a binary response, not text. */
  chunkEncoding?: 'base64';
}

export interface ProxyResponseDoneIn {
  type: 'proxy_http_response_done';
  requestId: string;
}

export interface ProxyErrorIn {
  type: 'proxy_http_error';
  requestId: string;
  error: string;
  /** HTTP status for the client (default 502) and a machine-readable code. */
  status?: number;
  code?: string;
}

export type ProxyResponseMessage =
  | ProxyResponseMetaIn
  | ProxyResponseChunkIn
  | ProxyResponseDoneIn
  | ProxyErrorIn;

interface ProxyConfig {
  port: number;
  sessionKey: string;
  providers: string[];
  /** Bridge token every client must present (see token.ts). */
  token: string;
  sendToExtension: (msg: ProxyMessageOut) => void;
}

type PendingResponse = {
  res: ServerResponse;
  timeout: ReturnType<typeof setTimeout>;
  /** Fails the request and has the upstream call stopped. */
  onTimeout: () => void;
};

const MAX_PENDING_REQUESTS = 100;
// Until the response headers arrive. A non-streaming reply sends them only
// once the model has finished, which can take minutes; the OpenAI and
// Anthropic SDKs wait 10 minutes by default.
const FIRST_BYTE_TIMEOUT_MS = 600_000;
// After the headers: idle, not total. Refreshed on every response chunk so
// a long stream that is still flowing never gets cut.
const IDLE_TIMEOUT_MS = 120_000;
const pendingRequests = new Map<string, PendingResponse>();

/**
 * Ports the bridge may bind. Anything else is refused — notably a string,
 * which Node's listen() would take as a Unix socket path.
 */
export function isValidProxyPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535;
}

// Browsers disconnect a native host that sends a message over 1 MiB.
const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;
// JSON escaping grows a UTF-16 unit to at most 6 bytes: 128K units < 1 MiB.
const NATIVE_SLICE_UNITS = 128 * 1024;

/** Split text into slices that each fit in one native message. */
export function sliceForNativeMessaging(text: string): string[] {
  const slices: string[] = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + NATIVE_SLICE_UNITS, text.length);
    // Never split a surrogate pair: the browser decodes each message alone.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    slices.push(text.slice(i, end));
    i = end;
  }
  return slices;
}

/**
 * The native messages for one proxied request. A body too large for a
 * single message goes ahead in slices; the request follows with
 * `bodyChunked` and the extension reassembles it.
 */
export function toNativeMessages(msg: ProxyRequestOut): Array<ProxyRequestOut | ProxyBodyChunkOut> {
  if (!msg.body || Buffer.byteLength(JSON.stringify(msg)) <= MAX_NATIVE_MESSAGE_BYTES) {
    return [msg];
  }
  const { body, ...rest } = msg;
  const chunks: ProxyBodyChunkOut[] = sliceForNativeMessaging(body).map((chunk) => ({
    type: 'proxy_http_body_chunk',
    requestId: msg.requestId,
    chunk,
  }));
  return [...chunks, { ...rest, bodyChunked: true }];
}

/**
 * Where clients put the bridge token: wherever their SDK puts an API key.
 * The bridge strips all of these before forwarding.
 */
const TOKEN_HEADERS = ['x-api-key', 'x-goog-api-key', 'api-key'];

function presentedTokens(req: IncomingMessage): string[] {
  const tokens: string[] = [];
  for (const name of TOKEN_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string' && value) tokens.push(value.trim());
  }
  const bearer = req.headers['authorization']?.match(/^Bearer\s+(.+)$/i);
  if (bearer) tokens.push(bearer[1].trim());
  return tokens;
}

/** Constant-time check; hashing first keeps differing lengths from leaking. */
function hasValidToken(req: IncomingMessage, token: string): boolean {
  const expected = createHash('sha256').update(token).digest();
  return presentedTokens(req).some((presented) =>
    timingSafeEqual(createHash('sha256').update(presented).digest(), expected),
  );
}

/**
 * Reject requests a browser made on behalf of a web page.
 *
 * The Host-header check below stops DNS rebinding, but not plain CSRF: a
 * page on any site can POST to http://127.0.0.1:<port>/... as a "simple
 * request" (no preflight) and the browser sets a passing `Host` itself.
 * Without this gate every visited website could drive the user's wallet
 * and burn their API quota.
 *
 * Two signals, both set by the browser and unforgeable from script:
 *   - `Origin`: present on every cross-origin fetch/XHR. Local CLI clients
 *     (Claude Code, OpenClaw, curl) never send it, so "absent" is the
 *     legitimate case. Extension origins are refused too: Byoky's own
 *     extension only talks to the bridge over native messaging, and any
 *     other installed extension has no business here.
 *   - `Sec-Fetch-Site`: a forbidden header name, so page script cannot set
 *     or clear it. Anything but `none`/`same-origin` came from a document
 *     on another site.
 */
function isBrowserCrossSiteRequest(req: IncomingMessage): boolean {
  const origin = req.headers['origin'];
  if (typeof origin === 'string' && origin.length > 0) return true;
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'none' && site !== 'same-origin') {
    return true;
  }
  return false;
}

export function handleProxyResponse(msg: ProxyResponseMessage): void {
  const pending = pendingRequests.get(msg.requestId);
  if (!pending) return;

  if (msg.type === 'proxy_http_response_meta') {
    const headers = { ...msg.headers };
    delete headers['transfer-encoding'];
    // Node.js fetch auto-decompresses gzip, so the body is already plain text.
    // Strip content-encoding to prevent the client from trying to decompress again.
    delete headers['content-encoding'];
    delete headers['content-length']; // Length no longer matches after decompression
    // Strip headers that could leak information or set state
    delete headers['set-cookie'];
    delete headers['set-cookie2'];
    pending.res.writeHead(msg.status, headers);
    clearTimeout(pending.timeout);
    pending.timeout = setTimeout(pending.onTimeout, IDLE_TIMEOUT_MS);
  } else if (msg.type === 'proxy_http_response_chunk') {
    pending.res.write(msg.chunkEncoding === 'base64' ? Buffer.from(msg.chunk, 'base64') : msg.chunk);
    pending.timeout.refresh();
  } else if (msg.type === 'proxy_http_response_done') {
    pending.res.end();
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.requestId);
  } else if (msg.type === 'proxy_http_error') {
    // A dead session (revoked, wallet locked, or past its 24 h) becomes a
    // clear 401 — the user needs to reconnect via `byoky-bridge connect`,
    // and a 502 would only make clients retry. `code` lets clients tell it
    // from a bad token. Newer extensions send the code; older ones only
    // the message.
    const isStaleSession = msg.code === 'bridge_session_expired' || (
      typeof msg.error === 'string' &&
      /unauthorized session key|session has expired|session not found/i.test(msg.error)
    );
    if (!pending.res.headersSent) {
      if (isStaleSession) {
        pending.res.writeHead(401, { 'Content-Type': 'application/json' });
        pending.res.end(JSON.stringify({
          error: 'Byoky bridge session expired or revoked',
          code: 'bridge_session_expired',
          hint: 'Run `byoky-bridge connect` to reconnect the wallet.',
        }));
      } else {
        const status = typeof msg.status === 'number' && msg.status >= 400 && msg.status < 600
          ? msg.status
          : 502;
        // The wallet refused the request (a spending limit, a provider not
        // in the session...): the same request would be refused again. The
        // Anthropic and OpenAI SDKs retry 408, 409, 429 and any 5xx unless
        // told not to. Only a reply without a status, a failure along the
        // way, stays retryable.
        const refused = status < 500 || typeof msg.code === 'string';
        pending.res.writeHead(status, {
          'Content-Type': 'application/json',
          ...(refused ? { 'x-should-retry': 'false' } : {}),
        });
        pending.res.end(JSON.stringify(
          typeof msg.code === 'string' ? { error: msg.error, code: msg.code } : { error: msg.error },
        ));
      }
    } else {
      // Mid-stream: drop the connection so the client sees a failed
      // response, not a body that just ends early.
      pending.res.destroy();
    }
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.requestId);
  }
}

/** Resolves once the server is listening; rejects if it can't bind. */
export function startProxyServer(config: ProxyConfig): Promise<Server> {
  const { port, sessionKey, providers, token, sendToExtension } = config;
  if (!isValidProxyPort(port)) return Promise.reject(new Error('Invalid port'));

  // Node does not catch rejections thrown out of an async request listener,
  // and an unhandled rejection terminates the process by default. Wrapping
  // the handler keeps a malformed request from killing the bridge.
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res).catch((err: unknown) => {
      process.stderr.write(
        `Byoky proxy request failed: ${err instanceof Error ? err.message : 'unknown'}\n`,
      );
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      try { res.end(JSON.stringify({ error: 'Internal bridge error' })); } catch { /* already closed */ }
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Reject DNS rebinding: only accept requests with a localhost Host header
    const host = req.headers.host || '';
    const hostWithoutPort = host.split(':')[0];
    if (hostWithoutPort !== '127.0.0.1' && hostWithoutPort !== 'localhost') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid Host header' }));
      return;
    }

    // CSRF: refuse anything a browser issued for a web page. Checked before
    // every route, including /health.
    if (isBrowserCrossSiteRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: cross-site request' }));
      return;
    }

    if (req.method === 'OPTIONS') {
      // No CORS headers are emitted anywhere in this server, so a browser
      // preflight can never succeed. Answering 204 just keeps non-browser
      // clients that probe with OPTIONS happy.
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check: open for liveness probes; the provider list needs the token.
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hasValidToken(req, token) ? { status: 'ok', providers } : { status: 'ok' }));
      return;
    }

    // Every other route needs the bridge token, checked before anything
    // that could tell an unauthenticated caller about the session.
    if (!hasValidToken(req, token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Missing or invalid bridge token',
        code: 'bridge_token_invalid',
        hint: 'Send the output of `byoky-bridge token` as the API key, e.g. export ANTHROPIC_API_KEY=$(byoky-bridge token)',
      }));
      return;
    }

    // Reject excessively long URIs to prevent resource exhaustion
    if ((req.url?.length ?? 0) > MAX_URI_LENGTH) {
      res.writeHead(414, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'URI too long' }));
      return;
    }

    // Parse: /<providerId>/rest/of/path
    const match = req.url?.match(/^\/([^/]+)(\/.*)?$/);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown route. Use /<providerId>/...' }));
      return;
    }

    const providerId = match[1];
    const path = match[2] || '/';

    if (!providers.includes(providerId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Provider "${providerId}" not available in this session` }));
      return;
    }

    // Reject oversized requests early based on Content-Length header
    const declaredLength = parseInt(req.headers['content-length'] || '0', 10);
    if (declaredLength > MAX_BODY_SIZE) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }));
      return;
    }

    // Read request body. readBody rejects when the stream exceeds
    // MAX_BODY_SIZE — which a chunked request slips past the Content-Length
    // pre-check above. Left unhandled, that rejection escapes this async
    // listener and takes the whole bridge process down.
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Payload too large' }));
      return;
    }

    // Build the real URL from the provider's registered base URL. For
    // Azure, Ollama and LM Studio that is a placeholder host; the extension
    // puts the credential's own host in its place.
    const baseUrl = Object.hasOwn(PROVIDERS, providerId) ? PROVIDERS[providerId].baseUrl : undefined;
    if (!baseUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown provider base URL for "${providerId}"` }));
      return;
    }

    const realUrl = `${baseUrl}${path}`;

    const requestId = `proxy-${crypto.randomUUID()}`;

    // Forward headers, stripping hop-by-hop headers and the bridge token
    // (defense-in-depth; the extension's buildHeaders() does the
    // authoritative sanitization).
    const STRIP_HEADERS = new Set([
      'host', 'connection', 'cookie', 'authorization',
      'proxy-authorization', 'proxy-connection', ...TOKEN_HEADERS,
    ]);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (STRIP_HEADERS.has(key)) continue;
      if (typeof value === 'string') headers[key] = value;
    }

    // Send to extension via native messaging — the extension will inject the key
    const proxyMsg: ProxyRequestOut = {
      type: 'proxy_http',
      requestId,
      sessionKey,
      providerId,
      url: realUrl,
      method: req.method || 'GET',
      headers,
      ...encodeBody(body),
      reportsDirectFetch: true,
      acceptsBinaryChunks: true,
    };

    if (pendingRequests.size >= MAX_PENDING_REQUESTS) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many concurrent requests' }));
      return;
    }

    const onTimeout = () => {
      if (!pendingRequests.delete(requestId)) return;
      // The client gets an error either way. Stop the upstream call too, or
      // it runs, and bills, to the end.
      sendToExtension({ type: 'proxy_http_cancel', requestId });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // SDKs retry a 504 twice by default, and each retry would wait as long.
      res.writeHead(504, { 'Content-Type': 'application/json', 'x-should-retry': 'false' });
      res.end(JSON.stringify({ error: 'Request timed out' }));
    };

    pendingRequests.set(requestId, {
      res,
      timeout: setTimeout(onTimeout, FIRST_BYTE_TIMEOUT_MS),
      onTimeout,
    });

    // Still pending when the connection closes means the client hung up
    // (Ctrl-C in Claude Code). Have the upstream call stopped rather than
    // letting it run, and bill, to the end.
    res.on('close', () => {
      const pending = pendingRequests.get(requestId);
      if (pending?.res !== res) return;
      clearTimeout(pending.timeout);
      pendingRequests.delete(requestId);
      sendToExtension({ type: 'proxy_http_cancel', requestId });
    });

    for (const msg of toNativeMessages(proxyMsg)) sendToExtension(msg);
  }

  return new Promise((resolve, reject) => {
    // Without an 'error' listener a taken port is an uncaught exception
    // that kills the whole native host.
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      server.on('error', (err) => {
        process.stderr.write(`Byoky proxy error: ${err.message}\n`);
      });
      process.stderr.write(`Byoky proxy listening on http://127.0.0.1:${port}\n`);
      resolve(server);
    });
  });
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_URI_LENGTH = 8192;

/**
 * A native message carries text only. A body that is not valid UTF-8
 * (multipart audio, an image) would have every invalid byte turned into
 * U+FFFD, so it goes as base64 instead.
 */
function encodeBody(body: Buffer): Pick<ProxyRequestOut, 'body' | 'bodyEncoding'> {
  if (body.length === 0) return {};
  // Decode once, at the end: a multi-byte character can straddle chunks.
  const text = body.toString('utf-8');
  if (Buffer.from(text, 'utf-8').equals(body)) return { body: text };
  return { body: body.toString('base64'), bodyEncoding: 'base64' };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
