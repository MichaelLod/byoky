import {
  type AuthMethod,
  type Credential,
  type Session,
  type SessionProvider,
  type SessionTranslation,
  type SessionSwap,
  type RequestLogEntry,
  type PendingApproval,
  type TrustedSite,
  type TokenAllowance,
  type ConnectRequest,
  type ConnectResponse,
  type ProviderRequirement,
  type ProxyRequest,
  type SerializedFormDataEntry,
  type Group,
  type AppGroups,
  type ProviderId,
  type TranslationContext,
  type ModelFamily,
  DEFAULT_GROUP_ID,
  decrypt,
  encrypt,
  verifyPassword,
  PROVIDERS,
  buildHeaders,
  parseModel,
  parseUsage,
  detectRequestCapabilities,
  injectStreamUsageOptions,
  computeAllowanceCheck,
  shouldEstimateUsage,
  validateProxyUrl,
  isAllowedProxyRequest,
  resolveProviderBaseUrl,
  injectClaudeCodeSystemPrompt,
  rewriteToolNamesForClaudeCode,
  familyOf,
  rewriteProxyUrl,
  isChatCompletionsEndpoint,
  translateRequest,
  translateResponse,
  createStreamTranslator,
  TranslationError,
  resolveCrossFamilyRoute,
  resolveSameFamilySwapRoute,
  resolveAutoCrossFamilyRoute,
  buildNoCredentialMessage,
} from '@byoky/core';
import type { Runtime } from 'wxt/browser';
import { exportVaultFile, importVaultFile } from '../lib/vault-file';

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
        const blob = new Blob([new Uint8Array(binary)], { type: entry.contentType || 'application/octet-stream' });
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
  // Content scripts never read extension storage, so close storage.local to
  // them: a compromised renderer in any tab could otherwise add itself to the
  // trusted sites or repoint a credential's base URL. Chrome only; elsewhere
  // the call doesn't exist and storage stays as it was.
  const localArea = browser.storage.local as { setAccessLevel?: (o: { accessLevel: string }) => Promise<void> };
  localArea.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch(() => {});

  const sessions = new Map<string, Session>();
  function updateBadge() {
    const count = _pendingMap.size;
    const text = count > 0 ? String(count) : '';
    try {
      browser.action.setBadgeText({ text });
      browser.action.setBadgeBackgroundColor({ color: '#FF4F00' });
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

  // Unlock and re-authentication (before export) share one lockout, so
  // neither is an unthrottled oracle for the master password.
  function passwordLockoutError(): string | null {
    if (Date.now() >= unlockLockedUntil) return null;
    const remaining = Math.ceil((unlockLockedUntil - Date.now()) / 1000);
    return `Too many attempts. Try again in ${remaining}s`;
  }

  function recordPasswordFailure() {
    unlockFailures++;
    if (unlockFailures >= 5) {
      // Exponential backoff: 1m, 2m, 4m, 8m, ... capped at 60m
      const exponent = Math.min(unlockFailures - 5, 5);
      unlockLockedUntil = Date.now() + 60_000 * Math.pow(2, exponent);
    }
    persistLockout();
  }

  function clearPasswordFailures() {
    unlockFailures = 0;
    unlockLockedUntil = 0;
    persistLockout();
  }

  // Persist masterPassword across MV3 service worker restarts using session storage.
  // session storage is memory-only (not written to disk) and cleared when the browser closes.
  // Firefox (MV2) doesn't support storage.session, so we guard all access.
  const hasSessionStorage = !!browser.storage.session;

  async function persistSession() {
    if (!hasSessionStorage) return;
    try {
      await browser.storage.session.set({ _mp: masterPassword });
    } catch {}
  }

  async function clearSessionStorage() {
    if (!hasSessionStorage) return;
    try {
      await browser.storage.session.remove(['_mp', '_lastActivity']);
    } catch {}
  }

  // The lockout counters live in session storage too, or every service
  // worker restart would hand out five fresh password guesses.
  async function persistLockout() {
    if (!hasSessionStorage) return;
    try {
      await browser.storage.session.set({ _unlockFailures: unlockFailures, _unlockLockedUntil: unlockLockedUntil });
    } catch {}
  }

  async function restoreSession() {
    if (!hasSessionStorage) return;
    try {
      const data = await browser.storage.session.get(['_mp', '_lastActivity', '_unlockFailures', '_unlockLockedUntil']);
      if (typeof data._unlockFailures === 'number') unlockFailures = data._unlockFailures;
      if (typeof data._unlockLockedUntil === 'number') unlockLockedUntil = data._unlockLockedUntil;
      if (data._mp) {
        // A worker restart must not reset the idle clock: lock if the wallet
        // was idle long enough, else keep counting from the last activity.
        const last = typeof data._lastActivity === 'number' ? data._lastActivity : 0;
        if (Date.now() - last >= IDLE_TIMEOUT_MS) {
          await browser.storage.session.remove(['_mp', '_lastActivity', '_sessions', '_bridgeKey', '_bridgePort']);
          return;
        }
        masterPassword = data._mp as string;
        lastActivityAt = last;
        scheduleIdleLock();
      }
    } catch {}
  }

  async function persistSessions() {
    if (!hasSessionStorage) return;
    try {
      await browser.storage.session.set({ _sessions: Array.from(sessions.entries()) });
    } catch {}
  }

  async function restoreSessions() {
    if (!hasSessionStorage) return;
    try {
      const data = await browser.storage.session.get('_sessions');
      if (Array.isArray(data._sessions)) {
        const now = Date.now();
        for (const [key, session] of data._sessions as [string, Session][]) {
          if (session.expiresAt > now) {
            sessions.set(key, session);
          }
        }
      }
    } catch {}
  }

  // Origins whose session the user revoked. Their next connect needs a
  // manual approval even if the site is trusted, or the SDK's automatic
  // reconnect would silently undo the revocation. Cleared when the user
  // approves the site again.
  const revokedOrigins = new Set<string>();

  async function persistRevokedOrigins() {
    try {
      await browser.storage.local.set({ revokedOrigins: [...revokedOrigins] });
    } catch {}
  }

  async function restoreRevokedOrigins() {
    try {
      const data = await browser.storage.local.get('revokedOrigins');
      if (Array.isArray(data.revokedOrigins)) {
        for (const origin of data.revokedOrigins) {
          if (typeof origin === 'string') revokedOrigins.add(origin);
        }
      }
    } catch {}
  }

  async function clearPersistedSessions() {
    if (!hasSessionStorage) return;
    try {
      await browser.storage.session.remove('_sessions');
    } catch {}
  }

  // The bridge's authorized sessionKey + port survive MV3 service worker
  // evictions. Without persisting these, every CLI request after a worker
  // recycle hits ECONNREFUSED (the bridge process exits when its native-
  // messaging port closes) and the user has to re-run `byoky-bridge connect`.
  // Storage is browser-close-bounded (storage.session) — same security
  // profile as the sessions Map.
  async function persistAuthorizedBridgeSessionKey() {
    if (!hasSessionStorage) return;
    try {
      if (authorizedBridgeSessionKey && authorizedBridgePort) {
        await browser.storage.session.set({
          _bridgeKey: authorizedBridgeSessionKey,
          _bridgePort: authorizedBridgePort,
        });
      } else {
        await browser.storage.session.remove(['_bridgeKey', '_bridgePort']);
      }
    } catch {}
  }

  async function restoreAuthorizedBridgeSessionKey() {
    if (!hasSessionStorage) return;
    try {
      const data = await browser.storage.session.get(['_bridgeKey', '_bridgePort']);
      if (typeof data._bridgeKey === 'string' && data._bridgeKey) {
        // Only honor it if the session itself is still in the Map. If autoLock
        // cleared sessions, the cached bridge key is also dead.
        if (sessions.has(data._bridgeKey)) {
          authorizedBridgeSessionKey = data._bridgeKey;
          if (typeof data._bridgePort === 'number') {
            authorizedBridgePort = data._bridgePort;
          }
        } else {
          await browser.storage.session.remove(['_bridgeKey', '_bridgePort']);
        }
      }
    } catch {}
  }

  // Re-open the native-messaging port after a service-worker recycle so the
  // bridge process respawns and re-binds :19280 without the user having to
  // re-run `byoky-bridge connect`. Idempotent — no-op if the bridge is
  // already connected, the wallet is locked, or the bridge isn't installed.
  // Called from two places: the SW boot chain (cold start) and the periodic
  // keepalive alarm (warm-state health check).
  async function maybeAutoStartBridgeProxy() {
    if (bridgeProxyPort) return;
    if (!authorizedBridgeSessionKey || !authorizedBridgePort) return;
    if (!masterPassword) return;
    if (!sessions.has(authorizedBridgeSessionKey)) return;
    try {
      await startBridgeProxy(authorizedBridgeSessionKey, authorizedBridgePort);
    } catch {}
  }

  // Auto-lock after 20 minutes of inactivity. Chrome stops an idle MV3
  // service worker after ~30s, killing the timer, so the last activity is
  // also kept in session storage and checked on restore and by the
  // keepalive alarm.
  const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
  const ACTIVITY_PERSIST_INTERVAL_MS = 15_000;
  let lastActivityAt = 0;
  let lastActivityPersistedAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleIdleLock() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (masterPassword) {
      idleTimer = setTimeout(autoLock, Math.max(0, lastActivityAt + IDLE_TIMEOUT_MS - Date.now()));
    }
  }

  function resetIdleTimer() {
    lastActivityAt = Date.now();
    scheduleIdleLock();
    if (masterPassword && hasSessionStorage && lastActivityAt - lastActivityPersistedAt >= ACTIVITY_PERSIST_INTERVAL_MS) {
      lastActivityPersistedAt = lastActivityAt;
      browser.storage.session.set({ _lastActivity: lastActivityAt }).catch(() => {});
    }
  }

  function lockIfIdle() {
    if (masterPassword && Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS) autoLock();
  }

  function autoLock() {
    if (!masterPassword) return;
    masterPassword = null;
    sessions.clear();
    clearPersistedSessions();
    authorizedBridgeSessionKey = null;
    authorizedBridgePort = null;
    persistAuthorizedBridgeSessionKey();
    clearSessionStorage();
    browser.runtime.sendMessage({
      type: 'BYOKY_INTERNAL',
      action: 'sessionChanged',
    }).catch(() => {});
  }

  // Rate limiting for connect requests per origin
  const connectRateLimit = new Map<string, number[]>();
  const CONNECT_RATE_LIMIT = 10; // max requests per window
  const CONNECT_RATE_WINDOW = 60_000; // 1 minute

  function checkConnectRateLimit(origin: string): { limited: true; retryAfter: number } | { limited: false } {
    const now = Date.now();
    const timestamps = connectRateLimit.get(origin) ?? [];
    const recent = timestamps.filter((t) => now - t < CONNECT_RATE_WINDOW);
    if (recent.length >= CONNECT_RATE_LIMIT) {
      connectRateLimit.set(origin, recent);
      const retryAfter = Math.max(1, Math.ceil((CONNECT_RATE_WINDOW - (now - recent[0])) / 1000));
      return { limited: true, retryAfter };
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
    return { limited: false };
  }

  // Restore session after MV3 service worker restart. Capture the sessions
  // promise so port handlers can await it — otherwise a proxy request that
  // arrives during the SW boot window would miss the in-flight rehydrate
  // and 401 with SESSION_EXPIRED even when a valid session is on disk.
  // After the bridge key is restored, kick off the native-host reconnect so
  // CLI tools (Hermes, Claude Code) can hit :19280 without waiting for the
  // user to re-run `byoky-bridge connect`.
  const sessionRestored = restoreSession();
  const sessionsRestored = Promise.all([sessionRestored, restoreSessions(), restoreRevokedOrigins()])
    // restoreSession drops the password when the wallet idled out while the
    // worker was stopped; the app sessions loaded alongside go with it.
    .then(() => { if (!masterPassword) sessions.clear(); })
    .then(() => restoreAuthorizedBridgeSessionKey())
    .then(() => maybeAutoStartBridgeProxy());

  // --- Retired features: one-time storage cleanup ---
  //
  // Cloud sync, gifts and the in-wallet app store were removed when the
  // wallet became purely local. Their state is dead weight in storage.local
  // (for cloud sync it includes a bearer token and a wrapped key for a
  // service that no longer exists). Swept on update, and defensively on
  // every service-worker start in case the update event was missed.
  //
  // Only the keys listed here (plus anything under `cloudVault.`) are
  // touched. Credentials, the password hash, groups, app→group bindings,
  // trusted sites, allowances and the request log are never written.
  const RETIRED_STORAGE_KEYS = [
    'cloudVault.enabled',
    'cloudVault.username',
    'cloudVault.email',
    'cloudVault.token',
    'cloudVault.sessionId',
    'cloudVault.tokenIssuedAt',
    'cloudVault.tokenExpired',
    'cloudVault.credentialMap',
    'cloudVault.credentialMeta',
    'cloudVault.lastSyncAt',
    'cloudVault.lastUsername',
    'cloudVault.vaultKey',
    'vaultBannerDismissedAt',
    'gifts',
    'giftedCredentials',
    'giftPreferences',
    'pendingGiftLink',
    'installedApps',
  ];
  const RETIRED_STORAGE_PREFIX = 'cloudVault.';
  const RETIRED_RELAY_ALARM = 'byoky:relay-reconnect';
  // Set when the sweep finds that the user relied on cloud sync or gifts, so
  // the popup can explain once where they went.
  const RETIRED_FEATURES_NOTICE_KEY = 'retiredFeaturesNotice';

  function usedRetiredFeatures(data: Record<string, unknown>): boolean {
    const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0;
    return data['cloudVault.enabled'] === true
      || typeof data['cloudVault.username'] === 'string'
      || typeof data['cloudVault.lastUsername'] === 'string'
      || nonEmpty(data.gifts)
      || nonEmpty(data.giftedCredentials);
  }

  async function removeRetiredFeatureState(sweepPrefix: boolean): Promise<void> {
    browser.alarms.clear(RETIRED_RELAY_ALARM).catch(() => {});
    try {
      // The full read is only needed to catch `cloudVault.*` keys that are
      // not in the list; the startup pass reads just the known keys.
      const data = sweepPrefix
        ? await browser.storage.local.get(null)
        : await browser.storage.local.get(RETIRED_STORAGE_KEYS);
      const stale = Object.keys(data).filter(
        (key) => RETIRED_STORAGE_KEYS.includes(key) || key.startsWith(RETIRED_STORAGE_PREFIX),
      );
      if (stale.length === 0) return;
      // Record the notice before deleting, so an interrupted sweep can't
      // drop it.
      if (usedRetiredFeatures(data)) {
        await browser.storage.local.set({ [RETIRED_FEATURES_NOTICE_KEY]: true });
      }
      await browser.storage.local.remove(stale);
    } catch {}
  }

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'update') removeRetiredFeatureState(true);
  });
  removeRetiredFeatureState(false);

  // --- Open side panel on icon click (Chrome) / sidebar (Firefox) ---

  if (typeof chrome !== 'undefined' && chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } else if (typeof browser !== 'undefined' && browser.sidebarAction) {
    // Firefox: no popup is set, so onClicked fires → toggle the sidebar
    browser.browserAction.onClicked.addListener(() => {
      browser.sidebarAction.toggle();
    });
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
        const ALLOWED_CONTENT_ACTIONS = ['startBridgeProxy', 'checkBridge'];
        if (!ALLOWED_CONTENT_ACTIONS.includes((message as { action: string }).action)) return;
      }
      return handleInternal(message as { action: string; payload?: unknown }, senderInfo);
    }
  });

  // --- Notification ports (session revocations / provider updates) ---

  // Each content script's notify port, with the origin of the frame it runs
  // in. Notifications carry a session key, so they only go to frames of the
  // session's own origin (see notifyOrigin).
  const notifyPorts = new Map<Runtime.Port, string | null>();

  // --- Proxy via Port (streaming) ---

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'byoky-notify') {
      notifyPorts.set(port, senderOrigin(port.sender));
      port.onDisconnect.addListener(() => notifyPorts.delete(port));
      return;
    }

    if (port.name === 'byoky-message') {
      // Handle connect/disconnect/status/usage via port so the message doesn't
      // broadcast to the side-panel's onMessage listener (which can interfere
      // in Chrome MV3 when multiple listeners exist).
      port.onMessage.addListener(async (raw: unknown) => {
        await sessionsRestored;
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
              persistSessions();
              if (authorizedBridgeSessionKey === sessionKey) {
                authorizedBridgeSessionKey = null;
                authorizedBridgePort = null;
                persistAuthorizedBridgeSessionKey();
              }
              browser.runtime.sendMessage({
                type: 'BYOKY_INTERNAL',
                action: 'sessionChanged',
              }).catch(() => {});
            }
          }
          // Lets the content script close its port; never forwarded to the page.
          response = { type: 'BYOKY_DISCONNECT_ACK', requestId: (message as { id?: string }).id };
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

    // The sending frame's origin, set by the browser (can't be spoofed).
    const portOrigin = senderOrigin(port.sender);

    // One port per request. When it closes (the app cancelled, or the tab
    // went away) the upstream call is aborted instead of running on and
    // billing; usage up to that point is still recorded.
    const upstreamAbort = new AbortController();
    let portOpen = true;
    port.onDisconnect.addListener(() => {
      portOpen = false;
      upstreamAbort.abort();
    });
    const send = (message: unknown) => {
      if (!portOpen) return;
      try { port.postMessage(message); } catch { portOpen = false; }
    };

    port.onMessage.addListener(async (raw: unknown) => {
      await sessionsRestored;
      const msg = raw as ProxyRequest;
      if (msg.sessionKey == null) return;

      const session = sessions.get(msg.sessionKey);
      if (!session) {
        send({
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
        persistSessions();
        send({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 401,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
        return;
      }

      // Verify the requesting origin matches the session's approved origin
      if (!portOrigin || portOrigin !== session.appOrigin) {
        send({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 403,
          error: { code: 'PROVIDER_UNAVAILABLE', message: 'Origin mismatch — request rejected' },
        });
        return;
      }

      // Apps get inference endpoints only: no files, batches, fine-tunes or
      // account management, which would expose other apps' stored data.
      if (!isAllowedProxyRequest(msg.method, msg.url)) {
        send({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 403,
          error: { code: 'ENDPOINT_NOT_ALLOWED', message: 'Apps can only call inference and model-listing endpoints through Byoky' },
        });
        return;
      }

      // Only requests from the approved app count as wallet activity, or any
      // page could keep the wallet from locking with junk requests.
      resetIdleTimer();

      if (!masterPassword) {
        send({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 423,
          error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' },
        });
        return;
      }

      const sessionProvider = session.providers.find((sp) => sp.providerId === msg.providerId);

      // Cross-family translation context (set when the resolved group routes
      // this app to a credential in a different provider family).
      const translation = sessionProvider?.translation;
      // Same-family swap context (set when the resolved group routes this
      // app to a different provider in the same translation family — no
      // translation needed, just URL rewrite + credential swap + optional
      // body.model override).
      const swap = sessionProvider?.swap;
      // The "effective" provider id is the one we actually call upstream:
      // the destination if translation or swap is on, otherwise the source.
      const effectiveProviderId = translation?.dstProviderId ?? swap?.dstProviderId ?? msg.providerId;

      // Look up and refresh the credential before entering the try/catch below.
      let credential = await resolveCredential(session, msg.providerId);
      if (!credential) {
        const allCreds = await getStoredCredentials();
        const group = await getGroupForOrigin(session.appOrigin);
        const message = buildNoCredentialMessage(
          msg.providerId,
          Array.from(new Set(allCreds.map((c) => c.providerId))).sort(),
          group,
        );
        send({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 403,
          error: { code: 'PROVIDER_UNAVAILABLE', message },
        });
        return;
      }

      // Check the token allowance and hold what this request may use in one
      // step, so a burst of parallel requests can't all pass the check.
      const reservation = await checkAndReserveAllowance(session.appOrigin, msg.providerId, msg);
      if (!reservation.allowed) {
        send({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 429,
          error: { code: 'QUOTA_EXCEEDED', message: reservation.reason },
        });
        return;
      }
      let logEntryId: string | undefined;
      let responseStatus = 0;
      let responseContentType = '';
      let responseChunks: string[] | undefined;
      let streamComplete = false;
      let fetchSent = false;

      try {
        const apiKey = await decryptCredentialKey(credential);

        // The URL the SDK sent must match the SOURCE provider's base URL.
        // (After translation we issue against the destination's URL — see
        // rewriteProxyUrl below.) For providers without a fixed host (Azure,
        // Ollama, LM Studio), pass the credential's baseUrl — but only when
        // the credential is the source credential (no translation/swap), so
        // we don't accidentally validate the source URL against the
        // destination's tenant/loopback origin.
        const sourceBaseUrl = (!translation && !swap && credential.providerId === msg.providerId)
          ? credential.baseUrl
          : undefined;
        if (!validateProxyUrl(msg.providerId, msg.url, sourceBaseUrl)) {
          send({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 403,
            error: { code: 'INVALID_URL', message: 'Request URL does not match the provider\'s registered base URL' },
          });
          return;
        }

        // Routing rewrites the request onto the destination's chat endpoint,
        // so only chat requests can be swapped or translated. Model lists,
        // embeddings or the Responses API would be mangled into chat calls.
        if ((translation || swap) && !isRoutableChatRequest(msg.providerId, msg.url)) {
          send({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 400,
            error: { code: 'ROUTING_UNSUPPORTED', message: `This app is routed to ${effectiveProviderId}, and only chat requests can be routed to another provider` },
          });
          return;
        }

        // Translate the request body up front, before any branch (the OAuth
        // bridge path needs to see the translated body too).
        let translatedBody: string | undefined = msg.body;
        let translatedUrl = msg.url;
        if (translation) {
          if (msg.bodyEncoding) {
            // Binary bodies cannot be translated — translation requires JSON.
            send({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 400,
              error: { code: 'TRANSLATION_NOT_SUPPORTED', message: 'Cross-family routing does not support binary request bodies.' },
            });
            return;
          }
          try {
            translatedBody = applyRequestTranslation(translation, msg.body, msg.requestId, msg.url);
          } catch (err) {
            const code = err instanceof TranslationError ? err.code : 'TRANSLATION_FAILED';
            send({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 502,
              error: { code, message: err instanceof Error ? err.message : 'Translation failed' },
            });
            return;
          }
          const isStreaming = detectStreamingRequest(msg.body, msg.url);
          const rewritten = rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming, credential.baseUrl);
          if (!rewritten) {
            send({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 502,
              error: { code: 'TRANSLATION_FAILED', message: `Cannot rewrite URL for destination provider ${translation.dstProviderId}` },
            });
            return;
          }
          translatedUrl = rewritten;
        } else if (swap) {
          // Same-family swap: no translation layer, just URL rewrite +
          // optional body.model override. Binary bodies pass through
          // unchanged (we only touch the JSON when swap.dstModel is set).
          const isStreaming = detectStreamingRequest(msg.body, msg.url);
          const rewritten = rewriteProxyUrl(swap.dstProviderId, swap.dstModel ?? '', isStreaming, credential.baseUrl);
          if (!rewritten) {
            send({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 502,
              error: { code: 'SWAP_FAILED', message: `Cannot rewrite URL for destination provider ${swap.dstProviderId}` },
            });
            return;
          }
          translatedUrl = rewritten;
          if (swap.dstModel && !msg.bodyEncoding && msg.body) {
            translatedBody = rewriteModelInJsonBody(msg.body, swap.dstModel);
          }
        } else if (sessionProvider?.modelOverride && !msg.bodyEncoding && msg.body) {
          // Direct path, same provider, but the group pins a model. The
          // group's model is the strongest force — override the SDK's choice.
          translatedBody = rewriteModelInJsonBody(msg.body, sessionProvider.modelOverride);
        }

        const realHeaders = buildHeaders(effectiveProviderId, msg.headers, apiKey, credential.authMethod);

        // OAuth tokens for Anthropic route through the bridge (Node.js) to bypass TLS fingerprint detection.
        // Setup tokens require the Claude Code system prompt + Claude-Code-shaped tool names.
        // When the tool name rewriter fires, also relocate the system prompt (third-party framework).
        // After translation, the body is already in Anthropic shape — the
        // Claude Code injection still applies because the bridge expects an
        // Anthropic-shaped request.
        if (credential.authMethod === 'oauth' && effectiveProviderId === 'anthropic') {
          const { body: rewrittenBody, toolNameMap } = rewriteToolNamesForClaudeCode(translatedBody);
          const isThirdParty = Object.keys(toolNameMap).length > 0;
          const body = injectClaudeCodeSystemPrompt(rewrittenBody, {
            relocateExisting: isThirdParty,
          });
          const sseRewriter = translation
            ? buildResponseStreamRewriter(translation, msg.requestId, msg.body, msg.url)
            : undefined;
          await proxyViaBridge(
            port,
            { ...msg, body, url: translatedUrl, providerId: effectiveProviderId },
            realHeaders,
            session,
            msg,
            toolNameMap,
            translation
              ? { translation, sseRewriter, originalBody: msg.body }
              : undefined,
          );
          return;
        }

        const proxyBody = msg.bodyEncoding ? translatedBody : injectStreamUsageOptions(effectiveProviderId, translatedBody);
        const reconstructed = reconstructBody(proxyBody, msg.bodyEncoding);
        const fetchHeaders = { ...realHeaders };
        if (reconstructed.stripContentType) delete fetchHeaders['content-type'];

        // redirect: 'error' — a redirect would carry the injected API key
        // headers to wherever the upstream points.
        fetchSent = true;
        const response = await fetch(translatedUrl, {
          method: msg.method,
          headers: fetchHeaders,
          body: reconstructed.body,
          redirect: 'error',
          signal: upstreamAbort.signal,
        });

        const respHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          respHeaders[k] = v;
        });

        send({
          type: 'BYOKY_PROXY_RESPONSE_META',
          requestId: msg.requestId,
          status: response.status,
          statusText: response.statusText,
          headers: respHeaders,
        });

        responseStatus = response.status;
        responseContentType = respHeaders['content-type'] ?? '';
        logEntryId = await logRequest(session, msg, response.status);

        // Decide streaming vs single-shot from the response Content-Type.
        // Translation activates a per-chunk SSE rewriter for streaming
        // responses, or a one-shot JSON translator for non-streaming.
        const isStreamingResponse = (respHeaders['content-type'] ?? '').includes('text/event-stream');
        const sseRewriter = translation && isStreamingResponse
          ? buildResponseStreamRewriter(translation, msg.requestId, msg.body, msg.url)
          : undefined;

        const chunks: string[] = [];
        responseChunks = chunks;
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            chunks.push(text);
            if (sseRewriter) {
              const rewritten = sseRewriter.process(text);
              if (rewritten) {
                send({
                  type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                  requestId: msg.requestId,
                  chunk: rewritten,
                });
              }
            } else if (!translation) {
              // Pass-through path: forward each chunk as-is.
              send({
                type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                requestId: msg.requestId,
                chunk: text,
              });
            }
            // Non-streaming + translation: buffer everything in chunks[],
            // emit one translated chunk after the loop.
          }
        }

        streamComplete = true;

        if (sseRewriter) {
          const tail = sseRewriter.flush();
          if (tail) {
            send({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: tail,
            });
          }
        } else if (translation && !isStreamingResponse) {
          // Non-streaming translation: translate the buffered JSON body
          // and emit it as a single chunk.
          try {
            const translatedResponse = applyResponseTranslation(translation, msg.body, msg.requestId, chunks.join(''), msg.url);
            send({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: translatedResponse,
            });
          } catch (err) {
            send({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 502,
              error: { code: 'TRANSLATION_FAILED', message: err instanceof Error ? err.message : 'Response translation failed' },
            });
            return;
          }
        }

        send({
          type: 'BYOKY_PROXY_RESPONSE_DONE',
          requestId: msg.requestId,
        });
      } catch (error) {
        send({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 502,
          error: { code: 'PROXY_ERROR', message: 'Proxy request failed' },
        });
      } finally {
        // Usage is read from the *destination* format (effectiveProviderId),
        // since the chunks hold the untranslated upstream body. Recorded even
        // when the stream was cut off or a later step failed: the provider
        // billed it either way. The reservation is released only once the
        // usage is counted, so the tokens are never counted nowhere.
        try {
          if (logEntryId && responseChunks) {
            await recordProxyUsage(session.appOrigin, msg, effectiveProviderId, logEntryId, responseStatus, responseContentType, responseChunks.join(''), streamComplete);
          } else if (fetchSent && upstreamAbort.signal.aborted) {
            // Cancelled before the response headers (for a non-streaming
            // reply that's until generation ends): the provider still bills.
            await chargeCancelledRequest(session, msg);
          }
        } catch { /* usage bookkeeping must not break the response */ }
        reservation.release();
      }
    });
  });

  // --- Helpers ---

  /**
   * Origin of the frame that sent a message or opened a port. Chrome sets
   * `sender.origin`; elsewhere `sender.url` is the sending frame's own URL
   * (content scripts get it without the tabs permission). Never falls back
   * to the tab's URL: that is the top-level page, so an iframe would act
   * with the origin of whatever page embeds it. Opaque origins yield null.
   */
  function senderOrigin(sender: Runtime.MessageSender | undefined): string | null {
    if (!sender) return null;
    // Not in the polyfill's MessageSender type, but set by Chrome.
    const declared = (sender as { origin?: unknown }).origin;
    let origin: string | undefined;
    if (typeof declared === 'string' && declared) {
      origin = declared;
    } else if (sender.url) {
      try { origin = new URL(sender.url).origin; } catch { return null; }
    }
    return origin && origin !== 'null' ? origin : null;
  }

  function resolveOrigin(sender: Runtime.MessageSender): string {
    return senderOrigin(sender) ?? 'unknown';
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

    // Cheap path: reuse an active session for this origin. Don't gate on
    // the rate limit — every page load calls connect(), and reusing the
    // same approval shouldn't burn budget.
    const existing = findActiveSession(origin);
    if (existing) {
      return buildSessionResponse(existing, message.id);
    }

    // Silent reconnect probe with no session is also cheap — answer NO_SESSION
    // without consuming the rate-limit budget.
    if (message.payload.reconnectOnly) {
      return {
        type: 'BYOKY_ERROR',
        requestId: message.id,
        payload: { code: 'NO_SESSION', message: 'No active session for this origin' },
      };
    }

    // Expensive path: a fresh session requires creation (and likely user
    // approval). Apply the rate limit here so spam can't trigger repeat
    // approval prompts.
    const rl = checkConnectRateLimit(origin);
    if (rl.limited) {
      return {
        type: 'BYOKY_ERROR',
        requestId: message.id,
        payload: {
          code: 'RATE_LIMITED',
          message: 'Please wait a moment before trying again.',
          retryAfter: rl.retryAfter,
        },
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
          if (trustedSite && trustedSite.allowedProviders?.length && !revokedOrigins.has(origin)) {
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
    const result: Array<{ id: string; authMethod: AuthMethod; sessionProvider: Session['providers'][number] }> = [];

    for (const cred of credentials) {
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
    const request = message.payload;
    const sessionKey = `byk_${crypto.randomUUID().replace(/-/g, '')}`;

    const providerMap: ConnectResponse['providers'] = {};
    const sessionProviders: Session['providers'] = [];

    // Resolve the group this app belongs to (auto-assigns to default if first contact)
    const group = await getGroupForOrigin(origin);

    for (const req of request.providers ?? []) {
      // If the group is bound to this provider with a specific credential pin,
      // it overrides everything else for credential selection.
      const groupPinnedCred =
        group && group.providerId === req.id && group.credentialId
          ? credentials.find((c) => c.id === group.credentialId)
          : undefined;

      // Cross-family routing: the group's bound
      // provider differs from what the app asked for, both providers are
      // in known translation families, and a credential resolves for the
      // destination. Record translation metadata so the proxy handler
      // knows to translate.
      const crossRoute = resolveCrossFamilyRoute(group, req.id, credentials);

      // Same-family swap: the group's bound provider differs from what the
      // app asked for, and both providers are in the SAME family (identical
      // wire format). No translation needed — just URL rewrite + credential
      // swap + optional model override. Only consulted when cross-family
      // routing doesn't apply, so the branches are mutually exclusive.
      const swapRoute = !crossRoute
        ? resolveSameFamilySwapRoute(group, req.id, credentials)
        : undefined;

      const directCred = credentials.find((c) => c.providerId === req.id);

      // Auto cross-family translation: opportunistic fallback when the app
      // has no group binding AND no direct credential for the requested
      // provider. Picks any translatable credential the user holds so apps
      // "just work" against mismatched keys. Group intent always wins — we
      // only fire this when the app's group binds no provider (the default
      // group binds none).
      const autoRoute = !group?.providerId && !directCred
        ? resolveAutoCrossFamilyRoute(req.id, credentials)
        : undefined;

      // Group credential pin wins over everything. Cross-family routing and
      // same-family swap beat own-key direct lookup.
      const cred = groupPinnedCred ?? crossRoute?.cred ?? swapRoute?.cred ?? directCred ?? autoRoute?.cred;
      providerMap[req.id] = {
        available: !!cred,
        authMethod: cred?.authMethod ?? 'api_key',
      };
      if (cred) {
        const sp: SessionProvider = {
          providerId: req.id,
          credentialId: cred.id,
          available: true,
          authMethod: cred.authMethod,
        };
        if (crossRoute) sp.translation = crossRoute.translation;
        else if (swapRoute) sp.swap = swapRoute.swap;
        else if (autoRoute) sp.translation = autoRoute.translation;
        else if (group && group.providerId === req.id && group.model) {
          sp.modelOverride = group.model;
        }
        sessionProviders.push(sp);
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
      // What the user approved. An "all providers" request is pinned to the
      // providers it resolved to, so keys added later aren't handed to this
      // session without a new approval.
      requestedProviders: request.providers?.length
        ? request.providers.map(p => p.id)
        : sessionProviders.map(sp => sp.providerId),
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    sessions.set(sessionKey, session);
    persistSessions();

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

  async function handleInternal(
    message: { action: string; payload?: unknown },
    sender?: Runtime.MessageSender,
  ): Promise<unknown> {
    // When this message is what woke the worker, the lockout counters and
    // the unlocked state are still being restored from session storage.
    await sessionRestored;
    switch (message.action) {
      case 'unlock': {
        const lockout = passwordLockoutError();
        if (lockout) return { success: false, error: lockout };
        const { password } = message.payload as { password: string };
        const data = await browser.storage.local.get('passwordHash');
        if (!data.passwordHash) return { success: false };
        const valid = await verifyPassword(password, data.passwordHash as string);
        if (valid) {
          masterPassword = password;
          clearPasswordFailures();
          lastActivityPersistedAt = 0;
          persistSession();
          resetIdleTimer();
          processPendingAfterUnlock();
        } else {
          recordPasswordFailure();
        }
        return { success: valid };
      }

      case 'lock':
        masterPassword = null;
        sessions.clear();
        clearPersistedSessions();
        authorizedBridgeSessionKey = null;
        authorizedBridgePort = null;
        persistAuthorizedBridgeSessionKey();
        clearSessionStorage();
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        // An open side panel or another popup switches to the unlock screen.
        browser.runtime.sendMessage({
          type: 'BYOKY_INTERNAL',
          action: 'sessionChanged',
        }).catch(() => {});
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
        const { providerId: cpId, label: cLabel, value: cValue, authMethod: cAuth, baseUrl: cBaseUrl } = message.payload as {
          providerId: string; label: string; value: string; authMethod: 'api_key' | 'oauth'; baseUrl?: string;
        };
        // A baseUrl only applies to providers without a fixed host, and has to
        // be safe to send the key to (see resolveProviderBaseUrl).
        let storedBaseUrl: string | undefined;
        if (PROVIDERS[cpId]?.requiresCustomBaseUrl) {
          const resolved = cBaseUrl ? resolveProviderBaseUrl(cpId, cBaseUrl) : null;
          if (!resolved) return { error: 'Base URL must use https:// (or http://localhost for a local server)' };
          storedBaseUrl = resolved;
        }
        const cleanValue = cValue.replace(/\s+/g, '');
        // Local providers run unauthenticated — empty key is allowed and we skip
        // the encryption step entirely, storing an empty string as the marker.
        const encValue = cleanValue ? await encrypt(cleanValue, masterPassword) : '';
        const data = await browser.storage.local.get('credentials');
        const creds = (data.credentials ?? []) as Array<Record<string, unknown>>;
        const newCred: Record<string, unknown> = {
          id: crypto.randomUUID(),
          providerId: cpId,
          label: cLabel,
          authMethod: cAuth,
          createdAt: Date.now(),
        };
        if (storedBaseUrl) newCred.baseUrl = storedBaseUrl;
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

      case 'renameCredential': {
        const { id: rnId, label: rnLabel } = message.payload as { id: string; label: string };
        const newLabel = rnLabel.trim();
        if (!newLabel) return { error: 'Label cannot be empty' };
        const rnData = await browser.storage.local.get('credentials');
        const rnCreds = (rnData.credentials ?? []) as Array<Record<string, unknown>>;
        const rnIdx = rnCreds.findIndex((c) => c.id === rnId);
        if (rnIdx < 0) return { error: 'Credential not found' };
        rnCreds[rnIdx] = { ...rnCreds[rnIdx], label: newLabel };
        await browser.storage.local.set({ credentials: rnCreds });
        return { success: true };
      }

      case 'removeCredential': {
        const { id: rmId } = message.payload as { id: string };
        const rmData = await browser.storage.local.get('credentials');
        const rmCreds = (rmData.credentials ?? []) as Array<{ id: string }>;
        await browser.storage.local.set({
          credentials: rmCreds.filter((c) => c.id !== rmId),
        });
        // Clear any group pin pointing at the removed credential
        const groups = await getGroups();
        let mutated = false;
        for (let i = 0; i < groups.length; i++) {
          if (groups[i].credentialId === rmId) {
            groups[i] = { ...groups[i], credentialId: undefined };
            mutated = true;
          }
        }
        if (mutated) await setGroups(groups);
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
        clearPersistedSessions();
        authorizedBridgeSessionKey = null;
        authorizedBridgePort = null;
        persistAuthorizedBridgeSessionKey();
        clearSessionStorage();
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        clearPasswordFailures();
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
            persistSessions();
            if (authorizedBridgeSessionKey === key) {
              authorizedBridgeSessionKey = null;
              authorizedBridgePort = null;
              persistAuthorizedBridgeSessionKey();
            }
            revokedOrigins.add(s.appOrigin);
            persistRevokedOrigins();
            broadcastRevocation(s);
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
          port?: unknown;
        };
        // Reachable from localhost pages via the content script. Only the
        // app that owns the session may bind the bridge to it.
        const bridgeSession = sessions.get(sessionKey);
        if (!bridgeSession || !sender || resolveOrigin(sender) !== bridgeSession.appOrigin) {
          return { success: false, error: 'Invalid session' };
        }
        // The page picks the port. Only a plain unprivileged TCP port: a
        // string would make the bridge's listen() create a Unix socket.
        const bridgePort = port ?? 19280;
        if (typeof bridgePort !== 'number' || !Number.isInteger(bridgePort) || bridgePort < 1024 || bridgePort > 65535) {
          return { success: false, error: 'Invalid port' };
        }
        return startBridgeProxy(sessionKey, bridgePort);
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
        if (revokedOrigins.delete(pending.approval.appOrigin)) persistRevokedOrigins();

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

      case 'addTrustedSite': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { origin, allowedProviders } = message.payload as { origin: string; allowedProviders: string[] };
        await addTrustedSite(origin, allowedProviders);
        return { success: true };
      }

      case 'exportVault': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { exportPassword, currentPassword } = message.payload as {
          exportPassword: string; currentPassword?: string;
        };
        // The file hands out every key at once, so an unlocked wallet isn't
        // enough: the user re-enters the wallet password, checked against the
        // stored hash.
        if (typeof currentPassword !== 'string' || !currentPassword) {
          return { error: 'Enter your wallet password to export' };
        }
        const exportLockout = passwordLockoutError();
        if (exportLockout) return { error: exportLockout };
        const stored = await browser.storage.local.get('passwordHash');
        if (!stored.passwordHash || !(await verifyPassword(currentPassword, stored.passwordHash as string))) {
          recordPasswordFailure();
          return { error: 'Incorrect wallet password' };
        }
        clearPasswordFailures();
        const encryptedVault = await exportVaultFile(await getStoredCredentials(), masterPassword, exportPassword);
        return { encryptedVault };
      }

      case 'importVault': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { encryptedVault: impVault, importPassword: impPw } = message.payload as {
          encryptedVault: string; importPassword: string;
        };
        // Merge, never replace: existing credentials (and the group pins that
        // reference them) stay untouched; duplicates of them are skipped.
        const result = await importVaultFile(impVault, impPw, await getStoredCredentials(), masterPassword);
        if (!result.ok) return { error: result.error };
        if (result.added.length > 0) {
          const latest = await getStoredCredentials();
          await browser.storage.local.set({ credentials: [...latest, ...result.added] });
          refreshSessionProviders();
        }
        return { success: true, count: result.added.length, skipped: result.skipped, rejected: result.rejected };
      }

      case 'getAllowances':
        // The usage totals are what allowances are enforced against.
        return { allowances: await getAllowances(), usage: await getUsageTotals() };

      case 'resetAppUsage': {
        const { origin } = message.payload as { origin: string };
        await serializedStorage(async () => {
          const totals = await getUsageTotals();
          delete totals[origin];
          await browser.storage.local.set({ usageTotals: totals });
        });
        return { success: true };
      }

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

      case 'getRetiredFeaturesNotice': {
        const data = await browser.storage.local.get(RETIRED_FEATURES_NOTICE_KEY);
        return { show: data[RETIRED_FEATURES_NOTICE_KEY] === true };
      }

      case 'dismissRetiredFeaturesNotice':
        await browser.storage.local.remove(RETIRED_FEATURES_NOTICE_KEY);
        return { success: true };

      // --- Groups (alias layer) ---

      case 'getGroups': {
        // Ensure a default group exists so the UI never has to synthesize one.
        await ensureDefaultGroup();
        return { groups: await getGroups(), appGroups: await getAppGroups() };
      }

      case 'createGroup': {
        const result = await createGroup(message.payload as {
          name: string; providerId: string; credentialId?: string; model?: string;
        });
        if (result.error) return { error: result.error };
        return { group: result.group };
      }

      case 'updateGroup': {
        const { id, patch } = message.payload as {
          id: string;
          patch: { name?: string; providerId?: string; credentialId?: string | null; model?: string | null };
        };
        const result = await updateGroup(id, patch);
        if (result.error) return { error: result.error };
        refreshSessionProviders();
        return { group: result.group };
      }

      case 'deleteGroup': {
        const { id } = message.payload as { id: string };
        const result = await deleteGroup(id);
        if (result.error) return { error: result.error };
        refreshSessionProviders();
        return { success: true };
      }

      case 'setAppGroup': {
        const { origin, groupId } = message.payload as { origin: string; groupId: string };
        const result = await setAppGroup(origin, groupId);
        if (result.error) return { error: result.error };
        refreshSessionProviders();
        return { success: true };
      }

      default:
        return { error: 'Unknown action' };
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

  /**
   * Optional cross-family translation context for proxyViaBridge. When set,
   * the bridge has been called with an already-translated body, but the
   * response chunks still need to be rewritten back to the source dialect on
   * their way to the SDK.
   */
  interface BridgeTranslation {
    translation: SessionTranslation;
    sseRewriter?: { process(s: string): string; flush(): string };
    /** The SDK's original (pre-translation) body, used by parseModel for logging. */
    originalBody?: string;
  }

  async function proxyViaBridge(
    responsePort: Runtime.Port,
    msg: ProxyRequest,
    headers: Record<string, string>,
    session: Session,
    appRequest: ProxyRequest,
    toolNameMap: Record<string, string> = {},
    translationCtx?: BridgeTranslation,
  ): Promise<void> {
    // The app's port may close at any time (cancel, tab closed); posting to
    // it after that throws.
    let appConnected = true;
    const send = (message: unknown) => {
      if (!appConnected) return;
      try { responsePort.postMessage(message); } catch { appConnected = false; }
    };

    const available = await checkBridgeAvailable();
    if (!available) {
      send({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: msg.requestId,
        status: 503,
        error: {
          code: 'BRIDGE_UNAVAILABLE',
          // The bridge is a desktop Node program; Safari can't reach it.
          message: import.meta.env.SAFARI
            ? 'Claude setup tokens need the Byoky Bridge, which works with Chrome and Firefox on a computer. Use an Anthropic API key in Safari.'
            : 'Byoky Bridge not installed. Run: npm install -g @byoky/bridge && byoky-bridge install',
        },
      });
      return;
    }

    let nativePort: Runtime.Port;
    try {
      nativePort = browser.runtime.connectNative(BRIDGE_HOST);
    } catch {
      send({
        type: 'BYOKY_PROXY_RESPONSE_ERROR',
        requestId: msg.requestId,
        status: 502,
        error: { code: 'BRIDGE_ERROR', message: 'Could not start the bridge' },
      });
      return;
    }

    let bridgeResponded = false;
    let status = 0;
    let contentType = '';
    let appCancelled = false;
    let logEntry: Promise<string> | undefined;
    let complete = false;
    const chunks: string[] = [];
    let isStreamingResponse = false;

    // Resolves once the request is over, however it ended, so the caller's
    // allowance reservation lasts as long as the request does.
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try { nativePort.disconnect(); } catch { /* already gone */ }
        resolve();
      };

      // Closing the native port ends the bridge process and its upstream fetch.
      responsePort.onDisconnect.addListener(() => {
        appConnected = false;
        if (!finished) appCancelled = true;
        finish();
      });

      nativePort.onMessage.addListener((raw: unknown) => {
        const response = raw as { type: string; requestId: string; status?: number; headers?: Record<string, string>; chunk?: string; error?: string };
        if (response.requestId !== msg.requestId) return;

        if (response.type === 'proxy_response_meta') {
          bridgeResponded = true;
          status = response.status ?? 0;
          const respHeaders = response.headers ?? {};
          contentType = respHeaders['content-type'] ?? '';
          isStreamingResponse = (respHeaders['content-type'] ?? '').includes('text/event-stream');
          send({
            type: 'BYOKY_PROXY_RESPONSE_META',
            requestId: msg.requestId,
            status: response.status,
            statusText: response.status === 200 ? 'OK' : 'Error',
            headers: respHeaders,
          });
          logEntry = logRequest(session, appRequest, status);
        } else if (response.type === 'proxy_response_chunk') {
          chunks.push(response.chunk ?? '');
          // Translation: route chunks through the SSE rewriter when
          // streaming, otherwise buffer for one-shot translation at done.
          if (translationCtx && isStreamingResponse && translationCtx.sseRewriter) {
            const rewritten = translationCtx.sseRewriter.process(response.chunk ?? '');
            if (rewritten) {
              send({
                type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                requestId: msg.requestId,
                chunk: rewritten,
              });
            }
          } else if (!translationCtx) {
            send({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: response.chunk,
            });
          }
          // Non-streaming + translation: hold chunks until done.
        } else if (response.type === 'proxy_response_done') {
          complete = true;
          // Flush any trailing translated bytes / emit one-shot translation.
          if (translationCtx) {
            if (isStreamingResponse && translationCtx.sseRewriter) {
              const tail = translationCtx.sseRewriter.flush();
              if (tail) {
                send({
                  type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                  requestId: msg.requestId,
                  chunk: tail,
                });
              }
            } else {
              try {
                const translated = applyResponseTranslation(
                  translationCtx.translation,
                  translationCtx.originalBody,
                  msg.requestId,
                  chunks.join(''),
                  appRequest.url,
                );
                send({
                  type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                  requestId: msg.requestId,
                  chunk: translated,
                });
              } catch (err) {
                send({
                  type: 'BYOKY_PROXY_RESPONSE_ERROR',
                  requestId: msg.requestId,
                  status: 502,
                  error: { code: 'TRANSLATION_FAILED', message: err instanceof Error ? err.message : 'Response translation failed' },
                });
                finish();
                return;
              }
            }
          }
          send({
            type: 'BYOKY_PROXY_RESPONSE_DONE',
            requestId: msg.requestId,
          });
          finish();
        } else if (response.type === 'proxy_error') {
          bridgeResponded = true;
          send({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 502,
            error: {
              code: 'BRIDGE_ERROR',
              message: 'Bridge request failed',
            },
          });
          finish();
        }
      });

      nativePort.onDisconnect.addListener(() => {
        if (!bridgeResponded) {
          send({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 502,
            error: { code: 'BRIDGE_ERROR', message: 'Bridge disconnected unexpectedly' },
          });
        }
        finish();
      });

      nativePort.postMessage({
        type: 'proxy',
        requestId: msg.requestId,
        url: msg.url,
        method: msg.method,
        headers,
        body: msg.body,
        toolNameMap,
      });
    });

    // The log entry is written when the response headers arrive; waiting for
    // it here (not in the message handler) means a fast reply can't finish
    // before the entry exists. Usage is parsed in the upstream format
    // (msg.providerId is the destination) and charged to the provider the
    // app asked for.
    if (logEntry) {
      const logEntryId = await logEntry;
      await recordProxyUsage(session.appOrigin, appRequest, msg.providerId, logEntryId, status, contentType, chunks.join(''), complete)
        .catch(() => {});
    } else if (appCancelled) {
      await chargeCancelledRequest(session, appRequest).catch(() => {});
    }
  }

  // --- Bridge HTTP proxy (generic local gateway for CLI/desktop apps) ---

  let bridgeProxyPort: Runtime.Port | null = null;
  let authorizedBridgeSessionKey: string | null = null;
  let authorizedBridgePort: number | null = null;

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

      const nativePort = browser.runtime.connectNative(BRIDGE_HOST);
      bridgeProxyPort = nativePort;

      authorizedBridgeSessionKey = sessionKey;
      authorizedBridgePort = port;
      persistAuthorizedBridgeSessionKey();

      // The bridge answers start-proxy with proxy-started once it listens,
      // or proxy_error when it can't (port taken). Wait for that, so callers
      // never report a proxy that isn't there.
      const startError = new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve('Bridge did not respond'), 10_000);
        const onReply = (raw: unknown) => {
          const msg = raw as Record<string, unknown>;
          if (msg.type === 'proxy-started') {
            resolve(null);
          } else if (msg.type === 'proxy_error' && msg.requestId === 'start-proxy') {
            resolve(typeof msg.error === 'string' ? msg.error : 'Bridge failed to start');
          } else {
            return;
          }
          clearTimeout(timer);
          nativePort.onMessage.removeListener(onReply);
        };
        nativePort.onMessage.addListener(onReply);
        nativePort.onDisconnect.addListener(() => {
          clearTimeout(timer);
          resolve('Bridge disconnected');
        });
      });

      // Tell bridge to start the HTTP proxy server
      nativePort.postMessage({
        type: 'start-proxy',
        port,
        sessionKey,
        providers: providerIds,
      });

      // Listen for HTTP proxy requests from the bridge. A body too big for
      // one native message (1 MiB) arrives first in slices, then the
      // request with `bodyChunked`.
      const pendingBodies = new Map<string, string[]>();
      nativePort.onMessage.addListener(async (raw: unknown) => {
        const msg = raw as Record<string, unknown>;
        if (msg.type === 'proxy_http_body_chunk') {
          if (typeof msg.requestId !== 'string' || typeof msg.chunk !== 'string') return;
          const parts = pendingBodies.get(msg.requestId) ?? [];
          parts.push(msg.chunk);
          pendingBodies.set(msg.requestId, parts);
        } else if (msg.type === 'proxy_http') {
          if (msg.bodyChunked === true && typeof msg.requestId === 'string') {
            msg.body = (pendingBodies.get(msg.requestId) ?? []).join('');
            pendingBodies.delete(msg.requestId);
          }
          await handleBridgeProxyRequest(msg);
        }
      });

      nativePort.onDisconnect.addListener(() => {
        if (bridgeProxyPort === nativePort) bridgeProxyPort = null;
        // Note: do NOT clear authorizedBridgeSessionKey here. The native-host
        // port disconnects on every MV3 service-worker recycle (which is
        // frequent and unrelated to user intent). Keeping the key authorized
        // means the next bridge respawn lands in a working state instead of
        // 401-storming until the user runs `byoky-bridge connect` again.
        // The key is still cleared on autoLock and on explicit session
        // revocation paths below.
      });

      const error = await startError;
      if (error) {
        // Drop the port so the keepalive's auto-start can try again later.
        if (bridgeProxyPort === nativePort) {
          nativePort.disconnect();
          bridgeProxyPort = null;
        }
        return { success: false, error };
      }
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

    // CLI traffic via the bridge counts as wallet activity. Without this the
    // 20-min idle auto-lock fires mid-Hermes/Claude-Code session even though
    // the user is actively using the wallet through a CLI.
    resetIdleTimer();

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
      persistSessions();
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Session has expired',
      });
      return;
    }

    const sessionProvider = session.providers.find((sp) => sp.providerId === providerId);

    // For requiresCustomBaseUrl providers (Azure, Ollama, LM Studio) we can't
    // validate here yet — we need the credential's baseUrl, which isn't
    // resolved until below. Skip the pre-flight validate for those; direct-
    // path calls revalidate after resolveCredential with the override.
    // Unlike the page path there is no isAllowedProxyRequest check: bridge
    // callers are local tools holding the bridge token, and Claude Code uses
    // Anthropic paths beyond inference.
    const providerCfg = PROVIDERS[providerId];
    if (!providerCfg?.requiresCustomBaseUrl && !validateProxyUrl(providerId, url)) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Request URL does not match the provider\'s registered base URL',
      });
      return;
    }

    const credential = await resolveCredential(session, providerId);
    if (!credential) {
      const allCreds = await getStoredCredentials();
      const group = await getGroupForOrigin(session.appOrigin);
      const message = buildNoCredentialMessage(
        providerId,
        Array.from(new Set(allCreds.map((c) => c.providerId))).sort(),
        group,
      );
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: message,
      });
      return;
    }

    // Cross-family translation + same-family swap context
    // (mirrors the popup port path).
    const translation = sessionProvider?.translation;
    const swap = sessionProvider?.swap;
    const effectiveProviderId = translation?.dstProviderId ?? swap?.dstProviderId ?? providerId;

    // Revalidate for requiresCustomBaseUrl providers now that we have the
    // credential's baseUrl. Direct path only — translation/swap builds the
    // destination URL via rewriteProxyUrl below, so the pre-translation URL
    // is still the source provider's (validated above when non-custom).
    if (
      providerCfg?.requiresCustomBaseUrl &&
      !translation &&
      !swap &&
      !validateProxyUrl(providerId, url, credential.baseUrl)
    ) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: 'Request URL does not match the credential\'s registered base URL',
      });
      return;
    }

    // Routing rewrites the request onto the destination's chat endpoint, so
    // only chat requests can be swapped or translated (same rule as the page
    // path). Model lists or token counting would be mangled into chat calls.
    if ((translation || swap) && !isRoutableChatRequest(providerId, url)) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        status: 400,
        code: 'ROUTING_UNSUPPORTED',
        error: `This app is routed to ${effectiveProviderId}, and only chat requests can be routed to another provider`,
      });
      return;
    }

    // The app's request as the log and allowance helpers expect it.
    const appRequest = { providerId, url, method, body } as ProxyRequest;

    try {
      const apiKey = await decryptCredentialKey(credential);

      // Translate the request body up front, before any branch.
      let translatedBody: string | undefined = body;
      let translatedUrl = url;
      if (translation) {
        try {
          translatedBody = applyRequestTranslation(translation, body, requestId, url);
        } catch (err) {
          bridgeProxyPort?.postMessage({
            type: 'proxy_http_error',
            requestId,
            error: err instanceof Error ? err.message : 'Translation failed',
          });
          return;
        }
        const isStreaming = detectStreamingRequest(body, url);
        const rewritten = rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming, credential.baseUrl);
        if (!rewritten) {
          bridgeProxyPort?.postMessage({
            type: 'proxy_http_error',
            requestId,
            error: `Cannot rewrite URL for destination provider ${translation.dstProviderId}`,
          });
          return;
        }
        translatedUrl = rewritten;
      } else if (swap) {
        // Same-family swap: URL rewrite + optional body.model override.
        const isStreaming = detectStreamingRequest(body, url);
        const rewritten = rewriteProxyUrl(swap.dstProviderId, swap.dstModel ?? '', isStreaming, credential.baseUrl);
        if (!rewritten) {
          bridgeProxyPort?.postMessage({
            type: 'proxy_http_error',
            requestId,
            error: `Cannot rewrite URL for destination provider ${swap.dstProviderId}`,
          });
          return;
        }
        translatedUrl = rewritten;
        if (swap.dstModel && body) {
          translatedBody = rewriteModelInJsonBody(body, swap.dstModel);
        }
      } else if (sessionProvider?.modelOverride && body) {
        // Direct path, same provider, but the group pins a model. The
        // group's model is the strongest force — override the SDK's choice.
        translatedBody = rewriteModelInJsonBody(body, sessionProvider.modelOverride);
      }

      const realHeaders = buildHeaders(effectiveProviderId, headers, apiKey, credential.authMethod);

      // OAuth tokens for Anthropic must route through the native bridge (Node.js)
      // to bypass TLS fingerprint detection on api.anthropic.com.
      // Bridge does the fetch directly and streams response to proxy-server (no double hop).
      if (credential.authMethod === 'oauth' && effectiveProviderId === 'anthropic') {
        if (!bridgeProxyPort) return;

        // Translation + OAuth direct-fetch is unsupported in the bridge HTTP
        // path: the bridge streams the response back to its own HTTP server
        // without round-tripping through the extension, so we have no place
        // to insert the SSE rewriter that would translate chunks back to the
        // source dialect.
        if (translation) {
          bridgeProxyPort.postMessage({
            type: 'proxy_http_error',
            requestId,
            error: 'Cross-family translation is not supported on the bridge OAuth path. Bind this app to an Anthropic credential or remove the OAuth requirement.',
          });
          return;
        }

        // Rewrite non-Claude-Code tool names (e.g. OpenClaw's `read`/`exec`) to
        // PascalCase aliases so Anthropic's third-party detector accepts the
        // request as Claude Code. When the rewriter fires, the request is from
        // a third-party framework — also relocate its system prompt out of the
        // system field (Anthropic also classifies on system content). The bridge
        // reverses the tool name mapping on the streaming response.
        const { body: rewrittenBody, toolNameMap } = rewriteToolNamesForClaudeCode(translatedBody);
        const isThirdParty = Object.keys(toolNameMap).length > 0;
        const finalBody = injectClaudeCodeSystemPrompt(rewrittenBody, {
          relocateExisting: isThirdParty,
        });

        const nativePort = bridgeProxyPort;
        const reservation = await checkAndReserveAllowance(session.appOrigin, providerId, appRequest);
        if (!reservation.allowed) {
          nativePort.postMessage({ type: 'proxy_http_error', requestId, error: reservation.reason });
          return;
        }
        if (msg.reportsDirectFetch === true) {
          // Only the bridge sees this response. It reports the status and
          // usage once the response ends, also when it was cut off; log and
          // charge it then, the same way recordProxyUsage does for responses
          // the extension reads itself.
          const finish = async (status: number, report?: Record<string, unknown>) => {
            nativePort.onMessage.removeListener(onDone);
            nativePort.onDisconnect.removeListener(onGone);
            try {
              await chargeDirectFetch(status, report);
            } finally {
              reservation.release();
            }
          };
          const chargeDirectFetch = async (status: number, report?: Record<string, unknown>) => {
            const tokens = (v: unknown) =>
              typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
            const usage = report?.usage as Record<string, unknown> | undefined;
            let inputTokens = tokens(usage?.inputTokens);
            let outputTokens = tokens(usage?.outputTokens);
            const responseChars = tokens(report?.responseChars) ?? 0;
            // A successful call without readable usage, or one cut off before
            // its final usage event, is charged an estimate (bytes / 4 each way).
            // The bridge only takes this path for Anthropic setup tokens, whose
            // replies are JSON or SSE.
            if (status >= 200 && status < 300 && shouldEstimateUsage(effectiveProviderId, url, 'application/json') &&
                (inputTokens == null || outputTokens == null || report?.complete !== true)) {
              if (!inputTokens) inputTokens = Math.ceil((body?.length ?? 0) / 4);
              if (!outputTokens) outputTokens = Math.ceil(responseChars / 4);
            }
            const logId = await logRequest(session, appRequest, status);
            await updateLogEntry(logId, { inputTokens, outputTokens, model: parseModel(body) });
            browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'usageUpdated' }).catch(() => {});
            await addUsage(session.appOrigin, providerId, (inputTokens ?? 0) + (outputTokens ?? 0));
          };
          const onDone = (raw: unknown) => {
            const report = raw as Record<string, unknown>;
            if (report.type !== 'proxy_direct_done' || report.requestId !== requestId) return;
            void finish(typeof report.status === 'number' ? report.status : 502, report).catch(() => {});
          };
          // The bridge died mid-request: the client got an error, log one.
          const onGone = () => { void finish(502).catch(() => {}); };
          nativePort.onMessage.addListener(onDone);
          nativePort.onDisconnect.addListener(onGone);
        } else {
          // Older bridges don't report back; log what is known now.
          reservation.release();
          const model = parseModel(body);
          logRequest(session, appRequest, 200).then((logId) => {
            if (model) updateLogEntry(logId, { model });
          });
        }

        nativePort.postMessage({
          type: 'proxy_direct_fetch',
          requestId,
          url: translatedUrl,
          method,
          headers: realHeaders,
          body: finalBody,
          toolNameMap,
          providerId: effectiveProviderId,
        });
        return;
      }

      const bridgeBody = injectStreamUsageOptions(effectiveProviderId, translatedBody);
      // Check the allowance and hold what this request may use in one step,
      // as on the page path.
      const reservation = await checkAndReserveAllowance(session.appOrigin, providerId, appRequest);
      if (!reservation.allowed) {
        bridgeProxyPort?.postMessage({ type: 'proxy_http_error', requestId, error: reservation.reason });
        return;
      }
      let logEntryId: string | undefined;
      let responseStatus = 0;
      let responseContentType = '';
      let complete = false;
      const chunks: string[] = [];
      try {
        // redirect: 'error' — see the extension-port proxy path.
        const response = await fetch(translatedUrl, {
          method,
          headers: realHeaders,
          body: bridgeBody || undefined,
          redirect: 'error',
        });
        responseStatus = response.status;

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

        logEntryId = await logRequest(session, appRequest, response.status);

        // Translation: stream rewriter for SSE responses, one-shot for JSON.
        const isStreamingResponse = (responseHeaders['content-type'] ?? '').includes('text/event-stream');
        const sseRewriter = translation && isStreamingResponse
          ? buildResponseStreamRewriter(translation, requestId, body, url)
          : undefined;

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            chunks.push(text);
            if (sseRewriter) {
              const rewritten = sseRewriter.process(text);
              if (rewritten) {
                bridgeProxyPort?.postMessage({
                  type: 'proxy_http_response_chunk',
                  requestId,
                  chunk: rewritten,
                });
              }
            } else if (!translation) {
              bridgeProxyPort?.postMessage({
                type: 'proxy_http_response_chunk',
                requestId,
                chunk: text,
              });
            }
          }
        }
        complete = true;

        if (sseRewriter) {
          const tail = sseRewriter.flush();
          if (tail) {
            bridgeProxyPort?.postMessage({
              type: 'proxy_http_response_chunk',
              requestId,
              chunk: tail,
            });
          }
        } else if (translation && !isStreamingResponse) {
          try {
            const translatedResponse = applyResponseTranslation(translation, body, requestId, chunks.join(''), url);
            bridgeProxyPort?.postMessage({
              type: 'proxy_http_response_chunk',
              requestId,
              chunk: translatedResponse,
            });
          } catch (err) {
            bridgeProxyPort?.postMessage({
              type: 'proxy_http_error',
              requestId,
              error: err instanceof Error ? err.message : 'Response translation failed',
            });
            return;
          }
        }

        bridgeProxyPort?.postMessage({
          type: 'proxy_http_response_done',
          requestId,
        });
      } finally {
        // Usage is read from the destination format (chunks hold the
        // untranslated upstream body) and recorded even when the stream was
        // cut off or a later step failed: the provider billed it either way.
        // The hold is released only once the usage is counted.
        if (logEntryId) {
          await recordProxyUsage(session.appOrigin, appRequest, effectiveProviderId, logEntryId, responseStatus, responseContentType, chunks.join(''), complete)
            .catch(() => {});
        }
        reservation.release();
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

  // ─── Translation helpers ────────────────────────────────────────────────

  /**
   * Build a TranslationContext for a given session translation + request.
   * Captures the model the SDK asked for so it can be echoed back in
   * responses.
   */
  function buildTranslationContext(
    translation: SessionTranslation,
    requestBody: string | undefined,
    requestId: string,
    requestUrl?: string,
  ): TranslationContext | null {
    const srcFamily = familyOf(translation.srcProviderId);
    const dstFamily = familyOf(translation.dstProviderId);
    if (!srcFamily || !dstFamily) return null;
    return {
      srcFamily: srcFamily as ModelFamily,
      dstFamily: dstFamily as ModelFamily,
      srcModel: (requestBody ? parseModel(requestBody) : undefined) ?? modelFromUrl(requestUrl),
      dstModel: translation.dstModel,
      isStreaming: detectStreamingRequest(requestBody, requestUrl),
      requestId,
    };
  }

  /** Gemini puts the model in the path: /v1beta/models/{model}:generateContent. */
  function modelFromUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
      const match = /\/models\/([^/:]+):/.exec(new URL(url).pathname);
      return match ? decodeURIComponent(match[1]) : undefined;
    } catch {
      return undefined;
    }
  }

  function isRoutableChatRequest(providerId: string, url: string): boolean {
    const family = familyOf(providerId);
    return !!family && isChatCompletionsEndpoint(family, url);
  }

  function detectStreamingRequest(body: string | undefined, url?: string): boolean {
    // Gemini asks for a stream in the URL, not the body.
    if (url) {
      try {
        if (new URL(url).pathname.endsWith(':streamGenerateContent')) return true;
      } catch { /* fall through to the body */ }
    }
    if (!body) return false;
    try {
      const parsed = JSON.parse(body) as { stream?: boolean };
      return parsed.stream === true;
    } catch {
      return false;
    }
  }

  /**
   * Surgically rewrite the top-level `model` field of a JSON request body to
   * `newModel`. Returns the original body unchanged if parsing fails — we'd
   * rather pass through and let the destination return a real error than
   * silently corrupt the request. Used by the same-family swap path when
   * the group pins a destination model.
   */
  function rewriteModelInJsonBody(body: string, newModel: string): string {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      parsed.model = newModel;
      return JSON.stringify(parsed);
    } catch {
      return body;
    }
  }

  /**
   * Run the request body through the canonical-IR translation pipeline.
   * Throws TranslationError on shapes the destination cannot represent.
   */
  function applyRequestTranslation(
    translation: SessionTranslation,
    body: string | undefined,
    requestId: string,
    requestUrl?: string,
  ): string | undefined {
    if (!body) return body;
    const ctx = buildTranslationContext(translation, body, requestId, requestUrl);
    if (!ctx) {
      throw new TranslationError('TRANSLATION_FAILED', 'Cannot resolve translation families');
    }
    return translateRequest(ctx, body);
  }

  /**
   * Translate a single non-streaming response body from the destination
   * dialect back to the source dialect.
   */
  function applyResponseTranslation(
    translation: SessionTranslation,
    requestBody: string | undefined,
    requestId: string,
    responseBody: string,
    requestUrl?: string,
  ): string {
    const ctx = buildTranslationContext(translation, requestBody, requestId, requestUrl);
    if (!ctx) {
      throw new TranslationError('TRANSLATION_FAILED', 'Cannot resolve translation families');
    }
    return translateResponse(ctx, responseBody);
  }

  /**
   * Build the SSE stream rewriter that translates upstream chunks (in the
   * destination dialect) back to the source dialect.
   */
  function buildResponseStreamRewriter(
    translation: SessionTranslation,
    requestId: string,
    requestBody?: string,
    requestUrl?: string,
  ): { process(s: string): string; flush(): string } | undefined {
    // The request body carries the model the app asked for, which the
    // translated stream echoes back instead of the destination's.
    const ctx = buildTranslationContext(translation, requestBody, requestId, requestUrl);
    if (!ctx) return undefined;
    return createStreamTranslator(ctx);
  }

  async function decryptCredentialKey(
    credential: Credential,
  ): Promise<string> {
    if (!masterPassword) throw new Error('Wallet is locked');

    // Local providers (Ollama, LM Studio) may be stored with an empty key
    // when the user didn't set auth on their local server. No ciphertext,
    // nothing to decrypt.
    if (credential.authMethod === 'api_key' && !credential.encryptedKey) {
      return '';
    }

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

    // Pull cross-family routing info from the session provider so we can
    // record what we actually called upstream (vs what the SDK requested).
    // Translation and swap are mutually exclusive — at most one is set.
    const sp = session.providers.find((p) => p.providerId === req.providerId);
    const translation = sp?.translation;
    const swap = sp?.swap;

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

    if (translation) {
      entry.actualProviderId = translation.dstProviderId;
      entry.actualModel = translation.dstModel;
    } else if (swap) {
      entry.actualProviderId = swap.dstProviderId;
      if (swap.dstModel) entry.actualModel = swap.dstModel;
    } else if (sp?.modelOverride) {
      entry.actualModel = sp.modelOverride;
    }

    // Capture the group routing this request, if any (the resolver auto-
    // assigns to the default group on first contact).
    const group = await getGroupForOrigin(session.appOrigin);
    if (group) entry.groupId = group.id;

    // Capture the capability fingerprint of the request body for drag-time
    // warnings — the popup aggregates these per app to detect when an app
    // is about to be moved to a model that lacks a capability it uses.
    if (req.body && !req.bodyEncoding) {
      const caps = detectRequestCapabilities(req.body);
      if (caps.tools || caps.vision || caps.structuredOutput || caps.reasoning) {
        entry.usedCapabilities = caps;
      }
    }

    await serializedStorage(async () => {
      const data = await browser.storage.local.get('requestLog');
      const log = (data.requestLog as RequestLogEntry[]) ?? [];
      log.unshift(entry);

      // Keep last 500 entries
      await browser.storage.local.set({
        requestLog: log.slice(0, 500),
      });
    });

    return id;
  }

  async function updateLogEntry(
    entryId: string,
    updates: { inputTokens?: number; outputTokens?: number; model?: string },
  ) {
    await serializedStorage(async () => {
      const data = await browser.storage.local.get('requestLog');
      const log = (data.requestLog as RequestLogEntry[]) ?? [];
      const entry = log.find((e) => e.id === entryId);
      if (!entry) return;
      if (updates.inputTokens != null) entry.inputTokens = updates.inputTokens;
      if (updates.outputTokens != null) entry.outputTokens = updates.outputTokens;
      if (updates.model) entry.model = updates.model;
      await browser.storage.local.set({ requestLog: log });
    });
  }

  // Read-modify-write of the request log and the usage totals runs one at a
  // time, or concurrent requests drop each other's entries.
  let storageQueue: Promise<unknown> = Promise.resolve();
  function serializedStorage<T>(fn: () => Promise<T>): Promise<T> {
    const run = storageQueue.then(fn, fn);
    storageQueue = run.catch(() => {});
    return run;
  }

  // Lifetime tokens per app and provider, which allowances are checked
  // against. Kept apart from the request log: that holds only the last 500
  // entries across all apps, so an app could push its own expensive entries
  // out of the window with cheap requests.
  type UsageTotals = Record<string, Record<string, number>>;

  async function getUsageTotals(): Promise<UsageTotals> {
    const data = await browser.storage.local.get(['usageTotals', 'requestLog']);
    if (data.usageTotals) return data.usageTotals as UsageTotals;
    // First run with totals: seed them from what the log still holds.
    const totals: UsageTotals = {};
    for (const e of (data.requestLog as RequestLogEntry[]) ?? []) {
      const tokens = (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
      if (e.status >= 400 || tokens <= 0) continue;
      const app = (totals[e.appOrigin] ??= {});
      app[e.providerId] = (app[e.providerId] ?? 0) + tokens;
    }
    return totals;
  }

  // Seed the totals once, before any request can update the log, or the
  // first request after the upgrade would be counted twice (once from the
  // log, once by addUsage).
  serializedStorage(async () => {
    const data = await browser.storage.local.get('usageTotals');
    if (!data.usageTotals) await browser.storage.local.set({ usageTotals: await getUsageTotals() });
  }).catch(() => {});

  function addUsage(origin: string, providerId: string, tokens: number): Promise<void> {
    if (tokens <= 0) return Promise.resolve();
    return serializedStorage(async () => {
      const totals = await getUsageTotals();
      const app = (totals[origin] ??= {});
      app[providerId] = (app[providerId] ?? 0) + tokens;
      await browser.storage.local.set({ usageTotals: totals });
    });
  }

  // Tokens in-flight requests may still use, per app and provider.
  const reservedTokens = new Map<string, Map<string, number>>();

  function reserveTokens(origin: string, providerId: string, tokens: number): () => void {
    const app = reservedTokens.get(origin) ?? new Map<string, number>();
    reservedTokens.set(origin, app);
    app.set(providerId, (app.get(providerId) ?? 0) + tokens);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (app.get(providerId) ?? 0) - tokens;
      if (left > 0) app.set(providerId, left);
      else app.delete(providerId);
      if (app.size === 0) reservedTokens.delete(origin);
    };
  }

  /**
   * Check the app's allowance and, if it passes, hold the tokens this
   * request may use. Everything after the one await runs synchronously, so
   * concurrent requests see each other's holds.
   */
  async function checkAndReserveAllowance(
    origin: string,
    providerId: string,
    req: ProxyRequest,
  ): Promise<{ allowed: true; release: () => void } | { allowed: false; reason: string }> {
    const [allowances, allTotals] = await Promise.all([getAllowances(), getUsageTotals()]);
    const allowance = allowances.find((a) => a.origin === origin);
    if (allowance) {
      const totals = allTotals[origin] ?? {};
      const reserved = reservedTokens.get(origin) ?? new Map<string, number>();
      const entries = [...Object.entries(totals), ...reserved.entries()].map(([pid, tokens]) => ({
        providerId: pid as ProviderId,
        inputTokens: tokens,
        outputTokens: 0,
      }));
      const check = computeAllowanceCheck(allowance, entries, providerId);
      if (!check.allowed) return { allowed: false, reason: check.reason ?? 'Token allowance exceeded' };
    }
    return { allowed: true, release: reserveTokens(origin, providerId, estimateRequestTokens(req)) };
  }

  /** A request the app cancelled before any response: charge its estimate. */
  async function chargeCancelledRequest(session: Session, req: ProxyRequest) {
    const inputTokens = req.body && !req.bodyEncoding ? Math.ceil(req.body.length / 4) : 0;
    const outputTokens = Math.max(0, estimateRequestTokens(req) - inputTokens);
    const logEntryId = await logRequest(session, req, 499);
    await updateLogEntry(logEntryId, { inputTokens, outputTokens, model: req.bodyEncoding ? undefined : parseModel(req.body) });
    await addUsage(session.appOrigin, req.providerId, inputTokens + outputTokens);
  }

  /** Rough upper bound for a request: its prompt plus the output it asks for. */
  function estimateRequestTokens(req: ProxyRequest): number {
    if (!req.body || req.bodyEncoding) return 0;
    let maxOutput = 0;
    try {
      const body = JSON.parse(req.body) as Record<string, unknown>;
      const config = body.generationConfig as Record<string, unknown> | undefined;
      for (const value of [body.max_tokens, body.max_completion_tokens, body.max_output_tokens, config?.maxOutputTokens]) {
        if (typeof value === 'number' && value > maxOutput) maxOutput = value;
      }
    } catch { /* not JSON: count the prompt only */ }
    return Math.ceil(req.body.length / 4) + maxOutput;
  }

  async function recordProxyUsage(
    origin: string,
    req: ProxyRequest,
    upstreamProviderId: string,
    logEntryId: string,
    status: number,
    contentType: string,
    responseText: string,
    complete: boolean,
  ) {
    const model = req.bodyEncoding ? undefined : parseModel(req.body);
    const ok = status >= 200 && status < 300;
    const parsed = ok ? parseUsage(upstreamProviderId, responseText) : undefined;
    let inputTokens = parsed?.inputTokens;
    let outputTokens = parsed?.outputTokens;
    // A successful generation whose usage we can't read, or a stream cut off
    // before its final usage event, is charged an estimate (bytes / 4 each
    // way), so allowances can't be dodged by cancelling early. Embeddings,
    // images, audio, token counting and model lists aren't estimated. Same
    // rule on iOS and Android.
    if (ok && shouldEstimateUsage(upstreamProviderId, req.url, contentType) && (!parsed || !complete)) {
      if (!inputTokens) inputTokens = Math.ceil((req.body?.length ?? 0) / 4);
      if (!outputTokens) outputTokens = Math.ceil(responseText.length / 4);
    }
    if (inputTokens != null || outputTokens != null || model) {
      await updateLogEntry(logEntryId, { inputTokens, outputTokens, model });
      browser.runtime.sendMessage({
        type: 'BYOKY_INTERNAL',
        action: 'usageUpdated',
      }).catch(() => {});
    }
    await addUsage(origin, req.providerId, (inputTokens ?? 0) + (outputTokens ?? 0));
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
      if (trustedSite && trustedSite.allowedProviders?.length && !revokedOrigins.has(entry.approval.appOrigin)) {
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

  /** Post to the notify ports of frames whose origin is `origin`, and no others. */
  function notifyOrigin(origin: string, msg: unknown) {
    for (const [port, portOrigin] of notifyPorts) {
      if (portOrigin !== origin) continue;
      try { port.postMessage(msg); } catch { /* port may have disconnected */ }
    }
  }

  function broadcastRevocation(session: Session) {
    notifyOrigin(session.appOrigin, { type: 'BYOKY_SESSION_REVOKED', payload: { sessionKey: session.sessionKey } });
  }

  async function refreshSessionProviders() {
    if (sessions.size === 0) return;
    const credentials = await getStoredCredentials();

    for (const [sessionKey, session] of sessions) {
      const providerIds = session.requestedProviders;

      // Re-resolve group binding for this session's origin (may have changed)
      const group = await getGroupForOrigin(session.appOrigin);

      const providerMap: ConnectResponse['providers'] = {};
      const newSessionProviders: Session['providers'] = [];

      for (const providerId of providerIds) {
        const groupPinnedCred =
          group && group.providerId === providerId && group.credentialId
            ? credentials.find(c => c.id === group.credentialId)
            : undefined;
        const crossRoute = resolveCrossFamilyRoute(group, providerId, credentials);
        const swapRoute = !crossRoute
          ? resolveSameFamilySwapRoute(group, providerId, credentials)
          : undefined;
        const directCred = credentials.find(c => c.providerId === providerId);
        const autoRoute = !group?.providerId && !directCred
          ? resolveAutoCrossFamilyRoute(providerId, credentials)
          : undefined;
        const cred = groupPinnedCred ?? crossRoute?.cred ?? swapRoute?.cred ?? directCred ?? autoRoute?.cred;
        providerMap[providerId] = { available: !!cred, authMethod: cred?.authMethod ?? 'api_key' };
        if (cred) {
          const sp: SessionProvider = { providerId, credentialId: cred.id, available: true, authMethod: cred.authMethod };
          if (crossRoute) sp.translation = crossRoute.translation;
          else if (swapRoute) sp.swap = swapRoute.swap;
          else if (autoRoute) sp.translation = autoRoute.translation;
          else if (group && group.providerId === providerId && group.model) {
            sp.modelOverride = group.model;
          }
          newSessionProviders.push(sp);
        }
      }

      session.providers = newSessionProviders;
      persistSessions();

      notifyOrigin(session.appOrigin, { type: 'BYOKY_PROVIDERS_UPDATED', payload: { sessionKey, providers: providerMap } });
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

  // --- Groups (alias layer) ---

  async function getGroups(): Promise<Group[]> {
    const data = await browser.storage.local.get('groups');
    return (data.groups as Group[]) ?? [];
  }

  async function setGroups(groups: Group[]) {
    await browser.storage.local.set({ groups });
  }

  async function getAppGroups(): Promise<AppGroups> {
    const data = await browser.storage.local.get('appGroups');
    return (data.appGroups as AppGroups) ?? {};
  }

  async function setAppGroups(appGroups: AppGroups) {
    await browser.storage.local.set({ appGroups });
  }

  // Ensures the default group exists. The default group is a sentinel bucket
  // for apps with no explicit binding — it carries no routing (empty
  // providerId), so unbound apps fall through to direct credential lookup
  // for the provider they actually request.
  async function ensureDefaultGroup(): Promise<Group> {
    const groups = await getGroups();
    const existing = groups.find((g) => g.id === DEFAULT_GROUP_ID);
    if (existing) {
      // Migrate stale default groups that were auto-populated with a
      // provider binding (pre-sentinel behavior). The default group must
      // stay routing-neutral; users wire routing by creating real groups
      // and assigning apps to them.
      if (existing.providerId || existing.credentialId) {
        existing.providerId = '';
        existing.credentialId = undefined;
        await setGroups(groups);
      }
      return existing;
    }
    const def: Group = {
      id: DEFAULT_GROUP_ID,
      name: 'Default',
      providerId: '',
      createdAt: Date.now(),
    };
    groups.unshift(def);
    await setGroups(groups);
    return def;
  }

  // Returns the group an origin currently belongs to. Auto-assigns to the
  // default group if no binding exists yet (and persists the assignment, so
  // the next call is a pure lookup).
  async function getGroupForOrigin(origin: string): Promise<Group | undefined> {
    const appGroups = await getAppGroups();
    let groupId = appGroups[origin];
    const groups = await getGroups();

    // No binding → assign to default
    if (!groupId) {
      const def = await ensureDefaultGroup();
      appGroups[origin] = def.id;
      await setAppGroups(appGroups);
      return def;
    }

    let group = groups.find((g) => g.id === groupId);
    // Stale binding (group was deleted) → fall back to default
    if (!group) {
      const def = await ensureDefaultGroup();
      appGroups[origin] = def.id;
      await setAppGroups(appGroups);
      return def;
    }
    return group;
  }

  async function createGroup(input: {
    name: string;
    providerId: string;
    credentialId?: string;
    model?: string;
  }): Promise<{ group?: Group; error?: string }> {
    const name = input.name?.trim();
    if (!name || name.length > 200) return { error: 'Group name must be 1-200 characters' };
    if (!PROVIDERS[input.providerId]) return { error: 'Invalid provider' };
    if (input.credentialId) {
      const creds = await getStoredCredentials();
      const cred = creds.find((c) => c.id === input.credentialId);
      if (!cred) return { error: 'Credential not found' };
      if (cred.providerId !== input.providerId) return { error: 'Credential does not match provider' };
    }
    const groups = await getGroups();
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      return { error: 'A group with this name already exists' };
    }
    const group: Group = {
      id: crypto.randomUUID(),
      name,
      providerId: input.providerId,
      credentialId: input.credentialId,
      model: input.model?.trim() || undefined,
      createdAt: Date.now(),
    };
    groups.push(group);
    await setGroups(groups);
    return { group };
  }

  async function updateGroup(
    id: string,
    patch: { name?: string; providerId?: string; credentialId?: string | null; model?: string | null },
  ): Promise<{ group?: Group; error?: string }> {
    const groups = await getGroups();
    const idx = groups.findIndex((g) => g.id === id);
    if (idx < 0) return { error: 'Group not found' };
    const current = groups[idx];

    const next: Group = { ...current };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name || name.length > 200) return { error: 'Group name must be 1-200 characters' };
      if (id !== DEFAULT_GROUP_ID && groups.some((g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) {
        return { error: 'A group with this name already exists' };
      }
      next.name = name;
    }
    if (patch.providerId !== undefined) {
      if (!PROVIDERS[patch.providerId]) return { error: 'Invalid provider' };
      next.providerId = patch.providerId;
      // Provider change invalidates the pin unless explicitly set in this patch
      if (patch.credentialId === undefined) next.credentialId = undefined;
    }
    if (patch.credentialId !== undefined) {
      if (patch.credentialId === null) {
        next.credentialId = undefined;
      } else {
        const creds = await getStoredCredentials();
        const cred = creds.find((c) => c.id === patch.credentialId);
        if (!cred) return { error: 'Credential not found' };
        if (cred.providerId !== next.providerId) return { error: 'Credential does not match provider' };
        next.credentialId = patch.credentialId;
      }
    }
    if (patch.model !== undefined) {
      next.model = patch.model === null ? undefined : (patch.model.trim() || undefined);
    }
    groups[idx] = next;
    await setGroups(groups);
    return { group: next };
  }

  async function deleteGroup(id: string): Promise<{ success?: boolean; error?: string }> {
    if (id === DEFAULT_GROUP_ID) return { error: 'Cannot delete the default group' };
    const groups = await getGroups();
    if (!groups.some((g) => g.id === id)) return { error: 'Group not found' };
    await setGroups(groups.filter((g) => g.id !== id));
    // Reassign any apps that pointed at this group back to the default
    const appGroups = await getAppGroups();
    let reassigned = false;
    for (const origin of Object.keys(appGroups)) {
      if (appGroups[origin] === id) {
        appGroups[origin] = DEFAULT_GROUP_ID;
        reassigned = true;
      }
    }
    if (reassigned) await setAppGroups(appGroups);
    return { success: true };
  }

  async function setAppGroup(origin: string, groupId: string): Promise<{ success?: boolean; error?: string }> {
    const groups = await getGroups();
    if (!groups.some((g) => g.id === groupId)) return { error: 'Group not found' };
    const appGroups = await getAppGroups();
    appGroups[origin] = groupId;
    await setAppGroups(appGroups);
    return { success: true };
  }

  // Wake the SW every minute to re-spawn the byoky-bridge native host if it
  // died with the SW (Hermes/OpenClaw need :19280 stable).
  const BRIDGE_KEEPALIVE_ALARM = 'byoky:bridge-keepalive';
  browser.alarms.create(BRIDGE_KEEPALIVE_ALARM, {
    periodInMinutes: 1,
    delayInMinutes: 0,
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BRIDGE_KEEPALIVE_ALARM) {
      lockIfIdle();
      maybeAutoStartBridgeProxy().catch(() => {});
    }
  });
});
