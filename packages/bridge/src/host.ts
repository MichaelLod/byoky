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
  isValidProxyPort,
  sliceForNativeMessaging,
  type ProxyResponseMessage,
} from './proxy-server.js';
import { loadOrCreateToken } from './token.js';
import { createMessageReader } from './native-messaging.js';
import { createToolNameSSERewriter, parseUsage, rewriteToolNamesInJSONBody } from '@byoky/core';

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
  /** Upstream provider, for reading token usage out of the response. */
  providerId?: string;
}

/**
 * Sent back to the extension when a direct fetch ends, however it ends. The
 * bridge is the only one that sees this response, so the wallet's request
 * log and allowances depend on it.
 */
interface DirectFetchDone {
  type: 'proxy_direct_done';
  requestId: string;
  status: number;
  /** The upstream response was read to its end. */
  complete: boolean;
  /** Characters of response seen, for estimating a cut-off response. */
  responseChars: number;
  usage?: { inputTokens: number; outputTokens: number };
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

// The browser allows up to 64 MiB per message; past this one is dropped
// rather than buffered.
const MAX_INCOMING_MESSAGE_BYTES = 20_971_520; // 20 MiB

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
    const controller = new AbortController();
    directFetches.set(req.requestId, controller);
    let outcome: FetchOutcome;
    try {
      outcome = await handleStreamingFetch(
        req.requestId, req.url, req.method, req.headers, req.body, 'proxy_http', req.toolNameMap, controller,
      );
    } finally {
      directFetches.delete(req.requestId);
    }
    // Report what was seen, also when the client hung up or the stream broke
    // off; the extension then charges an estimate. Usage is parsed the same
    // way the extension parses it.
    writeMessage({
      type: 'proxy_direct_done',
      requestId: req.requestId,
      status: outcome.status,
      complete: outcome.complete,
      responseChars: outcome.responseText.length,
      usage: req.providerId && outcome.status < 400
        ? parseUsage(req.providerId, outcome.responseText)
        : undefined,
    } satisfies DirectFetchDone);
    return;
  }

  // Start HTTP proxy server for CLI tools (OpenClaw)
  if (message.type === 'start-proxy') {
    const req = msg as StartProxyRequest;
    await handleStartProxy(req);
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
/**
 * Anthropic beta-header values that opt the request into a billing tier the
 * caller probably can't afford on a Pro/Max OAuth token. Their mere presence
 * (regardless of actual context size) routes the request through long-context
 * billing, so we strip them on OAuth paths to api.anthropic.com to keep
 * non-Claude-Code traffic indistinguishable from Claude Code's own.
 */
const OAUTH_INCOMPATIBLE_BETAS = new Set(['context-1m-2025-08-07']);

function stripIncompatibleBetas(url: string, headers: Record<string, string>): Record<string, string> {
  const auth = headers['authorization'] || headers['Authorization'] || '';
  if (!url.includes('api.anthropic.com') || !auth.toLowerCase().startsWith('bearer ')) return headers;
  const beta = headers['anthropic-beta'] || headers['Anthropic-Beta'];
  if (!beta) return headers;
  const filtered = beta.split(',').map((s) => s.trim()).filter((s) => s && !OAUTH_INCOMPATIBLE_BETAS.has(s));
  if (filtered.length === beta.split(',').map((s) => s.trim()).length) return headers;
  const next = { ...headers };
  if ('Anthropic-Beta' in next) delete next['Anthropic-Beta'];
  if (filtered.length > 0) {
    next['anthropic-beta'] = filtered.join(',');
  } else {
    delete next['anthropic-beta'];
  }
  return next;
}

const FETCH_IDLE_TIMEOUT_MS = 120_000;

// Direct fetches in flight, so a client hang-up can abort the upstream call.
const directFetches = new Map<string, AbortController>();

interface FetchOutcome {
  /** Upstream status, or 502 when no response arrived. */
  status: number;
  /** The response body was read to its end. */
  complete: boolean;
  /** The raw upstream body, as far as it was read. */
  responseText: string;
}

async function handleStreamingFetch(
  requestId: string,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  mode: 'bridge' | 'proxy_http',
  toolNameMap: Record<string, string> = {},
  controller = new AbortController(),
): Promise<FetchOutcome> {
  const outcome: FetchOutcome = { status: 502, complete: false, responseText: '' };
  const seen: string[] = [];

  const send = (msg: unknown) => {
    if (mode === 'bridge') {
      writeMessage(msg);
    } else {
      handleProxyResponse(msg as ProxyResponseMessage);
    }
  };

  const prefix = mode === 'bridge' ? 'proxy_response' : 'proxy_http_response';
  const errorType = mode === 'bridge' ? 'proxy_error' : 'proxy_http_error';

  headers = stripIncompatibleBetas(url, headers);

  // SSE rewriter that translates Claude-Code aliases back to the framework's
  // original tool names. Identity passthrough when the map is empty.
  // Used only for streaming responses (text/event-stream); non-streaming
  // JSON responses go through the JSON-body rewriter at the end.
  const rewriter = createToolNameSSERewriter(toolNameMap);

  // Each slice fits in one native message; the browser drops bigger ones.
  const sendChunk = (text: string) => {
    for (const chunk of sliceForNativeMessaging(text)) {
      send({ type: `${prefix}_chunk`, requestId, chunk });
    }
  };

  // Idle timeout: refreshed whenever the upstream sends something, so only a
  // stalled request is aborted, never a long stream that is still flowing.
  const idleTimeout = setTimeout(() => controller.abort(), FETCH_IDLE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: controller.signal,
      // Provider auth headers (x-api-key etc.) would survive a cross-host
      // redirect, so never follow one.
      redirect: 'error',
    });
    idleTimeout.refresh();
    outcome.status = res.status;

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });

    send({ type: `${prefix}_meta`, requestId, status: res.status, headers: resHeaders });

    // Decide between streaming and one-shot rewrite paths based on the
    // response Content-Type. Streaming SSE → use the SSE rewriter chunk by
    // chunk. JSON body → buffer everything, then rewrite once at the end.
    const isStreaming = (resHeaders['content-type'] ?? '').includes('text/event-stream');

    if (res.body) {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      if (isStreaming) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          idleTimeout.refresh();
          const raw = decoder.decode(value, { stream: true });
          seen.push(raw);
          const rewritten = rewriter.process(raw);
          if (rewritten) sendChunk(rewritten);
        }
        const tail = rewriter.flush();
        if (tail) sendChunk(tail);
      } else {
        // Non-streaming JSON: buffer the whole body, JSON-rewrite tool
        // names, then send it.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          idleTimeout.refresh();
          seen.push(decoder.decode(value, { stream: true }));
        }
        seen.push(decoder.decode());
        sendChunk(rewriteToolNamesInJSONBody(seen.join(''), toolNameMap));
      }
    }

    outcome.complete = true;
    send({ type: `${prefix}_done`, requestId });
  } catch (e) {
    send({ type: errorType, requestId, error: 'Fetch request failed' });
  } finally {
    clearTimeout(idleTimeout);
  }
  outcome.responseText = seen.join('');
  return outcome;
}

interface RunningProxy {
  server: import('node:http').Server;
  sessionKey: string;
  port: number;
  providers: string[];
}
let runningProxy: RunningProxy | null = null;

async function handleStartProxy(req: StartProxyRequest): Promise<void> {
  // Validate before touching a running proxy, so a bad request can't take
  // down a working one.
  if (
    !isValidProxyPort(req.port) ||
    typeof req.sessionKey !== 'string' || !req.sessionKey ||
    !Array.isArray(req.providers) || req.providers.some((p) => typeof p !== 'string')
  ) {
    writeMessage({ type: 'proxy_error', requestId: 'start-proxy', error: 'Invalid start-proxy request' });
    return;
  }

  // Same session already running → ack and exit. This is the steady-state
  // case (browser tab refreshes, extension service worker reconnect, etc.).
  if (runningProxy && runningProxy.sessionKey === req.sessionKey && runningProxy.port === req.port) {
    writeMessage({ type: 'proxy-started', port: req.port } satisfies StartProxyResponse);
    return;
  }

  // Different session/port → tear down the old listener so we don't keep
  // forwarding requests with a stale (likely revoked) sessionKey.
  if (runningProxy) {
    try { runningProxy.server.close(); } catch { /* best-effort */ }
    runningProxy = null;
  }

  try {
    const server = await startProxyServer({
      port: req.port,
      sessionKey: req.sessionKey,
      providers: req.providers,
      token: loadOrCreateToken(),
      sendToExtension: (msg) => {
        // A hang-up also stops a fetch the bridge is making itself. The
        // extension gets the cancel too; older ones ignore it.
        if (msg.type === 'proxy_http_cancel') directFetches.get(msg.requestId)?.abort();
        writeMessage(msg);
      },
    });
    runningProxy = { server, sessionKey: req.sessionKey, port: req.port, providers: req.providers };
    writeMessage({ type: 'proxy-started', port: req.port } satisfies StartProxyResponse);
  } catch (e) {
    const inUse = (e as NodeJS.ErrnoException).code === 'EADDRINUSE';
    writeMessage({
      type: 'proxy_error',
      requestId: 'start-proxy',
      error: inUse ? `Port ${req.port} is already in use` : 'Failed to start proxy server',
    });
  }
}

// --- Main loop ---

// The extension launches a host process for every availability ping and
// setup-token request too, so the HTTP proxy only ever starts on an
// explicit `start-proxy`. (The extension re-sends it after a service-worker
// restart; restoring a saved session at launch made every short-lived host
// race the real one for the port.)
//
// Messages are handled concurrently: a long streaming fetch must not hold
// up the next request or a `proxy_http_response_*` message.
process.stdin.on('data', createMessageReader((msg) => {
  void handleMessage(msg).catch((e: unknown) => {
    process.stderr.write(`byoky-bridge: ${e instanceof Error ? e.message : 'message failed'}\n`);
  });
}, MAX_INCOMING_MESSAGE_BYTES));
// stdin closed = extension disconnected
process.stdin.on('end', () => process.exit(0));
