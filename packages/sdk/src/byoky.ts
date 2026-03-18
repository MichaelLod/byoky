import type { ConnectRequest, ConnectResponse } from '@byoky/core';
import { ByokyError, ByokyErrorCode, isByokyMessage } from '@byoky/core';
import { isExtensionInstalled, getStoreUrl } from './detect.js';
import { createProxyFetch } from './proxy-fetch.js';

export interface ByokySession extends ConnectResponse {
  createFetch(providerId: string): typeof fetch;
  disconnect(): void;
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
    if (!isExtensionInstalled()) {
      const storeUrl = getStoreUrl();
      if (storeUrl) {
        window.open(storeUrl, '_blank');
      }
      throw ByokyError.walletNotInstalled();
    }

    const response = await this.sendConnectRequest(request);

    return {
      ...response,
      createFetch: (providerId: string) =>
        createProxyFetch(providerId, response.sessionKey),
      disconnect: () => this.disconnect(response.sessionKey),
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

      function handleMessage(event: MessageEvent) {
        if (event.source !== window) return;
        if (!isByokyMessage(event.data)) return;

        const msg = event.data;
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
        window.removeEventListener('message', handleMessage);
      }

      window.addEventListener('message', handleMessage);

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

  private disconnect(sessionKey: string): void {
    window.postMessage(
      { type: 'BYOKY_DISCONNECT', payload: { sessionKey } },
      '*',
    );
  }
}
