import type { ConnectRequest, ConnectResponse, ModelInfo, SessionUsage } from '@byoky/core';
import { ByokyError, ByokyErrorCode } from '@byoky/core';
import { replayableArgs } from './body.js';
import { fetchModelsList } from './list-models-fetch.js';
import { isExtensionInstalled, getStoreUrl, resolveMessageTarget } from './detect.js';
import { createProxyFetch } from './proxy-fetch.js';
import { createRelayClient, type RelayConnection } from './relay-client.js';
import { ConnectModal, type ModalOptions } from './modal/connect-modal.js';
import { createMockSession, type MockConnectOptions } from './mock.js';
import { randomId } from './id.js';
import { walletError } from './wallet-error.js';

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
  /** How long connect() waits for the wallet's answer, in ms. Default: 60000. */
  timeout?: number;
  /**
   * How long a proxied request waits for the response headers, in ms; 0
   * waits forever. A non-streaming response sends its headers only once
   * generation is done, so keep this above your longest generation.
   * Default: 600000 (10 minutes, as in the official OpenAI and Anthropic SDKs).
   */
  requestTimeout?: number;
}

export class Byoky {
  private timeout: number;
  private requestTimeout: number | undefined;
  // Snapshot of the last user-initiated connect request, so reconnects can
  // fall back from `reconnectOnly` to a full connect when the wallet has
  // dropped the session (browser restart / extension reload).
  private lastConnectRequest?: ConnectRequest;

  constructor(options: ByokyOptions = {}) {
    this.timeout = options.timeout ?? 60_000;
    this.requestTimeout = options.requestTimeout;
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
    } catch (err) {
      // Byoky was updated while this page was open: nothing is reachable
      // until it reloads, and the saved session may still be good then.
      if (isWalletReloaded(err)) return null;
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
    // Every provider the app asked for gets an entry, so
    // session.providers[id].available reads false instead of throwing when
    // a wallet (the mobile apps) lists only the providers it holds keys for.
    const requested = this.lastConnectRequest?.providers ?? [];
    const withRequested = (providers: ConnectResponse['providers']): ConnectResponse['providers'] => {
      const out = { ...providers };
      for (const { id } of requested) {
        if (typeof id === 'string' && !Object.hasOwn(out, id)) out[id] = { available: false, authMethod: 'api_key' };
      }
      return out;
    };
    const disconnectCallbacks = new Set<() => void>();
    const providersUpdatedCallbacks = new Set<(providers: ConnectResponse['providers']) => void>();

    let reconnectPromise: Promise<boolean> | null = null;

    const fireDisconnect = () => {
      for (const cb of disconnectCallbacks) cb();
      disconnectCallbacks.clear();
    };

    // Byoky was updated or reloaded while this page was open, which cuts
    // off the content script for good: nothing can be retried, the page has
    // to reload. The saved session is kept for tryReconnect after that.
    const onWalletReloaded = () => {
      fireDisconnect();
      releaseNotify();
    };

    // Hands the notify port back. The content script keeps a frame's
    // notify connection to the background open while any SDK port is
    // registered, which wakes the service worker every ~30 s; a closed
    // MessagePort alone never tells it this one is gone.
    const releaseNotify = () => {
      try { notifyChannel.port1.postMessage({ type: 'BYOKY_UNREGISTER_NOTIFY' }); } catch {}
      notifyChannel.port1.close();
    };

    const applyNewResponse = (newResponse: ConnectResponse) => {
      sessionKeyRef.current = newResponse.sessionKey;
      session.sessionKey = newResponse.sessionKey;
      session.providers = withRequested(newResponse.providers);
      saveExtSession(newResponse);
      for (const cb of providersUpdatedCallbacks) cb(session.providers);
    };

    const attemptReconnect = (): Promise<boolean> => {
      if (reconnectPromise) return reconnectPromise;
      reconnectPromise = (async () => {
        try {
          const newResponse = await this.sendConnectRequest({ reconnectOnly: true });
          applyNewResponse(newResponse);
          return true;
        } catch (err) {
          if (isWalletReloaded(err)) {
            onWalletReloaded();
            return false;
          }
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
          fireDisconnect();
          releaseNotify();
          return false;
        } finally {
          reconnectPromise = null;
        }
      })();
      return reconnectPromise;
    };

    const session: ByokySession = {
      ...response,
      providers: withRequested(response.providers),
      createFetch: (providerId: string) => {
        const proxyFetch = createProxyFetch(providerId, sessionKeyRef, { timeout: this.requestTimeout });
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          // The retry below sends the request again, so a stream body or a
          // Request input's body is read into bytes once, up front.
          const [safeInput, safeInit] = await replayableArgs(input, init);

          const resp = await proxyFetch(safeInput, safeInit);

          if (resp.status === 401 && await walletErrorCode(resp) === ByokyErrorCode.SESSION_EXPIRED) {
            if (await attemptReconnect()) {
              return proxyFetch(safeInput, safeInit);
            }
          } else if (resp.status === 503 && await walletErrorCode(resp) === ByokyErrorCode.WALLET_RELOADED) {
            onWalletReloaded();
          }

          return resp;
        };
      },
      listModels: (providerId: string) =>
        fetchModelsList(session.createFetch(providerId), providerId),
      // The relay calls through session.createFetch, not a fetch bound to
      // today's key: that one would answer 401 forever once the wallet
      // locked or restarted, with nothing to trigger a reconnect.
      createRelay: (wsUrl: string) =>
        createRelayClient(
          wsUrl,
          (providerId) => session.createFetch(providerId),
          () => session.providers,
          (callback) => session.onProvidersUpdated(callback),
        ),
      disconnect: () => {
        clearExtSession();
        releaseNotify();
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
        fireDisconnect();
        releaseNotify();
      } else if (msg?.type === 'BYOKY_WALLET_RELOADED') {
        // Sent by the content script itself when it is cut off; it carries
        // no session key because every session in this frame is affected.
        onWalletReloaded();
      } else if (msg?.type === 'BYOKY_PROVIDERS_UPDATED' && msg.payload?.sessionKey === sessionKeyRef.current) {
        session.providers = withRequested(msg.payload.providers as ConnectResponse['providers']);
        for (const cb of providersUpdatedCallbacks) cb(session.providers);
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
      const requestId = randomId();

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(
          new ByokyError(ByokyErrorCode.UNKNOWN, 'Connection request timed out. If Byoky was just updated, reload the page.'),
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
          const { code, message, retryAfter } = (msg.payload ?? {}) as {
            code?: unknown;
            message?: unknown;
            retryAfter?: number;
          };
          reject(walletError(code, message, retryAfter !== undefined ? { retryAfter } : undefined));
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
    const requestId = randomId();
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
      const requestId = randomId();
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
      const requestId = randomId();
      const timeout = setTimeout(() => {
        cleanup();
        reject(new ByokyError(ByokyErrorCode.PROXY_ERROR, 'Usage query timed out'));
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
            reject(new ByokyError(ByokyErrorCode.NO_SESSION, 'Session not found'));
          }
        } else if (msg.type === 'BYOKY_ERROR') {
          // The content script couldn't reach the wallet (WALLET_RELOADED,
          // EXTENSION_ERROR).
          cleanup();
          const { code, message } = (msg.payload ?? {}) as { code?: unknown; message?: unknown };
          reject(walletError(code, message));
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

function isWalletReloaded(err: unknown): boolean {
  return err instanceof ByokyError && err.code === ByokyErrorCode.WALLET_RELOADED;
}

/** The Byoky error code in a wallet error response's JSON body, if any. */
async function walletErrorCode(resp: Response): Promise<string | undefined> {
  try {
    const body = await resp.clone().json();
    const code = body?.error?.code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined; // not JSON
  }
}
