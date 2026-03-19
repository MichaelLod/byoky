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

export interface ProxyResponseIn {
  type: 'proxy_http_response';
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ProxyErrorIn {
  type: 'proxy_http_error';
  requestId: string;
  error: string;
}

interface ProxyConfig {
  port: number;
  sessionKey: string;
  providers: string[];
  sendToExtension: (msg: ProxyRequestOut) => void;
}

type PendingResponse = {
  resolve: (response: ProxyResponseIn) => void;
  reject: (error: Error) => void;
};

const pendingRequests = new Map<string, PendingResponse>();

export function handleProxyResponse(msg: ProxyResponseIn | ProxyErrorIn): void {
  if (msg.type === 'proxy_http_response') {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      pending.resolve(msg);
      pendingRequests.delete(msg.requestId);
    }
  } else if (msg.type === 'proxy_http_error') {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      pending.reject(new Error(msg.error));
      pendingRequests.delete(msg.requestId);
    }
  }
}

export function startProxyServer(config: ProxyConfig): Server {
  const { port, sessionKey, providers, sendToExtension } = config;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS for local tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

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
    const requestId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

    try {
      const response = await new Promise<ProxyResponseIn>((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });

        // Timeout after 120s
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            reject(new Error('Request timed out'));
          }
        }, 120_000);

        sendToExtension(proxyMsg);
      });

      // Return the response from the extension
      const responseHeaders: Record<string, string> = { ...response.headers };
      delete responseHeaders['transfer-encoding']; // Node handles this

      res.writeHead(response.status, responseHeaders);
      res.end(response.body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`Byoky proxy listening on http://127.0.0.1:${port}\n`);
  });

  return server;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}
