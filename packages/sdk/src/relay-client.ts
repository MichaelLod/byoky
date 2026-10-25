import type {
  AuthMethod,
  RelayMessage,
  RelayRequest,
} from '@byoky/core';
import {
  ByokyError,
  MAX_RELAY_MESSAGE_SIZE,
  parseRelayMessage,
  WS_READY_STATE,
} from '@byoky/core';
import { createProxyFetch } from './proxy-fetch.js';

export interface RelayConnection {
  /**
   * The ID this relay announces to your server in `relay:hello` (the
   * server's `client.sessionId`). Send it with your app's requests so the
   * backend can find this relay. The session key itself never goes to the
   * relay server.
   */
  readonly relayId: string;
  readonly status: 'connecting' | 'connected' | 'disconnected';
  close(): void;
  onClose(callback: (reason?: string) => void): () => void;
}

export function createRelayClient(
  wsUrl: string,
  sessionKey: string,
  providers: Record<string, { available: boolean; authMethod: AuthMethod }>,
): RelayConnection {
  // Relay-specific ID announced in relay:hello — the real session key is never
  // exposed to the relay server.
  const relayId = `relay_${crypto.randomUUID().replace(/-/g, '')}`;
  let status: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  const closeCallbacks = new Set<(reason?: string) => void>();
  const inFlight = new Map<string, AbortController>();

  let ws: WebSocket;
  let pingInterval: ReturnType<typeof setInterval> | undefined;

  try {
    const parsed = new URL(wsUrl);
    const isSecure = parsed.protocol === 'wss:';
    const isLocalWs = parsed.protocol === 'ws:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
    if (!isSecure && !isLocalWs) {
      status = 'disconnected';
      return {
        relayId,
        get status() { return status; },
        close() {},
        onClose(cb) { cb('Insecure WebSocket URL rejected — use wss:// for non-localhost connections'); return () => {}; },
      };
    }
  } catch {
    status = 'disconnected';
    return {
      relayId,
      get status() { return status; },
      close() {},
      onClose(cb) { cb('Invalid WebSocket URL'); return () => {}; },
    };
  }

  try {
    ws = new WebSocket(wsUrl);
  } catch {
    status = 'disconnected';
    return {
      relayId,
      get status() { return status; },
      close() {},
      onClose(cb) { cb('Failed to create WebSocket'); return () => {}; },
    };
  }

  ws.onopen = () => {
    status = 'connected';

    ws.send(JSON.stringify({
      type: 'relay:hello',
      sessionId: relayId,
      providers,
    }));

    // Keepalive ping every 30s
    pingInterval = setInterval(() => {
      if (ws.readyState === WS_READY_STATE.OPEN) {
        ws.send(JSON.stringify({ type: 'relay:ping', ts: Date.now() }));
      }
    }, 30_000);
  };

  ws.onmessage = (event) => {
    const msg = parseRelayMessage(event.data);
    if (!msg) return;

    switch (msg.type) {
      case 'relay:request':
        handleRequest(msg);
        break;
      case 'relay:ping':
        ws.send(JSON.stringify({ type: 'relay:pong', ts: msg.ts }));
        break;
      case 'relay:pong':
        // Keepalive response, nothing to do
        break;
    }
  };

  ws.onclose = (event) => {
    cleanup(event.reason || 'WebSocket closed');
  };

  ws.onerror = () => {
    cleanup('WebSocket error');
  };

  async function handleRequest(req: RelayRequest) {
    const { requestId, providerId, url, method, headers, body } = req;
    const controller = new AbortController();
    inFlight.set(requestId, controller);

    try {
      const proxyFetch = createProxyFetch(providerId, { current: sessionKey });
      const response = await proxyFetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      // Send response metadata
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      send({
        type: 'relay:response:meta',
        requestId,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });

      // Stream the body
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (controller.signal.aborted) break;

          for (const chunk of splitChunk(decoder.decode(value, { stream: true }))) {
            send({ type: 'relay:response:chunk', requestId, chunk });
          }
        }
      }

      send({ type: 'relay:response:done', requestId });
    } catch (err) {
      send({
        type: 'relay:response:error',
        requestId,
        error: {
          code: err instanceof ByokyError ? err.code : 'PROXY_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      });
    } finally {
      inFlight.delete(requestId);
    }
  }

  function send(msg: RelayMessage) {
    if (ws.readyState === WS_READY_STATE.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function cleanup(reason?: string) {
    if (status === 'disconnected') return;
    status = 'disconnected';

    if (pingInterval) clearInterval(pingInterval);

    // Abort all in-flight requests
    for (const controller of inFlight.values()) {
      controller.abort();
    }
    inFlight.clear();

    for (const cb of closeCallbacks) cb(reason);
    closeCallbacks.clear();
  }

  return {
    relayId,
    get status() { return status; },
    close() {
      if (ws.readyState === WS_READY_STATE.OPEN || ws.readyState === WS_READY_STATE.CONNECTING) {
        ws.close(1000, 'Client closed');
      }
      cleanup('Client closed');
    },
    onClose(callback: (reason?: string) => void) {
      closeCallbacks.add(callback);
      return () => { closeCallbacks.delete(callback); };
    },
  };
}

// The server drops relay messages over MAX_RELAY_MESSAGE_SIZE, which would
// stall the response. JSON escaping can grow a string up to 6x (\u00XX), so
// pieces of an eighth of the limit always fit, envelope included.
const MAX_CHUNK_LENGTH = Math.floor(MAX_RELAY_MESSAGE_SIZE / 8);

function splitChunk(text: string): string[] {
  if (text.length <= MAX_CHUNK_LENGTH) return [text];
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_CHUNK_LENGTH, text.length);
    // Never split a surrogate pair: the server encodes each chunk on its
    // own, and a lone half would turn into U+FFFD.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}
