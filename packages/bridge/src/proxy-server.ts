/**
 * HTTP Proxy Server for Byoky Bridge.
 *
 * Generic local gateway for CLI tools, desktop apps, and local servers
 * to make LLM API calls through the user's Byoky wallet. The bridge
 * is a dumb relay — it forwards requests to the browser extension via
 * native messaging. The extension injects the real API key and makes
 * the actual API call. Keys NEVER touch the bridge process.
 *
 * Flow:
 *   Local App → HTTP → Bridge → Native Messaging → Extension → fetch(real API)
 *                                                     ↓
 *   Local App ← HTTP ← Bridge ← Native Messaging ← Extension ← response
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

export interface ProxyRequestOut {
  type: 'proxy_http';
  requestId: string;
  sessionKey: string;
  providerId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** The body was sent ahead in `proxy_http_body_chunk` messages. */
  bodyChunked?: true;
  /**
   * This bridge answers `proxy_direct_fetch` with `proxy_direct_done`, so
   * the extension can wait for the real status and usage before logging.
   */
  reportsDirectFetch: true;
}

export interface ProxyBodyChunkOut {
  type: 'proxy_http_body_chunk';
  requestId: string;
  chunk: string;
}

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
  sendToExtension: (msg: ProxyRequestOut | ProxyBodyChunkOut) => void;
}

type PendingResponse = {
  res: ServerResponse;
  timeout: ReturnType<typeof setTimeout>;
};

const MAX_PENDING_REQUESTS = 100;
// Idle, not total: refreshed on every response chunk so a long stream that
// is still flowing never gets cut.
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
    pending.timeout.refresh();
  } else if (msg.type === 'proxy_http_response_chunk') {
    pending.res.write(msg.chunk);
    pending.timeout.refresh();
  } else if (msg.type === 'proxy_http_response_done') {
    pending.res.end();
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.requestId);
  } else if (msg.type === 'proxy_http_error') {
    // Translate the extension's "Unauthorized session key" into a clearer
    // 401 — the key is dead and the user needs to reconnect via
    // `byoky-bridge connect`. `code` lets clients tell it from a bad token.
    const isStaleSession =
      typeof msg.error === 'string' && /unauthorized session key/i.test(msg.error);
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
        pending.res.writeHead(status, { 'Content-Type': 'application/json' });
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
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Payload too large' }));
      return;
    }

    // Build the real URL from the provider's base URL
    const providerUrls: Record<string, string> = {
      anthropic: 'https://api.anthropic.com',
      openai: 'https://api.openai.com',
      gemini: 'https://generativelanguage.googleapis.com',
      mistral: 'https://api.mistral.ai',
      cohere: 'https://api.cohere.com',
      xai: 'https://api.x.ai',
      deepseek: 'https://api.deepseek.com',
      perplexity: 'https://api.perplexity.ai',
      groq: 'https://api.groq.com',
      together: 'https://api.together.xyz',
      fireworks: 'https://api.fireworks.ai',
      openrouter: 'https://openrouter.ai/api',
      azure_openai: 'https://YOUR_RESOURCE.openai.azure.com',
    };

    const baseUrl = providerUrls[providerId];
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
      body: body || undefined,
      reportsDirectFetch: true,
    };

    if (pendingRequests.size >= MAX_PENDING_REQUESTS) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many concurrent requests' }));
      return;
    }

    const timeout = setTimeout(() => {
      if (!pendingRequests.delete(requestId)) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timed out' }));
    }, IDLE_TIMEOUT_MS);

    pendingRequests.set(requestId, { res, timeout });
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    // Decode once at the end: a multi-byte character can straddle chunks.
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
