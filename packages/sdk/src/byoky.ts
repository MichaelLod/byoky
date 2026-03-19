import type { ConnectRequest, ConnectResponse, SessionUsage } from '@byoky/core';
import { ByokyError, ByokyErrorCode, isByokyMessage } from '@byoky/core';
import { isExtensionInstalled, getStoreUrl } from './detect.js';
import { createProxyFetch } from './proxy-fetch.js';
import { createRelayClient, type RelayConnection } from './relay-client.js';

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
}

export interface ByokyOptions {
  timeout?: number;
}

export class Byoky {
  private timeout: number;

  constructor(options: ByokyOptions = {}) {
    this.timeout = options.timeout ?? 60_000;
  }

  async connect(request: ConnectRequest = {}): Promise<ByokySession> {
    if (typeof window === 'undefined') {
      throw new ByokyError(
        ByokyErrorCode.UNKNOWN,
        'Byoky SDK requires a browser environment. On the server, use your API key directly.',
      );
    }

    if (!isExtensionInstalled()) {
      const storeUrl = getStoreUrl();
      if (storeUrl) {
        window.open(storeUrl, '_blank');
      }
      throw ByokyError.walletNotInstalled();
    }

    const response = await this.sendConnectRequest(request);
    return this.buildSession(response);
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

  private buildSession(response: ConnectResponse): ByokySession {
    const sessionKey = response.sessionKey;
    const disconnectCallbacks = new Set<() => void>();

    function handleRevocation(event: Event) {
      const msg = (event as CustomEvent).detail;
      if (msg?.type === 'BYOKY_SESSION_REVOKED' && msg.payload?.sessionKey === sessionKey) {
        for (const cb of disconnectCallbacks) cb();
        disconnectCallbacks.clear();
        document.removeEventListener('byoky-message', handleRevocation);
      }
    }
    document.addEventListener('byoky-message', handleRevocation);

    return {
      ...response,
      createFetch: (providerId: string) =>
        createProxyFetch(providerId, sessionKey),
      createRelay: (wsUrl: string) =>
        createRelayClient(wsUrl, sessionKey, response.providers),
      disconnect: () => {
        document.removeEventListener('byoky-message', handleRevocation);
        this.sendDisconnect(sessionKey);
      },
      isConnected: () => this.querySessionStatus(sessionKey),
      getUsage: () => this.querySessionUsage(sessionKey),
      onDisconnect: (callback: () => void) => {
        disconnectCallbacks.add(callback);
        return () => { disconnectCallbacks.delete(callback); };
      },
    };
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

      function handleEvent(event: Event) {
        const msg = (event as CustomEvent).detail;
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
      }

      function cleanup() {
        clearTimeout(timeoutId);
        document.removeEventListener('byoky-message', handleEvent);
      }

      document.addEventListener('byoky-message', handleEvent);

      window.postMessage(
        {
          type: 'BYOKY_CONNECT_REQUEST',
          id: requestId,
          requestId,
          payload: request,
        },
        '*',
      );
    });
  }

  private sendDisconnect(sessionKey: string): void {
    window.postMessage(
      { type: 'BYOKY_DISCONNECT', payload: { sessionKey } },
      '*',
    );
  }

  private querySessionStatus(sessionKey: string): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { cleanup(); resolve(false); }, 5000);

      function handleEvent(event: Event) {
        const msg = (event as CustomEvent).detail;
        if (msg?.requestId !== requestId) return;
        if (msg.type === 'BYOKY_SESSION_STATUS_RESPONSE') {
          cleanup();
          resolve(!!msg.payload?.connected);
        }
      }

      function cleanup() {
        clearTimeout(timeout);
        document.removeEventListener('byoky-message', handleEvent);
      }

      document.addEventListener('byoky-message', handleEvent);
      window.postMessage({
        type: 'BYOKY_SESSION_STATUS',
        requestId,
        payload: { sessionKey },
      }, '*');
    });
  }

  private querySessionUsage(sessionKey: string): Promise<SessionUsage> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Usage query timed out'));
      }, 5000);

      function handleEvent(event: Event) {
        const msg = (event as CustomEvent).detail;
        if (msg?.requestId !== requestId) return;
        if (msg.type === 'BYOKY_SESSION_USAGE_RESPONSE') {
          cleanup();
          if (msg.payload) {
            resolve(msg.payload as SessionUsage);
          } else {
            reject(new Error('Session not found'));
          }
        }
      }

      function cleanup() {
        clearTimeout(timeout);
        document.removeEventListener('byoky-message', handleEvent);
      }

      document.addEventListener('byoky-message', handleEvent);
      window.postMessage({
        type: 'BYOKY_SESSION_USAGE',
        requestId,
        payload: { sessionKey },
      }, '*');
    });
  }
}
