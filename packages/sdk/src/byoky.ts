import type { AuthMethod, ConnectRequest, ConnectResponse, SessionUsage, Balance, DeveloperAppInfo } from '@byoky/core';
import { ByokyError, ByokyErrorCode, isByokyMessage, encodePairPayload } from '@byoky/core';
import { isExtensionInstalled, getStoreUrl } from './detect.js';
import { createProxyFetch } from './proxy-fetch.js';
import { createRelayFetch } from './relay-fetch.js';
import { createRelayClient, type RelayConnection } from './relay-client.js';
import { ConnectModal, type ModalOptions } from './modal/connect-modal.js';
import { createVaultFetch } from './vault-fetch.js';

export interface VaultConnectOptions {
  vaultUrl: string;
  username?: string;
  password?: string;
  token?: string;
}

export interface ByokySession extends ConnectResponse {
  /** Create a fetch function that proxies requests through the wallet for the given provider. */
  createFetch(providerId: string): typeof fetch;
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
  /** Relay server URL for mobile wallet pairing. Default: wss://relay.byoky.com */
  relayUrl?: string;
  /** Developer app ID for attribution and discount. Get this from the developer portal. */
  appId?: string;
  /** Vault server URL. Default: https://vault.byoky.com */
  vaultUrl?: string;
  /** Web wallet URL for extensionless login/signup. Default: https://byoky.com */
  walletUrl?: string;
}

export class Byoky {
  private timeout: number;
  private relayUrl: string;
  /** Developer app ID — passed in all proxy requests for attribution + discount. */
  readonly appId?: string;
  private vaultUrl: string;
  private walletUrl: string;

  constructor(options: ByokyOptions = {}) {
    this.timeout = options.timeout ?? 60_000;
    this.appId = options.appId;
    this.vaultUrl = (options.vaultUrl ?? 'https://vault.byoky.com').replace(/\/$/, '');
    this.walletUrl = (options.walletUrl ?? 'https://byoky.com').replace(/\/$/, '');
    const relayUrl = options.relayUrl ?? 'wss://relay.byoky.com';
    try {
      const parsed = new URL(relayUrl);
      if (parsed.protocol !== 'wss:') {
        throw new Error('Relay URL must use wss:// protocol');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('wss://')) throw e;
      throw new Error(`Invalid relay URL: ${relayUrl}`);
    }
    this.relayUrl = relayUrl;
  }

  /**
   * Connect to a Byoky wallet. Tries the browser extension first.
   * If no extension is found and `onPairingReady` is provided,
   * falls back to relay mode — pairing with a mobile wallet app.
   */
  async connect(request: ConnectRequest & {
    /** Called with a pairing code when no extension is detected. Show as QR or text. */
    onPairingReady?: (pairingCode: string) => void;
    /** Skip extension detection and go directly to relay pairing. */
    useRelay?: boolean;
    /** Show a built-in connect modal with QR code for pairing. Pass true or ModalOptions. */
    modal?: boolean | ModalOptions;
  } = {}): Promise<ByokySession> {
    if (typeof window === 'undefined') {
      throw new ByokyError(
        ByokyErrorCode.UNKNOWN,
        'Byoky SDK requires a browser environment. On the server, use your API key directly.',
      );
    }

    const { onPairingReady, useRelay, modal, ...connectRequest } = request;

    if (modal) {
      const hasExt = isExtensionInstalled();
      if (hasExt) {
        // Extension found — use it directly, skip modal
        const response = await this.sendConnectRequest(connectRequest);
        return this.buildSession(response);
      }
      // No extension — go straight to web wallet (no modal needed)
      return this.connectViaWebWallet();
    }

    // Go directly to relay if explicitly requested
    if (useRelay && onPairingReady) {
      return this.connectViaRelay(connectRequest, onPairingReady);
    }

    // Try extension first
    if (isExtensionInstalled()) {
      const response = await this.sendConnectRequest(connectRequest);
      return this.buildSession(response);
    }

    // Fall back to relay pairing if callback provided
    if (onPairingReady) {
      return this.connectViaRelay(connectRequest, onPairingReady);
    }

    // No extension, no relay — fall back to web wallet (vault mode)
    return this.connectViaWebWallet();
  }

  /**
   * Silently reconnect to an existing session for the current origin.
   * Returns null if no active session exists in the wallet.
   */
  async tryReconnect(): Promise<ByokySession | null> {
    if (typeof window === 'undefined') return null;
    if (!isExtensionInstalled()) return null;

    try {
      const response = await this.sendConnectRequest({ reconnectOnly: true });
      return this.buildSession(response);
    } catch {
      return null;
    }
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
   * Connect via the web wallet popup. Opens a popup to byoky.com/wallet/connect,
   * user logs in or signs up, and the token is returned via postMessage.
   * Then connects via vault mode.
   */
  private connectViaWebWallet(): Promise<ByokySession> {
    const walletUrl = `${this.walletUrl}/wallet/connect`;
    const width = 420;
    const height = 580;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    return new Promise<ByokySession>((resolve, reject) => {
      const popup = window.open(
        walletUrl,
        'byoky-wallet',
        `width=${width},height=${height},left=${left},top=${top},popup=yes`,
      );

      if (!popup) {
        reject(new ByokyError(ByokyErrorCode.UNKNOWN, 'Could not open wallet popup. Please allow popups for this site.'));
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new ByokyError(ByokyErrorCode.UNKNOWN, 'Wallet connection timed out'));
      }, this.timeout);

      const onMessage = async (event: MessageEvent) => {
        const data = event.data;
        if (data?.type !== 'BYOKY_WALLET_AUTH' || !data.token) return;

        cleanup();

        try {
          const vaultUrl = data.vaultUrl || this.vaultUrl;
          const session = await this.connectViaVault({
            vaultUrl,
            token: data.token,
          });
          resolve(session);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      // Poll for popup close (user closed without completing)
      const pollClose = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new ByokyError(ByokyErrorCode.USER_REJECTED, 'Wallet popup was closed'));
        }
      }, 500);

      function cleanup() {
        clearTimeout(timeout);
        clearInterval(pollClose);
        window.removeEventListener('message', onMessage);
        try { popup?.close(); } catch {}
      }

      window.addEventListener('message', onMessage);
    });
  }

  /**
   * Connect via a Byoky Vault server. Works in both browser and Node.js.
   * The vault stores encrypted credentials and proxies API calls server-side.
   */
  async connectViaVault(options: VaultConnectOptions): Promise<ByokySession> {
    const { vaultUrl } = options;
    let token = options.token;

    if (!token) {
      if (!options.username || !options.password) {
        throw new ByokyError(ByokyErrorCode.UNKNOWN, 'Either token or username+password required for vault connection');
      }
      const loginResp = await fetch(`${vaultUrl.replace(/\/$/, '')}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: options.username, password: options.password }),
      });
      if (!loginResp.ok) {
        const err = await loginResp.json().catch(() => ({})) as Record<string, unknown>;
        const errObj = err.error as Record<string, string> | undefined;
        throw new ByokyError(ByokyErrorCode.UNKNOWN, errObj?.message ?? 'Vault login failed');
      }
      const loginData = await loginResp.json() as { token: string };
      token = loginData.token;
    }

    const connectResp = await fetch(`${vaultUrl.replace(/\/$/, '')}/connect`, {
      headers: { 'authorization': `Bearer ${token}` },
    });
    if (!connectResp.ok) {
      throw new ByokyError(ByokyErrorCode.UNKNOWN, 'Failed to get vault providers');
    }
    const connectData = await connectResp.json() as {
      providers: Record<string, { available: boolean; authMethod: AuthMethod }>;
    };

    const sessionKey = `vault_${token.slice(-8)}`;
    const vaultToken = token;

    return {
      sessionKey,
      proxyUrl: `${vaultUrl.replace(/\/$/, '')}/proxy`,
      providers: connectData.providers,
      createFetch: (providerId: string) => createVaultFetch(vaultUrl, vaultToken, providerId, this.appId),
      createRelay: () => { throw new Error('Relay not supported in vault mode'); },
      disconnect: () => {},
      isConnected: async () => true,
      getUsage: async () => ({ requests: 0, inputTokens: 0, outputTokens: 0, byProvider: {} }),
      onDisconnect: () => () => {},
      onProvidersUpdated: () => () => {},
    };
  }

  /**
   * Connect to a Byoky wallet in payment mode. Shorthand for connect() that
   * always shows the modal and signals credit-mode intent.
   */
  async pay(options: {
    providers?: ConnectRequest['providers'];
    modal?: boolean | ModalOptions;
  } = {}): Promise<ByokySession> {
    return this.connect({
      providers: options.providers,
      modal: options.modal ?? true,
    });
  }

  /**
   * Query the current user's wallet balance from the vault.
   * Requires an active vault session (via connectViaVault).
   */
  async getBalance(): Promise<Balance | null> {
    try {
      const resp = await fetch(`${this.vaultUrl}/billing/balance`, {
        headers: { 'content-type': 'application/json' },
      });
      if (!resp.ok) return null;
      return await resp.json() as Balance;
    } catch {
      return null;
    }
  }

  /**
   * Fetch developer app info (name, discount, etc.) for the configured appId.
   */
  async getAppInfo(): Promise<DeveloperAppInfo | null> {
    if (!this.appId) return null;
    try {
      const resp = await fetch(`${this.vaultUrl}/developer/apps/${this.appId}/public`);
      if (!resp.ok) return null;
      return await resp.json() as DeveloperAppInfo;
    } catch {
      return null;
    }
  }

  // --- Relay pairing ---

  private connectViaRelay(
    request: ConnectRequest,
    onPairingReady: (code: string) => void,
  ): Promise<ByokySession> {
    return new Promise<ByokySession>((resolve, reject) => {
      const roomId = crypto.randomUUID();
      const authToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      const pairingCode = encodePairPayload({
        v: 1,
        r: this.relayUrl,
        id: roomId,
        t: authToken,
        o: window.location.origin,
      });

      const ws = new WebSocket(this.relayUrl);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new ByokyError(ByokyErrorCode.UNKNOWN, 'Pairing timed out. No wallet connected.'));
      }, this.timeout);

      ws.onopen = () => {
        // Authenticate as recipient (the web app receives proxied responses)
        ws.send(JSON.stringify({
          type: 'relay:auth',
          roomId,
          authToken,
          role: 'recipient',
        }));
      };

      ws.onmessage = (event) => {
        let msg: { type: string; [k: string]: unknown };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'relay:auth:result':
            if (msg.success) {
              // Authenticated — show the pairing code
              onPairingReady(pairingCode);
            } else {
              clearTimeout(timeout);
              ws.close();
              reject(new ByokyError(ByokyErrorCode.UNKNOWN, 'Relay authentication failed'));
            }
            break;

          case 'relay:pair:hello': {
            clearTimeout(timeout);
            const raw = msg.providers;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
              ws.close();
              reject(new ByokyError(ByokyErrorCode.UNKNOWN, 'Invalid provider data from relay'));
              break;
            }
            const VALID_AUTH_METHODS: Set<string> = new Set(['api_key', 'oauth']);
            const providers: Record<string, { available: boolean; authMethod: AuthMethod }> = {};
            for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
              if (!val || typeof val !== 'object') continue;
              const v = val as Record<string, unknown>;
              if (typeof v.available !== 'boolean' || typeof v.authMethod !== 'string') continue;
              if (!VALID_AUTH_METHODS.has(v.authMethod)) continue;
              providers[key] = { available: v.available, authMethod: v.authMethod as AuthMethod };
            }

            ws.send(JSON.stringify({ type: 'relay:pair:ack' }));
            resolve(this.buildRelaySession(ws, roomId, providers));
            break;
          }

          case 'relay:peer:status':
            // Phone came online but hasn't sent pair:hello yet — wait
            break;
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new ByokyError(ByokyErrorCode.UNKNOWN, 'Failed to connect to relay server'));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
      };
    });
  }

  private buildRelaySession(
    ws: WebSocket,
    roomId: string,
    providers: Record<string, { available: boolean; authMethod: AuthMethod }>,
  ): ByokySession {
    const sessionKey = `relay_${roomId}`;
    const disconnectCallbacks = new Set<() => void>();

    // Keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'relay:ping', ts: Date.now() }));
      }
    }, 30_000);

    ws.addEventListener('close', () => {
      clearInterval(pingInterval);
      for (const cb of disconnectCallbacks) cb();
      disconnectCallbacks.clear();
    });

    // Listen for phone going offline (app backgrounded/closed)
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'relay:peer:status' && msg.online === false) {
          for (const cb of disconnectCallbacks) cb();
          disconnectCallbacks.clear();
          clearInterval(pingInterval);
          ws.close(1000, 'Phone disconnected');
        }
      } catch {}
    });

    return {
      sessionKey,
      proxyUrl: '',
      providers,
      createFetch: (providerId: string) => createRelayFetch(ws, providerId),
      createRelay: () => { throw new Error('Relay-in-relay not supported'); },
      disconnect: () => {
        clearInterval(pingInterval);
        ws.close(1000, 'Client disconnected');
      },
      isConnected: async () => ws.readyState === WebSocket.OPEN,
      getUsage: async () => ({ requests: 0, inputTokens: 0, outputTokens: 0, byProvider: {} }),
      onDisconnect: (callback: () => void) => {
        disconnectCallbacks.add(callback);
        return () => { disconnectCallbacks.delete(callback); };
      },
      onProvidersUpdated: () => () => {},
    };
  }

  // --- Extension-based session ---

  private buildSession(response: ConnectResponse): ByokySession {
    const sessionKeyRef = { current: response.sessionKey };
    const disconnectCallbacks = new Set<() => void>();
    const providersUpdatedCallbacks = new Set<(providers: ConnectResponse['providers']) => void>();

    let reconnectPromise: Promise<boolean> | null = null;

    const attemptReconnect = (): Promise<boolean> => {
      if (reconnectPromise) return reconnectPromise;
      reconnectPromise = this.sendConnectRequest({ reconnectOnly: true }).then(
        (newResponse) => {
          sessionKeyRef.current = newResponse.sessionKey;
          session.sessionKey = newResponse.sessionKey;
          session.providers = newResponse.providers;
          for (const cb of providersUpdatedCallbacks) cb(newResponse.providers);
          reconnectPromise = null;
          return true;
        },
        () => {
          for (const cb of disconnectCallbacks) cb();
          disconnectCallbacks.clear();
          reconnectPromise = null;
          return false;
        },
      );
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
      createRelay: (wsUrl: string) =>
        createRelayClient(wsUrl, sessionKeyRef.current, session.providers),
      disconnect: () => {
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
        for (const cb of disconnectCallbacks) cb();
        disconnectCallbacks.clear();
        notifyChannel.port1.close();
      } else if (msg?.type === 'BYOKY_PROVIDERS_UPDATED' && msg.payload?.sessionKey === sessionKeyRef.current) {
        const newProviders = msg.payload.providers as ConnectResponse['providers'];
        session.providers = newProviders;
        for (const cb of providersUpdatedCallbacks) cb(newProviders);
      }
    };
    window.postMessage(
      { type: 'BYOKY_REGISTER_NOTIFY' },
      window.location.origin,
      [notifyChannel.port2],
    );

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
          const { code, message } = msg.payload as {
            code: string;
            message: string;
          };
          reject(new ByokyError(code as ByokyErrorCode, message));
        }
      };

      function cleanup() {
        clearTimeout(timeoutId);
        channel.port1.close();
      }

      window.postMessage(
        {
          type: 'BYOKY_CONNECT_REQUEST',
          id: requestId,
          requestId,
          payload: request,
        },
        window.location.origin,
        [channel.port2],
      );
    });
  }

  private sendDisconnect(sessionKey: string): void {
    window.postMessage(
      { type: 'BYOKY_DISCONNECT', payload: { sessionKey } },
      window.location.origin,
    );
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

      window.postMessage({
        type: 'BYOKY_SESSION_STATUS',
        requestId,
        payload: { sessionKey },
      }, window.location.origin, [channel.port2]);
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

      window.postMessage({
        type: 'BYOKY_SESSION_USAGE',
        requestId,
        payload: { sessionKey },
      }, window.location.origin, [channel.port2]);
    });
  }
}
