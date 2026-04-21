/**
 * Relay-mode bridge.
 *
 * Runs the same HTTP proxy on 127.0.0.1:<port> as the extension-backed
 * bridge, but instead of forwarding requests via native messaging to a
 * browser extension, it opens a WebSocket to the Byoky relay as a
 * `recipient` and forwards requests to the user's mobile wallet (the
 * `sender` in the relay room).
 *
 * This is the entrypoint when OpenClaw pairs with a mobile wallet rather
 * than a browser extension. The mobile apps already accept `relay:request`
 * frames and resolve them with the user's wallet credentials via
 * `RelayPairService` (packages/ios & packages/android).
 */
/// <reference lib="dom" />

import WebSocket from 'ws';
import { validateProxyUrl } from '@byoky/core';
import {
  startProxyServer,
  handleProxyResponse,
  type ProxyRequestOut,
  type ProxyResponseMessage,
} from './proxy-server.js';

export interface RelayModeConfig {
  port: number;
  relayUrl: string;
  roomId: string;
  authToken: string;
  providers: string[];
}

interface PendingRelayRequest {
  providerId: string;
  /**
   * Whether the meta frame has been forwarded. The bridge's proxy-server
   * consumer (`handleProxyResponse`) sequences on meta → chunks → done,
   * so we only forward chunks once the meta has gone out.
   */
  metaSeen: boolean;
  /** Chunks that arrived before the meta frame. Flushed when meta lands. */
  pendingChunks: string[];
  /** `done` that arrived before meta. Flushed after the meta + pendingChunks. */
  doneBuffered: boolean;
}

// Millisecond cap on the initial WS open — past this we exit so the CLI
// surfaces a visible failure instead of a zombie bridge that will never
// successfully proxy a request.
const CONNECT_TIMEOUT_MS = 10_000;

// Keep-alive ping cadence. Relay idle timeout is 5 min server-side, so 2 min
// is a comfortable margin that still catches a silently-dropped TCP connection
// in a reasonable window.
const PING_INTERVAL_MS = 120_000;

// Reconnect backoff when the WS drops. Caps at 30s so a long mobile
// backgrounding doesn't leave us hammering the relay.
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function startRelayMode(config: RelayModeConfig): void {
  const { port, relayUrl, roomId, authToken, providers } = config;

  const pendingByRequestId = new Map<string, PendingRelayRequest>();

  // A single ws ref that swaps across reconnects. Outbound sends queue while
  // it's not OPEN so in-flight HTTP calls don't fail on a momentary blip.
  let ws: WebSocket | null = null;
  let authed = false;
  let reconnectDelay = RECONNECT_MIN_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  // Outbound queue for frames written while the socket is not yet OPEN or
  // not yet authed. Bounded so a relay outage can't grow unbounded memory.
  const MAX_QUEUE = 200;
  const outboundQueue: string[] = [];

  function sendFrame(frame: unknown): boolean {
    const json = JSON.stringify(frame);
    if (ws && ws.readyState === WebSocket.OPEN && authed) {
      ws.send(json);
      return true;
    }
    if (outboundQueue.length >= MAX_QUEUE) return false;
    outboundQueue.push(json);
    return true;
  }

  function drainQueue() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !authed) return;
    while (outboundQueue.length) {
      const json = outboundQueue.shift()!;
      ws.send(json);
    }
  }

  function connect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    authed = false;
    let sock: WebSocket;
    try {
      sock = new WebSocket(relayUrl);
    } catch (e) {
      process.stderr.write(`Byoky relay: failed to open WS: ${(e as Error).message}\n`);
      scheduleReconnect();
      return;
    }
    ws = sock;

    connectTimeoutTimer = setTimeout(() => {
      if (!authed) {
        try { sock.close(); } catch {}
      }
    }, CONNECT_TIMEOUT_MS);

    sock.on('open', () => {
      sock.send(JSON.stringify({
        type: 'relay:auth',
        roomId,
        authToken,
        role: 'recipient',
      }));
    });

    sock.on('message', (raw: Buffer) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(raw.toString('utf-8'));
      } catch {
        return;
      }

      if (msg.type === 'relay:auth:result') {
        if (msg.success) {
          authed = true;
          reconnectDelay = RECONNECT_MIN_MS;
          if (connectTimeoutTimer) {
            clearTimeout(connectTimeoutTimer);
            connectTimeoutTimer = null;
          }
          process.stderr.write(
            `Byoky relay: authenticated (peerOnline=${msg.peerOnline === true ? 'yes' : 'no'})\n`,
          );
          drainQueue();
        } else {
          process.stderr.write(
            `Byoky relay: auth rejected — ${String(msg.error ?? 'unknown')}\n`,
          );
          try { sock.close(); } catch {}
          // A hard auth failure means the roomId/authToken are invalid —
          // reconnecting with the same creds will keep failing. Exit so the
          // user re-runs `openclaw models auth login` to repair.
          process.exit(2);
        }
        return;
      }

      if (
        msg.type !== 'relay:response:meta' &&
        msg.type !== 'relay:response:chunk' &&
        msg.type !== 'relay:response:done' &&
        msg.type !== 'relay:response:error'
      ) {
        return;
      }

      const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
      const pending = pendingByRequestId.get(requestId);
      if (!pending) return;

      if (msg.type === 'relay:response:meta') {
        const status = typeof msg.status === 'number' ? msg.status : 500;
        const rawHeaders = (msg.headers && typeof msg.headers === 'object' && !Array.isArray(msg.headers))
          ? msg.headers as Record<string, unknown>
          : {};
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (typeof k === 'string' && typeof v === 'string') headers[k] = v;
        }
        pending.metaSeen = true;
        deliver({ type: 'proxy_http_response_meta', requestId, status, headers });
        for (const chunk of pending.pendingChunks) {
          deliver({ type: 'proxy_http_response_chunk', requestId, chunk });
        }
        pending.pendingChunks.length = 0;
        if (pending.doneBuffered) {
          deliver({ type: 'proxy_http_response_done', requestId });
          pendingByRequestId.delete(requestId);
        }
        return;
      }

      if (msg.type === 'relay:response:chunk') {
        const chunk = typeof msg.chunk === 'string' ? msg.chunk : '';
        if (!pending.metaSeen) {
          pending.pendingChunks.push(chunk);
          return;
        }
        deliver({ type: 'proxy_http_response_chunk', requestId, chunk });
        return;
      }

      if (msg.type === 'relay:response:done') {
        if (!pending.metaSeen) {
          // Sender finished without meta — treat as error.
          deliver({
            type: 'proxy_http_error',
            requestId,
            error: 'Relay closed response without meta frame',
          });
          pendingByRequestId.delete(requestId);
          return;
        }
        deliver({ type: 'proxy_http_response_done', requestId });
        pendingByRequestId.delete(requestId);
        return;
      }

      // relay:response:error — surface through as an HTTP error body that
      // matches what the SDK's relay-fetch produces for the browser path.
      const errObj = (msg.error && typeof msg.error === 'object' && !Array.isArray(msg.error))
        ? msg.error as { code?: string; message?: string }
        : {};
      const code = typeof errObj.code === 'string' ? errObj.code : 'RELAY_ERROR';
      const message = typeof errObj.message === 'string' && errObj.message
        ? errObj.message
        : 'Relay proxy error';
      const status = relayErrorCodeToHttpStatus(code);
      const body = JSON.stringify({ error: { message, code, type: code } });
      if (!pending.metaSeen) {
        deliver({
          type: 'proxy_http_response_meta',
          requestId,
          status,
          headers: { 'content-type': 'application/json' },
        });
      }
      deliver({ type: 'proxy_http_response_chunk', requestId, chunk: body });
      deliver({ type: 'proxy_http_response_done', requestId });
      pendingByRequestId.delete(requestId);
    });

    sock.on('close', () => {
      if (connectTimeoutTimer) {
        clearTimeout(connectTimeoutTimer);
        connectTimeoutTimer = null;
      }
      authed = false;
      // Fail every in-flight request so the HTTP client unblocks. The
      // request can be retried by the caller once the WS is back.
      for (const [requestId] of pendingByRequestId) {
        deliver({
          type: 'proxy_http_error',
          requestId,
          error: 'Relay connection closed',
        });
      }
      pendingByRequestId.clear();
      scheduleReconnect();
    });

    sock.on('error', (err: Error) => {
      process.stderr.write(`Byoky relay: ws error — ${err.message}\n`);
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function deliver(msg: ProxyResponseMessage): void {
    handleProxyResponse(msg);
  }

  // Forward proxy_http requests out as relay:request frames. The field
  // shape is a near-match — we drop `sessionKey` (not used for relay auth)
  // and add `providerId` front-and-center.
  function sendToRelay(msg: ProxyRequestOut): void {
    pendingByRequestId.set(msg.requestId, {
      providerId: msg.providerId,
      metaSeen: false,
      pendingChunks: [],
      doneBuffered: false,
    });

    const ok = sendFrame({
      type: 'relay:request',
      requestId: msg.requestId,
      providerId: msg.providerId,
      url: msg.url,
      method: msg.method,
      headers: msg.headers,
      body: msg.body,
    });

    if (!ok) {
      // Queue is full or bridge is wedged — surface a 503 immediately.
      pendingByRequestId.delete(msg.requestId);
      deliver({
        type: 'proxy_http_error',
        requestId: msg.requestId,
        error: 'Relay outbound queue full — mobile wallet unreachable',
      });
    }
  }

  startProxyServer({
    port,
    // Session key is unused on the wire in relay mode — the relay room's
    // authToken is the real credential. Fill a stable sentinel for logs.
    sessionKey: `relay_${roomId}`,
    providers,
    sendToExtension: sendToRelay,
    validateUrl: (providerId, url) => {
      // Mirror the SDK's host-allowlist check so a compromised local
      // process can't ask the mobile wallet to hit an unrelated host.
      return validateProxyUrl(providerId, url) ? null : `URL host does not match provider "${providerId}"`;
    },
  });

  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && authed) {
      ws.send(JSON.stringify({ type: 'relay:ping', ts: Date.now() }));
    }
  }, PING_INTERVAL_MS);

  process.on('SIGINT', () => {
    if (pingTimer) clearInterval(pingTimer);
    if (ws) try { ws.close(); } catch {}
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    if (pingTimer) clearInterval(pingTimer);
    if (ws) try { ws.close(); } catch {}
    process.exit(0);
  });

  connect();
}

function relayErrorCodeToHttpStatus(code: string): number {
  switch (code) {
    case 'NO_CREDENTIAL':
    case 'PROVIDER_UNAVAILABLE':
      return 403;
    case 'INVALID_URL':
    case 'TRANSLATION_NOT_SUPPORTED':
      return 400;
    case 'QUOTA_EXCEEDED':
      return 429;
    case 'TRANSLATION_FAILED':
    case 'SWAP_FAILED':
    case 'INVALID_RESPONSE':
    case 'PROXY_ERROR':
      return 502;
    default:
      return 500;
  }
}
