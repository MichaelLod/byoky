import {
  type Credential,
  type Session,
  type RequestLogEntry,
  type PendingApproval,
  type TrustedSite,
  type TokenAllowance,
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
  function updateBadge() {
    const count = _pendingMap.size;
    const text = count > 0 ? String(count) : '';
    try {
      browser.action.setBadgeText({ text });
      browser.action.setBadgeBackgroundColor({ color: '#0ea5e9' });
    } catch {
      // Fallback for older APIs
    }
  }

  type PendingEntry = {
    approval: PendingApproval;
    originalMessageId: string;
    resolve: (response: unknown) => void;
    tabId?: number;
  };
  const _pendingMap = new Map<string, PendingEntry>();
  const pendingApprovals = {
    get size() { return _pendingMap.size; },
    get(id: string) { return _pendingMap.get(id); },
    set(id: string, entry: PendingEntry) { _pendingMap.set(id, entry); updateBadge(); },
    delete(id: string) { const r = _pendingMap.delete(id); updateBadge(); return r; },
    values() { return _pendingMap.values(); },
    [Symbol.iterator]() { return _pendingMap[Symbol.iterator](); },
  };
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
      // Notify extension popup to refresh session list
      browser.runtime.sendMessage({
        type: 'BYOKY_INTERNAL',
        action: 'sessionChanged',
      }).catch(() => {});
      return;
    }

    if (message.type === 'BYOKY_SESSION_STATUS') {
      const { sessionKey } = message.payload as { sessionKey: string };
      const session = sessions.get(sessionKey);
      return Promise.resolve({
        type: 'BYOKY_SESSION_STATUS_RESPONSE',
        requestId: message.requestId,
        payload: {
          connected: !!session && session.expiresAt > Date.now(),
          expiresAt: session?.expiresAt,
        },
      });
    }

    if (message.type === 'BYOKY_SESSION_USAGE') {
      const { sessionKey } = message.payload as { sessionKey: string };
      const session = sessions.get(sessionKey);
      if (!session) {
        return Promise.resolve({
          type: 'BYOKY_SESSION_USAGE_RESPONSE',
          requestId: message.requestId,
          payload: null,
        });
      }
      return getSessionUsage(session.id).then((usage) => ({
        type: 'BYOKY_SESSION_USAGE_RESPONSE',
        requestId: message.requestId,
        payload: usage,
      }));
    }

    if (message.type === 'BYOKY_INTERNAL') {
      return handleInternal(message);
    }
  });

  // --- Notification ports (for broadcasting revocations to content scripts) ---

  const notifyPorts = new Set<browser.Runtime.Port>();

  // --- Proxy via Port (streaming) ---

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'byoky-notify') {
      notifyPorts.add(port);
      port.onDisconnect.addListener(() => notifyPorts.delete(port));
      return;
    }

    if (port.name !== 'byoky-proxy') return;

    // Capture the origin from the port sender (set by Chrome, can't be spoofed)
    const senderUrl = port.sender?.url || port.sender?.tab?.url;
    const portOrigin = senderUrl ? new URL(senderUrl).origin : null;

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

      // Check session expiry
      if (session.expiresAt < Date.now()) {
        sessions.delete(msg.sessionKey);
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 401,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
        return;
      }

      // Verify the requesting origin matches the session's approved origin
      if (portOrigin && portOrigin !== session.appOrigin) {
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 403,
          error: { code: 'PROVIDER_UNAVAILABLE', message: 'Origin mismatch — request rejected' },
        });
        return;
      }

      if (!masterPassword) {
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 423,
          error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' },
        });
        return;
      }

      // Check token allowance before proxying
      const allowanceCheck = await checkAllowance(session.appOrigin, msg.providerId);
      if (!allowanceCheck.allowed) {
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 429,
          error: { code: 'QUOTA_EXCEEDED', message: allowanceCheck.reason ?? 'Token allowance exceeded' },
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

        // Setup tokens (OAuth) route through the native bridge → Claude Code CLI
        if (credential.authMethod === 'oauth' && msg.providerId === 'anthropic') {
          await proxyViaBridge(port, msg, apiKey);
          return;
        }

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

        const logEntryId = await logRequest(session, msg, response.status);

        const chunks: string[] = [];
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            chunks.push(text);
            port.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: text,
            });
          }
        }

        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_DONE',
          requestId: msg.requestId,
        });

        // Parse token usage from the buffered response
        const fullBody = chunks.join('');
        const model = parseModel(msg.body);
        const usage = parseUsage(msg.providerId, fullBody);
        if (usage || model) {
          await updateLogEntry(logEntryId, {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            model,
          });
        }
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

  function resolveOrigin(sender: browser.Runtime.MessageSender): string {
    // sender.url is always available for content scripts (no tabs permission needed)
    const url = sender.url || sender.tab?.url;
    return url ? new URL(url).origin : 'unknown';
  }

  function findActiveSession(origin: string): Session | undefined {
    if (origin === 'unknown') return undefined;
    for (const session of sessions.values()) {
      if (session.appOrigin === origin && session.expiresAt > Date.now()) {
        return session;
      }
    }
    return undefined;
  }

  function buildSessionResponse(session: Session, requestId: string) {
    const providerMap: ConnectResponse['providers'] = {};
    for (const sp of session.providers) {
      providerMap[sp.providerId] = { available: sp.available, authMethod: sp.authMethod };
    }
    return {
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId,
      payload: {
        sessionKey: session.sessionKey,
        proxyUrl: 'extension-proxy',
        providers: providerMap,
      } as ConnectResponse,
    };
  }

  async function handleConnect(
    message: { id: string; payload: ConnectRequest },
    sender: browser.Runtime.MessageSender,
  ): Promise<unknown> {
    const origin = resolveOrigin(sender);

    // If there's already an active session for this origin, reuse it
    const existing = findActiveSession(origin);
    if (existing) {
      return buildSessionResponse(existing, message.id);
    }

    // If there's already a pending approval for this origin, wait for its result
    const existingPending = [...pendingApprovals.values()].find(
      (e) => e.approval.appOrigin === origin,
    );
    if (existingPending) {
      openWalletUI(sender.tab?.id);
      return waitForSessionOrReject(origin, message.id);
    }

    // Queue for user approval (whether locked or unlocked)
    const approval: PendingApproval = {
      id: crypto.randomUUID(),
      appOrigin: origin,
      providers: message.payload.providers ?? [],
      timestamp: Date.now(),
    };

    openWalletUI(sender.tab?.id);

    return new Promise((resolve) => {
      pendingApprovals.set(approval.id, {
        approval,
        originalMessageId: message.id,
        resolve,
        tabId: sender.tab?.id,
      });

      // If already unlocked, check trusted sites and either auto-approve or notify for approval
      if (masterPassword) {
        getTrustedSites().then((trustedSites) => {
          const entry = pendingApprovals.get(approval.id);
          if (!entry) return;
          if (trustedSites.some((s) => s.origin === origin)) {
            // Auto-approve trusted origin
            pendingApprovals.delete(approval.id);
            createSession(message, origin).then((response) => entry.resolve(response));
            return;
          }
          // Notify popup to show approval UI
          browser.runtime.sendMessage({
            type: 'BYOKY_INTERNAL',
            action: 'newPendingApproval',
          }).catch(() => {});
        });
      }
      // If locked, the approval stays queued. When user unlocks, processPendingAfterUnlock() runs.

      // Auto-reject after 2 minutes
      setTimeout(() => {
        const entry = pendingApprovals.get(approval.id);
        if (entry) {
          pendingApprovals.delete(approval.id);
          entry.resolve({
            type: 'BYOKY_ERROR',
            requestId: entry.originalMessageId,
            payload: { code: 'USER_REJECTED', message: 'Connection request timed out' },
          });
        }
      }, 120_000);
    });
  }

  function waitForSessionOrReject(origin: string, messageId: string): Promise<unknown> {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const session = findActiveSession(origin);
        if (session) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(buildSessionResponse(session, messageId));
          return;
        }
        // If no more pending approvals for this origin and no session, it was rejected
        const stillPending = [...pendingApprovals.values()].some(
          (e) => e.approval.appOrigin === origin,
        );
        if (!stillPending) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve({
            type: 'BYOKY_ERROR',
            requestId: messageId,
            payload: { code: 'USER_REJECTED', message: 'Connection request was rejected' },
          });
        }
      }, 300);
      const timeout = setTimeout(() => {
        clearInterval(interval);
        resolve({
          type: 'BYOKY_ERROR',
          requestId: messageId,
          payload: { code: 'USER_REJECTED', message: 'Connection request timed out' },
        });
      }, 120_000);
    });
  }

  async function createSession(
    message: { id: string; payload: ConnectRequest },
    origin: string,
  ): Promise<unknown> {
    // Reuse existing active session for this origin
    const existing = findActiveSession(origin);
    if (existing) {
      return buildSessionResponse(existing, message.id);
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

    return {
      type: 'BYOKY_CONNECT_RESPONSE',
      requestId: message.id,
      payload: {
        sessionKey,
        proxyUrl: 'extension-proxy',
        providers: providerMap,
      } as ConnectResponse,
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
        if (valid) {
          masterPassword = password;
          processPendingAfterUnlock();
        }
        return { success: valid };
      }

      case 'lock':
        masterPassword = null;
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
            broadcastRevocation(key);
            break;
          }
        }
        return { success: true };
      }

      case 'checkBridge': {
        const available = await checkBridgeAvailable();
        return { available };
      }

      case 'startBridgeProxy': {
        const { sessionKey, port } = message.payload as {
          sessionKey: string;
          port: number;
        };
        return startBridgeProxy(sessionKey, port ?? 19280);
      }

      case 'startOAuth': {
        const { providerId, label } = message.payload as {
          providerId: string;
          label: string;
        };
        return handleOAuthFlow(providerId, label);
      }

      case 'getPendingApprovals':
        return {
          approvals: [...pendingApprovals.values()].map((p) => p.approval),
        };

      case 'approveConnect': {
        const { approvalId, trust } = message.payload as {
          approvalId: string;
          trust: boolean;
        };
        const pending = pendingApprovals.get(approvalId);
        if (!pending) return { success: false, error: 'Approval not found' };

        pendingApprovals.delete(approvalId);

        if (trust) {
          await addTrustedSite(pending.approval.appOrigin);
        }

        const response = await createSession(
          {
            id: pending.originalMessageId,
            payload: { providers: pending.approval.providers } as ConnectRequest,
          },
          pending.approval.appOrigin,
        );
        pending.resolve(response);
        return { success: true };
      }

      case 'rejectConnect': {
        const { approvalId } = message.payload as { approvalId: string };
        const pending = pendingApprovals.get(approvalId);
        if (!pending) return { success: false, error: 'Approval not found' };

        pendingApprovals.delete(approvalId);
        pending.resolve({
          type: 'BYOKY_ERROR',
          requestId: pending.originalMessageId,
          payload: { code: 'USER_REJECTED', message: 'User rejected the connection request' },
        });
        return { success: true };
      }

      case 'getTrustedSites':
        return { sites: await getTrustedSites() };

      case 'removeTrustedSite': {
        const { origin } = message.payload as { origin: string };
        await removeTrustedSite(origin);
        return { success: true };
      }

      case 'getAllowances':
        return { allowances: await getAllowances() };

      case 'setAllowance': {
        const { allowance } = message.payload as { allowance: TokenAllowance };
        await setAllowance(allowance);
        return { success: true };
      }

      case 'removeAllowance': {
        const { origin } = message.payload as { origin: string };
        await removeAllowance(origin);
        return { success: true };
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

  // --- Bridge for setup tokens (native messaging → Claude Code CLI) ---

  const BRIDGE_HOST = 'com.byoky.bridge';
  let bridgeAvailable: boolean | null = null;

  async function checkBridgeAvailable(): Promise<boolean> {
    if (bridgeAvailable !== null) return bridgeAvailable;
    try {
      const port = browser.runtime.connectNative(BRIDGE_HOST);
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          port.disconnect();
          bridgeAvailable = false;
          resolve(false);
        }, 2000);

        port.onMessage.addListener((msg: { type: string }) => {
          clearTimeout(timeout);
          port.disconnect();
          bridgeAvailable = msg.type === 'pong';
          resolve(bridgeAvailable);
        });

        port.onDisconnect.addListener(() => {
          clearTimeout(timeout);
          bridgeAvailable = false;
          resolve(false);
        });

        port.postMessage({ type: 'ping' });
      });
    } catch {
      bridgeAvailable = false;
      return false;
    }
  }

  async function proxyViaBridge(
    responsePort: browser.Runtime.Port,
    msg: ProxyRequest,
    setupToken: string,
  ): Promise<void> {
    const available = await checkBridgeAvailable();
    if (!available) {
      responsePort.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: msg.requestId,
        status: 503,
        error: {
          code: 'BRIDGE_UNAVAILABLE',
          message: 'Byoky Bridge not installed. Run: npm install -g @byoky/bridge && byoky-bridge install',
        },
      });
      return;
    }

    try {
      const nativePort = browser.runtime.connectNative(BRIDGE_HOST);

      nativePort.postMessage({
        type: 'proxy',
        requestId: msg.requestId,
        setupToken,
        url: msg.url,
        method: msg.method,
        headers: msg.headers,
        body: msg.body,
      });

      nativePort.onMessage.addListener(
        (response: { type: string; requestId: string; status?: number; headers?: Record<string, string>; body?: string; error?: string }) => {
          if (response.requestId !== msg.requestId) return;

          if (response.type === 'proxy_response') {
            // Send meta
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_META',
              requestId: msg.requestId,
              status: response.status,
              statusText: response.status === 200 ? 'OK' : 'Error',
              headers: response.headers ?? {},
            });

            // Send body as a single chunk
            if (response.body) {
              responsePort.postMessage({
                type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                requestId: msg.requestId,
                chunk: response.body,
              });
            }

            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_DONE',
              requestId: msg.requestId,
            });

            nativePort.disconnect();
          } else if (response.type === 'proxy_error') {
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 502,
              error: {
                code: 'BRIDGE_ERROR',
                message: response.error || 'Bridge request failed',
              },
            });
            nativePort.disconnect();
          }
        },
      );

      nativePort.onDisconnect.addListener(() => {
        // Bridge disconnected unexpectedly
      });
    } catch (e) {
      responsePort.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: msg.requestId,
        status: 502,
        error: { code: 'BRIDGE_ERROR', message: (e as Error).message },
      });
    }
  }

  // --- Bridge HTTP proxy (generic local gateway for CLI/desktop apps) ---

  let bridgeProxyPort: browser.Runtime.Port | null = null;

  async function startBridgeProxy(
    sessionKey: string,
    port: number,
  ): Promise<{ success: boolean; port?: number; error?: string }> {
    const session = sessions.get(sessionKey);
    if (!session) return { success: false, error: 'Invalid session' };
    if (!masterPassword) return { success: false, error: 'Wallet is locked' };

    const available = await checkBridgeAvailable();
    if (!available) return { success: false, error: 'Bridge not installed' };

    const providerIds = session.providers
      .filter((p) => p.available)
      .map((p) => p.providerId);

    if (providerIds.length === 0) return { success: false, error: 'No providers available' };

    try {
      // Close existing proxy connection if any
      if (bridgeProxyPort) {
        bridgeProxyPort.disconnect();
        bridgeProxyPort = null;
      }

      bridgeProxyPort = browser.runtime.connectNative(BRIDGE_HOST);

      // Tell bridge to start the HTTP proxy server
      bridgeProxyPort.postMessage({
        type: 'start-proxy',
        port,
        sessionKey,
        providers: providerIds,
      });

      // Listen for messages from the bridge
      bridgeProxyPort.onMessage.addListener(async (msg: Record<string, unknown>) => {
        if (msg.type === 'proxy_http') {
          await handleBridgeProxyRequest(msg);
        }
      });

      bridgeProxyPort.onDisconnect.addListener(() => {
        bridgeProxyPort = null;
      });

      return { success: true, port };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async function handleBridgeProxyRequest(msg: Record<string, unknown>): Promise<void> {
    const requestId = msg.requestId as string;
    const sessionKey = msg.sessionKey as string;
    const providerId = msg.providerId as string;
    const url = msg.url as string;
    const method = msg.method as string;
    const headers = msg.headers as Record<string, string>;
    const body = msg.body as string | undefined;

    const session = sessions.get(sessionKey);
    if (!session || !masterPassword) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Session not found or wallet locked',
      });
      return;
    }

    const credential = await resolveCredential(session, providerId);
    if (!credential) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: `No credential for provider "${providerId}"`,
      });
      return;
    }

    try {
      const apiKey = await decryptCredentialKey(credential);
      const realHeaders = buildHeaders(providerId, headers, apiKey, credential.authMethod);

      const response = await fetch(url, {
        method,
        headers: realHeaders,
        body: body || undefined,
      });

      // Read the full response body
      const responseBody = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      bridgeProxyPort?.postMessage({
        type: 'proxy_http_response',
        requestId,
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      });

      // Log the request
      await logRequest({
        sessionId: session.id,
        appOrigin: 'bridge-proxy',
        providerId,
        url,
        method,
        status: response.status,
      });
    } catch (e) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: (e as Error).message,
      });
    }
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
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
    } else if (providerId === 'azure_openai') {
      headers['api-key'] = apiKey;
    } else {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  async function logRequest(
    session: Session,
    req: ProxyRequest,
    status: number,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const entry: RequestLogEntry = {
      id,
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

    return id;
  }

  async function updateLogEntry(
    entryId: string,
    updates: { inputTokens?: number; outputTokens?: number; model?: string },
  ) {
    const data = await browser.storage.local.get('requestLog');
    const log = (data.requestLog as RequestLogEntry[]) ?? [];
    const entry = log.find((e) => e.id === entryId);
    if (!entry) return;
    if (updates.inputTokens != null) entry.inputTokens = updates.inputTokens;
    if (updates.outputTokens != null) entry.outputTokens = updates.outputTokens;
    if (updates.model) entry.model = updates.model;
    await browser.storage.local.set({ requestLog: log });
  }

  function parseModel(body?: string): string | undefined {
    if (!body) return undefined;
    try {
      const parsed = JSON.parse(body);
      return parsed.model ?? undefined;
    } catch {
      return undefined;
    }
  }

  function parseUsage(
    providerId: string,
    body: string,
  ): { inputTokens: number; outputTokens: number } | undefined {
    try {
      // For streaming responses (SSE), try to find usage in the last data chunk
      if (body.includes('data: ')) {
        const lines = body.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
        // Anthropic streaming: message_stop event has usage in a preceding message_delta
        // OpenAI streaming: last chunk may include usage
        for (let i = lines.length - 1; i >= 0; i--) {
          const json = lines[i].replace('data: ', '');
          try {
            const parsed = JSON.parse(json);
            const usage = extractUsageFromParsed(providerId, parsed);
            if (usage) return usage;
          } catch {
            continue;
          }
        }
        return undefined;
      }

      const parsed = JSON.parse(body);
      return extractUsageFromParsed(providerId, parsed);
    } catch {
      return undefined;
    }
  }

  function extractUsageFromParsed(
    providerId: string,
    parsed: Record<string, unknown>,
  ): { inputTokens: number; outputTokens: number } | undefined {
    // Anthropic: { usage: { input_tokens, output_tokens } }
    if (providerId === 'anthropic') {
      const usage = parsed.usage as Record<string, number> | undefined;
      if (usage?.input_tokens != null && usage?.output_tokens != null) {
        return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
      }
    }

    // Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
    if (providerId === 'gemini') {
      const meta = parsed.usageMetadata as Record<string, number> | undefined;
      if (meta?.promptTokenCount != null) {
        return {
          inputTokens: meta.promptTokenCount,
          outputTokens: meta.candidatesTokenCount ?? 0,
        };
      }
    }

    // OpenAI-compatible (openai, groq, together, deepseek, xai, perplexity, fireworks, openrouter, mistral, azure_openai):
    // { usage: { prompt_tokens, completion_tokens } }
    const usage = parsed.usage as Record<string, number> | undefined;
    if (usage?.prompt_tokens != null && usage?.completion_tokens != null) {
      return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
    }

    return undefined;
  }

  async function getSessionUsage(sessionId: string) {
    const data = await browser.storage.local.get('requestLog');
    const log = (data.requestLog as RequestLogEntry[]) ?? [];
    const entries = log.filter((e) => e.sessionId === sessionId && e.status < 400);

    const byProvider: Record<string, { requests: number; inputTokens: number; outputTokens: number }> = {};
    let totalRequests = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const entry of entries) {
      totalRequests++;
      const input = entry.inputTokens ?? 0;
      const output = entry.outputTokens ?? 0;
      totalInput += input;
      totalOutput += output;

      if (!byProvider[entry.providerId]) {
        byProvider[entry.providerId] = { requests: 0, inputTokens: 0, outputTokens: 0 };
      }
      byProvider[entry.providerId].requests++;
      byProvider[entry.providerId].inputTokens += input;
      byProvider[entry.providerId].outputTokens += output;
    }

    return { requests: totalRequests, inputTokens: totalInput, outputTokens: totalOutput, byProvider };
  }

  async function processPendingAfterUnlock() {
    if (pendingApprovals.size === 0) return;

    const trustedSites = await getTrustedSites();

    for (const [id, entry] of pendingApprovals) {
      if (trustedSites.some((s) => s.origin === entry.approval.appOrigin)) {
        // Auto-approve trusted origins
        pendingApprovals.delete(id);
        const response = await createSession(
          { id: entry.originalMessageId, payload: { providers: entry.approval.providers } as ConnectRequest },
          entry.approval.appOrigin,
        );
        entry.resolve(response);
      }
    }

    // Notify popup about remaining pending approvals
    if (pendingApprovals.size > 0) {
      browser.runtime.sendMessage({
        type: 'BYOKY_INTERNAL',
        action: 'newPendingApproval',
      }).catch(() => {});
    }
  }

  function broadcastRevocation(sessionKey: string) {
    const msg = { type: 'BYOKY_SESSION_REVOKED', payload: { sessionKey } };
    for (const port of notifyPorts) {
      try { port.postMessage(msg); } catch { /* port may have disconnected */ }
    }
  }

  async function getTrustedSites(): Promise<TrustedSite[]> {
    const data = await browser.storage.local.get('trustedSites');
    return (data.trustedSites as TrustedSite[]) ?? [];
  }

  async function addTrustedSite(origin: string) {
    const sites = await getTrustedSites();
    if (!sites.some((s) => s.origin === origin)) {
      sites.push({ origin, trustedAt: Date.now() });
      await browser.storage.local.set({ trustedSites: sites });
    }
  }

  async function removeTrustedSite(origin: string) {
    const sites = await getTrustedSites();
    await browser.storage.local.set({
      trustedSites: sites.filter((s) => s.origin !== origin),
    });
  }

  // --- Token allowances ---

  async function getAllowances(): Promise<TokenAllowance[]> {
    const data = await browser.storage.local.get('tokenAllowances');
    return (data.tokenAllowances as TokenAllowance[]) ?? [];
  }

  async function setAllowance(allowance: TokenAllowance) {
    const allowances = await getAllowances();
    const idx = allowances.findIndex((a) => a.origin === allowance.origin);
    if (idx >= 0) allowances[idx] = allowance;
    else allowances.push(allowance);
    await browser.storage.local.set({ tokenAllowances: allowances });
  }

  async function removeAllowance(origin: string) {
    const allowances = await getAllowances();
    await browser.storage.local.set({
      tokenAllowances: allowances.filter((a) => a.origin !== origin),
    });
  }

  async function checkAllowance(
    origin: string,
    providerId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const allowances = await getAllowances();
    const allowance = allowances.find((a) => a.origin === origin);
    if (!allowance) return { allowed: true };

    const data = await browser.storage.local.get('requestLog');
    const log = (data.requestLog as RequestLogEntry[]) ?? [];
    const entries = log.filter((e) => e.appOrigin === origin && e.status < 400);

    let totalUsed = 0;
    const byProvider: Record<string, number> = {};
    for (const entry of entries) {
      const tokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
      totalUsed += tokens;
      byProvider[entry.providerId] = (byProvider[entry.providerId] ?? 0) + tokens;
    }

    if (allowance.totalLimit != null && totalUsed >= allowance.totalLimit) {
      return { allowed: false, reason: `Token allowance exceeded for ${origin}` };
    }

    const providerLimit = allowance.providerLimits?.[providerId];
    if (providerLimit != null && (byProvider[providerId] ?? 0) >= providerLimit) {
      return { allowed: false, reason: `Token allowance for ${providerId} exceeded` };
    }

    return { allowed: true };
  }
});
