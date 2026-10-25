import type { ConnectRequest, ConnectResponse, ModelInfo, SessionUsage } from '@byoky/core';
import { ByokyError, ByokyErrorCode } from '@byoky/core';
import { fetchModelsList } from './list-models-fetch.js';
import { isExtensionInstalled, getStoreUrl, resolveMessageTarget } from './detect.js';
import { createProxyFetch } from './proxy-fetch.js';
import { createRelayClient, type RelayConnection } from './relay-client.js';
import { ConnectModal, type ModalOptions } from './modal/connect-modal.js';
import { createMockSession, type MockConnectOptions } from './mock.js';

// --- Session persistence helpers ---

const EXT_SESSION_KEY = 'byoky:session';

function hasSessionStorage(): boolean {
  try { return typeof sessionStorage !== 'undefined'; } catch { return false; }
}

function saveExtSession(response: ConnectResponse): void {
  if (!hasSessionStorage()) return;
  try { sessionStorage.setItem(EXT_SESSION_KEY, JSON.stringify(response)); } catch {}
}

function loadExtSession(): ConnectResponse | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(EXT_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ConnectResponse;
    if (!data.sessionKey || !data.providers) return null;
    return data;
  } catch { return null; }
}

function clearExtSession(): void {
  if (!hasSessionStorage()) return;
  try { sessionStorage.removeItem(EXT_SESSION_KEY); } catch {}
}

export interface ByokySession extends ConnectResponse {
  /** Create a fetch function that proxies requests through the wallet for the given provider. */
  createFetch(providerId: string): typeof fetch;
  /**
   * Fetch the list of models the user's credential can access for a provider.
   * Hits each provider's discovery endpoint (e.g. /v1/models) through the
   * proxy. For Perplexity (no public endpoint) returns a hardcoded list.
   */
  listModels(providerId: string): Promise<ModelInfo[]>;
  /** Open a relay channel so a backend server can make LLM calls through this session. */
  createRelay(wsUrl: string): RelayConnection;
  /** Disconnect this session from the wallet. */
  disconnect(): void;
  /** Check if this session is still connected and valid. */
  isConnected(): Promise<boolean>;
  /** Get token usage stats for this session only. */
  getUsage(): Promise<SessionUsage>;
  /** Register a callback for when the wallet revokes this session. */
  onDisconnect(callback: () => void): () => void;
  /** Register a callback for when provider availability changes (e.g. credential added/removed). */
  onProvidersUpdated(callback: (providers: ConnectResponse['providers']) => void): () => void;
}

export interface ByokyOptions {
  timeout?: number;
}

export class Byoky {
  private timeout: number;
  // Snapshot of the last user-initiated connect request, so reconnects can
  // fall back from `reconnectOnly` to a full connect when the wallet has
  // dropped the session (browser restart / extension reload).
  private lastConnectRequest?: ConnectRequest;

  constructor(options: ByokyOptions = {}) {
    this.timeout = options.timeout ?? 60_000;
  }

  /**
   * Connect to the Byoky wallet: the browser extension, the iOS Safari
   * extension, or the in-app browser of the Byoky mobile apps (which expose
   * the same page protocol). Throws WALLET_NOT_INSTALLED when none is
   * present; with `modal`, shows install guidance instead.
   */
  async connect(request: ConnectRequest & {
    /** Show the built-in connect modal. Pass true or ModalOptions. */
    modal?: boolean | ModalOptions;
  } = {}): Promise<ByokySession> {
    if (typeof window === 'undefined') {
      throw new ByokyError(
        ByokyErrorCode.UNKNOWN,
        'Byoky SDK requires a browser environment. On the server, use your API key directly.',
      );
    }

    const { modal, ...connectRequest } = request;
    this.lastConnectRequest = connectRequest;

    if (modal) {
      const modalOpts = typeof modal === 'object' ? modal : {};
      const connectModal = new ConnectModal(modalOpts);
      return connectModal.show({
        isExtensionInstalled: () => isExtensionInstalled(),
        connectExtension: () => this.sendConnectRequest(connectRequest).then((r) => this.buildSession(r)),
        getStoreUrl: () => getStoreUrl(),
      });
    }

    if (isExtensionInstalled()) {
      const response = await this.sendConnectRequest(connectRequest);
      return this.buildSession(response);
    }

    const storeUrl = getStoreUrl();
    if (storeUrl) {
      window.open(storeUrl, '_blank');
    }
    throw ByokyError.walletNotInstalled();
  }

  /**
   * Silently reconnect to an existing session for the current origin.
   * Checks the wallet's live session first, then the session persisted in
   * sessionStorage. Returns null if nothing is restorable.
   */
  async tryReconnect(): Promise<ByokySession | null> {
    if (typeof window === 'undefined') return null;
    if (!isExtensionInstalled()) return null;

    // 1. Try the wallet's live session (covers SW still running)
    try {
      const response = await this.sendConnectRequest({ reconnectOnly: true });
      saveExtSession(response);
      return this.buildSession(response);
    } catch {
      // No live session — fall through
    }

    // 2. Try the persisted session (covers SW restart + page reload)
    const saved = loadExtSession();
    if (saved) {
      try {
        const connected = await this.querySessionStatus(saved.sessionKey);
        if (connected) return this.buildSession(saved);
      } catch {}
      clearExtSession();
    }

    return null;
  }

  /**
   * Reconnect to an existing session using previously stored response data.
   * Returns null if the session is no longer valid.
   */
  async reconnect(savedResponse: ConnectResponse): Promise<ByokySession | null> {
    if (typeof window === 'undefined') return null;
    if (!isExtensionInstalled()) return null;

    const connected = await this.querySessionStatus(savedResponse.sessionKey);
    if (!connected) return null;

    return this.buildSession(savedResponse);
  }

  /**
   * Dev-only mock session — runs the app's full code path without a real
   * wallet. Provider keys come from the `keys` option or the `BYOKY_DEV_KEYS`
   * environment variable (Node.js). Refuses to run when NODE_ENV=production.
   *
   * Useful for local development, integration tests, and CI. Not a security
   * boundary — keys are used directly with the upstream provider, no proxy.
   */
  async connectMock(options: MockConnectOptions = {}): Promise<ByokySession> {
    return createMockSession(options);
  }

  // --- Extension-based session ---

  private buildSession(response: ConnectResponse): ByokySession {
    const sessionKeyRef = { current: response.sessionKey };
    const disconnectCallbacks = new Set<() => void>();
    const providersUpdatedCallbacks = new Set<(providers: ConnectResponse['providers']) => void>();

    let reconnectPromise: Promise<boolean> | null = null;

    const applyNewResponse = (newResponse: ConnectResponse) => {
      sessionKeyRef.current = newResponse.sessionKey;
      session.sessionKey = newResponse.sessionKey;
      session.providers = newResponse.providers;
      saveExtSession(newResponse);
      for (const cb of providersUpdatedCallbacks) cb(newResponse.providers);
    };

    const attemptReconnect = (): Promise<boolean> => {
      if (reconnectPromise) return reconnectPromise;
      reconnectPromise = (async () => {
        try {
          const newResponse = await this.sendConnectRequest({ reconnectOnly: true });
          applyNewResponse(newResponse);
          return true;
        } catch (err) {
          // Silent reconnect failed (NO_SESSION). If the user previously
          // approved this origin in the wallet, a full connect will
          // re-create the session via the trusted-sites auto-approve path
          // (see extension handleConnect). Otherwise the wallet popup will
          // re-prompt — better UX than surfacing a raw 401 in the chat.
          if (this.lastConnectRequest && err instanceof ByokyError && err.code === ByokyErrorCode.NO_SESSION) {
            try {
              const newResponse = await this.sendConnectRequest(this.lastConnectRequest);
              applyNewResponse(newResponse);
              return true;
            } catch {
              // Fall through to disconnect
            }
          }
          clearExtSession();
          for (const cb of disconnectCallbacks) cb();
          disconnectCallbacks.clear();
          return false;
        } finally {
          reconnectPromise = null;
        }
      })();
      return reconnectPromise;
    };

    const session: ByokySession = {
      ...response,
      createFetch: (providerId: string) => {
        const proxyFetch = createProxyFetch(providerId, sessionKeyRef);
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          // Pre-serialize ReadableStream body so retry is possible
          const safeInit = init?.body instanceof ReadableStream
            ? { ...init, body: await new Response(init.body).text() }
            : init;

          const resp = await proxyFetch(input, safeInit);

          if (resp.status === 401) {
            try {
              const body = await resp.clone().json();
              if (body?.error?.code === 'SESSION_EXPIRED') {
                if (await attemptReconnect()) {
                  return proxyFetch(input, safeInit);
                }
              }
            } catch { /* not JSON or parse error — return original response */ }
          }

          return resp;
        };
      },
      listModels: (providerId: string) =>
        fetchModelsList(session.createFetch(providerId), providerId),
      createRelay: (wsUrl: string) =>
        createRelayClient(wsUrl, sessionKeyRef.current, session.providers),
      disconnect: () => {
        clearExtSession();
        notifyChannel.port1.close();
        this.sendDisconnect(sessionKeyRef.current);
      },
      isConnected: () => this.querySessionStatus(sessionKeyRef.current),
      getUsage: () => this.querySessionUsage(sessionKeyRef.current),
      onDisconnect: (callback: () => void) => {
        disconnectCallbacks.add(callback);
        return () => { disconnectCallbacks.delete(callback); };
      },
      onProvidersUpdated: (callback: (providers: ConnectResponse['providers']) => void) => {
        providersUpdatedCallbacks.add(callback);
        return () => { providersUpdatedCallbacks.delete(callback); };
      },
    };

    // Register a secure notification channel via MessageChannel so
    // revocation events cannot be spoofed by page scripts.
    const notifyChannel = new MessageChannel();
    notifyChannel.port1.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'BYOKY_SESSION_REVOKED' && msg.payload?.sessionKey === sessionKeyRef.current) {
        clearExtSession();
        for (const cb of disconnectCallbacks) cb();
        disconnectCallbacks.clear();
        notifyChannel.port1.close();
      } else if (msg?.type === 'BYOKY_PROVIDERS_UPDATED' && msg.payload?.sessionKey === sessionKeyRef.current) {
        const newProviders = msg.payload.providers as ConnectResponse['providers'];
        session.providers = newProviders;
        for (const cb of providersUpdatedCallbacks) cb(newProviders);
      }
    };
    {
      // resolveMessageTarget is async, so this is fire-and-forget: the
      // notify channel simply registers a moment later.
      void resolveMessageTarget().then(({ target, origin }) => {
        target.postMessage(
          { type: 'BYOKY_REGISTER_NOTIFY' },
          origin,
          [notifyChannel.port2],
        );
      });
    }

    saveExtSession(response);
    return session;
  }

  private sendConnectRequest(
    request: ConnectRequest,
  ): Promise<ConnectResponse> {
    return new Promise<ConnectResponse>((resolve, reject) => {
      const requestId = crypto.randomUUID();

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(
          new ByokyError(ByokyErrorCode.UNKNOWN, 'Connection request timed out'),
        );
      }, this.timeout);

      const channel = new MessageChannel();

      channel.port1.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (typeof msg?.type !== 'string' || !msg.type.startsWith('BYOKY_')) return;
        if (msg.requestId !== requestId) return;

        cleanup();

        if (msg.type === 'BYOKY_CONNECT_RESPONSE') {
          resolve(msg.payload as ConnectResponse);
        } else if (msg.type === 'BYOKY_ERROR') {
          const { code, message, retryAfter } = msg.payload as {
            code: string;
            message: string;
            retryAfter?: number;
          };
          reject(new ByokyError(
            code as ByokyErrorCode,
            message,
            retryAfter !== undefined ? { retryAfter } : undefined,
          ));
        }
      };

      function cleanup() {
        clearTimeout(timeoutId);
        channel.port1.close();
      }

      void resolveMessageTarget().then(({ target, origin }) => {
        target.postMessage(
          {
            type: 'BYOKY_CONNECT_REQUEST',
            id: requestId,
            requestId,
            payload: request,
          },
          origin,
          [channel.port2],
        );
      });
    });
  }

  private sendDisconnect(sessionKey: string): void {
    // The wallet sends no answer, so nothing listens on the reply port. It
    // and the id are still sent: older extensions drop a BYOKY_DISCONNECT
    // that carries neither.
    const requestId = crypto.randomUUID();
    const channel = new MessageChannel();
    channel.port1.close();

    void resolveMessageTarget().then(({ target, origin }) => {
      target.postMessage(
        { type: 'BYOKY_DISCONNECT', id: requestId, requestId, payload: { sessionKey } },
        origin,
        [channel.port2],
      );
    });
  }

  private querySessionStatus(sessionKey: string): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { cleanup(); resolve(false); }, 5000);

      const channel = new MessageChannel();

      channel.port1.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg?.requestId !== requestId) return;
        if (msg.type === 'BYOKY_SESSION_STATUS_RESPONSE') {
          cleanup();
          resolve(!!msg.payload?.connected);
        }
      };

      function cleanup() {
        clearTimeout(timeout);
        channel.port1.close();
      }

      void resolveMessageTarget().then(({ target, origin }) => {
        target.postMessage({
          type: 'BYOKY_SESSION_STATUS',
          requestId,
          payload: { sessionKey },
        }, origin, [channel.port2]);
      });
    });
  }

  private querySessionUsage(sessionKey: string): Promise<SessionUsage> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Usage query timed out'));
      }, 5000);

      const channel = new MessageChannel();

      channel.port1.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg?.requestId !== requestId) return;
        if (msg.type === 'BYOKY_SESSION_USAGE_RESPONSE') {
          cleanup();
          if (msg.payload) {
            resolve(msg.payload as SessionUsage);
          } else {
            reject(new Error('Session not found'));
          }
        }
      };

      function cleanup() {
        clearTimeout(timeout);
        channel.port1.close();
      }

      void resolveMessageTarget().then(({ target, origin }) => {
        target.postMessage({
          type: 'BYOKY_SESSION_USAGE',
          requestId,
          payload: { sessionKey },
        }, origin, [channel.port2]);
      });
    });
  }
}
