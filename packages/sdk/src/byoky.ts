import type { AuthMethod, ConnectRequest, ConnectResponse, SessionUsage } from '@byoky/core';
import { ByokyError, ByokyErrorCode, isByokyMessage, encodePairPayload } from '@byoky/core';
import { isExtensionInstalled, getStoreUrl } from './detect.js';
import { createProxyFetch } from './proxy-fetch.js';
import { createRelayFetch } from './relay-fetch.js';
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
  /** Relay server URL for mobile wallet pairing. Default: wss://relay.byoky.com */
  relayUrl?: string;
}

export class Byoky {
  private timeout: number;
  private relayUrl: string;

  constructor(options: ByokyOptions = {}) {
    this.timeout = options.timeout ?? 60_000;
    this.relayUrl = options.relayUrl ?? 'wss://relay.byoky.com';
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
  } = {}): Promise<ByokySession> {
    if (typeof window === 'undefined') {
      throw new ByokyError(
        ByokyErrorCode.UNKNOWN,
        'Byoky SDK requires a browser environment. On the server, use your API key directly.',
      );
    }

    const { onPairingReady, useRelay, ...connectRequest } = request;

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
          type: 'gift:auth',
          giftId: roomId,
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
          case 'gift:auth:result':
            if (msg.success) {
              // Authenticated — show the pairing code
              onPairingReady(pairingCode);
            } else {
              clearTimeout(timeout);
              ws.close();
              reject(new ByokyError(ByokyErrorCode.UNKNOWN, `Relay auth failed: ${msg.error}`));
            }
            break;

          case 'relay:pair:hello': {
            // Phone wallet connected and sent its providers
            clearTimeout(timeout);
            const providers = msg.providers as Record<string, { available: boolean; authMethod: AuthMethod }>;

            // Acknowledge the pairing
            ws.send(JSON.stringify({ type: 'relay:pair:ack' }));

            resolve(this.buildRelaySession(ws, roomId, providers));
            break;
          }

          case 'gift:peer:status':
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
    };
  }

  // --- Extension-based session ---

  private buildSession(response: ConnectResponse): ByokySession {
    const sessionKey = response.sessionKey;
    const disconnectCallbacks = new Set<() => void>();

    // Register a secure notification channel via MessageChannel so
    // revocation events cannot be spoofed by page scripts.
    const notifyChannel = new MessageChannel();
    notifyChannel.port1.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'BYOKY_SESSION_REVOKED' && msg.payload?.sessionKey === sessionKey) {
        for (const cb of disconnectCallbacks) cb();
        disconnectCallbacks.clear();
        notifyChannel.port1.close();
      }
    };
    window.postMessage(
      { type: 'BYOKY_REGISTER_NOTIFY' },
      window.location.origin,
      [notifyChannel.port2],
    );

    return {
      ...response,
      createFetch: (providerId: string) =>
        createProxyFetch(providerId, sessionKey),
      createRelay: (wsUrl: string) =>
        createRelayClient(wsUrl, sessionKey, response.providers),
      disconnect: () => {
        notifyChannel.port1.close();
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
