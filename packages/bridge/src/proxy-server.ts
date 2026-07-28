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
import { clearSession } from './session-store.js';

export interface ProxyRequestOut {
  type: 'proxy_http';
  requestId: string;
  sessionKey: string;
  providerId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
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
  sendToExtension: (msg: ProxyRequestOut) => void;
  /**
   * Optional request validator. Receives the outbound provider URL and can
   * return a string error to reject the request with 400. Used by relay-mode
   * to apply the same URL hygiene the SDK enforces on the browser side.
   */
  validateUrl?: (providerId: string, url: string) => string | null;
}

type PendingResponse = {
  res: ServerResponse;
  timeout: ReturnType<typeof setTimeout>;
};

const MAX_PENDING_REQUESTS = 100;
const pendingRequests = new Map<string, PendingResponse>();

/**
 * Reject requests a browser made on behalf of a web page.
 *
 * The Host-header check below stops DNS rebinding, but not plain CSRF: a
 * page on any site can POST to http://127.0.0.1:<port>/... as a "simple
 * request" (no preflight) and the browser sets a passing `Host` itself.
 * Without this gate every visited website could drive the user's wallet
 * (burning their API quota) or POST /_shutdown to kill the bridge.
 *
 * Two signals, both set by the browser and unforgeable from script:
 *   - `Origin`: present on every cross-origin fetch/XHR. Local CLI clients
 *     (Claude Code, OpenClaw, curl) never send it, so "absent" is the
 *     legitimate case. Extension origins are allowed — that is how the
 *     wallet's own pages talk to the bridge.
 *   - `Sec-Fetch-Site`: a forbidden header name, so page script cannot set
 *     or clear it. Anything but `none`/`same-origin` came from a document
 *     on another site.
 */
const EXTENSION_ORIGIN_RE = /^(chrome|moz|safari-web)-extension:\/\//i;

function isBrowserCrossSiteRequest(req: IncomingMessage): boolean {
  const origin = req.headers['origin'];
  if (typeof origin === 'string' && origin.length > 0) {
    if (!EXTENSION_ORIGIN_RE.test(origin)) return true;
  }
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
  } else if (msg.type === 'proxy_http_response_chunk') {
    pending.res.write(msg.chunk);
  } else if (msg.type === 'proxy_http_response_done') {
    pending.res.end();
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.requestId);
  } else if (msg.type === 'proxy_http_error') {
    // Translate the extension's "Unauthorized session key" into a clearer 401
    // and drop the persisted session — the cached key is dead and the user
    // needs to re-pair via `byoky-bridge connect`.
    const isStaleSession =
      typeof msg.error === 'string' && /unauthorized session key/i.test(msg.error);
    if (!pending.res.headersSent) {
      if (isStaleSession) {
        clearSession();
        pending.res.writeHead(401, { 'Content-Type': 'application/json' });
        pending.res.end(JSON.stringify({
          error: 'Byoky bridge session expired or revoked',
          hint: 'Run `byoky-bridge connect` to re-pair the wallet.',
        }));
      } else {
        pending.res.writeHead(502, { 'Content-Type': 'application/json' });
        pending.res.end(JSON.stringify({ error: msg.error }));
      }
    } else {
      pending.res.end();
    }
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.requestId);
  }
}

export function startProxyServer(config: ProxyConfig): Server {
  const { port, sessionKey, providers, sendToExtension, validateUrl } = config;

  // Node does not catch rejections thrown out of an async request listener,
  // and an unhandled rejection terminates the process by default. Wrapping
  // the handler keeps a malformed request from killing the bridge.
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res).catch((err: unknown) => {
      process.stderr.write(
        `Byoky proxy request failed: ${err instanceof Error ? err.message : 'unknown'}\n`,
      );
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
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
    // every route, including /health and /_shutdown.
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

    // Health check
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', providers }));
      return;
    }

    // Graceful shutdown — used by the OpenClaw plugin to replace a stale
    // bridge bound to an old relay room. Reachable only from a local process:
    // the Host-header check pins it to loopback and isBrowserCrossSiteRequest
    // rejects the browser-driven CSRF path (any visited page could otherwise
    // POST here and kill the bridge). POST only — avoids link-preview
    // fetches tripping it.
    if (req.method === 'POST' && req.url === '/_shutdown') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      // Let the response flush before exiting.
      setTimeout(() => process.exit(0), 50);
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

    if (validateUrl) {
      const err = validateUrl(providerId, realUrl);
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err }));
        return;
      }
    }

    const requestId = `proxy-${crypto.randomUUID()}`;

    // Forward headers, stripping hop-by-hop and auth headers (defense-in-depth;
    // the extension's buildHeaders() does the authoritative sanitization).
    const STRIP_HEADERS = new Set([
      'host', 'connection', 'cookie', 'authorization',
      'proxy-authorization', 'proxy-connection',
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
    };

    if (pendingRequests.size >= MAX_PENDING_REQUESTS) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many concurrent requests' }));
      return;
    }

    const timeout = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Request timed out' }));
      }
    }, 120_000);

    pendingRequests.set(requestId, { res, timeout });
    sendToExtension(proxyMsg);
  }

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`Byoky proxy listening on http://127.0.0.1:${port}\n`);
  });

  return server;
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_URI_LENGTH = 8192;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
