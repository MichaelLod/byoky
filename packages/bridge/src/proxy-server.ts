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
}

type PendingResponse = {
  res: ServerResponse;
  timeout: ReturnType<typeof setTimeout>;
};

const MAX_PENDING_REQUESTS = 100;
const pendingRequests = new Map<string, PendingResponse>();

export function handleProxyResponse(msg: ProxyResponseMessage): void {
  const pending = pendingRequests.get(msg.requestId);
  if (!pending) return;

  if (msg.type === 'proxy_http_response_meta') {
    const headers = { ...msg.headers };
    delete headers['transfer-encoding'];
    pending.res.writeHead(msg.status, headers);
  } else if (msg.type === 'proxy_http_response_chunk') {
    pending.res.write(msg.chunk);
  } else if (msg.type === 'proxy_http_response_done') {
    pending.res.end();
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.requestId);
  } else if (msg.type === 'proxy_http_error') {
    if (!pending.res.headersSent) {
      pending.res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    pending.res.end(JSON.stringify({ error: msg.error }));
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.requestId);
  }
}

export function startProxyServer(config: ProxyConfig): Server {
  const { port, sessionKey, providers, sendToExtension } = config;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Reject DNS rebinding: only accept requests with a localhost Host header
    const host = req.headers.host || '';
    const hostWithoutPort = host.split(':')[0];
    if (hostWithoutPort !== '127.0.0.1' && hostWithoutPort !== 'localhost') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid Host header' }));
      return;
    }

    if (req.method === 'OPTIONS') {
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

    // Read request body
    const body = await readBody(req);

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
      replicate: 'https://api.replicate.com',
      openrouter: 'https://openrouter.ai/api',
      huggingface: 'https://api-inference.huggingface.co',
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

    // Forward headers (strip host)
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === 'host' || key === 'connection') continue;
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
  });

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`Byoky proxy listening on http://127.0.0.1:${port}\n`);
  });

  return server;
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

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
