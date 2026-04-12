import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  buildHeaders,
  injectClaudeCodeSystemPrompt,
  rewriteToolNamesForClaudeCode,
  rewriteToolNamesInJSONBody,
  createToolNameSSERewriter,
} from '@byoky/core';

// Stand-in for the byoky extension's bridge. Accepts requests on /<provider>/...
// just like the real bridge, applies the same Claude-Code-first-party rewrite
// the extension applies in production (imported from @byoky/core — no reimpl),
// injects the real credential from the environment, and forwards upstream.

const PORT = Number(process.env.BRIDGE_PORT ?? 19280);

const UPSTREAMS = {
  anthropic: { host: 'api.anthropic.com', envKey: 'ANTHROPIC_API_KEY' },
  openai: { host: 'api.openai.com', envKey: 'OPENAI_API_KEY' },
};

const availableProviders = () =>
  Object.keys(UPSTREAMS).filter((id) => process.env[UPSTREAMS[id].envKey]);

const requests = [];

function flattenHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

function detectAuthMethod(provider, apiKey) {
  if (provider === 'anthropic' && apiKey.startsWith('sk-ant-oat')) return 'oauth';
  return 'api_key';
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', providers: availableProviders() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/__test/requests') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(requests));
    return;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const provider = segments[0];
  const upstream = UPSTREAMS[provider];

  if (!upstream) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `unknown provider: ${provider}` } }));
    return;
  }

  const apiKey = process.env[upstream.envKey];
  if (!apiKey) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: `${upstream.envKey} not set in bridge environment` },
    }));
    return;
  }

  const upstreamPath = '/' + segments.slice(1).join('/') + (url.search || '');
  const authMethod = detectAuthMethod(provider, apiKey);

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let body = Buffer.concat(chunks).toString('utf-8');

    // Apply byoky's request-side transforms for anthropic/oauth (the exact
    // thing the extension does in production — this is why we import from
    // @byoky/core instead of reimplementing).
    let toolNameMap = {};
    let isThirdParty = false;
    if (
      provider === 'anthropic' &&
      authMethod === 'oauth' &&
      upstreamPath.startsWith('/v1/messages')
    ) {
      const rewritten = rewriteToolNamesForClaudeCode(body);
      body = rewritten.body ?? body;
      toolNameMap = rewritten.toolNameMap;
      isThirdParty = Object.keys(toolNameMap).length > 0;
      const relocated = injectClaudeCodeSystemPrompt(body, {
        relocateExisting: isThirdParty,
      });
      if (relocated) body = relocated;
    }

    const headers = buildHeaders(
      provider,
      flattenHeaders(req.headers),
      apiKey,
      authMethod,
    );
    // Strip forwarded Host (it still points at 127.0.0.1:19280) — https.request
    // will set the correct one from the hostname option.
    delete headers['host'];
    delete headers['connection'];
    headers['accept-encoding'] = 'identity';
    headers['content-length'] = String(Buffer.byteLength(body, 'utf-8'));

    const upstreamReq = httpsRequest(
      {
        hostname: upstream.host,
        servername: upstream.host,
        port: 443,
        path: upstreamPath,
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        const status = upstreamRes.statusCode ?? 502;
        const rewrittenTools = Object.keys(toolNameMap).length;
        requests.push({
          provider,
          path: url.pathname,
          method: req.method,
          upstreamStatus: status,
          authMethod,
          isThirdParty,
          toolsRewritten: rewrittenTools,
        });
        console.log(
          `[bridge] ${provider}(${authMethod}) ${req.method} ${upstreamPath} -> ${status}` +
            (isThirdParty
              ? ` [rewrote ${rewrittenTools} tools + relocated system]`
              : ''),
        );

        const upstreamHeaders = { ...upstreamRes.headers };
        delete upstreamHeaders['content-encoding'];
        const contentType = String(upstreamRes.headers['content-type'] ?? '');

        if (rewrittenTools === 0) {
          res.writeHead(status, upstreamHeaders);
          upstreamRes.pipe(res);
          return;
        }

        if (contentType.includes('text/event-stream')) {
          delete upstreamHeaders['content-length'];
          res.writeHead(status, upstreamHeaders);
          const rewriter = createToolNameSSERewriter(toolNameMap);
          upstreamRes.setEncoding('utf-8');
          upstreamRes.on('data', (chunk) => res.write(rewriter.process(chunk)));
          upstreamRes.on('end', () => res.end(rewriter.flush()));
          upstreamRes.on('error', () => res.end());
          return;
        }

        if (contentType.includes('application/json')) {
          const respChunks = [];
          upstreamRes.on('data', (chunk) => respChunks.push(chunk));
          upstreamRes.on('end', () => {
            const raw = Buffer.concat(respChunks).toString('utf-8');
            const rewritten = rewriteToolNamesInJSONBody(raw, toolNameMap);
            delete upstreamHeaders['content-length'];
            upstreamHeaders['content-length'] = String(
              Buffer.byteLength(rewritten, 'utf-8'),
            );
            res.writeHead(status, upstreamHeaders);
            res.end(rewritten);
          });
          return;
        }

        res.writeHead(status, upstreamHeaders);
        upstreamRes.pipe(res);
      },
    );

    upstreamReq.on('error', (err) => {
      console.error(`[bridge] upstream error: ${err.message}`);
      requests.push({
        provider,
        path: url.pathname,
        method: req.method,
        upstreamStatus: 0,
        error: err.message,
      });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: `bridge upstream error: ${err.message}` },
          }),
        );
      } else {
        res.end();
      }
    });

    if (body.length > 0) upstreamReq.write(body);
    upstreamReq.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const ready = availableProviders();
  console.log(
    `[bridge] listening on 127.0.0.1:${PORT} — upstreams with credentials: ${
      ready.length ? ready.join(', ') : '(none!)'
    }`,
  );
});
