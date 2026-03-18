import {
  type Credential,
  type Session,
  type RequestLogEntry,
  type PendingApproval,
  type ConnectRequest,
  type ConnectResponse,
  type ProxyRequest,
  decrypt,
  verifyPassword,
  PROVIDERS,
} from '@byoky/core';

export default defineBackground(() => {
  const sessions = new Map<string, Session>();
  let masterPassword: string | null = null;

  // --- Open side panel on icon click (Chrome) ---

  if (typeof chrome !== 'undefined' && chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // --- Message handling ---

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'BYOKY_CONNECT_REQUEST') {
      return handleConnect(message, sender);
    }

    if (message.type === 'BYOKY_DISCONNECT') {
      const { sessionKey } = message.payload as { sessionKey: string };
      sessions.delete(sessionKey);
      return;
    }

    if (message.type === 'BYOKY_INTERNAL') {
      return handleInternal(message);
    }
  });

  // --- Proxy via Port (streaming) ---

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'byoky-proxy') return;

    port.onMessage.addListener(async (msg: ProxyRequest) => {
      if (msg.sessionKey == null) return;

      const session = sessions.get(msg.sessionKey);
      if (!session) {
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 401,
          error: { code: 'SESSION_EXPIRED', message: 'Invalid or expired session' },
        });
        return;
      }

      const credential = await resolveCredential(session, msg.providerId);
      if (!credential) {
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 403,
          error: { code: 'PROVIDER_UNAVAILABLE', message: `No credential for ${msg.providerId}` },
        });
        return;
      }

      try {
        const apiKey = await decryptCredentialKey(credential);
        const realHeaders = buildHeaders(msg.providerId, msg.headers, apiKey);

        const response = await fetch(msg.url, {
          method: msg.method,
          headers: realHeaders,
          body: msg.body,
        });

        const respHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          respHeaders[k] = v;
        });

        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_META',
          requestId: msg.requestId,
          status: response.status,
          statusText: response.statusText,
          headers: respHeaders,
        });

        await logRequest(session, msg, response.status);

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            port.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: decoder.decode(value, { stream: true }),
            });
          }
        }

        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_DONE',
          requestId: msg.requestId,
        });
      } catch (error) {
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 502,
          error: { code: 'PROXY_ERROR', message: (error as Error).message },
        });
      }
    });
  });

  // --- Helpers ---

  async function handleConnect(
    message: { id: string; payload: ConnectRequest },
    sender: browser.Runtime.MessageSender,
  ): Promise<unknown> {
    const origin = sender.tab?.url ? new URL(sender.tab.url).origin : 'unknown';

    if (!masterPassword) {
      return {
        type: 'BYOKY_ERROR',
        requestId: message.id,
        payload: { code: 'WALLET_LOCKED', message: 'Wallet is locked' },
      };
    }

    const credentials = await getStoredCredentials();
    const request = message.payload;
    const sessionKey = `byk_${crypto.randomUUID().replace(/-/g, '')}`;

    const providerMap: ConnectResponse['providers'] = {};
    const sessionProviders: Session['providers'] = [];

    for (const req of request.providers ?? []) {
      const cred = credentials.find((c) => c.providerId === req.id);
      providerMap[req.id] = {
        available: !!cred,
        authMethod: cred?.authMethod ?? 'api_key',
      };
      if (cred) {
        sessionProviders.push({
          providerId: req.id,
          credentialId: cred.id,
          available: true,
          authMethod: cred.authMethod,
        });
      }
    }

    if (request.providers?.length === 0 || !request.providers) {
      for (const cred of credentials) {
        providerMap[cred.providerId] = {
          available: true,
          authMethod: cred.authMethod,
        };
        sessionProviders.push({
          providerId: cred.providerId,
          credentialId: cred.id,
          available: true,
          authMethod: cred.authMethod,
        });
      }
    }

    const session: Session = {
      id: crypto.randomUUID(),
      sessionKey,
      appOrigin: origin,
      providers: sessionProviders,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    sessions.set(sessionKey, session);

    const response: ConnectResponse = {
      sessionKey,
      proxyUrl: 'extension-proxy',
      providers: providerMap,
    };

    return {
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: message.id,
      payload: response,
    };
  }

  async function handleInternal(message: {
    action: string;
    payload?: unknown;
  }): Promise<unknown> {
    switch (message.action) {
      case 'unlock': {
        const { password } = message.payload as { password: string };
        const data = await browser.storage.local.get('passwordHash');
        if (!data.passwordHash) return { success: false };
        const valid = await verifyPassword(password, data.passwordHash as string);
        if (valid) masterPassword = password;
        return { success: valid };
      }

      case 'lock':
        masterPassword = null;
        sessions.clear();
        return { success: true };

      case 'isUnlocked':
        return { unlocked: masterPassword !== null };

      case 'isInitialized': {
        const data = await browser.storage.local.get('passwordHash');
        return { initialized: !!data.passwordHash };
      }

      case 'getCredentials':
        return { credentials: await getStoredCredentials() };

      case 'getSessions':
        return { sessions: Array.from(sessions.values()) };

      case 'getRequestLog': {
        const data = await browser.storage.local.get('requestLog');
        return { log: (data.requestLog as RequestLogEntry[]) ?? [] };
      }

      case 'revokeSession': {
        const { sessionId } = message.payload as { sessionId: string };
        for (const [key, s] of sessions) {
          if (s.id === sessionId) {
            sessions.delete(key);
            break;
          }
        }
        return { success: true };
      }

      default:
        return { error: 'Unknown action' };
    }
  }

  async function getStoredCredentials(): Promise<Credential[]> {
    const data = await browser.storage.local.get('credentials');
    return (data.credentials as Credential[]) ?? [];
  }

  async function resolveCredential(
    session: Session,
    providerId: string,
  ): Promise<Credential | undefined> {
    const sp = session.providers.find((p) => p.providerId === providerId);
    if (!sp) return undefined;

    const credentials = await getStoredCredentials();
    return credentials.find((c) => c.id === sp.credentialId);
  }

  async function decryptCredentialKey(
    credential: Credential,
  ): Promise<string> {
    if (!masterPassword) throw new Error('Wallet is locked');

    if (credential.authMethod === 'api_key') {
      return decrypt(credential.encryptedKey, masterPassword);
    }
    return decrypt(credential.encryptedAccessToken, masterPassword);
  }

  function buildHeaders(
    providerId: string,
    requestHeaders: Record<string, string>,
    apiKey: string,
  ): Record<string, string> {
    const headers = { ...requestHeaders };

    // Remove any auth headers the SDK might have set (they're fake session keys)
    delete headers['authorization'];
    delete headers['x-api-key'];

    if (providerId === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
    } else {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  async function logRequest(
    session: Session,
    req: ProxyRequest,
    status: number,
  ) {
    const entry: RequestLogEntry = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      appOrigin: session.appOrigin,
      providerId: req.providerId,
      url: req.url,
      method: req.method,
      status,
      timestamp: Date.now(),
    };

    const data = await browser.storage.local.get('requestLog');
    const log = (data.requestLog as RequestLogEntry[]) ?? [];
    log.unshift(entry);

    // Keep last 500 entries
    await browser.storage.local.set({
      requestLog: log.slice(0, 500),
    });
  }
});
