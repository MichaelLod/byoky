import type { AuthMethod, ConnectRequest, ConnectResponse, ModelInfo, SessionUsage } from '@byoky/core';
import { ByokyError, ByokyErrorCode, isByokyMessage, encodePairPayload } from '@byoky/core';
import { fetchModelsList } from './list-models-fetch.js';
import { isExtensionInstalled, getStoreUrl, getMessageTarget } from './detect.js';
import { createProxyFetch } from './proxy-fetch.js';
import { createRelayFetch } from './relay-fetch.js';
import { createRelayClient, type RelayConnection } from './relay-client.js';
import { ConnectModal, type ModalOptions } from './modal/connect-modal.js';
import { createVaultFetch } from './vault-fetch.js';
import { createMockSession, type MockConnectOptions } from './mock.js';

// --- Session persistence helpers ---

const EXT_SESSION_KEY = 'byoky:session';
const VAULT_SESSION_KEY = 'byoky:vault-session';
const RELAY_SESSION_KEY = 'byoky:relay-session';
// Cap relay-rejoin freshness so a stolen authToken can't be replayed forever.
// Relay rooms idle out after 5 min server-side; keeping the client window at
// 10 min makes "refresh within a minute" work reliably while still bounding
// the attack window for an exfiltrated token.
const RELAY_SESSION_TTL_MS = 10 * 60 * 1000;

interface VaultSessionData {
  appSessionToken: string;
  vaultUrl: string;
  sessionKey: string;
  proxyUrl: string;
  providers: ConnectResponse['providers'];
  expiresAt: number;
}

interface RelaySessionData {
  relayUrl: string;
  roomId: string;
  authToken: string;
  providers: ConnectResponse['providers'];
  savedAt: number;
}

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

function decodeJwtExp(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 0;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch { return 0; }
}

function saveVaultSession(data: VaultSessionData): void {
  if (!hasSessionStorage()) return;
  try { sessionStorage.setItem(VAULT_SESSION_KEY, JSON.stringify(data)); } catch {}
}

function loadVaultSession(): VaultSessionData | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(VAULT_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as VaultSessionData;
    if (!data.appSessionToken || !data.vaultUrl) return null;
    if (data.expiresAt > 0 && data.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

function clearVaultSession(): void {
  if (!hasSessionStorage()) return;
  try { sessionStorage.removeItem(VAULT_SESSION_KEY); } catch {}
}

function saveRelaySession(data: RelaySessionData): void {
  if (!hasSessionStorage()) return;
  try { sessionStorage.setItem(RELAY_SESSION_KEY, JSON.stringify(data)); } catch {}
}

function loadRelaySession(): RelaySessionData | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(RELAY_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as RelaySessionData;
    if (!data.relayUrl || !data.roomId || !data.authToken) return null;
    if (typeof data.savedAt !== 'number' || Date.now() - data.savedAt > RELAY_SESSION_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function clearRelaySession(): void {
  if (!hasSessionStorage()) return;
  try { sessionStorage.removeItem(RELAY_SESSION_KEY); } catch {}
}

export interface VaultConnectOptions {
  vaultUrl: string;
  username?: string;
  password?: string;
  token?: string;
  /**
   * Providers the app needs. Required so the vault can compute per-app
   * routing decisions and surface availability for each requested provider.
   * If omitted, the vault will return an empty providers map.
   */
  providers?: { id: string; required?: boolean }[];
  /**
   * App origin used for per-app routing on the vault side. The vault keys
   * its app→group bindings by this. In a browser, defaults to
   * `window.location.origin`. In Node, you must pass it explicitly so the
   * vault can identify your app.
   */
  appOrigin?: string;
}

export interface ByokySession extends ConnectResponse {
  /**
   * Relay coordinates, present only when the session was paired via mobile
   * wallet (i.e. no extension was found and the user scanned a QR). Consumers
   * that need to open their own recipient WebSocket to the relay — like the
   * OpenClaw bridge running in relay-mode — read these. Undefined for the
   * extension path and for vault sessions.
   */
  relay?: { url: string; roomId: string; authToken: string };
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
  /** Relay server URL for mobile wallet pairing. Default: wss://relay.byoky.com */
  relayUrl?: string;
}

export class Byoky {
  private timeout: number;
  private relayUrl: string;

  constructor(options: ByokyOptions = {}) {
    this.timeout = options.timeout ?? 60_000;
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
      const modalOpts = typeof modal === 'object' ? modal : {};
      const connectModal = new ConnectModal(modalOpts);
      return connectModal.show({
        hasExtension: isExtensionInstalled(),
        connectExtension: () => this.sendConnectRequest(connectRequest).then((r) => this.buildSession(r)),
        connectRelay: (onReady) => this.connectViaRelay(connectRequest, onReady),
        getStoreUrl: () => getStoreUrl(),
      });
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

    // No extension, no relay callback — throw
    const storeUrl = getStoreUrl();
    if (storeUrl) {
      window.open(storeUrl, '_blank');
    }
    throw ByokyError.walletNotInstalled();
  }

  /**
   * Silently reconnect to an existing session for the current origin.
   * Checks (in order): persisted relay pairing (phone still open), vault
   * session, extension live session, persisted extension session. Returns
   * null if nothing is restorable.
   */
  async tryReconnect(): Promise<ByokySession | null> {
    if (typeof window === 'undefined') return null;

    // 1. Try rejoining a persisted relay room. Works as long as the phone
    //    stayed connected to the relay — room + authToken still valid, phone
    //    gets a peer:status:online on the server side and keeps proxying.
    const relayData = loadRelaySession();
    if (relayData) {
      const relaySession = await this.rejoinRelaySession(relayData);
      if (relaySession) return relaySession;
      // Rejoin failed (phone offline, room gone, or auth rejected). The
      // helper already cleared the stored session; fall through.
    }

    // 2. Try restoring a vault session (no extension needed)
    const vaultData = loadVaultSession();
    if (vaultData) {
      // Drop the session if the vault has nothing it can actually serve. The
      // relay path saves what the vault *reported*; if every provider came
      // back unavailable, restoring would present a fake "connected" state
      // and the first fetch would 404 on NO_CREDENTIAL.
      const anyAvailable = Object.values(vaultData.providers ?? {}).some((p) => p?.available);
      if (!anyAvailable) {
        clearVaultSession();
      } else {
        return this.buildVaultSession(vaultData);
      }
    }

    if (!isExtensionInstalled()) return null;

    // 3. Try extension's live session (covers SW still running)
    try {
      const response = await this.sendConnectRequest({ reconnectOnly: true });
      saveExtSession(response);
      return this.buildSession(response);
    } catch {
      // No live session — fall through
    }

    // 4. Try persisted extension session (covers SW restart + page reload)
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
   * Connect via a Byoky Vault server. Works in both browser and Node.js.
   * The vault stores encrypted credentials and proxies API calls server-side.
   *
   * Two-step handshake:
   *   1. Authenticate with the user's vault credentials → user-session JWT
   *   2. POST /connect with the requested providers + app origin → app-session JWT
   *
   * The app-session JWT is what subsequent /proxy calls use; it's scoped
   * to (user, origin) so the vault can apply per-app routing rules
   * (groups, cross-family translation, same-family swap).
   *
   * In the browser, the app origin defaults to window.location.origin. In
   * Node, callers must pass `appOrigin` explicitly.
   */
  async connectViaVault(options: VaultConnectOptions): Promise<ByokySession> {
    const { vaultUrl } = options;
    const baseUrl = vaultUrl.replace(/\/$/, '');
    let userToken = options.token;

    if (!userToken) {
      if (!options.username || !options.password) {
        throw new ByokyError(ByokyErrorCode.UNKNOWN, 'Either token or username+password required for vault connection');
      }
      const loginResp = await fetch(`${baseUrl}/auth/login`, {
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
      userToken = loginData.token;
    }

    const appOrigin =
      options.appOrigin ??
      (typeof window !== 'undefined' ? window.location.origin : undefined);

    if (!appOrigin) {
      throw new ByokyError(
        ByokyErrorCode.UNKNOWN,
        'appOrigin is required when connecting from Node. Pass it via options.appOrigin.',
      );
    }

    const handshakeResp = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        appOrigin,
        providers: options.providers ?? [],
      }),
    });
    if (!handshakeResp.ok) {
      const err = await handshakeResp.json().catch(() => ({})) as Record<string, unknown>;
      const errObj = err.error as Record<string, string> | undefined;
      throw new ByokyError(
        ByokyErrorCode.UNKNOWN,
        errObj?.message ?? 'Failed to establish vault app session',
      );
    }
    const handshakeData = await handshakeResp.json() as {
      appSessionToken: string;
      origin: string;
      groupId: string;
      providers: Record<string, { available: boolean; authMethod: AuthMethod }>;
    };

    const appSessionToken = handshakeData.appSessionToken;
    const sessionKey = `vault_${appSessionToken.slice(-8)}`;

    saveVaultSession({
      appSessionToken,
      vaultUrl,
      sessionKey,
      proxyUrl: `${baseUrl}/proxy`,
      providers: handshakeData.providers,
      expiresAt: decodeJwtExp(appSessionToken),
    });

    return this.buildVaultSession({
      appSessionToken,
      vaultUrl,
      sessionKey,
      proxyUrl: `${baseUrl}/proxy`,
      providers: handshakeData.providers,
    });
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

  private buildVaultSession(data: {
    appSessionToken: string;
    vaultUrl: string;
    sessionKey: string;
    proxyUrl: string;
    providers: ConnectResponse['providers'];
  }): ByokySession {
    return {
      sessionKey: data.sessionKey,
      proxyUrl: data.proxyUrl,
      providers: data.providers,
      createFetch: (providerId: string) => createVaultFetch(data.vaultUrl, data.appSessionToken, providerId),
      listModels: (providerId: string) =>
        fetchModelsList(createVaultFetch(data.vaultUrl, data.appSessionToken, providerId), providerId),
      createRelay: () => { throw new Error('Relay not supported in vault mode'); },
      disconnect: () => { clearVaultSession(); },
      isConnected: async () => {
        const exp = decodeJwtExp(data.appSessionToken);
        return exp === 0 || exp > Math.floor(Date.now() / 1000);
      },
      getUsage: async () => ({ requests: 0, inputTokens: 0, outputTokens: 0, byProvider: {} }),
      onDisconnect: () => () => {},
      onProvidersUpdated: () => () => {},
    };
  }

  // --- Relay rejoin (refresh survival) ---

  private rejoinRelaySession(data: RelaySessionData): Promise<ByokySession | null> {
    return new Promise<ByokySession | null>((resolve) => {
      let settled = false;
      const settle = (value: ByokySession | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(data.relayUrl);
      } catch {
        clearRelaySession();
        settle(null);
        return;
      }

      // Hard ceiling on the rejoin attempt itself — don't block page startup
      // on a misbehaving relay.
      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        clearRelaySession();
        settle(null);
      }, 5_000);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'relay:auth',
          roomId: data.roomId,
          authToken: data.authToken,
          role: 'recipient',
        }));
      };

      ws.onmessage = (event) => {
        let msg: { type: string; success?: boolean; peerOnline?: boolean; online?: boolean };
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'relay:auth:result') {
          if (!msg.success) {
            clearTimeout(timeout);
            try { ws.close(); } catch {}
            clearRelaySession();
            settle(null);
            return;
          }
          if (msg.peerOnline === false) {
            // Auth passed but the phone is gone. Drop the session so the next
            // reconnect attempt doesn't uselessly retry the same dead room.
            clearTimeout(timeout);
            try { ws.close(); } catch {}
            clearRelaySession();
            settle(null);
            return;
          }
          // Phone is alive in the room — resume on the existing provider list.
          clearTimeout(timeout);
          settle(this.buildRelaySession(ws, data.relayUrl, data.roomId, data.authToken, data.providers));
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        clearRelaySession();
        settle(null);
      };
    });
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
            saveRelaySession({
              relayUrl: this.relayUrl,
              roomId,
              authToken,
              providers,
              savedAt: Date.now(),
            });
            resolve(this.buildRelaySession(ws, this.relayUrl, roomId, authToken, providers));
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
    relayUrl: string,
    roomId: string,
    authToken: string,
    providers: Record<string, { available: boolean; authMethod: AuthMethod }>,
  ): ByokySession {
    const sessionKey = `relay_${roomId}`;
    // Refresh the persisted pair payload whenever the session is (re)built —
    // both the initial pairing and a successful rejoin land here. This keeps
    // the TTL rolling as long as the tab stays active.
    saveRelaySession({ relayUrl, roomId, authToken, providers, savedAt: Date.now() });
    const disconnectCallbacks = new Set<() => void>();

    let vaultFallback: { vaultUrl: string; appSessionToken: string } | null = null;
    let activeFetchMode: 'relay' | 'vault' = 'relay';

    // Keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'relay:ping', ts: Date.now() }));
      }
    }, 30_000);

    ws.addEventListener('close', () => {
      clearInterval(pingInterval);
      if (vaultFallback) {
        activeFetchMode = 'vault';
      } else {
        for (const cb of disconnectCallbacks) cb();
        disconnectCallbacks.clear();
      }
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'relay:vault:offer:failed') {
          console.warn('[byoky] vault fallback unavailable:', msg.reason);
          return;
        }

        if (msg.type === 'relay:vault:offer') {
          if (typeof msg.vaultUrl === 'string' && typeof msg.appSessionToken === 'string') {
            vaultFallback = { vaultUrl: msg.vaultUrl, appSessionToken: msg.appSessionToken };
            // Prefer the vault's own view of provider availability over the
            // phone's pair:hello map. The phone's map advertises everything it
            // *could* serve (incl. oauth), while the vault's map reflects what
            // *it* can actually route. Using the former here is what caused
            // refresh-restored sessions to silently 404 on every request.
            const vaultProviders = (msg.providers && typeof msg.providers === 'object')
              ? msg.providers as ConnectResponse['providers']
              : providers;
            saveVaultSession({
              appSessionToken: msg.appSessionToken,
              vaultUrl: msg.vaultUrl,
              sessionKey: `relay_vault_${roomId}`,
              proxyUrl: `${msg.vaultUrl.replace(/\/$/, '')}/proxy`,
              providers: vaultProviders,
              expiresAt: decodeJwtExp(msg.appSessionToken),
            });
          }
          return;
        }

        if (msg.type === 'relay:peer:status') {
          if (msg.online === false) {
            // Try loading a saved vault session if the offer never arrived
            if (!vaultFallback) {
              const saved = loadVaultSession();
              if (saved) {
                vaultFallback = { vaultUrl: saved.vaultUrl, appSessionToken: saved.appSessionToken };
              }
            }
            if (vaultFallback) {
              activeFetchMode = 'vault';
            } else {
              for (const cb of disconnectCallbacks) cb();
              disconnectCallbacks.clear();
              clearInterval(pingInterval);
              ws.close(1000, 'Phone disconnected');
            }
          } else if (msg.online === true) {
            activeFetchMode = 'relay';
          }
        }
      } catch {}
    });

    const session: ByokySession = {
      sessionKey,
      proxyUrl: '',
      providers,
      relay: { url: relayUrl, roomId, authToken },
      createFetch: (providerId: string) => {
        const relayFetch = createRelayFetch(ws, providerId);
        return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          if (activeFetchMode === 'vault' && vaultFallback) {
            return createVaultFetch(vaultFallback.vaultUrl, vaultFallback.appSessionToken, providerId)(input, init);
          }
          return relayFetch(input, init);
        };
      },
      listModels: (providerId: string) =>
        fetchModelsList(session.createFetch(providerId), providerId),
      createRelay: () => { throw new Error('Relay-in-relay not supported'); },
      disconnect: () => {
        clearInterval(pingInterval);
        clearVaultSession();
        clearRelaySession();
        ws.close(1000, 'Client disconnected');
      },
      isConnected: async () => {
        if (activeFetchMode === 'vault' && vaultFallback) {
          const exp = decodeJwtExp(vaultFallback.appSessionToken);
          return exp === 0 || exp > Math.floor(Date.now() / 1000);
        }
        return ws.readyState === WebSocket.OPEN;
      },
      getUsage: async () => ({ requests: 0, inputTokens: 0, outputTokens: 0, byProvider: {} }),
      onDisconnect: (callback: () => void) => {
        disconnectCallbacks.add(callback);
        return () => { disconnectCallbacks.delete(callback); };
      },
      onProvidersUpdated: () => () => {},
    };
    return session;
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
          saveExtSession(newResponse);
          for (const cb of providersUpdatedCallbacks) cb(newResponse.providers);
          reconnectPromise = null;
          return true;
        },
        () => {
          clearExtSession();
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
      const { target, origin } = getMessageTarget();
      target.postMessage(
        { type: 'BYOKY_REGISTER_NOTIFY' },
        origin,
        [notifyChannel.port2],
      );
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

      const { target, origin } = getMessageTarget();
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
  }

  private sendDisconnect(sessionKey: string): void {
    const { target, origin } = getMessageTarget();
    target.postMessage(
      { type: 'BYOKY_DISCONNECT', payload: { sessionKey } },
      origin,
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

      const { target, origin } = getMessageTarget();
      target.postMessage({
        type: 'BYOKY_SESSION_STATUS',
        requestId,
        payload: { sessionKey },
      }, origin, [channel.port2]);
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

      const { target, origin } = getMessageTarget();
      target.postMessage({
        type: 'BYOKY_SESSION_USAGE',
        requestId,
        payload: { sessionKey },
      }, origin, [channel.port2]);
    });
  }
}
