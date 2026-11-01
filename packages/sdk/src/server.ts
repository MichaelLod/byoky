import type {
  AuthMethod,
  RelayMessage,
  RelayHello,
  RelayRequest,
  WebSocketLike,
} from '@byoky/core';
import { base64ToBytes, encodeBody, fetchParts } from './body.js';
import {
  ByokyError,
  ByokyErrorCode,
  MAX_RELAY_MESSAGE_SIZE,
  parseRelayMessage,
  sendRelayMessage,
  WS_READY_STATE,
} from '@byoky/core';

export interface ByokyServerOptions {
  /** Keepalive ping interval in ms. Default: 30000. Set to 0 to disable. */
  pingInterval?: number;
  /** Timeout waiting for relay:hello after connection. Default: 10000. */
  helloTimeout?: number;
  /**
   * Fail a relayed request when the browser sends nothing for it for this
   * long, in ms. Resets on every response chunk, so long streams are fine,
   * but a non-streaming response sends nothing until generation is done.
   * Default: 600000 (10 minutes). Set to 0 to disable.
   */
  requestTimeout?: number;
}

export interface ByokyClient {
  readonly sessionId: string;
  readonly providers: Record<string, { available: boolean; authMethod: AuthMethod }>;
  readonly connected: boolean;
  createFetch(providerId: string): typeof fetch;
  close(): void;
  onClose(callback: () => void): () => void;
}

export class ByokyServer {
  private pingInterval: number;
  private helloTimeout: number;
  private requestTimeout: number;

  constructor(options: ByokyServerOptions = {}) {
    this.pingInterval = options.pingInterval ?? 30_000;
    this.helloTimeout = options.helloTimeout ?? 10_000;
    this.requestTimeout = options.requestTimeout ?? 600_000;
  }

  handleConnection(ws: WebSocketLike): Promise<ByokyClient> {
    const self = this;
    return new Promise<ByokyClient>((resolve, reject) => {
      let sessionId = '';
      let providers: Record<string, { available: boolean; authMethod: AuthMethod }> = {};
      let connected = false;
      // A connection says hello once. Each hello used to start another ping
      // interval that cleanup() never cleared, and could rename the session.
      let helloReceived = false;
      let closed = false;
      const closeCallbacks = new Set<() => void>();
      const pendingRequests = new Map<string, {
        resolveMeta: (value: { status: number; statusText: string; headers: Record<string, string> }) => void;
        pushChunk: (chunk: string, chunkEncoding?: 'base64') => void;
        done: () => void;
        error: (err: Error) => void;
      }>();

      let pingTimer: ReturnType<typeof setInterval> | undefined;
      let requestCounter = 0;

      const helloTimer = setTimeout(() => {
        closed = true;
        reject(ByokyError.relayConnectionFailed('Timed out waiting for relay:hello'));
        ws.close(4000, 'Hello timeout');
      }, this.helloTimeout);

      // The relay endpoint is public, so a client can send anything. Nothing
      // it sends may throw out of here: with the `ws` library that would be
      // an uncaught exception and take the whole process down.
      ws.onmessage = (event: { data: unknown }) => {
        try {
          handleMessage(event.data);
        } catch {
          // Drop the message.
        }
      };

      function handleMessage(data: unknown) {
        const msg = parseRelayMessage(data);
        if (!msg) return;

        switch (msg.type) {
          case 'relay:hello':
            handleHello(msg);
            break;
          case 'relay:response:meta': {
            const pending = pendingRequests.get(msg.requestId);
            if (pending) {
              pending.resolveMeta({
                status: msg.status,
                statusText: msg.statusText,
                headers: msg.headers,
              });
            }
            break;
          }
          case 'relay:response:chunk': {
            const pending = pendingRequests.get(msg.requestId);
            if (pending) pending.pushChunk(msg.chunk, msg.chunkEncoding);
            break;
          }
          case 'relay:response:done': {
            const pending = pendingRequests.get(msg.requestId);
            if (pending) {
              pending.done();
              pendingRequests.delete(msg.requestId);
            }
            break;
          }
          case 'relay:response:error': {
            const pending = pendingRequests.get(msg.requestId);
            if (pending) {
              pending.error(new Error(msg.error.message));
              pendingRequests.delete(msg.requestId);
            }
            break;
          }
          case 'relay:ping':
            sendRelayMessage(ws, { type: 'relay:pong', ts: msg.ts });
            break;
          case 'relay:pong':
            break;
        }
      }

      ws.onclose = () => {
        cleanup();
      };

      ws.onerror = () => {
        cleanup();
      };

      function handleHello(msg: RelayHello) {
        if (helloReceived || closed) return;
        helloReceived = true;
        clearTimeout(helloTimer);
        sessionId = msg.sessionId;
        providers = msg.providers;
        connected = true;

        // Start keepalive pings
        if (self.pingInterval > 0) {
          clearInterval(pingTimer);
          pingTimer = setInterval(() => {
            sendRelayMessage(ws, { type: 'relay:ping', ts: Date.now() });
          }, self.pingInterval);
        }

        resolve(client);
      }

      function cleanup() {
        if (closed) return;
        closed = true;
        clearTimeout(helloTimer);
        if (pingTimer) clearInterval(pingTimer);
        if (!connected) {
          reject(ByokyError.relayConnectionFailed('Connection closed before relay:hello'));
          return;
        }
        connected = false;

        // Reject all pending requests
        for (const pending of pendingRequests.values()) {
          pending.error(ByokyError.relayDisconnected());
        }
        pendingRequests.clear();

        for (const cb of closeCallbacks) cb();
        closeCallbacks.clear();
      }

      function createClientFetch(providerId: string): typeof fetch {
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          if (!connected) throw ByokyError.relayDisconnected();

          const { url, method, headers, signal, body: rawBody } = await fetchParts(input, init);
          if (signal?.aborted) throw abortReason(signal);
          const encoded = rawBody ? await encodeBody(rawBody, headers['content-type']) : undefined;
          if (encoded?.contentType && !headers['content-type']) headers['content-type'] = encoded.contentType;
          if (signal?.aborted) throw abortReason(signal);
          // The socket may have closed while the body was read.
          if (!connected) throw ByokyError.relayDisconnected();

          const requestId = `relay-${++requestCounter}-${Date.now()}`;
          const request: RelayRequest = {
            type: 'relay:request',
            requestId,
            providerId,
            url,
            method,
            headers,
            body: encoded?.body,
            bodyEncoding: encoded?.bodyEncoding,
          };

          // The browser drops oversized relay messages without a reply, so
          // sending one would leave this request hanging.
          const size = JSON.stringify(request).length;
          if (size > MAX_RELAY_MESSAGE_SIZE) {
            throw new ByokyError(
              ByokyErrorCode.PROXY_ERROR,
              `Request too large for the relay: ${size} characters serialized, limit ${MAX_RELAY_MESSAGE_SIZE}`,
              { size, limit: MAX_RELAY_MESSAGE_SIZE },
            );
          }

          return new Promise<Response>((resolveFetch, rejectFetch) => {
            let metaResolved = false;
            let controller: ReadableStreamDefaultController<Uint8Array>;
            let idleTimer: ReturnType<typeof setTimeout> | undefined;
            const encoder = new TextEncoder();

            const stream = new ReadableStream<Uint8Array>({
              start(c) { controller = c; },
              // The app cancelled the body: stop the generation as well.
              cancel() { giveUp(); },
            });

            // Ends the request: it fails before the headers, or its body
            // errors after them.
            const settle = (reason: unknown) => {
              clearTimeout(idleTimer);
              signal?.removeEventListener('abort', onAbort);
              try { controller.error(reason); } catch {}
              if (!metaResolved) {
                metaResolved = true;
                rejectFetch(reason);
              }
            };

            // The backend gave up on the request (abort, timeout, a broken
            // response). Forget it and have the browser stop the call, or it
            // keeps generating and billing.
            const giveUp = (reason?: unknown) => {
              if (pendingRequests.get(requestId) !== pending) return;
              pendingRequests.delete(requestId);
              sendRelayMessage(ws, { type: 'relay:cancel', requestId });
              settle(reason);
            };

            const onAbort = () => giveUp(abortReason(signal!));

            // Idle timeout: catches a browser that dropped the request or
            // stalled mid-stream, without cutting off long streams.
            const touch = () => {
              if (self.requestTimeout <= 0) return;
              clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                giveUp(new ByokyError(
                  ByokyErrorCode.PROXY_ERROR,
                  `Relay request timed out (no response from the browser for ${Math.round(self.requestTimeout / 1000)}s)`,
                ));
              }, self.requestTimeout);
            };

            const pending = {
              resolveMeta: (meta: { status: number; statusText: string; headers: Record<string, string> }) => {
                if (metaResolved) return;
                let response: Response;
                try {
                  response = buildResponse(stream, meta);
                } catch {
                  giveUp(new ByokyError(ByokyErrorCode.PROXY_ERROR, 'Invalid relay response'));
                  return;
                }
                metaResolved = true;
                touch();
                resolveFetch(response);
              },
              pushChunk: (chunk: string, chunkEncoding?: 'base64') => {
                let bytes: Uint8Array;
                try {
                  bytes = chunkEncoding === 'base64' ? base64ToBytes(chunk) : encoder.encode(chunk);
                } catch {
                  giveUp(new ByokyError(ByokyErrorCode.PROXY_ERROR, 'Invalid relay response'));
                  return;
                }
                touch();
                try { controller.enqueue(bytes); } catch {}
              },
              done: () => {
                clearTimeout(idleTimer);
                signal?.removeEventListener('abort', onAbort);
                try { controller.close(); } catch {}
              },
              error: (err: Error) => settle(err),
            };
            pendingRequests.set(requestId, pending);
            signal?.addEventListener('abort', onAbort);
            touch();

            // Send the request to the frontend
            sendRelayMessage(ws, request);
          });
        };
      }

      const client: ByokyClient = {
        get sessionId() { return sessionId; },
        get providers() { return providers; },
        get connected() { return connected; },
        createFetch: (providerId: string) => createClientFetch(providerId),
        close() {
          ws.close(1000, 'Server closed');
          cleanup();
        },
        onClose(callback: () => void) {
          closeCallbacks.add(callback);
          return () => { closeCallbacks.delete(callback); };
        },
      };

    });
  }
}

/** What fetch rejects with on abort: the signal's reason, an AbortError by default. */
function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

// Statuses whose Response must have a null body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** Throws on a status or status text Response refuses; skips invalid headers. */
function buildResponse(
  body: ReadableStream<Uint8Array>,
  meta: { status: number; statusText?: string; headers?: Record<string, string> },
): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(meta.headers ?? {})) {
    try {
      headers.append(name, value);
    } catch {
      // Invalid header name or value.
    }
  }
  return new Response(NULL_BODY_STATUSES.has(meta.status) ? null : body, {
    status: meta.status,
    statusText: meta.statusText ?? '',
    headers,
  });
}

export type { WebSocketLike, RelayMessage, AuthMethod } from '@byoky/core';
