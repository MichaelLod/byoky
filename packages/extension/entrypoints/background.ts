import {
  type AuthMethod,
  type Credential,
  type Session,
  type RequestLogEntry,
  type PendingApproval,
  type TrustedSite,
  type TokenAllowance,
  type ConnectRequest,
  type ConnectResponse,
  type ProviderRequirement,
  type ProxyRequest,
  type Gift,
  type GiftedCredential,
  type GiftLink,
  type SerializedFormDataEntry,
  decrypt,
  encrypt,
  verifyPassword,
  PROVIDERS,
  buildHeaders,
  parseModel,
  parseUsage,
  computeAllowanceCheck,
  validateProxyUrl,
  injectClaudeCodeSystemPrompt,
  createGiftLink,
  decodeGiftLink,
  validateGiftLink,
} from '@byoky/core';
import type { Runtime } from 'wxt/browser';

declare const chrome: {
  sidePanel?: {
    setPanelBehavior(opts: { openPanelOnActionClick: boolean }): void;
    open(opts: { tabId: number }): Promise<void>;
  };
};

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function reconstructBody(
  body: string | undefined,
  bodyEncoding: string | undefined,
): { body: BodyInit | undefined; stripContentType: boolean } {
  if (body === undefined) return { body: undefined, stripContentType: false };

  if (bodyEncoding === 'formdata') {
    const entries = JSON.parse(body) as SerializedFormDataEntry[];
    const formData = new FormData();
    for (const entry of entries) {
      if (entry.type === 'text') {
        formData.append(entry.name, entry.value);
      } else {
        const binary = base64ToUint8(entry.value);
        const blob = new Blob([binary], { type: entry.contentType || 'application/octet-stream' });
        formData.append(entry.name, blob, entry.filename);
      }
    }
    return { body: formData, stripContentType: true };
  }

  if (bodyEncoding === 'base64') {
    const binary = base64ToUint8(body);
    return { body: binary.buffer as ArrayBuffer, stripContentType: false };
  }

  return { body, stripContentType: false };
}

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
  let unlockFailures = 0;
  let unlockLockedUntil = 0;

  // Auto-lock after 20 minutes of inactivity
  const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
  let lastActivityAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function resetIdleTimer() {
    lastActivityAt = Date.now();
    if (idleTimer) clearTimeout(idleTimer);
    if (masterPassword) {
      idleTimer = setTimeout(autoLock, IDLE_TIMEOUT_MS);
    }
  }

  function autoLock() {
    if (!masterPassword) return;
    masterPassword = null;
    sessions.clear();
    authorizedBridgeSessionKey = null;
    disconnectAllGiftRelays();
    browser.runtime.sendMessage({
      type: 'BYOKY_INTERNAL',
      action: 'sessionChanged',
    }).catch(() => {});
  }

  // Rate limiting for connect requests per origin
  const connectRateLimit = new Map<string, number[]>();
  const CONNECT_RATE_LIMIT = 10; // max requests per window
  const CONNECT_RATE_WINDOW = 60_000; // 1 minute

  function isConnectRateLimited(origin: string): boolean {
    const now = Date.now();
    const timestamps = connectRateLimit.get(origin) ?? [];
    const recent = timestamps.filter((t) => now - t < CONNECT_RATE_WINDOW);
    if (recent.length >= CONNECT_RATE_LIMIT) {
      connectRateLimit.set(origin, recent);
      return true;
    }
    recent.push(now);
    connectRateLimit.set(origin, recent);
    // Periodically prune stale origins (every 100 calls)
    if (connectRateLimit.size > 50) {
      for (const [key, ts] of connectRateLimit) {
        if (ts.every((t) => now - t >= CONNECT_RATE_WINDOW)) {
          connectRateLimit.delete(key);
        }
      }
    }
    return false;
  }

  // Rate limiting for OAuth flow requests
  const oauthRateLimit = new Map<string, number[]>();
  const OAUTH_RATE_LIMIT = 3;
  const OAUTH_RATE_WINDOW = 60_000;

  function isOAuthRateLimited(providerId: string): boolean {
    const now = Date.now();
    const timestamps = oauthRateLimit.get(providerId) ?? [];
    const recent = timestamps.filter((t) => now - t < OAUTH_RATE_WINDOW);
    if (recent.length >= OAUTH_RATE_LIMIT) {
      oauthRateLimit.set(providerId, recent);
      return true;
    }
    recent.push(now);
    oauthRateLimit.set(providerId, recent);
    return false;
  }

  // Mutex for gift budget updates to prevent concurrent overwrites
  const giftBudgetLocks = new Map<string, Promise<void>>();

  // --- Open side panel on icon click (Chrome) ---

  if (typeof chrome !== 'undefined' && chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // --- Message handling ---

  // Connect/disconnect/status/usage are handled via ports (byoky-message) in onConnect.
  // Only BYOKY_INTERNAL messages (popup ↔ background) use sendMessage.
  browser.runtime.onMessage.addListener((raw: unknown, sender: unknown) => {
    const message = raw as Record<string, unknown>;
    const senderInfo = sender as Runtime.MessageSender;

    if (message.type === 'BYOKY_INTERNAL') {
      // Only accept internal messages from the extension itself
      if (senderInfo.id !== browser.runtime.id) return;
      // Content scripts have the same extension ID but must be restricted
      // to safe actions — only popup/sidepanel pages get full access
      const senderUrl = senderInfo.url ?? '';
      const extensionOrigin = new URL(browser.runtime.getURL('/popup.html')).origin;
      const isExtensionPage = senderUrl.startsWith(extensionOrigin + '/');
      if (!isExtensionPage) {
        const ALLOWED_CONTENT_ACTIONS = ['startBridgeProxy', 'checkBridge', 'startOAuth'];
        if (!ALLOWED_CONTENT_ACTIONS.includes((message as { action: string }).action)) return;
      }
      return handleInternal(message as { action: string; payload?: unknown });
    }
  });

  // --- Notification ports (for broadcasting revocations to content scripts) ---

  const notifyPorts = new Set<Runtime.Port>();

  // --- Proxy via Port (streaming) ---

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'byoky-notify') {
      notifyPorts.add(port);
      port.onDisconnect.addListener(() => notifyPorts.delete(port));
      return;
    }

    if (port.name === 'byoky-message') {
      // Handle connect/disconnect/status/usage via port so the message doesn't
      // broadcast to the side-panel's onMessage listener (which can interfere
      // in Chrome MV3 when multiple listeners exist).
      port.onMessage.addListener(async (raw: unknown) => {
        const message = raw as Record<string, unknown>;
        const sender = port.sender as Runtime.MessageSender;
        let response: unknown;

        if (message.type === 'BYOKY_CONNECT_REQUEST') {
          response = await handleConnect(message as { id: string; payload: ConnectRequest }, sender);
        } else if (message.type === 'BYOKY_DISCONNECT') {
          const { sessionKey } = message.payload as { sessionKey: string };
          const session = sessions.get(sessionKey);
          if (session) {
            const disconnectOrigin = resolveOrigin(sender);
            if (disconnectOrigin === session.appOrigin) {
              sessions.delete(sessionKey);
              if (authorizedBridgeSessionKey === sessionKey) {
                authorizedBridgeSessionKey = null;
              }
              browser.runtime.sendMessage({
                type: 'BYOKY_INTERNAL',
                action: 'sessionChanged',
              }).catch(() => {});
            }
          }
        } else if (message.type === 'BYOKY_SESSION_STATUS') {
          const { sessionKey } = message.payload as { sessionKey: string };
          const session = sessions.get(sessionKey);
          const statusOrigin = resolveOrigin(sender);
          if (!session || !statusOrigin || statusOrigin === 'unknown' || statusOrigin !== session.appOrigin) {
            response = {
              type: 'BYOKY_SESSION_STATUS_RESPONSE',
              requestId: message.requestId,
              payload: { connected: false },
            };
          } else {
            response = {
              type: 'BYOKY_SESSION_STATUS_RESPONSE',
              requestId: message.requestId,
              payload: {
                connected: !!session && session.expiresAt > Date.now(),
                expiresAt: session?.expiresAt,
              },
            };
          }
        } else if (message.type === 'BYOKY_SESSION_USAGE') {
          const { sessionKey } = message.payload as { sessionKey: string };
          const session = sessions.get(sessionKey);
          const usageOrigin = resolveOrigin(sender);
          if (!session || !usageOrigin || usageOrigin === 'unknown' || usageOrigin !== session.appOrigin) {
            response = {
              type: 'BYOKY_SESSION_USAGE_RESPONSE',
              requestId: message.requestId,
              payload: null,
            };
          } else {
            const usage = await getSessionUsage(session.id);
            response = {
              type: 'BYOKY_SESSION_USAGE_RESPONSE',
              requestId: message.requestId,
              payload: usage,
            };
          }
        }

        if (response) {
          try { port.postMessage(response); } catch { /* port closed */ }
        }
      });
      return;
    }

    if (port.name !== 'byoky-proxy') return;

    // Capture the origin from the port sender (set by Chrome, can't be spoofed)
    const senderUrl = port.sender?.url || port.sender?.tab?.url;
    const portOrigin = senderUrl ? new URL(senderUrl).origin : null;

    port.onMessage.addListener(async (raw: unknown) => {
      const msg = raw as ProxyRequest;
      if (msg.sessionKey == null) return;

      resetIdleTimer();

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
      if (!portOrigin || portOrigin !== session.appOrigin) {
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

      // Check if this is a gifted credential — route through relay
      const sessionProvider = session.providers.find((sp) => sp.providerId === msg.providerId);
      if (sessionProvider?.giftId && sessionProvider.giftRelayUrl && sessionProvider.giftAuthToken) {
        await proxyViaGiftRelay(port, msg, sessionProvider, session);
        return;
      }

      let credential = await resolveCredential(session, msg.providerId);
      if (!credential) {
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 403,
          error: { code: 'PROVIDER_UNAVAILABLE', message: `No credential for ${msg.providerId}` },
        });
        return;
      }

      // Refresh OAuth token if expired or about to expire
      if (
        credential.authMethod === 'oauth' &&
        (credential as { expiresAt?: number }).expiresAt &&
        (credential as { expiresAt: number }).expiresAt < Date.now() + 60_000 &&
        PROVIDERS[msg.providerId]?.oauthConfig
      ) {
        const refreshed = await refreshOAuthToken(credential);
        if (refreshed) {
          credential = (await resolveCredential(session, msg.providerId))!;
        }
      }

      try {
        const apiKey = await decryptCredentialKey(credential);

        if (!validateProxyUrl(msg.providerId, msg.url)) {
          port.postMessage({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 403,
            error: { code: 'INVALID_URL', message: 'Request URL does not match the provider\'s registered base URL' },
          });
          return;
        }

        const realHeaders = buildHeaders(msg.providerId, msg.headers, apiKey, credential.authMethod);

        // OAuth tokens for Anthropic route through the bridge (Node.js) to bypass TLS fingerprint detection
        if (credential.authMethod === 'oauth' && msg.providerId === 'anthropic') {
          const body = authorizedBridgeSessionKey === msg.sessionKey
            ? injectClaudeCodeSystemPrompt(msg.body)
            : msg.body;
          await proxyViaBridge(port, { ...msg, body }, realHeaders, session);
          return;
        }

        const reconstructed = reconstructBody(msg.body, msg.bodyEncoding);
        const fetchHeaders = { ...realHeaders };
        if (reconstructed.stripContentType) delete fetchHeaders['content-type'];

        const response = await fetch(msg.url, {
          method: msg.method,
          headers: fetchHeaders,
          body: reconstructed.body,
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
        const model = msg.bodyEncoding ? undefined : parseModel(msg.body);
        const usage = parseUsage(msg.providerId, fullBody);
        if (usage || model) {
          await updateLogEntry(logEntryId, {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            model,
          });
          browser.runtime.sendMessage({
            type: 'BYOKY_INTERNAL',
            action: 'usageUpdated',
          }).catch(() => {});
        }
      } catch (error) {
        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 502,
          error: { code: 'PROXY_ERROR', message: 'Proxy request failed' },
        });
      }
    });
  });

  // --- Helpers ---

  function resolveOrigin(sender: Runtime.MessageSender): string {
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
    sender: Runtime.MessageSender,
  ): Promise<unknown> {
    const origin = resolveOrigin(sender);

    if (isConnectRateLimited(origin)) {
      return {
        type: 'BYOKY_ERROR',
        requestId: message.id,
        payload: { code: 'RATE_LIMITED', message: 'Too many connection requests. Try again later.' },
      };
    }

    // If there's already an active session for this origin, reuse it
    const existing = findActiveSession(origin);
    if (existing) {
      return buildSessionResponse(existing, message.id);
    }

    // Silent reconnect: only return existing session, don't prompt
    if (message.payload.reconnectOnly) {
      return {
        type: 'BYOKY_ERROR',
        requestId: message.id,
        payload: { code: 'NO_SESSION', message: 'No active session for this origin' },
      };
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
          const trustedSite = trustedSites.find((s) => s.origin === origin);
          if (trustedSite && trustedSite.allowedProviders?.length) {
            // Scope to the providers the user originally approved for this trusted site
            const scopedProviders = scopeProvidersForTrust(
              message.payload.providers,
              trustedSite.allowedProviders,
            );
            if (scopedProviders) {
              pendingApprovals.delete(approval.id);
              createSession(
                { ...message, payload: { ...message.payload, providers: scopedProviders } },
                origin,
              ).then((response) => entry.resolve(response));
              return;
            }
            // Requested providers outside trust scope — fall through to manual approval
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

  /**
   * Scope a connect request's providers against a trusted site's allowedProviders.
   * Returns scoped ProviderRequirement[] if all requested providers are within scope,
   * or null if any fall outside (requiring manual re-approval).
   */
  function scopeProvidersForTrust(
    requested: ProviderRequirement[] | undefined,
    allowedProviders: string[],
  ): ProviderRequirement[] | null {
    const allowed = new Set(allowedProviders);
    if (!requested || requested.length === 0) {
      // Empty request: scope to exactly the trusted providers
      return allowedProviders.map((id) => ({ id, required: false }) as ProviderRequirement);
    }
    // Check every requested provider is within the trust scope
    if (requested.every((r) => allowed.has(r.id))) {
      return requested;
    }
    return null; // Some requested providers are outside trust scope
  }

  async function resolveAllProviders(): Promise<Array<{
    id: string;
    authMethod: AuthMethod;
    sessionProvider: Session['providers'][number];
  }>> {
    const credentials = await getStoredCredentials();
    const gcData = await browser.storage.local.get('giftedCredentials');
    const giftedCreds = (gcData.giftedCredentials ?? []) as GiftedCredential[];
    const result: Array<{ id: string; authMethod: AuthMethod; sessionProvider: Session['providers'][number] }> = [];
    const seen = new Set<string>();
    for (const cred of credentials) {
      seen.add(cred.providerId);
      result.push({
        id: cred.providerId,
        authMethod: cred.authMethod,
        sessionProvider: {
          providerId: cred.providerId,
          credentialId: cred.id,
          available: true,
          authMethod: cred.authMethod,
        },
      });
    }
    for (const gc of giftedCreds) {
      if (gc.expiresAt > Date.now() && gc.usedTokens < gc.maxTokens && !seen.has(gc.providerId)) {
        result.push({
          id: gc.providerId,
          authMethod: 'api_key',
          sessionProvider: {
            providerId: gc.providerId,
            credentialId: gc.id,
            available: true,
            authMethod: 'api_key',
            giftId: gc.giftId,
            giftRelayUrl: gc.relayUrl,
            giftAuthToken: gc.authToken,
          },
        });
      }
    }
    return result;
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
    const gcData = await browser.storage.local.get('giftedCredentials');
    const giftedCreds = (gcData.giftedCredentials ?? []) as GiftedCredential[];
    const request = message.payload;
    const sessionKey = `byk_${crypto.randomUUID().replace(/-/g, '')}`;

    const providerMap: ConnectResponse['providers'] = {};
    const sessionProviders: Session['providers'] = [];

    for (const req of request.providers ?? []) {
      const cred = credentials.find((c) => c.providerId === req.id);
      const gc = !cred ? giftedCreds.find((g) => g.providerId === req.id && g.expiresAt > Date.now() && g.usedTokens < g.maxTokens) : undefined;
      providerMap[req.id] = {
        available: !!(cred || gc),
        authMethod: cred?.authMethod ?? 'api_key',
      };
      if (cred) {
        sessionProviders.push({
          providerId: req.id,
          credentialId: cred.id,
          available: true,
          authMethod: cred.authMethod,
        });
      } else if (gc) {
        sessionProviders.push({
          providerId: req.id,
          credentialId: gc.id,
          available: true,
          authMethod: 'api_key',
          giftId: gc.giftId,
          giftRelayUrl: gc.relayUrl,
          giftAuthToken: gc.authToken,
        });
      }
    }

    if (request.providers?.length === 0 || !request.providers) {
      // Empty provider list: resolve to all available credentials.
      // This path is only reached via explicit user approval — trusted
      // auto-approvals always scope providers before calling createSession.
      const resolved = await resolveAllProviders();
      for (const rp of resolved) {
        providerMap[rp.id] = { available: true, authMethod: rp.authMethod };
        sessionProviders.push(rp.sessionProvider);
      }
    }

    const session: Session = {
      id: crypto.randomUUID(),
      sessionKey,
      appOrigin: origin,
      providers: sessionProviders,
      requestedProviders: request.providers?.map(p => p.id) ?? [],
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
        if (Date.now() < unlockLockedUntil) {
          const remaining = Math.ceil((unlockLockedUntil - Date.now()) / 1000);
          return { success: false, error: `Too many attempts. Try again in ${remaining}s` };
        }
        const { password } = message.payload as { password: string };
        const data = await browser.storage.local.get('passwordHash');
        if (!data.passwordHash) return { success: false };
        const valid = await verifyPassword(password, data.passwordHash as string);
        if (valid) {
          masterPassword = password;
          unlockFailures = 0;
          unlockLockedUntil = 0;
          resetIdleTimer();
          processPendingAfterUnlock();
          reconnectGiftRelays();
        } else {
          unlockFailures++;
          if (unlockFailures >= 5) {
            // Exponential backoff: 1m, 2m, 4m, 8m, ... capped at 60m
            const exponent = Math.min(unlockFailures - 5, 5);
            unlockLockedUntil = Date.now() + 60_000 * Math.pow(2, exponent);
          }
        }
        return { success: valid };
      }

      case 'lock':
        masterPassword = null;
        sessions.clear();
        authorizedBridgeSessionKey = null;
        disconnectAllGiftRelays();
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        return { success: true };

      case 'isUnlocked':
        return { unlocked: masterPassword !== null };

      case 'isInitialized': {
        const data = await browser.storage.local.get('passwordHash');
        return { initialized: !!data.passwordHash };
      }

      case 'getCredentials':
        return { credentials: await getStoredCredentials() };

      case 'addCredential': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { providerId: cpId, label: cLabel, value: cValue, authMethod: cAuth } = message.payload as {
          providerId: string; label: string; value: string; authMethod: 'api_key' | 'oauth';
        };
        const cleanValue = cValue.replace(/\s+/g, '');
        const encValue = await encrypt(cleanValue, masterPassword);
        const data = await browser.storage.local.get('credentials');
        const creds = (data.credentials ?? []) as Array<Record<string, unknown>>;
        const newCred: Record<string, unknown> = {
          id: crypto.randomUUID(),
          providerId: cpId,
          label: cLabel,
          authMethod: cAuth,
          createdAt: Date.now(),
        };
        if (cAuth === 'api_key') {
          newCred.encryptedKey = encValue;
        } else {
          newCred.encryptedAccessToken = encValue;
        }
        creds.push(newCred);
        await browser.storage.local.set({ credentials: creds });
        refreshSessionProviders();
        return { success: true };
      }

      case 'removeCredential': {
        const { id: rmId } = message.payload as { id: string };
        const rmData = await browser.storage.local.get('credentials');
        const rmCreds = (rmData.credentials ?? []) as Array<{ id: string }>;
        await browser.storage.local.set({
          credentials: rmCreds.filter((c) => c.id !== rmId),
        });
        refreshSessionProviders();
        return { success: true };
      }

      case 'setupWallet': {
        const existing = await browser.storage.local.get('passwordHash');
        if (existing.passwordHash) {
          return { error: 'Wallet already initialized' };
        }
        const { passwordHash: setupHash } = message.payload as { passwordHash: string };
        await browser.storage.local.set({ passwordHash: setupHash, credentials: [] });
        return { success: true };
      }

      case 'resetWallet': {
        masterPassword = null;
        sessions.clear();
        authorizedBridgeSessionKey = null;
        disconnectAllGiftRelays();
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        unlockFailures = 0;
        unlockLockedUntil = 0;
        await browser.storage.local.clear();
        return { success: true };
      }

      case 'getSessions':
        return {
          sessions: Array.from(sessions.values()).map(
            ({ id, appOrigin, providers, createdAt, expiresAt }) =>
              ({ id, appOrigin, providers, createdAt, expiresAt }),
          ),
        };

      case 'getRequestLog': {
        const data = await browser.storage.local.get('requestLog');
        return { log: (data.requestLog as RequestLogEntry[]) ?? [] };
      }

      case 'revokeSession': {
        const { sessionId } = message.payload as { sessionId: string };
        for (const [key, s] of sessions) {
          if (s.id === sessionId) {
            sessions.delete(key);
            if (authorizedBridgeSessionKey === key) {
              authorizedBridgeSessionKey = null;
            }
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

        // Resolve which providers are being approved
        const approvedProviderIds = pending.approval.providers.length > 0
          ? pending.approval.providers.map((p) => p.id)
          : (await getStoredCredentials()).map((c) => c.providerId);

        if (trust) {
          await addTrustedSite(pending.approval.appOrigin, approvedProviderIds);
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

      case 'exportVault': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { exportPassword } = message.payload as { exportPassword: string };
        const pw = masterPassword;
        const allCreds = await getStoredCredentials();
        const reEncrypted = await Promise.all(
          allCreds.map(async (c) => {
            const result: Record<string, unknown> = { ...c };
            if ('encryptedKey' in c && typeof c.encryptedKey === 'string') {
              const plain = await decrypt(c.encryptedKey, pw);
              result.encryptedKey = await encrypt(plain, exportPassword);
            }
            if ('encryptedAccessToken' in c && typeof c.encryptedAccessToken === 'string') {
              const plain = await decrypt(c.encryptedAccessToken, pw);
              result.encryptedAccessToken = await encrypt(plain, exportPassword);
            }
            return result;
          }),
        );
        const vault = { version: 1, exportedAt: Date.now(), credentials: reEncrypted };
        const vaultJson = JSON.stringify(vault);
        const encryptedVault = await encrypt(vaultJson, exportPassword);
        return { encryptedVault };
      }

      case 'importVault': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const pw = masterPassword;
        const { encryptedVault: impVault, importPassword: impPw } = message.payload as {
          encryptedVault: string; importPassword: string;
        };
        let vaultJson: string;
        try {
          vaultJson = await decrypt(impVault.trim(), impPw);
        } catch {
          return { error: 'Wrong password or corrupted file' };
        }
        if (vaultJson.length > 10_485_760) {
          return { error: 'Vault file too large' };
        }
        const vault = JSON.parse(vaultJson) as { version?: number; credentials?: unknown[] };
        if (!vault.version || !vault.credentials) {
          return { error: 'Invalid vault file format' };
        }
        const imported = await Promise.all(
          vault.credentials.map(async (cred: unknown) => {
            const c = cred as Record<string, unknown>;
            const result: Record<string, unknown> = { ...c, id: crypto.randomUUID() };
            if (c.encryptedKey && typeof c.encryptedKey === 'string') {
              const plain = await decrypt(c.encryptedKey, impPw);
              result.encryptedKey = await encrypt(plain, pw);
            }
            if (c.encryptedAccessToken && typeof c.encryptedAccessToken === 'string') {
              const plain = await decrypt(c.encryptedAccessToken, impPw);
              result.encryptedAccessToken = await encrypt(plain, pw);
            }
            return result;
          }),
        );
        await browser.storage.local.set({ credentials: imported });
        return { success: true, count: imported.length };
      }

      case 'encryptValue': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { value } = message.payload as { value: string };
        const encrypted = await encrypt(value, masterPassword);
        return { encrypted };
      }

      case 'decryptValue': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { encrypted: enc } = message.payload as { encrypted: string };
        try {
          const decrypted = await decrypt(enc, masterPassword);
          return { decrypted };
        } catch {
          return { error: 'Failed to decrypt' };
        }
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

      // --- Token gifts ---

      case 'createGift': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { credentialId, providerId, label, maxTokens, expiresInMs, relayUrl } = message.payload as {
          credentialId: string; providerId: string; label: string; maxTokens: number; expiresInMs: number; relayUrl: string;
        };
        if (!PROVIDERS[providerId]) return { error: 'Invalid provider' };
        if (!label || label.length > 200) return { error: 'Label must be 1-200 characters' };
        if (!Number.isFinite(maxTokens) || maxTokens <= 0 || maxTokens > 100_000_000) return { error: 'Invalid maxTokens' };
        if (!Number.isFinite(expiresInMs) || expiresInMs <= 0 || expiresInMs > 90 * 24 * 60 * 60_000) return { error: 'Invalid expiry (max 90 days)' };
        try {
          const parsed = new URL(relayUrl);
          if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return { error: 'Relay URL must use ws:// or wss://' };
        } catch { return { error: 'Invalid relay URL' }; }
        const authToken = `gft_${crypto.randomUUID().replace(/-/g, '')}`;
        const gift: Gift = {
          id: crypto.randomUUID(),
          credentialId,
          providerId,
          label,
          authToken,
          maxTokens,
          usedTokens: 0,
          expiresAt: Date.now() + expiresInMs,
          createdAt: Date.now(),
          active: true,
          relayUrl,
        };
        // Encrypt authToken before persisting to storage
        const encryptedAuthToken = await encrypt(authToken, masterPassword!);
        const storageGift = { ...gift, authToken: encryptedAuthToken };
        const data = await browser.storage.local.get('gifts');
        const gifts = (data.gifts ?? []) as Gift[];
        gifts.push(storageGift);
        await browser.storage.local.set({ gifts });
        const { encoded } = createGiftLink(gift);
        connectGiftRelay(gift);
        return { success: true, giftLink: encoded };
      }

      case 'getGifts': {
        const data = await browser.storage.local.get('gifts');
        return { gifts: (data.gifts ?? []) as Gift[] };
      }

      case 'revokeGift': {
        const { giftId } = message.payload as { giftId: string };
        const data = await browser.storage.local.get('gifts');
        const gifts = (data.gifts ?? []) as Gift[];
        const idx = gifts.findIndex((g) => g.id === giftId);
        if (idx !== -1) {
          gifts[idx].active = false;
          await browser.storage.local.set({ gifts });
          disconnectGiftRelay(giftId);
        }
        return { success: true };
      }

      case 'redeemGift': {
        const { giftLinkEncoded } = message.payload as { giftLinkEncoded: string };
        const link = decodeGiftLink(giftLinkEncoded);
        if (!link) return { error: 'Invalid gift link' };
        const validation = validateGiftLink(link);
        if (!validation.valid) return { error: validation.reason };
        const giftedCred: GiftedCredential = {
          id: crypto.randomUUID(),
          giftId: link.id,
          providerId: link.p,
          providerName: link.n,
          senderLabel: link.s,
          authToken: link.t,
          maxTokens: link.m,
          usedTokens: 0,
          expiresAt: link.e,
          relayUrl: link.r,
          createdAt: Date.now(),
        };
        const gcData = await browser.storage.local.get('giftedCredentials');
        const giftedCreds = (gcData.giftedCredentials ?? []) as GiftedCredential[];
        if (giftedCreds.some((gc) => gc.giftId === link.id)) {
          return { error: 'Gift already redeemed' };
        }
        giftedCreds.push(giftedCred);
        await browser.storage.local.set({ giftedCredentials: giftedCreds });
        refreshSessionProviders();
        return { success: true };
      }

      case 'getGiftedCredentials': {
        const data = await browser.storage.local.get('giftedCredentials');
        return { giftedCredentials: (data.giftedCredentials ?? []) as GiftedCredential[] };
      }

      case 'removeGiftedCredential': {
        const { id } = message.payload as { id: string };
        const data = await browser.storage.local.get('giftedCredentials');
        const giftedCreds = (data.giftedCredentials ?? []) as GiftedCredential[];
        await browser.storage.local.set({
          giftedCredentials: giftedCreds.filter((gc) => gc.id !== id),
        });
        refreshSessionProviders();
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

    if (isOAuthRateLimited(providerId)) {
      return { success: false, error: 'Too many OAuth requests. Try again later.' };
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
    // Apply provider-specific extra params (e.g., Google's access_type=offline)
    if (provider.oauthConfig.extraAuthParams) {
      for (const [key, value] of Object.entries(provider.oauthConfig.extraAuthParams)) {
        authUrl.searchParams.set(key, value);
      }
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
        return { success: false, error: `Token exchange failed (HTTP ${tokenResponse.status})` };
      }

      const tokens = (await tokenResponse.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (!tokens.access_token || typeof tokens.access_token !== 'string') {
        return { success: false, error: 'OAuth provider returned no access token' };
      }

      // Encrypt and store
      const encryptedAccessToken = await encrypt(
        tokens.access_token,
        masterPassword,
      );
      const encryptedRefreshToken = tokens.refresh_token && typeof tokens.refresh_token === 'string'
        ? await encrypt(tokens.refresh_token, masterPassword)
        : undefined;

      const expiresIn = typeof tokens.expires_in === 'number' && tokens.expires_in > 0
        ? tokens.expires_in
        : undefined;

      const newCred: Credential = {
        id: crypto.randomUUID(),
        providerId,
        label,
        authMethod: 'oauth',
        encryptedAccessToken,
        encryptedRefreshToken,
        expiresAt: expiresIn
          ? Date.now() + expiresIn * 1000
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

  // --- OAuth token refresh ---

  async function refreshOAuthToken(
    credential: Credential,
  ): Promise<boolean> {
    if (!masterPassword) return false;
    if (credential.authMethod !== 'oauth') return false;

    const provider = PROVIDERS[credential.providerId];
    if (!provider?.oauthConfig) return false;

    const oauthCred = credential as { encryptedRefreshToken?: string; id: string; providerId: string; authMethod: string; encryptedAccessToken: string; label: string; createdAt: number };
    if (!oauthCred.encryptedRefreshToken) return false;

    try {
      const refreshToken = await decrypt(oauthCred.encryptedRefreshToken, masterPassword);
      const { clientId, tokenUrl } = provider.oauthConfig;

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) return false;

      const tokens = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
      };

      if (!tokens.access_token || typeof tokens.access_token !== 'string') return false;

      const encryptedAccessToken = await encrypt(tokens.access_token, masterPassword);
      const encryptedRefreshToken = tokens.refresh_token && typeof tokens.refresh_token === 'string'
        ? await encrypt(tokens.refresh_token, masterPassword)
        : oauthCred.encryptedRefreshToken;

      const refreshExpiresIn = typeof tokens.expires_in === 'number' && tokens.expires_in > 0
        ? tokens.expires_in
        : undefined;

      const credentials = await getStoredCredentials();
      const idx = credentials.findIndex((c) => c.id === credential.id);
      if (idx === -1) return false;

      credentials[idx] = {
        ...credentials[idx],
        encryptedAccessToken,
        encryptedRefreshToken,
        expiresAt: refreshExpiresIn ? Date.now() + refreshExpiresIn * 1000 : undefined,
      } as Credential;

      await browser.storage.local.set({ credentials });
      return true;
    } catch {
      return false;
    }
  }

  // --- Gift relay proxy (recipient side) ---

  async function proxyViaGiftRelay(
    responsePort: Runtime.Port,
    msg: ProxyRequest,
    sp: { giftId?: string; giftRelayUrl?: string; giftAuthToken?: string },
    session: Session,
  ): Promise<void> {
    if (!sp.giftRelayUrl || !sp.giftAuthToken || !sp.giftId) {
      responsePort.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: msg.requestId,
        status: 500,
        error: { code: 'GIFT_ERROR', message: 'Missing gift relay configuration' },
      });
      return;
    }

    // Validate relay URL uses TLS (wss://) or is localhost
    try {
      const relayParsed = new URL(sp.giftRelayUrl);
      const isSecure = relayParsed.protocol === 'wss:';
      const isLocalWs = relayParsed.protocol === 'ws:' &&
        (relayParsed.hostname === 'localhost' || relayParsed.hostname === '127.0.0.1' || relayParsed.hostname === '[::1]');
      if (!isSecure && !isLocalWs) {
        responsePort.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 400,
          error: { code: 'GIFT_ERROR', message: 'Insecure relay URL rejected' },
        });
        return;
      }
    } catch {
      responsePort.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: msg.requestId,
        status: 400,
        error: { code: 'GIFT_ERROR', message: 'Invalid relay URL' },
      });
      return;
    }

    try {
      const ws = new WebSocket(sp.giftRelayUrl);
      let authenticated = false;
      let activeTimeout: ReturnType<typeof setTimeout> | null = null;
      let logEntryId: string | undefined;
      const chunks: string[] = [];

      function setPhaseTimeout(ms: number, code: string, message: string, status: number) {
        if (activeTimeout) clearTimeout(activeTimeout);
        activeTimeout = setTimeout(() => {
          ws.close();
          responsePort.postMessage({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status,
            error: { code, message },
          });
        }, ms);
      }

      function clearActiveTimeout() {
        if (activeTimeout) { clearTimeout(activeTimeout); activeTimeout = null; }
      }

      // Auth phase timeout: 30 seconds
      setPhaseTimeout(30_000, 'GIFT_TIMEOUT', 'Gift relay connection timed out', 504);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'relay:auth',
          roomId: sp.giftId,
          authToken: sp.giftAuthToken,
          role: 'recipient',
        }));
      };

      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : '';
          if (raw.length > 10_485_760) return;
          const data = JSON.parse(raw);

          if (data.type === 'relay:auth:result') {
            if (!data.success) {
              clearActiveTimeout();
              ws.close();
              responsePort.postMessage({
                type: 'BYOKY_PROXY_RESPONSE_ERROR',
                requestId: msg.requestId,
                status: 403,
                error: { code: 'GIFT_AUTH_FAILED', message: 'Gift authentication failed' },
              });
              return;
            }
            authenticated = true;
            if (!data.peerOnline) {
              clearActiveTimeout();
              ws.close();
              responsePort.postMessage({
                type: 'BYOKY_PROXY_RESPONSE_ERROR',
                requestId: msg.requestId,
                status: 503,
                error: { code: 'GIFT_SENDER_OFFLINE', message: 'Gift sender is not online' },
              });
              return;
            }
            // Send the relay request
            ws.send(JSON.stringify({
              type: 'relay:request',
              requestId: msg.requestId,
              providerId: msg.providerId,
              url: msg.url,
              method: msg.method,
              headers: msg.headers,
              body: msg.body,
            }));
            // Request phase timeout: 2 minutes
            setPhaseTimeout(120_000, 'GIFT_TIMEOUT', 'Gift relay request timed out', 504);
          }

          // Forward relay responses to the port
          if (data.type === 'relay:response:meta' && data.requestId === msg.requestId) {
            clearActiveTimeout();
            // Strip potentially sensitive upstream headers from relay responses
            const relayHeaders = { ...(data.headers ?? {}) };
            for (const h of ['server', 'x-request-id', 'x-cloud-trace-context', 'set-cookie', 'set-cookie2', 'alt-svc', 'via']) {
              delete relayHeaders[h];
            }
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_META',
              requestId: msg.requestId,
              status: data.status,
              statusText: data.statusText,
              headers: relayHeaders,
            });
            logRequest(session, msg, data.status ?? 0).then((id) => { logEntryId = id; });
          }

          if (data.type === 'relay:response:chunk' && data.requestId === msg.requestId) {
            chunks.push(data.chunk ?? '');
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: data.chunk,
            });
          }

          if (data.type === 'relay:response:done' && data.requestId === msg.requestId) {
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_DONE',
              requestId: msg.requestId,
            });
            ws.close();
            const fullBody = chunks.join('');
            const model = parseModel(msg.body);
            const usage = parseUsage(msg.providerId, fullBody);
            if (logEntryId && (usage || model)) {
              updateLogEntry(logEntryId, {
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                model,
              });
              browser.runtime.sendMessage({
                type: 'BYOKY_INTERNAL',
                action: 'usageUpdated',
              }).catch(() => {});
            }
          }

          if (data.type === 'relay:response:error' && data.requestId === msg.requestId) {
            clearActiveTimeout();
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: data.error?.code === 'GIFT_BUDGET_EXHAUSTED' ? 429 : 502,
              error: data.error ?? { code: 'GIFT_ERROR', message: 'Gift relay error' },
            });
            ws.close();
          }

          // Update local gifted credential usage
          if (data.type === 'relay:usage' && data.giftId === sp.giftId) {
            updateGiftedCredentialUsage(sp.giftId!, data.usedTokens);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        clearActiveTimeout();
        responsePort.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 502,
          error: { code: 'GIFT_RELAY_ERROR', message: 'Failed to connect to gift relay' },
        });
      };

      ws.onclose = () => {
        clearActiveTimeout();
      };
    } catch {
      responsePort.postMessage({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: msg.requestId,
        status: 502,
        error: { code: 'GIFT_RELAY_ERROR', message: 'Failed to connect to gift relay' },
      });
    }
  }

  async function updateGiftedCredentialUsage(giftId: string, usedTokens: number) {
    const data = await browser.storage.local.get('giftedCredentials');
    const giftedCreds = (data.giftedCredentials ?? []) as GiftedCredential[];
    const idx = giftedCreds.findIndex((gc) => gc.giftId === giftId);
    if (idx !== -1) {
      giftedCreds[idx].usedTokens = usedTokens;
      await browser.storage.local.set({ giftedCredentials: giftedCreds });
    }
  }

  // --- Bridge for setup tokens (native messaging → Claude Code CLI) ---

  const BRIDGE_HOST = 'com.byoky.bridge';
  let bridgeAvailable: boolean | null = null;

  async function checkBridgeAvailable(): Promise<boolean> {
    try {
      const port = browser.runtime.connectNative(BRIDGE_HOST);
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          port.disconnect();
          bridgeAvailable = false;
          resolve(false);
        }, 2000);

        port.onMessage.addListener((raw: unknown) => {
          const msg = raw as { type: string };
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
    responsePort: Runtime.Port,
    msg: ProxyRequest,
    headers: Record<string, string>,
    session: Session,
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
        url: msg.url,
        method: msg.method,
        headers,
        body: msg.body,
      });

      let bridgeResponded = false;
      let logEntryId: string | undefined;
      const chunks: string[] = [];

      nativePort.onMessage.addListener(
        (raw: unknown) => {
          const response = raw as { type: string; requestId: string; status?: number; headers?: Record<string, string>; chunk?: string; error?: string };
          if (response.requestId !== msg.requestId) return;

          if (response.type === 'proxy_response_meta') {
            bridgeResponded = true;
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_META',
              requestId: msg.requestId,
              status: response.status,
              statusText: response.status === 200 ? 'OK' : 'Error',
              headers: response.headers ?? {},
            });
            logRequest(session, msg, response.status ?? 0).then((id) => { logEntryId = id; });
          } else if (response.type === 'proxy_response_chunk') {
            chunks.push(response.chunk ?? '');
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: response.chunk,
            });
          } else if (response.type === 'proxy_response_done') {
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_DONE',
              requestId: msg.requestId,
            });
            nativePort.disconnect();
            const fullBody = chunks.join('');
            const model = parseModel(msg.body);
            const usage = parseUsage(msg.providerId, fullBody);
            if (logEntryId && (usage || model)) {
              updateLogEntry(logEntryId, {
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                model,
              });
              browser.runtime.sendMessage({
                type: 'BYOKY_INTERNAL',
                action: 'usageUpdated',
              }).catch(() => {});
            }
          } else if (response.type === 'proxy_error') {
            bridgeResponded = true;
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 502,
              error: {
                code: 'BRIDGE_ERROR',
                message: 'Bridge request failed',
              },
            });
            nativePort.disconnect();
          }
        },
      );

      nativePort.onDisconnect.addListener(() => {
        if (!bridgeResponded) {
          responsePort.postMessage({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 502,
            error: { code: 'BRIDGE_ERROR', message: 'Bridge disconnected unexpectedly' },
          });
        }
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

  let bridgeProxyPort: Runtime.Port | null = null;
  let authorizedBridgeSessionKey: string | null = null;

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

      authorizedBridgeSessionKey = sessionKey;

      // Tell bridge to start the HTTP proxy server
      bridgeProxyPort.postMessage({
        type: 'start-proxy',
        port,
        sessionKey,
        providers: providerIds,
      });

      // Listen for HTTP proxy requests from the bridge
      bridgeProxyPort.onMessage.addListener(async (raw: unknown) => {
        const msg = raw as Record<string, unknown>;
        if (msg.type === 'proxy_http') {
          await handleBridgeProxyRequest(msg);
        }
      });

      bridgeProxyPort.onDisconnect.addListener(() => {
        bridgeProxyPort = null;
        authorizedBridgeSessionKey = null;
      });

      return { success: true, port };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async function handleBridgeProxyRequest(msg: Record<string, unknown>): Promise<void> {
    if (typeof msg.requestId !== 'string' || typeof msg.sessionKey !== 'string' ||
        typeof msg.providerId !== 'string' || typeof msg.url !== 'string' ||
        typeof msg.method !== 'string' || typeof msg.headers !== 'object' || !msg.headers ||
        (msg.body !== undefined && typeof msg.body !== 'string')) {
      return;
    }
    const requestId = msg.requestId;
    const sessionKey = msg.sessionKey;
    const providerId = msg.providerId;
    const url = msg.url;
    const method = msg.method;
    const headers = msg.headers as Record<string, string>;
    const body = msg.body as string | undefined;

    // Validate the session key matches the one authorized at proxy start
    if (sessionKey !== authorizedBridgeSessionKey) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Unauthorized session key',
      });
      return;
    }

    const session = sessions.get(sessionKey);
    if (!session || !masterPassword) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Session not found or wallet locked',
      });
      return;
    }

    // Validate providerId is one the session actually granted access to
    if (!session.providers.some((p) => p.providerId === providerId && p.available)) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Provider not available in this session',
      });
      return;
    }

    if (session.expiresAt < Date.now()) {
      sessions.delete(sessionKey);
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Session has expired',
      });
      return;
    }

    const allowanceCheck = await checkAllowance(session.appOrigin, providerId);
    if (!allowanceCheck.allowed) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: allowanceCheck.reason ?? 'Token allowance exceeded',
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

    if (!validateProxyUrl(providerId, url)) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Request URL does not match the provider\'s registered base URL',
      });
      return;
    }

    try {
      const apiKey = await decryptCredentialKey(credential);
      const realHeaders = buildHeaders(providerId, headers, apiKey, credential.authMethod);

      // OAuth tokens for Anthropic must route through the native bridge (Node.js)
      // to bypass TLS fingerprint detection on api.anthropic.com.
      // Bridge does the fetch directly and streams response to proxy-server (no double hop).
      if (credential.authMethod === 'oauth' && providerId === 'anthropic') {
        if (!bridgeProxyPort) return;

        bridgeProxyPort.postMessage({
          type: 'proxy_direct_fetch',
          requestId,
          url,
          method,
          headers: realHeaders,
          body: injectClaudeCodeSystemPrompt(body),
        });
        const model = parseModel(body);
        logRequest(session, { providerId, url, method } as ProxyRequest, 200).then((logId) => {
          if (model) updateLogEntry(logId, { model });
        });
        return;
      }

      const response = await fetch(url, {
        method,
        headers: realHeaders,
        body: body || undefined,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      bridgeProxyPort?.postMessage({
        type: 'proxy_http_response_meta',
        requestId,
        status: response.status,
        headers: responseHeaders,
      });

      const logEntryId = await logRequest(session, { providerId, url, method } as ProxyRequest, response.status);

      const chunks: string[] = [];
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          chunks.push(text);
          bridgeProxyPort?.postMessage({
            type: 'proxy_http_response_chunk',
            requestId,
            chunk: text,
          });
        }
      }

      bridgeProxyPort?.postMessage({
        type: 'proxy_http_response_done',
        requestId,
      });

      const fullBody = chunks.join('');
      const model = parseModel(body);
      const usage = parseUsage(providerId, fullBody);
      if (usage || model) {
        await updateLogEntry(logEntryId, {
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          model,
        });
        browser.runtime.sendMessage({
          type: 'BYOKY_INTERNAL',
          action: 'usageUpdated',
        }).catch(() => {});
      }
    } catch {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Proxy request failed',
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

    try {
      if (credential.authMethod === 'api_key') {
        return await decrypt(credential.encryptedKey, masterPassword);
      }
      return await decrypt(credential.encryptedAccessToken, masterPassword);
    } catch {
      throw new Error('Failed to decrypt credential');
    }
  }

  // buildHeaders, parseModel, parseUsage, computeAllowanceCheck imported from @byoky/core

  async function logRequest(
    session: Session,
    req: ProxyRequest,
    status: number,
  ): Promise<string> {
    const id = crypto.randomUUID();
    // Strip query params from URL to avoid logging secrets (e.g. API keys in query strings)
    let sanitizedUrl = req.url;
    try {
      const parsed = new URL(req.url);
      parsed.search = '';
      sanitizedUrl = parsed.toString();
    } catch {}

    const entry: RequestLogEntry = {
      id,
      sessionId: session.id,
      appOrigin: session.appOrigin,
      providerId: req.providerId,
      url: sanitizedUrl,
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
      const trustedSite = trustedSites.find((s) => s.origin === entry.approval.appOrigin);
      if (trustedSite && trustedSite.allowedProviders?.length) {
        const scopedProviders = scopeProvidersForTrust(
          entry.approval.providers,
          trustedSite.allowedProviders,
        );
        if (scopedProviders) {
          pendingApprovals.delete(id);
          const response = await createSession(
            { id: entry.originalMessageId, payload: { providers: scopedProviders } as ConnectRequest },
            entry.approval.appOrigin,
          );
          entry.resolve(response);
        }
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

  async function refreshSessionProviders() {
    if (sessions.size === 0) return;
    const credentials = await getStoredCredentials();
    const gcData = await browser.storage.local.get('giftedCredentials');
    const giftedCreds = (gcData.giftedCredentials ?? []) as GiftedCredential[];

    for (const [sessionKey, session] of sessions) {
      const requested = session.requestedProviders;
      const providerIds = requested.length > 0 ? requested : [
        ...new Set([...credentials.map(c => c.providerId), ...giftedCreds.filter(g => g.expiresAt > Date.now() && g.usedTokens < g.maxTokens).map(g => g.providerId)]),
      ];

      const providerMap: ConnectResponse['providers'] = {};
      const newSessionProviders: Session['providers'] = [];

      for (const providerId of providerIds) {
        const cred = credentials.find(c => c.providerId === providerId);
        const gc = !cred ? giftedCreds.find(g => g.providerId === providerId && g.expiresAt > Date.now() && g.usedTokens < g.maxTokens) : undefined;
        providerMap[providerId] = { available: !!(cred || gc), authMethod: cred?.authMethod ?? 'api_key' };
        if (cred) {
          newSessionProviders.push({ providerId, credentialId: cred.id, available: true, authMethod: cred.authMethod });
        } else if (gc) {
          newSessionProviders.push({ providerId, credentialId: gc.id, available: true, authMethod: 'api_key', giftId: gc.giftId, giftRelayUrl: gc.relayUrl, giftAuthToken: gc.authToken });
        }
      }

      session.providers = newSessionProviders;

      const msg = { type: 'BYOKY_PROVIDERS_UPDATED', payload: { sessionKey, providers: providerMap } };
      for (const port of notifyPorts) {
        try { port.postMessage(msg); } catch { /* port may have disconnected */ }
      }
    }
  }

  async function getTrustedSites(): Promise<TrustedSite[]> {
    const data = await browser.storage.local.get('trustedSites');
    return (data.trustedSites as TrustedSite[]) ?? [];
  }

  async function addTrustedSite(origin: string, allowedProviders: string[]) {
    const sites = await getTrustedSites();
    const existing = sites.find((s) => s.origin === origin);
    if (existing) {
      // Merge new providers into existing trust entry
      const merged = new Set([...(existing.allowedProviders ?? []), ...allowedProviders]);
      existing.allowedProviders = [...merged];
    } else {
      sites.push({ origin, trustedAt: Date.now(), allowedProviders });
    }
    await browser.storage.local.set({ trustedSites: sites });
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

    return computeAllowanceCheck(allowance, entries, providerId);
  }

  // --- Gift relay (sender side) ---

  const giftRelayConnections = new Map<string, WebSocket>();

  function connectGiftRelay(gift: Gift) {
    if (giftRelayConnections.has(gift.id)) return;
    if (!gift.active || gift.expiresAt <= Date.now()) return;

    // Validate relay URL uses TLS (wss://) or is localhost
    try {
      const parsed = new URL(gift.relayUrl);
      const isSecure = parsed.protocol === 'wss:';
      const isLocalWs = parsed.protocol === 'ws:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
      if (!isSecure && !isLocalWs) return;
    } catch {
      return;
    }

    try {
      const ws = new WebSocket(gift.relayUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'relay:auth',
          roomId: gift.id,
          authToken: gift.authToken,
          role: 'sender',
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : '';
          if (raw.length > 10_485_760) return;
          const msg = JSON.parse(raw);

          if (msg.type === 'relay:auth:result' && !msg.success) {
            ws.close();
            giftRelayConnections.delete(gift.id);
            return;
          }

          // Proxy request from recipient
          if (msg.type === 'relay:request') {
            await handleGiftProxyRequest(gift, ws, msg);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        giftRelayConnections.delete(gift.id);
        // Reconnect if gift is still active and wallet is unlocked
        setTimeout(async () => {
          if (!masterPassword) return;
          const gifts = await decryptGiftsFromStorage(masterPassword);
          const current = gifts.find((g) => g.id === gift.id);
          if (current?.active && current.expiresAt > Date.now()) {
            connectGiftRelay(current);
          }
        }, 5000);
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };

      giftRelayConnections.set(gift.id, ws);
    } catch {
      // WebSocket construction failed
    }
  }

  function disconnectGiftRelay(giftId: string) {
    const ws = giftRelayConnections.get(giftId);
    if (ws) {
      ws.close();
      giftRelayConnections.delete(giftId);
    }
  }

  function disconnectAllGiftRelays() {
    for (const [id, ws] of giftRelayConnections) {
      ws.close();
      giftRelayConnections.delete(id);
    }
  }

  async function decryptGiftsFromStorage(password: string): Promise<Gift[]> {
    const data = await browser.storage.local.get('gifts');
    const stored = (data.gifts ?? []) as Gift[];
    const result: Gift[] = [];
    for (const gift of stored) {
      if (!gift.active || gift.expiresAt <= Date.now()) {
        result.push(gift);
        continue;
      }
      try {
        const decryptedToken = await decrypt(gift.authToken, password);
        result.push({ ...gift, authToken: decryptedToken });
      } catch {
        result.push(gift);
      }
    }
    return result;
  }

  async function handleGiftProxyRequest(
    gift: Gift,
    ws: WebSocket,
    msg: { requestId: string; providerId: string; url: string; method: string; headers: Record<string, string>; body?: string },
  ) {
    if (!masterPassword) {
      ws.send(JSON.stringify({
        type: 'relay:response:error',
        requestId: msg.requestId,
        error: { code: 'WALLET_LOCKED', message: 'Sender wallet is locked' },
      }));
      return;
    }

    // Serialize the entire request lifecycle per gift under one lock so budget
    // check → API call → usage update are atomic (prevents concurrent overspend).
    const prev = giftBudgetLocks.get(gift.id) ?? Promise.resolve();
    const lock = prev.then(async () => {
      // Budget check
      const d = await browser.storage.local.get('gifts');
      const g = (d.gifts ?? []) as Gift[];
      const c = g.find((x) => x.id === gift.id);
      if (!c || !c.active || c.expiresAt <= Date.now()) {
        ws.send(JSON.stringify({
          type: 'relay:response:error',
          requestId: msg.requestId,
          error: { code: 'GIFT_EXPIRED', message: 'Gift has expired or been revoked' },
        }));
        return;
      }
      if (c.usedTokens >= c.maxTokens) {
        ws.send(JSON.stringify({
          type: 'relay:response:error',
          requestId: msg.requestId,
          error: { code: 'GIFT_BUDGET_EXHAUSTED', message: 'Gift token budget exhausted' },
        }));
        return;
      }

      // Resolve credential
      const credentials = await getStoredCredentials();
      const credential = credentials.find((cr) => cr.id === gift.credentialId);
      if (!credential) {
        ws.send(JSON.stringify({
          type: 'relay:response:error',
          requestId: msg.requestId,
          error: { code: 'PROVIDER_UNAVAILABLE', message: 'Credential no longer available' },
        }));
        return;
      }

      if (!validateProxyUrl(gift.providerId, msg.url)) {
        ws.send(JSON.stringify({
          type: 'relay:response:error',
          requestId: msg.requestId,
          error: { code: 'INVALID_URL', message: 'Request URL does not match provider' },
        }));
        return;
      }

      try {
        const apiKey = await decryptCredentialKey(credential);
        const realHeaders = buildHeaders(gift.providerId, msg.headers, apiKey, credential.authMethod);

        const controller = new AbortController();
        const requestTimeout = setTimeout(() => controller.abort(), 120_000);

        const giftReconstructed = reconstructBody(msg.body, msg.bodyEncoding);
        const giftFetchHeaders = { ...realHeaders };
        if (giftReconstructed.stripContentType) delete giftFetchHeaders['content-type'];

        const response = await fetch(msg.url, {
          method: msg.method,
          headers: giftFetchHeaders,
          body: giftReconstructed.body,
          signal: controller.signal,
        });

        const respHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { respHeaders[k] = v; });
        for (const h of ['server', 'x-request-id', 'x-cloud-trace-context', 'set-cookie', 'set-cookie2', 'alt-svc', 'via']) {
          delete respHeaders[h];
        }

        ws.send(JSON.stringify({
          type: 'relay:response:meta',
          requestId: msg.requestId,
          status: response.status,
          statusText: response.statusText,
          headers: respHeaders,
        }));

        const chunks: string[] = [];
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            chunks.push(text);
            ws.send(JSON.stringify({
              type: 'relay:response:chunk',
              requestId: msg.requestId,
              chunk: text,
            }));
          }
        }

        clearTimeout(requestTimeout);

        ws.send(JSON.stringify({
          type: 'relay:response:done',
          requestId: msg.requestId,
        }));

        // Update usage within the same lock scope
        const fullBody = chunks.join('');
        const usage = parseUsage(gift.providerId, fullBody);
        if (usage) {
          const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
          const refreshData = await browser.storage.local.get('gifts');
          const refreshGifts = (refreshData.gifts ?? []) as Gift[];
          const gIdx = refreshGifts.findIndex((rg) => rg.id === gift.id);
          if (gIdx !== -1 && refreshGifts[gIdx].usedTokens + totalTokens <= refreshGifts[gIdx].maxTokens) {
            refreshGifts[gIdx].usedTokens += totalTokens;
            await browser.storage.local.set({ gifts: refreshGifts });
            ws.send(JSON.stringify({
              type: 'relay:usage',
              giftId: gift.id,
              usedTokens: refreshGifts[gIdx].usedTokens,
            }));
          }
        }
      } catch {
        ws.send(JSON.stringify({
          type: 'relay:response:error',
          requestId: msg.requestId,
          error: { code: 'PROXY_ERROR', message: 'Request failed' },
        }));
      }
    });
    giftBudgetLocks.set(gift.id, lock.catch(() => {}));
    await lock;
  }

  async function reconnectGiftRelays() {
    if (!masterPassword) return;
    const gifts = await decryptGiftsFromStorage(masterPassword);
    for (const gift of gifts) {
      if (gift.active && gift.expiresAt > Date.now()) {
        connectGiftRelay(gift);
      }
    }
  }
});
