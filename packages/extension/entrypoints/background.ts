import {
  type Credential,
  type Session,
  type RequestLogEntry,
  type PendingApproval,
  type ConnectRequest,
  type ConnectResponse,
  type ProxyRequest,
  decrypt,
  encrypt,
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
        const realHeaders = buildHeaders(msg.providerId, msg.headers, apiKey, credential.authMethod);

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
      // Auto-open the wallet so the user can unlock (like MetaMask)
      openWalletUI(sender.tab?.id);
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

      case 'startOAuth': {
        const { providerId, label } = message.payload as {
          providerId: string;
          label: string;
        };
        return handleOAuthFlow(providerId, label);
      }

      default:
        return { error: 'Unknown action' };
    }
  }

  async function handleOAuthFlow(
    providerId: string,
    label: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!masterPassword) {
      return { success: false, error: 'Wallet is locked' };
    }

    const provider = PROVIDERS[providerId];
    if (!provider?.oauthConfig) {
      return { success: false, error: 'Provider does not support OAuth' };
    }

    const { clientId, authorizationUrl, tokenUrl, scopes } = provider.oauthConfig;

    if (!clientId) {
      return { success: false, error: 'OAuth client_id not configured for this provider' };
    }

    const redirectUrl = browser.identity.getRedirectURL();
    const state = crypto.randomUUID();

    // PKCE: generate code_verifier and code_challenge (S256)
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const authUrl = new URL(authorizationUrl);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (scopes.length > 0) {
      authUrl.searchParams.set('scope', scopes.join(' '));
    }

    try {
      const responseUrl = await browser.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true,
      });

      const params = new URL(responseUrl).searchParams;

      if (params.get('state') !== state) {
        return { success: false, error: 'OAuth state mismatch' };
      }

      const code = params.get('code');
      if (!code) {
        const error = params.get('error') || 'No authorization code received';
        return { success: false, error };
      }

      // Exchange code for tokens (with PKCE code_verifier, no client_secret needed)
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUrl,
        }),
      });

      if (!tokenResponse.ok) {
        const err = await tokenResponse.text();
        return { success: false, error: `Token exchange failed: ${err}` };
      }

      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Encrypt and store
      const encryptedAccessToken = await encrypt(
        tokens.access_token,
        masterPassword,
      );
      const encryptedRefreshToken = tokens.refresh_token
        ? await encrypt(tokens.refresh_token, masterPassword)
        : undefined;

      const newCred: Credential = {
        id: crypto.randomUUID(),
        providerId,
        label,
        authMethod: 'oauth',
        encryptedAccessToken,
        encryptedRefreshToken,
        expiresAt: tokens.expires_in
          ? Date.now() + tokens.expires_in * 1000
          : undefined,
        createdAt: Date.now(),
      };

      const data = await browser.storage.local.get('credentials');
      const credentials = (data.credentials as Credential[]) ?? [];
      credentials.push(newCred);
      await browser.storage.local.set({ credentials });

      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('canceled') || msg.includes('cancelled')) {
        return { success: false, error: 'OAuth flow was cancelled' };
      }
      return { success: false, error: msg };
    }
  }

  // --- PKCE helpers (RFC 7636) ---

  function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
  }

  async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(digest));
  }

  function base64UrlEncode(buffer: Uint8Array): string {
    let binary = '';
    for (const byte of buffer) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function openWalletUI(tabId?: number) {
    // Chrome: open side panel
    if (typeof chrome !== 'undefined' && chrome.sidePanel && tabId) {
      chrome.sidePanel.open({ tabId }).catch(() => {});
      return;
    }

    // Firefox/Safari fallback: open popup as a window
    const popupUrl = browser.runtime.getURL('/popup.html');
    browser.windows.create({
      url: popupUrl,
      type: 'popup',
      width: 400,
      height: 600,
    }).catch(() => {});
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
    authMethod: string = 'api_key',
  ): Record<string, string> {
    const headers = { ...requestHeaders };

    // Remove any auth headers the SDK might have set (they're fake session keys)
    delete headers['authorization'];
    delete headers['x-api-key'];

    if (providerId === 'anthropic') {
      // Both API keys and setup tokens use x-api-key for Anthropic
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
