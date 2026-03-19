import type {
  AuthMethod,
  RelayMessage,
  RelayRequest,
} from '@byoky/core';
import {
  ByokyError,
  parseRelayMessage,
  WS_READY_STATE,
} from '@byoky/core';
import { createProxyFetch } from './proxy-fetch.js';

export interface RelayConnection {
  readonly status: 'connecting' | 'connected' | 'disconnected';
  close(): void;
  onClose(callback: (reason?: string) => void): () => void;
}

export function createRelayClient(
  wsUrl: string,
  sessionKey: string,
  providers: Record<string, { available: boolean; authMethod: AuthMethod }>,
): RelayConnection {
  let status: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  const closeCallbacks = new Set<(reason?: string) => void>();
  const inFlight = new Map<string, AbortController>();

  let ws: WebSocket;
  let pingInterval: ReturnType<typeof setInterval> | undefined;

  try {
    const parsed = new URL(wsUrl);
    const isSecure = parsed.protocol === 'wss:';
    const isLocalWs = parsed.protocol === 'ws:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (!isSecure && !isLocalWs) {
      status = 'disconnected';
      return {
        get status() { return status; },
        close() {},
        onClose(cb) { cb('Insecure WebSocket URL rejected — use wss:// for non-localhost connections'); return () => {}; },
      };
    }
  } catch {
    status = 'disconnected';
    return {
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
      get status() { return status; },
      close() {},
      onClose(cb) { cb('Failed to create WebSocket'); return () => {}; },
    };
  }

  ws.onopen = () => {
    status = 'connected';

    // Send hello with a relay-specific ID (never expose the real session key to the relay server)
    const relayId = `relay_${crypto.randomUUID().replace(/-/g, '')}`;
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
      const proxyFetch = createProxyFetch(providerId, sessionKey);
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

          send({
            type: 'relay:response:chunk',
            requestId,
            chunk: decoder.decode(value, { stream: true }),
          });
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
