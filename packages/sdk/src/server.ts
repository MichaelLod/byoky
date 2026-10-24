import type {
  AuthMethod,
  RelayMessage,
  RelayHello,
  WebSocketLike,
} from '@byoky/core';
import {
  ByokyError,
  parseRelayMessage,
  sendRelayMessage,
  WS_READY_STATE,
} from '@byoky/core';

export interface ByokyServerOptions {
  /** Keepalive ping interval in ms. Default: 30000. Set to 0 to disable. */
  pingInterval?: number;
  /** Timeout waiting for relay:hello after connection. Default: 10000. */
  helloTimeout?: number;
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

  constructor(options: ByokyServerOptions = {}) {
    this.pingInterval = options.pingInterval ?? 30_000;
    this.helloTimeout = options.helloTimeout ?? 10_000;
  }

  handleConnection(ws: WebSocketLike): Promise<ByokyClient> {
    const self = this;
    return new Promise<ByokyClient>((resolve, reject) => {
      let sessionId = '';
      let providers: Record<string, { available: boolean; authMethod: AuthMethod }> = {};
      let connected = false;
      const closeCallbacks = new Set<() => void>();
      const pendingRequests = new Map<string, {
        resolveMeta: (value: { status: number; statusText: string; headers: Record<string, string> }) => void;
        pushChunk: (chunk: string) => void;
        done: () => void;
        error: (err: Error) => void;
      }>();

      let pingTimer: ReturnType<typeof setInterval> | undefined;
      let requestCounter = 0;

      const helloTimer = setTimeout(() => {
        reject(ByokyError.relayConnectionFailed('Timed out waiting for relay:hello'));
        ws.close(4000, 'Hello timeout');
      }, this.helloTimeout);

      ws.onmessage = (event: { data: unknown }) => {
        const msg = parseRelayMessage(event.data);
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
            if (pending) pending.pushChunk(msg.chunk);
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
      };

      ws.onclose = () => {
        cleanup();
      };

      ws.onerror = () => {
        cleanup();
      };

      function handleHello(msg: RelayHello) {
        clearTimeout(helloTimer);
        sessionId = msg.sessionId;
        providers = msg.providers;
        connected = true;

        // Start keepalive pings
        if (self.pingInterval > 0) {
          pingTimer = setInterval(() => {
            sendRelayMessage(ws, { type: 'relay:ping', ts: Date.now() });
          }, self.pingInterval);
        }

        resolve(client);
      }

      function cleanup() {
        if (!connected) return;
        connected = false;
        clearTimeout(helloTimer);
        if (pingTimer) clearInterval(pingTimer);

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

          const url = typeof input === 'string' ? input
            : input instanceof URL ? input.toString()
            : (input as Request).url;

          const method = init?.method ?? 'GET';
          const headers = init?.headers
            ? Object.fromEntries(new Headers(init.headers).entries())
            : {};
          const body = init?.body ? await readBody(init.body) : undefined;

          const requestId = `relay-${++requestCounter}-${Date.now()}`;

          return new Promise<Response>((resolveFetch, rejectFetch) => {
            let metaResolved = false;
            let controller: ReadableStreamDefaultController<Uint8Array>;
            const encoder = new TextEncoder();

            const stream = new ReadableStream<Uint8Array>({
              start(c) { controller = c; },
            });

            pendingRequests.set(requestId, {
              resolveMeta: (meta) => {
                if (metaResolved) return;
                metaResolved = true;
                resolveFetch(new Response(stream, {
                  status: meta.status,
                  statusText: meta.statusText,
                  headers: new Headers(meta.headers),
                }));
              },
              pushChunk: (chunk) => {
                try { controller.enqueue(encoder.encode(chunk)); } catch {}
              },
              done: () => {
                try { controller.close(); } catch {}
              },
              error: (err) => {
                try { controller.error(err); } catch {}
                if (!metaResolved) {
                  metaResolved = true;
                  rejectFetch(err);
                }
              },
            });

            // Send the request to the frontend
            sendRelayMessage(ws, {
              type: 'relay:request',
              requestId,
              providerId,
              url,
              method,
              headers,
              body,
            });
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

async function readBody(body: BodyInit): Promise<string | undefined> {
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.text();
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
  return undefined;
}

export type { WebSocketLike, RelayMessage, AuthMethod } from '@byoky/core';
