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
  buildHeaders,
  parseModel,
  parseUsage,
  computeAllowanceCheck,
  validateProxyUrl,
} from '@byoky/core';
import type { Runtime } from 'wxt/browser';

declare const chrome: {
  sidePanel?: {
    setPanelBehavior(opts: { openPanelOnActionClick: boolean }): void;
    open(opts: { tabId: number }): Promise<void>;
  };
};

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

  // --- Open side panel on icon click (Chrome) ---

  if (typeof chrome !== 'undefined' && chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // --- Message handling ---

  browser.runtime.onMessage.addListener((raw: unknown, sender: unknown) => {
    const message = raw as Record<string, unknown>;
    const senderInfo = sender as Runtime.MessageSender;

    if (message.type === 'BYOKY_CONNECT_REQUEST') {
      return handleConnect(message as { id: string; payload: ConnectRequest }, senderInfo);
    }

    if (message.type === 'BYOKY_DISCONNECT') {
      const { sessionKey } = message.payload as { sessionKey: string };
      const session = sessions.get(sessionKey);
      if (session) {
        const disconnectOrigin = resolveOrigin(senderInfo);
        if (disconnectOrigin === session.appOrigin) {
          sessions.delete(sessionKey);
          browser.runtime.sendMessage({
            type: 'BYOKY_INTERNAL',
            action: 'sessionChanged',
          }).catch(() => {});
        }
      }
      return;
    }

    if (message.type === 'BYOKY_SESSION_STATUS') {
      const { sessionKey } = message.payload as { sessionKey: string };
      const session = sessions.get(sessionKey);
      // Verify the requesting origin owns this session
      const statusOrigin = resolveOrigin(senderInfo);
      if (session && statusOrigin !== 'unknown' && statusOrigin !== session.appOrigin) {
        return Promise.resolve({
          type: 'BYOKY_SESSION_STATUS_RESPONSE',
          requestId: message.requestId,
          payload: { connected: false },
        });
      }
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
      // Verify the requesting origin owns this session
      const usageOrigin = resolveOrigin(senderInfo);
      if (!session || (usageOrigin !== 'unknown' && usageOrigin !== session.appOrigin)) {
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

    if (port.name !== 'byoky-proxy') return;

    // Capture the origin from the port sender (set by Chrome, can't be spoofed)
    const senderUrl = port.sender?.url || port.sender?.tab?.url;
    const portOrigin = senderUrl ? new URL(senderUrl).origin : null;

    port.onMessage.addListener(async (raw: unknown) => {
      const msg = raw as ProxyRequest;
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

        // Setup tokens for Anthropic route through the bridge (Node.js) to bypass TLS fingerprint detection
        if (credential.authMethod === 'oauth' && msg.providerId === 'anthropic') {
          // Prepend Claude Code system prompt required for OAuth token auth
          let body = msg.body;
          if (body) {
            try {
              const parsed = JSON.parse(body);
              const prefix = "You are Claude Code, Anthropic's official CLI for Claude.";
              if (!parsed.system) {
                parsed.system = prefix;
              } else if (typeof parsed.system === 'string') {
                parsed.system = `${prefix}\n\n${parsed.system}`;
              } else if (Array.isArray(parsed.system)) {
                parsed.system = [{ type: 'text', text: prefix }, ...parsed.system];
              }
              body = JSON.stringify(parsed);
            } catch {}
          }
          await proxyViaBridge(port, { ...msg, body }, realHeaders);
          return;
        }

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
          processPendingAfterUnlock();
        } else {
          unlockFailures++;
          if (unlockFailures >= 5) {
            unlockLockedUntil = Date.now() + 60_000 * Math.min(unlockFailures - 4, 5);
          }
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
        return { success: true };
      }

      case 'removeCredential': {
        const { id: rmId } = message.payload as { id: string };
        const rmData = await browser.storage.local.get('credentials');
        const rmCreds = (rmData.credentials ?? []) as Array<{ id: string }>;
        await browser.storage.local.set({
          credentials: rmCreds.filter((c) => c.id !== rmId),
        });
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
        access_token: string;
        expires_in?: number;
        refresh_token?: string;
      };

      const encryptedAccessToken = await encrypt(tokens.access_token, masterPassword);
      const encryptedRefreshToken = tokens.refresh_token
        ? await encrypt(tokens.refresh_token, masterPassword)
        : oauthCred.encryptedRefreshToken;

      const credentials = await getStoredCredentials();
      const idx = credentials.findIndex((c) => c.id === credential.id);
      if (idx === -1) return false;

      credentials[idx] = {
        ...credentials[idx],
        encryptedAccessToken,
        encryptedRefreshToken,
        expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      } as Credential;

      await browser.storage.local.set({ credentials });
      return true;
    } catch {
      return false;
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

      nativePort.onMessage.addListener(
        (raw: unknown) => {
          const response = raw as { type: string; requestId: string; status?: number; headers?: Record<string, string>; body?: string; error?: string };
          if (response.requestId !== msg.requestId) return;

          if (response.type === 'proxy_response') {
            bridgeResponded = true;
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_META',
              requestId: msg.requestId,
              status: response.status,
              statusText: response.status === 200 ? 'OK' : 'Error',
              headers: response.headers ?? {},
            });

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
            bridgeResponded = true;
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

      // Listen for messages from the bridge
      bridgeProxyPort.onMessage.addListener(async (raw: unknown) => {
        const msg = raw as Record<string, unknown>;
        if (msg.type === 'proxy_http') {
          await handleBridgeProxyRequest(msg);
        } else if (msg.type === 'proxy_response') {
          // Setup token proxy response from bridge — forward to HTTP proxy client
          bridgeProxyPort?.postMessage({
            type: 'proxy_http_response',
            requestId: msg.requestId,
            status: msg.status,
            headers: msg.headers,
            body: msg.body,
          });
        } else if (msg.type === 'proxy_error') {
          bridgeProxyPort?.postMessage({
            type: 'proxy_http_error',
            requestId: msg.requestId,
            error: msg.error,
          });
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
    const requestId = msg.requestId as string;
    const sessionKey = msg.sessionKey as string;
    const providerId = msg.providerId as string;
    const url = msg.url as string;
    const method = msg.method as string;
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
      if (credential.authMethod === 'oauth' && providerId === 'anthropic') {
        if (!bridgeProxyPort) return;

        let adjustedBody = body;
        if (adjustedBody) {
          try {
            const parsed = JSON.parse(adjustedBody);
            const prefix = "You are Claude Code, Anthropic's official CLI for Claude.";
            if (!parsed.system) {
              parsed.system = prefix;
            } else if (typeof parsed.system === 'string') {
              parsed.system = `${prefix}\n\n${parsed.system}`;
            } else if (Array.isArray(parsed.system)) {
              parsed.system = [{ type: 'text', text: prefix }, ...parsed.system];
            }
            adjustedBody = JSON.stringify(parsed);
          } catch { /* keep original body */ }
        }

        // Send setup token proxy request through the existing bridge connection
        bridgeProxyPort.postMessage({
          type: 'proxy',
          requestId,
          setupToken: apiKey,
          url,
          method,
          headers: realHeaders,
          body: adjustedBody,
        });

        // The bridge will respond with proxy_response/proxy_error which gets
        // routed back to the HTTP proxy server via handleProxyResponse
        return;
      }

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

      await logRequest(session, { providerId, url, method } as ProxyRequest, response.status);
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

    return computeAllowanceCheck(allowance, entries, providerId);
  }
});
