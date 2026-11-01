import {
  type Credential,
  type Session,
  type SessionProvider,
  type SessionTranslation,
  type SessionSwap,
  type RequestLogEntry,
  type PendingApproval,
  type ConnectRequest,
  type ConnectResponse,
  type ProviderRequirement,
  type ProxyRequest,
  type SerializedFormDataEntry,
  type Group,
  type ProviderId,
  type TranslationContext,
  type ModelFamily,
  DEFAULT_GROUP_ID,
  encrypt,
  credentialAad,
  verifyPassword,
  isLegacyPasswordHash,
  deriveWalletMacKey,
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
  translateErrorResponse,
  isTextContentType,
  TranslationError,
  resolveRoute,
  buildNoCredentialMessage,
} from '@byoky/core';
import type { Runtime } from 'wxt/browser';
import { exportVaultFile, importVaultFile } from '../lib/vault-file';
import { KEYLESS_PROVIDERS, openCredentialSecret, upgradeWallet } from '../lib/wallet-upgrade';
import { isProviderIdList, parseProviderRequirements } from '../lib/connect-request';
import { MAX_BINARY_CHUNK_BYTES, bytesToBase64 } from '../lib/binary-body';
import {
  REVOKED_ORIGINS_KEY,
  TRUST_RESET_NOTICE_KEY,
  TRUST_STATE_KEYS,
  droppedTrustState,
  emptyTrustState,
  readTrustState,
  signTrustState,
  silentTrustFor,
  type TrustState,
} from '../lib/trust-state';
import {
  ROUTING_STATE_KEYS,
  USAGE_STATE_KEYS,
  addUsageTotals,
  adoptLegacyRoutingState,
  defaultGroup,
  hasSignedRoutingState,
  isEmptyWallet,
  parseAllowance,
  readRoutingState,
  readUsageState,
  salvageUsage,
  signRoutingState,
  signUsageState,
  toTokenCount,
  withHold,
  withUsage,
  type RoutingState,
  type UsageTotals,
} from '../lib/routing-state';

declare const chrome: {
  sidePanel?: {
    setPanelBehavior(opts: { openPanelOnActionClick: boolean }): void;
    open(opts: { tabId: number }): Promise<void>;
  };
  action?: {
    /** Chrome 127+. */
    openPopup?(): Promise<void>;
  };
  runtime?: {
    /** Chrome 116+. */
    getContexts?(filter: { contextTypes?: string[] }): Promise<Array<{ contextType: string; documentUrl?: string }>>;
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
      browser.action.setBadgeBackgroundColor({ color: '#7C3AED' });
    } catch {
      // Fallback for older APIs
    }
  }

  type ConnectMessage = { id: string; payload: ConnectRequest };
  type PendingEntry = {
    approval: PendingApproval;
    originalMessageId: string;
    resolve: (response: unknown) => void;
    tabId?: number;
    /**
     * Later connects from the same origin, waiting for this one's outcome.
     * Once it is approved they run again (and mostly reuse the session);
     * if it is rejected or times out, so are they.
     */
    waiters: Array<{ message: ConnectMessage; sender: Runtime.MessageSender; resolve: (response: unknown) => void }>;
    /**
     * Set once the request is left for the user (not trusted, or the wallet
     * is locked) and the wallet was shown for it. Until then it is still
     * being checked against the trusted sites, and may be approved without
     * a prompt.
     */
    askedUser?: boolean;
  };
  const _pendingMap = new Map<string, PendingEntry>();
  // Every change to the queue is broadcast, so an open popup or side panel
  // never shows (and lets the user approve) a request that is gone.
  const pendingApprovals = {
    get size() { return _pendingMap.size; },
    get(id: string) { return _pendingMap.get(id); },
    set(id: string, entry: PendingEntry) { _pendingMap.set(id, entry); updateBadge(); notifyApprovalsChanged(); },
    delete(id: string) {
      const r = _pendingMap.delete(id);
      updateBadge();
      if (r) notifyApprovalsChanged();
      return r;
    },
    values() { return _pendingMap.values(); },
    [Symbol.iterator]() { return _pendingMap[Symbol.iterator](); },
  };
  // Approved entries, out of the queue while their session is created. A
  // connect from the same origin meanwhile waits on them rather than
  // queueing a second prompt (or being told it was rejected).
  const settlingApprovals = new Set<PendingEntry>();

  function notifyApprovalsChanged() {
    browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'approvalsChanged' }).catch(() => {});
  }
  let masterPassword: string | null = null;
  // The wallet MAC key, which signs the trust, routing and usage state, and
  // the one-time upgrade of a pre-1.1.2 wallet. Both hang off the master
  // password and are forgotten with it; see walletMacKey and
  // ensureWalletUpgraded.
  let walletMacKeyPromise: Promise<CryptoKey | null> | null = null;
  let walletUpgradePromise: Promise<CryptoKey | null> | null = null;
  let unlockFailures = 0;
  let unlockLockedUntil = 0;
  // The origins the trust state last read lets connect without a prompt,
  // with their allowed providers: for decisions that can't wait for a
  // verified read (openSidePanelInGesture). Cleared with the wallet key.
  // Kept in storage.session too and restored with the password, so a
  // restarted worker knows it as soon as it knows the wallet is unlocked
  // (re-reading the trust state would mean a PBKDF2 run on every wake).
  // It only decides whether to open the side panel in the page's gesture;
  // handleConnect still reads the verified state before trusting anyone.
  let silentTrustSnapshot = new Map<string, string[]>();
  // The highest trust-state epoch seen this browser session. A state older
  // than this was put back from a snapshot (see lib/trust-state.ts). Kept
  // in storage.session too, so a worker restart doesn't forget it.
  let trustEpochHighWater = 0;
  // The same for the routing and usage state (lib/routing-state.ts).
  const epochHighWater = { routing: 0, usage: 0 };
  type EpochKind = keyof typeof epochHighWater;
  const EPOCH_SESSION_KEYS: Record<EpochKind, string> = { routing: '_routingEpoch', usage: '_usageEpoch' };
  // Tokens counted while the wallet key was unavailable (a request that
  // finished after the wallet locked), until the next signed usage write
  // takes them in. Allowance checks count them meanwhile. Kept in
  // storage.session too.
  let pendingUsage: UsageTotals = {};

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

  /**
   * What a failed password check tells the popup: the lockout message once
   * locked out, when the lockout ends, and how many tries are left before
   * the next one.
   */
  function passwordFailureDetails(): { error?: string; lockedUntil?: number; attemptsLeft: number } {
    const error = passwordLockoutError();
    return error
      ? { error, lockedUntil: unlockLockedUntil, attemptsLeft: 0 }
      : { attemptsLeft: Math.max(0, 5 - unlockFailures) };
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
      const data = await browser.storage.session.get(['_mp', '_lastActivity', '_unlockFailures', '_unlockLockedUntil', '_trustEpoch', '_silentTrust']);
      if (typeof data._trustEpoch === 'number') trustEpochHighWater = Math.max(trustEpochHighWater, data._trustEpoch);
      if (typeof data._unlockFailures === 'number') unlockFailures = data._unlockFailures;
      if (typeof data._unlockLockedUntil === 'number') unlockLockedUntil = data._unlockLockedUntil;
      if (data._mp) {
        // A worker restart must not reset the idle clock: lock if the wallet
        // was idle long enough, else keep counting from the last activity.
        const last = typeof data._lastActivity === 'number' ? data._lastActivity : 0;
        if (Date.now() - last >= IDLE_TIMEOUT_MS) {
          await browser.storage.session.remove(['_mp', '_lastActivity', '_sessions', '_bridgeKey', '_bridgePort', '_silentTrust']);
          // An open side panel still shows the unlocked wallet; tell it.
          browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'sessionChanged' }).catch(() => {});
          return;
        }
        silentTrustSnapshot = restoredSilentTrust(data._silentTrust);
        masterPassword = data._mp as string;
        lastActivityAt = last;
        scheduleIdleLock();
      }
    } catch {}
  }

  /** The routing and usage epochs seen, and usage held while locked, after a worker restart. */
  async function restoreRoutingSession() {
    if (!hasSessionStorage) return;
    try {
      const data = await browser.storage.session.get(['_pendingUsage', ...Object.values(EPOCH_SESSION_KEYS)]);
      for (const kind of Object.keys(epochHighWater) as EpochKind[]) {
        const seen = data[EPOCH_SESSION_KEYS[kind]];
        if (typeof seen === 'number') epochHighWater[kind] = Math.max(epochHighWater[kind], seen);
      }
      // As far as it parses: one app's bad count costs no other app its usage.
      pendingUsage = addUsageTotals(salvageUsage(data._pendingUsage).totals, pendingUsage);
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
    forgetWalletKeys();
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
  const sessionRestored = Promise.all([restoreSession(), restoreRoutingSession()]).then(() => {});
  // Read synchronously where awaiting isn't an option (openSidePanelInGesture).
  let sessionsRestoredDone = false;
  const sessionsRestored = Promise.all([sessionRestored, restoreSessions()])
    // restoreSession drops the password when the wallet idled out while the
    // worker was stopped; the app sessions loaded alongside go with it.
    .then(() => { if (!masterPassword) sessions.clear(); sessionsRestoredDone = true; })
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
        const message = raw as Record<string, unknown>;
        const sender = port.sender as Runtime.MessageSender;
        // Before any await: Chrome opens the side panel only within the
        // page's user gesture, which ends at this listener's first await.
        const panelOpened = message.type === 'BYOKY_CONNECT_REQUEST'
          ? openSidePanelInGesture(message.payload, sender)
          : undefined;
        await sessionsRestored;
        let response: unknown;

        if (message.type === 'BYOKY_CONNECT_REQUEST') {
          response = await handleConnect(message as { id: string; payload: ConnectRequest }, sender, panelOpened);
        } else if (message.type === 'BYOKY_DISCONNECT') {
          const { sessionKey } = message.payload as { sessionKey: string };
          const session = sessions.get(sessionKey);
          if (session) {
            const disconnectOrigin = resolveOrigin(sender);
            if (disconnectOrigin !== 'unknown' && disconnectOrigin === session.appOrigin) {
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
          error: { code: 'ORIGIN_MISMATCH', message: 'Origin mismatch — request rejected' },
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
      // The key goes out with the headers of effectiveProviderId, so it has
      // to be that provider's (see resolveSessionProviders).
      if (credential.providerId !== effectiveProviderId) {
        send({
          type: 'BYOKY_PROXY_RESPONSE_ERROR',
          requestId: msg.requestId,
          status: 403,
          error: { code: 'PROVIDER_UNAVAILABLE', message: `The key this app is routed to is not a ${effectiveProviderId} key` },
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
        // rewriteProxyUrl below.)
        if (!sourceUrlAllowed(msg.providerId, msg.url, !!(translation || swap), credential.baseUrl)) {
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
          // Cancelled already: nothing sent, nothing charged.
          if (upstreamAbort.signal.aborted) return;
          await proxyViaBridge(
            port,
            { ...msg, body, url: translatedUrl, providerId: effectiveProviderId },
            realHeaders,
            session,
            msg,
            upstreamAbort.signal,
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

        // Cancelled while the key was being decrypted (or earlier): nothing
        // went upstream, so nothing is charged; finally only releases the hold.
        if (upstreamAbort.signal.aborted) return;
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

        // A binary reply (audio, images) goes to the app as base64: decoded
        // as text, every byte that isn't valid UTF-8 would be lost. Only
        // text is kept for usage accounting.
        const binaryResponse = !translation && !isTextContentType(responseContentType);
        const chunks: string[] = [];
        responseChunks = chunks;
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (binaryResponse) {
              send({
                type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                requestId: msg.requestId,
                chunk: bytesToBase64(value),
                chunkEncoding: 'base64',
              });
              continue;
            }
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
            const translatedResponse = responseStatus >= 200 && responseStatus < 300
              ? applyResponseTranslation(translation, msg.body, msg.requestId, chunks.join(''), msg.url)
              : translateErrorBody(translation, msg.body, msg.requestId, chunks.join(''), msg.url);
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
    // Approved but without a usable key: reported as unavailable.
    for (const id of session.requestedProviders) {
      providerMap[id] = { available: false, authMethod: 'api_key' };
    }
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

  /**
   * `panelOpened` is the side panel the port listener tried to open inside
   * the page's gesture (Chrome), if it did; the wallet is shown some other
   * way when that didn't work.
   */
  async function handleConnect(
    message: { id: string; payload: ConnectRequest },
    sender: Runtime.MessageSender,
    panelOpened?: Promise<boolean>,
  ): Promise<unknown> {
    const origin = resolveOrigin(sender);
    const refuse = (code: string, text: string) => ({
      type: 'BYOKY_ERROR',
      requestId: message.id,
      payload: { code, message: text },
    });

    // A sandboxed frame (or a page without an origin) has nothing to show
    // the user, bind a session to or trust.
    if (origin === 'unknown') {
      return refuse('ORIGIN_UNSUPPORTED', 'Byoky cannot connect from a sandboxed frame or a page without an origin');
    }

    // Any page can send this. Check it before it is queued for the popup to
    // render, or signed into the trust state once approved.
    const raw = message.payload as unknown;
    const providers = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? parseProviderRequirements((raw as ConnectRequest).providers)
      : null;
    if (!providers) return refuse('INVALID_REQUEST', 'Invalid connect request');
    const request: ConnectRequest = { providers, reconnectOnly: (raw as ConnectRequest).reconnectOnly === true };

    // Cheap path: reuse an active session for this origin when it covers
    // what the app asks for now. Don't gate on the rate limit — every page
    // load calls connect(), and reusing the same approval shouldn't burn
    // budget. A silent reconnect probe takes the session as it is.
    const existing = findActiveSession(origin);
    if (existing && (request.reconnectOnly || sessionCovers(existing, providers))) {
      return buildSessionResponse(existing, message.id);
    }

    // Silent reconnect probe with no session is also cheap — answer NO_SESSION
    // without consuming the rate-limit budget.
    if (request.reconnectOnly) {
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

    // A request from this origin is already waiting for the user (or being
    // approved right now): wait for its outcome.
    const inFlight = pendingFor(origin);
    if (inFlight) {
      // The wallet is shown again (it may have been closed since) only for
      // a request the user is being asked about. One still checked against
      // the trusted sites shows it if it comes to asking, and one being
      // approved needs nothing.
      if (inFlight.askedUser && !settlingApprovals.has(inFlight)) openWalletUI(sender.tab?.id, panelOpened);
      return new Promise((resolve) => {
        inFlight.waiters.push({ message: { id: message.id, payload: request }, sender, resolve });
      });
    }

    // An app with a session that now asks for more providers is asked about
    // all of them; approving widens its session (createSession).
    const requested = existing ? withProviders(existing.requestedProviders, providers) : providers;

    // Queue for user approval (whether locked or unlocked)
    const approval: PendingApproval = {
      id: crypto.randomUUID(),
      appOrigin: origin,
      providers: requested,
      timestamp: Date.now(),
    };

    return new Promise((resolve) => {
      const queued: PendingEntry = {
        approval,
        originalMessageId: message.id,
        resolve,
        tabId: sender.tab?.id,
        waiters: [],
      };
      pendingApprovals.set(approval.id, queued);

      // The wallet is shown only for a request that waits for the user, not
      // for one a trusted site gets approved without a prompt.
      const askUser = () => {
        queued.askedUser = true;
        openWalletUI(sender.tab?.id, panelOpened);
        browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'newPendingApproval' }).catch(() => {});
      };

      // If already unlocked, check trusted sites and either auto-approve or notify for approval
      if (masterPassword) {
        getTrustState().catch(() => emptyTrustState()).then((trust) => {
          const entry = pendingApprovals.get(approval.id);
          if (!entry) return;
          const trustedSite = silentTrustFor(trust, origin);
          if (trustedSite) {
            // Scope to the providers the user originally approved for this trusted site
            const scopedProviders = scopeProvidersForTrust(
              requested,
              trustedSite.allowedProviders ?? [],
            );
            if (scopedProviders) {
              pendingApprovals.delete(approval.id);
              void settleApproval(entry, scopedProviders);
              return;
            }
            // Requested providers outside trust scope — fall through to manual approval
          }
          askUser();
        });
      } else {
        // Locked: it waits for the unlock (processPendingAfterUnlock), and an
        // open popup can already say that a request is waiting.
        askUser();
      }

      // Auto-reject after 2 minutes
      setTimeout(() => {
        const entry = pendingApprovals.get(approval.id);
        if (entry) {
          pendingApprovals.delete(approval.id);
          rejectPending(entry, 'Connection request timed out');
        }
      }, 120_000);
    });
  }

  /** Whether `session` already has every provider in `providers` approved. */
  function sessionCovers(session: Session, providers: ProviderRequirement[]): boolean {
    return providers.every((p) => session.requestedProviders.includes(p.id));
  }

  /** `ids` (already approved) plus `providers`, as one provider list. */
  function withProviders(ids: string[], providers: ProviderRequirement[]): ProviderRequirement[] {
    const byId = new Map<string, ProviderRequirement>(ids.map((id) => [id, { id, required: false }]));
    for (const p of providers) byId.set(p.id, p);
    return [...byId.values()];
  }

  /** The queued or settling request of `origin`, if any. */
  function pendingFor(origin: string): PendingEntry | undefined {
    for (const entry of pendingApprovals.values()) {
      if (entry.approval.appOrigin === origin) return entry;
    }
    for (const entry of settlingApprovals) {
      if (entry.approval.appOrigin === origin) return entry;
    }
    return undefined;
  }

  /**
   * Create (or widen) the session for an approved entry, already taken out
   * of the queue, and answer it and its waiters. `before` runs first, still
   * counted as settling (approving clears a revocation, trusts the site).
   * Call it right after the entry leaves the queue, before any await, so no
   * connect slips in between.
   */
  async function settleApproval(
    entry: PendingEntry,
    providers: ProviderRequirement[],
    before?: () => Promise<void>,
  ): Promise<void> {
    settlingApprovals.add(entry);
    let session: Session;
    try {
      await before?.();
      session = await createSession(entry.approval.appOrigin, providers);
    } catch {
      settlingApprovals.delete(entry);
      rejectPending(entry, 'Could not create the session', 'UNKNOWN');
      return;
    }
    settlingApprovals.delete(entry);
    entry.resolve(buildSessionResponse(session, entry.originalMessageId));
    // Each waiter runs again: one the session covers reuses it at once, one
    // asking for more providers is queued for those.
    for (const w of entry.waiters) {
      handleConnect(w.message, w.sender).then(w.resolve, () => {
        w.resolve({ type: 'BYOKY_ERROR', requestId: w.message.id, payload: { code: 'UNKNOWN', message: 'Could not connect' } });
      });
    }
  }

  /** Answer an entry (out of the queue) and its waiters with a refusal. */
  function rejectPending(entry: PendingEntry, message: string, code = 'USER_REJECTED') {
    const refusal = (requestId: string) => ({ type: 'BYOKY_ERROR', requestId, payload: { code, message } });
    entry.resolve(refusal(entry.originalMessageId));
    for (const w of entry.waiters) w.resolve(refusal(w.message.id));
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

  /**
   * The session's providers for `providerIds`, routed by the app's group.
   * The one routing rule for new and refreshed sessions: core resolveRoute
   * (cross-family translation, same-family swap, the group's credential pin
   * and model, a direct key, auto translation), as on iOS and Android.
   *
   * The credential must belong to the provider the request is sent to. A
   * group pin can't point at another provider's key through the popup, so a
   * mismatch means edited storage; the provider is then unavailable rather
   * than that key being sent with the other provider's headers.
   */
  function resolveSessionProviders(
    providerIds: string[],
    credentials: Credential[],
    group: Group | undefined,
  ): { providers: SessionProvider[]; providerMap: ConnectResponse['providers'] } {
    const providers: SessionProvider[] = [];
    const providerMap: ConnectResponse['providers'] = {};
    for (const providerId of new Set(providerIds)) {
      let route = resolveRoute(providerId, group, credentials);
      const destination = route?.translation?.dstProviderId ?? route?.swap?.dstProviderId ?? providerId;
      if (route && route.credential.providerId !== destination) route = null;
      providerMap[providerId] = {
        available: !!route,
        authMethod: route?.credential.authMethod ?? 'api_key',
      };
      if (!route) continue;
      const sp: SessionProvider = {
        providerId,
        credentialId: route.credential.id,
        available: true,
        authMethod: route.credential.authMethod,
      };
      if (route.translation) sp.translation = route.translation;
      else if (route.swap) sp.swap = route.swap;
      else if (route.modelOverride) sp.modelOverride = route.modelOverride;
      providers.push(sp);
    }
    return { providers, providerMap };
  }

  /**
   * The session for an approved request of `origin`. An app that already
   * has one (and asked for more providers) gets it widened, keeping its
   * session key; otherwise a new one is made. No providers means every
   * provider the wallet holds a key for.
   */
  async function createSession(origin: string, providers: ProviderRequirement[]): Promise<Session> {
    if (origin === 'unknown') throw new Error('No session for an opaque origin');
    const credentials = await getStoredCredentials();

    // No provider list means every provider the wallet holds a key for,
    // routed exactly like an explicit list of them.
    let providerIds = [...new Set(
      providers.length
        ? providers.map((p) => p.id)
        : credentials.map((c) => c.providerId),
    )];

    // Resolve the group this app belongs to (auto-assigns to default if first contact)
    const group = await getGroupForOrigin(origin);

    const existing = findActiveSession(origin);
    if (existing) {
      providerIds = [...new Set([...existing.requestedProviders, ...providerIds])];
      if (providerIds.length === existing.requestedProviders.length) return existing;
    }
    const { providers: sessionProviders, providerMap } = resolveSessionProviders(providerIds, credentials, group);

    if (existing) {
      existing.requestedProviders = providerIds;
      existing.providers = sessionProviders;
      persistSessions();
      browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'sessionChanged' }).catch(() => {});
      // Other frames of the app hold the same session key.
      notifyProvidersUpdated(existing, providerMap);
      return existing;
    }

    const session: Session = {
      id: crypto.randomUUID(),
      sessionKey: `byk_${crypto.randomUUID().replace(/-/g, '')}`,
      appOrigin: origin,
      providers: sessionProviders,
      // What the user approved. An "all providers" request is pinned to the
      // providers the wallet had keys for, so keys added later aren't handed
      // to this session without a new approval.
      requestedProviders: providerIds,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    sessions.set(session.sessionKey, session);
    persistSessions();
    // Trusted-site approvals create sessions without the popup's help; an
    // open popup or side panel lists them only if told.
    browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'sessionChanged' }).catch(() => {});
    return session;
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
        if (lockout) return { success: false, error: lockout, lockedUntil: unlockLockedUntil, attemptsLeft: 0 };
        const { password } = message.payload as { password: string };
        const data = await browser.storage.local.get('passwordHash');
        if (!data.passwordHash) return { success: false };
        const storedHash = data.passwordHash as string;
        // A format-2 hash yields the wallet MAC key from the same PBKDF2 run
        // that checks the password. A format-1 hash is a wallet from before
        // 1.1.2, which the upgrade started below converts.
        const legacyHash = isLegacyPasswordHash(storedHash);
        const macKey = legacyHash ? null : await deriveWalletMacKey(password, storedHash);
        const valid = legacyHash ? await verifyPassword(password, storedHash) : macKey !== null;
        if (valid) {
          masterPassword = password;
          forgetWalletKeys();
          if (macKey) walletMacKey(macKey);
          clearPasswordFailures();
          lastActivityPersistedAt = 0;
          persistSession();
          resetIdleTimer();
          ensureWalletUpgraded().catch(() => {});
          // Count what finished while the wallet was locked.
          if (Object.keys(pendingUsage).length > 0) commitPendingUsage().catch(() => {});
          processPendingAfterUnlock();
          return { success: true };
        }
        // The failure that starts a lockout says so, not only the next try.
        recordPasswordFailure();
        return { success: false, ...passwordFailureDetails() };
      }

      // The popup is in use: that is activity too (approved app and bridge
      // traffic is the rest). Extension pages only, like every action not
      // in ALLOWED_CONTENT_ACTIONS.
      case 'userActivity':
        if (masterPassword) resetIdleTimer();
        return { success: true };

      case 'lock':
        masterPassword = null;
        forgetWalletKeys();
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
        // Only a local server may run without a key.
        if (!cleanValue && !(cAuth === 'api_key' && KEYLESS_PROVIDERS.has(cpId))) {
          return { error: cAuth === 'api_key' ? 'Enter an API key' : 'Enter a token' };
        }
        const newCred: Record<string, unknown> = {
          id: crypto.randomUUID(),
          providerId: cpId,
          label: cLabel,
          authMethod: cAuth,
          createdAt: Date.now(),
        };
        if (storedBaseUrl) newCred.baseUrl = storedBaseUrl;
        const secretField = cAuth === 'api_key' ? 'encryptedKey' : 'encryptedAccessToken';
        // A key is bound to this record (id, provider, base URL), so it can't
        // be moved into another one. A local server's empty key is encrypted
        // and bound too: a record with no secret at all takes no password to
        // plant (see openCredentialSecret).
        newCred[secretField] = await encrypt(cleanValue, masterPassword, credentialAad({ id: newCred.id as string, providerId: cpId, baseUrl: storedBaseUrl }, secretField));
        // Credential writes are serialized with the wallet upgrade's.
        await serializedStorage(async () => {
          const data = await browser.storage.local.get('credentials');
          const creds = (data.credentials ?? []) as Array<Record<string, unknown>>;
          creds.push(newCred);
          await browser.storage.local.set({ credentials: creds });
        });

        refreshSessionProviders();
        return { success: true };
      }

      case 'renameCredential': {
        const { id: rnId, label: rnLabel } = message.payload as { id: string; label: string };
        const newLabel = rnLabel.trim();
        if (!newLabel) return { error: 'Label cannot be empty' };
        return serializedStorage(async () => {
          const rnData = await browser.storage.local.get('credentials');
          const rnCreds = (rnData.credentials ?? []) as Array<Record<string, unknown>>;
          const rnIdx = rnCreds.findIndex((c) => c.id === rnId);
          if (rnIdx < 0) return { error: 'Credential not found' };
          rnCreds[rnIdx] = { ...rnCreds[rnIdx], label: newLabel };
          await browser.storage.local.set({ credentials: rnCreds });
          return { success: true };
        });
      }

      case 'removeCredential': {
        const { id: rmId } = message.payload as { id: string };
        await serializedStorage(async () => {
          const rmData = await browser.storage.local.get('credentials');
          const rmCreds = (rmData.credentials ?? []) as Array<{ id: string }>;
          await browser.storage.local.set({
            credentials: rmCreds.filter((c) => c.id !== rmId),
          });
        });
        // Clear any group pin pointing at the removed credential. (Locked,
        // it stays: a pin to a missing key routes nowhere.)
        await changeRoutingState((routing) => (
          routing.groups.some((g) => g.credentialId === rmId)
            ? { routing: { ...routing, groups: routing.groups.map((g) => (g.credentialId === rmId ? withoutPin(g) : g)) }, result: undefined }
            : { result: undefined }
        ));
        refreshSessionProviders();
        return { success: true };
      }

      case 'setupWallet': {
        const existing = await browser.storage.local.get('passwordHash');
        if (existing.passwordHash) {
          return { error: 'Wallet already initialized' };
        }
        const { passwordHash: setupHash } = message.payload as { passwordHash: string };
        forgetWalletKeys();
        forgetEpochs();
        await browser.storage.local.set({ passwordHash: setupHash, credentials: [] });
        // Other open views leave their setup screen.
        browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'sessionChanged' }).catch(() => {});
        return { success: true };
      }

      case 'resetWallet': {
        masterPassword = null;
        forgetWalletKeys();
        sessions.clear();
        clearPersistedSessions();
        authorizedBridgeSessionKey = null;
        authorizedBridgePort = null;
        persistAuthorizedBridgeSessionKey();
        clearSessionStorage();
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        clearPasswordFailures();
        forgetEpochs();
        // After any in-flight upgrade write, which then finds the wallet gone.
        await serializedStorage(() => browser.storage.local.clear());
        browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'sessionChanged' }).catch(() => {});
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
            // Recorded before the app hears of it, so its reconnect is already
            // held for approval.
            await recordRevocation(s.appOrigin);
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
        if (!bridgeSession || !sender || resolveOrigin(sender) === 'unknown' || resolveOrigin(sender) !== bridgeSession.appOrigin) {
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
        // Approvals wait out a locked wallet; trusting a site needs the key.
        if (!masterPassword) return { success: false, error: 'Wallet is locked' };
        const pending = pendingApprovals.get(approvalId);
        if (!pending) return { success: false, error: 'Approval not found' };

        pendingApprovals.delete(approvalId);
        await settleApproval(pending, pending.approval.providers, async () => {
          // Resolve which providers are being approved
          const approvedProviderIds = [...new Set(pending.approval.providers.length > 0
            ? pending.approval.providers.map((p) => p.id)
            : (await getStoredCredentials()).map((c) => c.providerId))];

          // Approving clears a revocation. If the trust state can't be signed
          // (the wallet upgrade failed), the connection still goes ahead; the
          // site just asks again next time.
          await clearRevocation(pending.approval.appOrigin).catch(() => {});
          if (trust) {
            await addTrustedSite(pending.approval.appOrigin, approvedProviderIds).catch(() => {});
          }
        });
        return { success: true };
      }

      case 'rejectConnect': {
        const { approvalId } = message.payload as { approvalId: string };
        const pending = pendingApprovals.get(approvalId);
        if (!pending) return { success: false, error: 'Approval not found' };

        pendingApprovals.delete(approvalId);
        rejectPending(pending, 'User rejected the connection request');
        return { success: true };
      }

      case 'getTrustedSites': {
        // Read after the check, which is what may have raised the flag.
        const sites = (await getTrustState()).sites;
        const flag = await browser.storage.local.get(TRUST_RESET_NOTICE_KEY);
        return { sites, trustReset: flag[TRUST_RESET_NOTICE_KEY] === true };
      }

      case 'dismissTrustResetNotice':
        await browser.storage.local.remove(TRUST_RESET_NOTICE_KEY);
        return { success: true };

      case 'removeTrustedSite': {
        // The list is re-signed, which needs the unlocked wallet.
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { origin } = message.payload as { origin: string };
        await removeTrustedSite(origin);
        return { success: true };
      }

      case 'addTrustedSite': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { origin, allowedProviders } = message.payload as { origin: unknown; allowedProviders: unknown };
        if (typeof origin !== 'string' || origin === 'unknown' || !isProviderIdList(allowedProviders)) {
          return { error: 'Invalid trusted site' };
        }
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
        // A lockout reply carries lockedUntil, so the export form counts down.
        const exportLockout = passwordLockoutError();
        if (exportLockout) return { error: exportLockout, lockedUntil: unlockLockedUntil };
        const stored = await browser.storage.local.get('passwordHash');
        if (!stored.passwordHash || !(await verifyPassword(currentPassword, stored.passwordHash as string))) {
          recordPasswordFailure();
          const lockout = passwordLockoutError();
          return lockout ? { error: lockout, lockedUntil: unlockLockedUntil } : { error: 'Incorrect wallet password' };
        }
        clearPasswordFailures();
        // Stored secrets are read bound to their record (lib/wallet-upgrade.ts).
        if (!(await walletUpgraded())) return { error: WALLET_UPGRADE_FAILED };
        const encryptedVault = await exportVaultFile(await getStoredCredentials(), masterPassword, exportPassword);
        return { encryptedVault };
      }

      case 'importVault': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { encryptedVault: impVault, importPassword: impPw } = message.payload as {
          encryptedVault: string; importPassword: string;
        };
        if (!(await walletUpgraded())) return { error: WALLET_UPGRADE_FAILED };
        // Merge, never replace: existing credentials (and the group pins that
        // reference them) stay untouched; duplicates of them are skipped.
        const result = await importVaultFile(impVault, impPw, await getStoredCredentials(), masterPassword);
        if (!result.ok) return { error: result.error };
        if (result.added.length > 0) {
          await serializedStorage(async () => {
            const latest = await getStoredCredentials();
            await browser.storage.local.set({ credentials: [...latest, ...result.added] });
          });
          refreshSessionProviders();
        }
        return { success: true, count: result.added.length, skipped: result.skipped, rejected: result.rejected };
      }

      case 'getAllowances': {
        // The usage totals are what allowances are enforced against.
        // limitsHold: apps are paused until the user resumes them, after a
        // part of this state failed its integrity check.
        const state = await readWalletState();
        if (!state) return { allowances: [], usage: {}, limitsHold: null };
        return {
          allowances: state.routing.allowances,
          usage: addUsageTotals(state.usage, pendingUsage),
          limitsHold: state.routing.hold ?? null,
        };
      }

      case 'resetAppUsage': {
        const { origin } = message.payload as { origin: string };
        return resetAppUsage(origin);
      }

      case 'setAllowance': {
        const { allowance } = message.payload as { allowance: unknown };
        return setAllowance(allowance);
      }

      case 'removeAllowance': {
        const { origin } = message.payload as { origin: string };
        return removeAllowance(origin);
      }

      case 'resumeApps':
        // The user checked limits and usage after an integrity reset.
        return resumeApps();

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
        const routing = await changeRoutingState((current) => {
          const next = withDefaultGroup(current);
          return { ...(next !== current ? { routing: next } : {}), result: next };
        });
        return routing ? { groups: routing.result.groups, appGroups: routing.result.appGroups } : { groups: [], appGroups: {} };
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

  /**
   * `signal` aborts when the app cancels (its port closed). Until the
   * request has gone to the bridge, a cancel just stops it; after that the
   * bridge is shut down, which ends its upstream call, and the request is
   * charged as cancelled.
   */
  async function proxyViaBridge(
    responsePort: Runtime.Port,
    msg: ProxyRequest,
    headers: Record<string, string>,
    session: Session,
    appRequest: ProxyRequest,
    signal: AbortSignal,
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

    // The probe starts a native host and waits up to 2 s for it.
    const available = await checkBridgeAvailable();
    if (signal.aborted) return;
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
      // Closing the native port ends the bridge process and its upstream fetch.
      const onAbort = () => {
        appConnected = false;
        if (!finished) appCancelled = true;
        finish();
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        try { nativePort.disconnect(); } catch { /* already gone */ }
        resolve();
      };

      nativePort.onMessage.addListener((raw: unknown) => {
        const response = raw as { type: string; requestId: string; status?: number; headers?: Record<string, string>; chunk?: string; chunkEncoding?: string; error?: string };
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
          // The bridge sends a binary body as base64 (F025): passed on as
          // such, and not counted as text.
          const binary = response.chunkEncoding === 'base64';
          if (binary && !translationCtx) {
            send({ type: 'BYOKY_PROXY_RESPONSE_CHUNK', requestId: msg.requestId, chunk: response.chunk, chunkEncoding: 'base64' });
            return;
          }
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
                const translated = (status >= 200 && status < 300 ? applyResponseTranslation : translateErrorBody)(
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

      // The host died. Before the response ended, the app must hear of it:
      // after the headers its body would otherwise never end.
      nativePort.onDisconnect.addListener(() => {
        if (!finished) {
          send({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 502,
            error: {
              code: 'BRIDGE_ERROR',
              message: bridgeResponded ? 'Bridge disconnected mid-response' : 'Bridge disconnected unexpectedly',
            },
          });
        }
        finish();
      });

      // Cancelled while connecting: nothing has gone to the bridge yet.
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
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
      // request with `bodyChunked`. `proxy_http_cancel` means the client
      // hung up: abort that request's upstream fetch.
      const pendingBodies = new Map<string, string[]>();
      const inFlight = new Map<string, AbortController>();
      nativePort.onMessage.addListener(async (raw: unknown) => {
        const msg = raw as Record<string, unknown>;
        if (msg.type === 'proxy_http_body_chunk') {
          if (typeof msg.requestId !== 'string' || typeof msg.chunk !== 'string') return;
          const parts = pendingBodies.get(msg.requestId) ?? [];
          parts.push(msg.chunk);
          pendingBodies.set(msg.requestId, parts);
        } else if (msg.type === 'proxy_http_cancel') {
          if (typeof msg.requestId === 'string') inFlight.get(msg.requestId)?.abort();
        } else if (msg.type === 'proxy_http') {
          if (typeof msg.requestId !== 'string') return;
          const requestId = msg.requestId;
          if (msg.bodyChunked === true) {
            msg.body = (pendingBodies.get(requestId) ?? []).join('');
            pendingBodies.delete(requestId);
          }
          const controller = new AbortController();
          inFlight.set(requestId, controller);
          try {
            await handleBridgeProxyRequest(msg, controller.signal);
          } finally {
            inFlight.delete(requestId);
          }
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

  /** `signal` aborts when the bridge reports that the client hung up. */
  async function handleBridgeProxyRequest(msg: Record<string, unknown>, signal: AbortSignal): Promise<void> {
    if (typeof msg.requestId !== 'string' || typeof msg.sessionKey !== 'string' ||
        typeof msg.providerId !== 'string' || typeof msg.url !== 'string' ||
        typeof msg.method !== 'string' || typeof msg.headers !== 'object' || !msg.headers ||
        (msg.body !== undefined && typeof msg.body !== 'string') ||
        (msg.bodyEncoding !== undefined && msg.bodyEncoding !== 'base64')) {
      return;
    }
    const requestId = msg.requestId;
    const sessionKey = msg.sessionKey;
    const providerId = msg.providerId;
    let url = msg.url;
    const method = msg.method;
    const headers = msg.headers as Record<string, string>;
    const body = msg.body as string | undefined;
    // A body that isn't UTF-8 text (an audio upload) arrives as base64 (F025).
    const bodyEncoding = msg.bodyEncoding as 'base64' | undefined;
    // The bridge can take a binary response as base64 chunks.
    const acceptsBinaryChunks = msg.acceptsBinaryChunks === true;

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

    // The session ran out (24 h) or is gone: a 401 the bridge tells apart
    // from a transient failure (it would otherwise answer a retryable 502),
    // so CLI tools stop and the user reconnects with `byoky-bridge connect`.
    const session = sessions.get(sessionKey);
    if (!session || session.expiresAt < Date.now()) {
      if (session) {
        sessions.delete(sessionKey);
        persistSessions();
      }
      authorizedBridgeSessionKey = null;
      authorizedBridgePort = null;
      persistAuthorizedBridgeSessionKey();
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        status: 401,
        code: 'bridge_session_expired',
        error: 'Bridge session expired',
      });
      return;
    }
    if (!masterPassword) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        status: 423,
        code: 'WALLET_LOCKED',
        error: 'Wallet is locked',
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
    // The key goes out with effectiveProviderId's headers (as on the page path).
    if (credential.providerId !== effectiveProviderId) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        error: `The key this app is routed to is not a ${effectiveProviderId} key`,
      });
      return;
    }

    // Revalidate for requiresCustomBaseUrl providers now that we have the
    // credential's baseUrl. Direct, a request to the registry's placeholder
    // host goes to the credential's host instead; routed, rewriteProxyUrl
    // below builds the destination URL and this one only names the endpoint.
    if (providerCfg?.requiresCustomBaseUrl) {
      const routed = !!(translation || swap);
      if (!routed) url = rebaseOntoCredential(providerId, url, credential.baseUrl) ?? url;
      if (!sourceUrlAllowed(providerId, url, routed, credential.baseUrl)) {
        bridgeProxyPort?.postMessage({
          type: 'proxy_http_error',
          requestId,
          error: 'Request URL does not match the credential\'s registered base URL',
        });
        return;
      }
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

    // Routing rewrites a JSON body; a binary one can't be.
    if (bodyEncoding && (translation || swap)) {
      bridgeProxyPort?.postMessage({
        type: 'proxy_http_error',
        requestId,
        status: 400,
        code: 'ROUTING_UNSUPPORTED',
        error: `This app is routed to ${effectiveProviderId}, and a binary request body can't be routed to another provider`,
      });
      return;
    }

    // The app's request as the log and allowance helpers expect it (which
    // leave an encoded body uncounted and unparsed).
    const appRequest = { providerId, url, method, body, bodyEncoding } as ProxyRequest;

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
      } else if (sessionProvider?.modelOverride && body && !bodyEncoding) {
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
        // The setup-token request is rewritten as JSON (tool names, system prompt).
        if (bodyEncoding) {
          bridgeProxyPort.postMessage({
            type: 'proxy_http_error',
            requestId,
            status: 400,
            error: 'A Claude setup token can only be used with a JSON request body',
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
        // The client already hung up: don't start a call nobody will read.
        // (Once it runs, the bridge aborts it on hang-up by itself.)
        if (signal.aborted) {
          reservation.release();
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

      const bridgeBody = bodyEncoding
        ? reconstructBody(translatedBody, bodyEncoding).body
        : injectStreamUsageOptions(effectiveProviderId, translatedBody);
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
        // redirect: 'error' — see the extension-port proxy path. `signal`
        // stops the upstream call when the client hangs up; the finally
        // below still charges what it used.
        const response = await fetch(translatedUrl, {
          method,
          headers: realHeaders,
          body: bridgeBody || undefined,
          redirect: 'error',
          signal,
        });
        responseStatus = response.status;

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        responseContentType = responseHeaders['content-type'] ?? '';

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
        // A binary reply goes to a bridge that takes it as base64 slices
        // (as on the page path); an older bridge gets text, as before.
        const binaryResponse = acceptsBinaryChunks && !translation && !isTextContentType(responseContentType);

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (binaryResponse) {
              for (let i = 0; i < value.length; i += MAX_BINARY_CHUNK_BYTES) {
                bridgeProxyPort?.postMessage({
                  type: 'proxy_http_response_chunk',
                  requestId,
                  chunk: bytesToBase64(value.subarray(i, i + MAX_BINARY_CHUNK_BYTES)),
                  chunkEncoding: 'base64',
                });
              }
              continue;
            }
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
            const translatedResponse = responseStatus >= 200 && responseStatus < 300
              ? applyResponseTranslation(translation, body, requestId, chunks.join(''), url)
              : translateErrorBody(translation, body, requestId, chunks.join(''), url);
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

  /**
   * Chrome: open the side panel for a connect request, synchronously in the
   * port listener, where the page's user gesture still counts. Skipped for
   * a silent reconnect, and for an app whose session already covers the
   * request (known once the sessions are restored). Resolves to whether
   * the panel opened; undefined when it wasn't tried.
   */
  function openSidePanelInGesture(payload: unknown, sender: Runtime.MessageSender): Promise<boolean> | undefined {
    const tabId = sender.tab?.id;
    if (typeof chrome === 'undefined' || !chrome.sidePanel || !tabId) return undefined;
    const request = payload && typeof payload === 'object' ? payload as ConnectRequest : undefined;
    if (!request || request.reconnectOnly === true) return undefined;
    const origin = resolveOrigin(sender);
    if (origin === 'unknown') return undefined;
    const providers = parseProviderRequirements(request.providers);
    if (sessionsRestoredDone) {
      const existing = findActiveSession(origin);
      if (existing && providers && sessionCovers(existing, providers)) return undefined;
    }
    // A trusted site connects without a prompt (as far as the last verified
    // read knows; handleConnect checks again and shows the wallet if not).
    const allowed = masterPassword ? silentTrustSnapshot.get(origin) : undefined;
    if (allowed && providers && scopeProvidersForTrust(providers, allowed)) return undefined;
    return chrome.sidePanel.open({ tabId }).then(() => true, () => false);
  }

  /**
   * Show the wallet for a request that needs the user. Chrome: the side
   * panel (opened in the page's gesture if `panelOpened` says so; without
   * a gesture Chrome refuses it), else the action popup, unless a wallet
   * view is already open. Firefox and Safari, and Chrome's last resort: the
   * popup in a window of its own.
   */
  function openWalletUI(tabId?: number, panelOpened?: Promise<boolean>) {
    void (async () => {
      if (typeof chrome !== 'undefined' && chrome.sidePanel && tabId) {
        if (await panelOpened) return;
        if (await chrome.sidePanel.open({ tabId }).then(() => true, () => false)) return;
        if (await walletViewOpen()) return;
        if (await chrome.action?.openPopup?.().then(() => true, () => false)) return;
      }
      openPopupWindow();
    })().catch(() => {});
  }

  /** Whether a popup, side panel or popup window of the wallet is open (Chrome 116+). */
  async function walletViewOpen(): Promise<boolean> {
    try {
      const contexts = await chrome.runtime?.getContexts?.({ contextTypes: ['SIDE_PANEL', 'POPUP', 'TAB'] });
      const views = [browser.runtime.getURL('/popup.html'), browser.runtime.getURL('/sidepanel.html')];
      return (contexts ?? []).some((c) => views.some((url) => c.documentUrl?.startsWith(url)));
    } catch {
      return false;
    }
  }

  function openPopupWindow() {
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
    // dstProviderId lets an adapter tell providers of one family apart (the
    // OpenAI API itself wants max_completion_tokens).
    const ctx: TranslationContext = {
      srcFamily: srcFamily as ModelFamily,
      dstFamily: dstFamily as ModelFamily,
      srcModel: (requestBody ? parseModel(requestBody) : undefined) ?? modelFromUrl(requestUrl),
      dstModel: translation.dstModel,
      dstProviderId: translation.dstProviderId,
      isStreaming: detectStreamingRequest(requestBody, requestUrl),
      requestId,
    };
    return ctx;
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

  /**
   * Whether `url`, as the app sent it, fits the provider it asked for.
   * Unrouted it is where the request goes, so it must be that provider's
   * host: for one without a fixed host (Azure OpenAI, Ollama, LM Studio),
   * the credential's own (`credentialBaseUrl`). Routed, the request goes to
   * the destination's URL and this one only names the endpoint; a provider
   * without a fixed host then has no host to hold it to, so any URL one of
   * its credentials could have (https, or http to this machine for a local
   * server) passes.
   */
  function sourceUrlAllowed(providerId: string, url: string, routed: boolean, credentialBaseUrl?: string): boolean {
    if (!routed) return validateProxyUrl(providerId, url, credentialBaseUrl);
    if (!PROVIDERS[providerId]?.requiresCustomBaseUrl) return validateProxyUrl(providerId, url);
    try {
      return validateProxyUrl(providerId, url, new URL(url).origin);
    } catch {
      return false;
    }
  }

  /**
   * The bridge knows only the registry's placeholder host for a provider
   * without a fixed one (Azure's YOUR_RESOURCE, the local servers' default
   * ports). A request it sends there goes to the credential's own host,
   * same path and query. Null when `url` names another host (validated as
   * it is) or the credential has no usable base URL.
   */
  function rebaseOntoCredential(providerId: string, url: string, credentialBaseUrl: string | undefined): string | null {
    const placeholder = PROVIDERS[providerId]?.baseUrl;
    const base = resolveProviderBaseUrl(providerId, credentialBaseUrl);
    if (!placeholder || !base) return null;
    try {
      const target = new URL(url);
      if (target.origin !== new URL(placeholder).origin) return null;
      return `${base.replace(/\/$/, '')}${target.pathname}${target.search}`;
    } catch {
      return null;
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
   * A translated request's upstream error body, for the app: in the app's
   * dialect when the destination's error parses as one (so its SDK can
   * read it), otherwise as it came. An HTML 502 from a CDN or a plain-text
   * error is passed through rather than failing the response.
   */
  function translateErrorBody(
    translation: SessionTranslation,
    requestBody: string | undefined,
    requestId: string,
    responseBody: string,
    requestUrl?: string,
  ): string {
    const ctx = buildTranslationContext(translation, requestBody, requestId, requestUrl);
    if (!ctx) return responseBody;
    try {
      return translateErrorResponse(ctx, responseBody) ?? responseBody;
    } catch {
      return responseBody;
    }
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
    const password = masterPassword;
    if (!password) throw new Error('Wallet is locked');

    try {
      // A secret only decrypts for the record it was bound to. Unbound ones
      // predate 1.1.2 and are accepted only until the wallet upgrade has
      // rebound them (lib/wallet-upgrade.ts): after that, a blob moved into
      // another record is refused rather than sent to that record's host.
      // So is a record with no secret, other than a local server's.
      const { passwordHash } = await browser.storage.local.get('passwordHash');
      const allowUnbound = typeof passwordHash === 'string' && isLegacyPasswordHash(passwordHash);
      if (credential.authMethod === 'api_key') {
        return await openCredentialSecret(credential, 'encryptedKey', credential.encryptedKey, password, allowUnbound);
      }
      return await openCredentialSecret(credential, 'encryptedAccessToken', credential.encryptedAccessToken, password, allowUnbound);
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

    if (sp) entry.credentialId = sp.credentialId;
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

  // Lifetime tokens per app and provider (usageTotals), which allowances are
  // checked against. Kept apart from the request log: that holds only the
  // last 500 entries across all apps, so an app could push its own expensive
  // entries out of the window with cheap requests. Signed with the wallet
  // key (lib/routing-state.ts); a wallet that had none yet seeds them from
  // the log when its state is first signed.

  function addUsage(origin: string, providerId: string, tokens: number): Promise<void> {
    // NaN or Infinity never gets in: it can't be signed, and it would hold
    // back every app's usage with it.
    if (!toTokenCount(tokens)) return Promise.resolve();
    pendingUsage = withUsage(pendingUsage, origin, providerId, tokens);
    persistPendingUsage();
    return commitPendingUsage();
  }

  /**
   * Add the tokens counted since the last signed write (pendingUsage) to
   * the usage totals, in one signed write. Without the wallet key they stay
   * pending until the next unlock.
   */
  async function commitPendingUsage(): Promise<void> {
    let taken: UsageTotals | undefined;
    try {
      await changeWalletState((state) => {
        if (Object.keys(pendingUsage).length === 0) return { result: undefined };
        taken = pendingUsage;
        pendingUsage = {};
        return { usage: addUsageTotals(state.usage, taken), result: undefined };
      });
    } catch (err) {
      // Not written: they are counted with the next write.
      if (taken) pendingUsage = addUsageTotals(taken, pendingUsage);
      throw err;
    } finally {
      if (taken) persistPendingUsage();
    }
  }

  function persistPendingUsage() {
    if (!hasSessionStorage) return;
    browser.storage.session.set({ _pendingUsage: pendingUsage }).catch(() => {});
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
   * request may use. The check and the hold run in one storage section,
   * after the verified read, so concurrent requests see each other's holds
   * and no usage write lands in between. Nothing passes without the wallet
   * key, or while apps are paused after an integrity reset: neither the
   * limits nor the usage are known then.
   */
  async function checkAndReserveAllowance(
    origin: string,
    providerId: string,
    req: ProxyRequest,
  ): Promise<{ allowed: true; release: () => void } | { allowed: false; reason: string }> {
    const key = await walletMacKey();
    if (!key) return { allowed: false, reason: noWalletKeyError() };
    return serializedStorage(async () => {
      const { routing, usage } = await loadWalletState(key);
      if (routing.hold) return { allowed: false as const, reason: LIMITS_HOLD_MESSAGE };
      const allowance = routing.allowances.find((a) => a.origin === origin);
      if (allowance) {
        const own = (totals: UsageTotals) => (Object.hasOwn(totals, origin) ? Object.entries(totals[origin]) : []);
        const reserved = reservedTokens.get(origin) ?? new Map<string, number>();
        const entries = [...own(usage), ...own(pendingUsage), ...reserved.entries()].map(([pid, tokens]) => ({
          providerId: pid as ProviderId,
          inputTokens: tokens,
          outputTokens: 0,
        }));
        const check = computeAllowanceCheck(allowance, entries, providerId);
        if (!check.allowed) return { allowed: false as const, reason: check.reason ?? 'Token allowance exceeded' };
      }
      return { allowed: true as const, release: reserveTokens(origin, providerId, estimateRequestTokens(req)) };
    });
  }

  /** A request the app cancelled before any response: charge its estimate. */
  async function chargeCancelledRequest(session: Session, req: ProxyRequest) {
    const inputTokens = req.body && !req.bodyEncoding ? Math.ceil(req.body.length / 4) : 0;
    const outputTokens = Math.max(0, estimateRequestTokens(req) - inputTokens);
    const logEntryId = await logRequest(session, req, 499);
    await updateLogEntry(logEntryId, { inputTokens, outputTokens, model: req.bodyEncoding ? undefined : parseModel(req.body) });
    await addUsage(session.appOrigin, req.providerId, inputTokens + outputTokens);
  }

  // The most output tokens a request's estimate counts (estimateRequestTokens).
  const MAX_OUTPUT_ESTIMATE = 1_000_000;

  /**
   * Rough upper bound for a request: its prompt plus the output it asks for.
   * An output limit counts in whole tokens, at most MAX_OUTPUT_ESTIMATE
   * (more than any model writes in one reply), and only as a finite number:
   * max_tokens 1e400 comes out of JSON.parse as Infinity, which would make
   * the estimate unsignable. Same rule on iOS and Android, whose JSON
   * parsers refuse 1e400 outright.
   */
  function estimateRequestTokens(req: ProxyRequest): number {
    if (!req.body || req.bodyEncoding) return 0;
    let maxOutput = 0;
    try {
      const body = JSON.parse(req.body) as Record<string, unknown>;
      const config = body.generationConfig as Record<string, unknown> | undefined;
      for (const value of [body.max_tokens, body.max_completion_tokens, body.max_output_tokens, config?.maxOutputTokens]) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          maxOutput = Math.max(maxOutput, Math.min(Math.floor(value), MAX_OUTPUT_ESTIMATE));
        }
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
      // An encoded (binary) body's length says nothing about its tokens.
      if (!inputTokens && !req.bodyEncoding) inputTokens = Math.ceil((req.body?.length ?? 0) / 4);
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

    const trust = await getTrustState();

    for (const [id, entry] of pendingApprovals) {
      const trustedSite = silentTrustFor(trust, entry.approval.appOrigin);
      if (trustedSite) {
        const scopedProviders = scopeProvidersForTrust(
          entry.approval.providers,
          trustedSite.allowedProviders ?? [],
        );
        if (scopedProviders) {
          pendingApprovals.delete(id);
          await settleApproval(entry, scopedProviders);
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

    for (const session of sessions.values()) {
      const providerIds = session.requestedProviders;

      // Re-resolve group binding for this session's origin (may have changed)
      const group = await getGroupForOrigin(session.appOrigin);

      const { providers: newSessionProviders, providerMap } = resolveSessionProviders(providerIds, credentials, group);

      session.providers = newSessionProviders;
      persistSessions();

      notifyProvidersUpdated(session, providerMap);
    }
  }

  function notifyProvidersUpdated(session: Session, providerMap: ConnectResponse['providers']) {
    notifyOrigin(session.appOrigin, { type: 'BYOKY_PROVIDERS_UPDATED', payload: { sessionKey: session.sessionKey, providers: providerMap } });
  }

  // --- Wallet keys and the pre-1.1.2 upgrade ---

  const WALLET_UPGRADE_FAILED = 'Could not upgrade the wallet. Lock and unlock it, then try again';

  /**
   * Run the one-time upgrade of a wallet written before 1.1.2
   * (lib/wallet-upgrade.ts), at most once per unlock. Resolves to the wallet
   * MAC key under the new password hash, or null when there was nothing to
   * upgrade or the wallet is locked. A failed upgrade rejects, and the next
   * call tries again.
   */
  function ensureWalletUpgraded(): Promise<CryptoKey | null> {
    const password = masterPassword;
    if (!password) return Promise.resolve(null);
    if (!walletUpgradePromise) {
      const pending = upgradeWallet(browser.storage.local, password, { exclusive: serializedStorage })
        .then((result) => result?.macKey ?? null);
      walletUpgradePromise = pending;
      pending.catch(() => { if (walletUpgradePromise === pending) walletUpgradePromise = null; });
    }
    return walletUpgradePromise;
  }

  /** Whether the wallet is at the 1.1.2 format, upgrading it if needed. */
  async function walletUpgraded(): Promise<boolean> {
    try {
      await ensureWalletUpgraded();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The wallet MAC key, which signs the trust, routing and usage state. It
   * is derived from the master password, so it's null while the wallet is
   * locked (and while a failed upgrade leaves it at format 1): nothing is
   * trusted then, and no app request passes its allowance check. `known` is
   * the key the unlock derived already. Routing state that was never signed
   * is adopted (adoptRoutingState) before the key is handed out.
   */
  function walletMacKey(known?: CryptoKey): Promise<CryptoKey | null> {
    const password = masterPassword;
    if (!password) return Promise.resolve(null);
    if (!walletMacKeyPromise) {
      const derived = known
        ? Promise.resolve(known)
        : ensureWalletUpgraded().then(async (upgradedKey) => {
          if (upgradedKey) return upgradedKey;
          const { passwordHash } = await browser.storage.local.get('passwordHash');
          return typeof passwordHash === 'string' ? deriveWalletMacKey(password, passwordHash) : null;
        });
      const pending = derived
        .then(async (key) => {
          if (key) await adoptRoutingState(key);
          return key;
        })
        .catch(() => null);
      walletMacKeyPromise = pending;
      // A missing key isn't cached, so a retried upgrade can still supply it.
      pending.then((key) => { if (!key && walletMacKeyPromise === pending) walletMacKeyPromise = null; });
    }
    return walletMacKeyPromise;
  }

  /** Why something that needs the wallet key can't be done. */
  function noWalletKeyError(): string {
    return masterPassword ? WALLET_UPGRADE_FAILED : 'Wallet is locked';
  }

  function forgetWalletKeys() {
    walletMacKeyPromise = null;
    walletUpgradePromise = null;
    setSilentTrustSnapshot(new Map());
  }

  // --- Trust state: trusted sites and revoked origins (lib/trust-state.ts) ---

  /**
   * The trusted sites and revoked origins, verified against their MAC;
   * empty while locked. A state that fails verification is dropped from
   * storage whole, which fails closed: no site keeps its trust, and the
   * popup is told why (TRUST_RESET_NOTICE_KEY).
   */
  async function getTrustState(): Promise<TrustState> {
    const key = await walletMacKey();
    if (!key) return emptyTrustState();
    return serializedStorage(async () => {
      const read = await readTrustState(await browser.storage.local.get(TRUST_STATE_KEYS), key, trustEpochHighWater);
      if (!read.intact) {
        const epoch = nextTrustEpoch(read.epoch);
        await browser.storage.local.set(await droppedTrustState(key, epoch));
        noteTrustEpoch(epoch);
      } else if (read.beforeRouting) {
        // Signed before states had an epoch, or before the routing state was
        // signed too: re-signed under the current tag.
        const epoch = nextTrustEpoch(read.epoch);
        await browser.storage.local.set(await signTrustState(read, key, epoch));
        noteTrustEpoch(epoch);
      } else {
        noteTrustEpoch(read.epoch);
      }
      // Locked while this ran: trust nothing.
      const state = masterPassword ? { sites: read.sites, revoked: read.revoked } : emptyTrustState();
      noteSilentTrust(state);
      return state;
    });
  }

  function noteSilentTrust(state: TrustState) {
    const snapshot = new Map<string, string[]>();
    for (const site of state.sites) {
      if (silentTrustFor(state, site.origin)) snapshot.set(site.origin, site.allowedProviders ?? []);
    }
    setSilentTrustSnapshot(snapshot);
  }

  function setSilentTrustSnapshot(snapshot: Map<string, string[]>) {
    silentTrustSnapshot = snapshot;
    if (!hasSessionStorage) return;
    const stored = snapshot.size > 0
      ? browser.storage.session.set({ _silentTrust: [...snapshot] })
      : browser.storage.session.remove('_silentTrust');
    stored.catch(() => {});
  }

  /** The snapshot setSilentTrustSnapshot kept in storage.session. */
  function restoredSilentTrust(stored: unknown): Map<string, string[]> {
    const snapshot = new Map<string, string[]>();
    if (!Array.isArray(stored)) return snapshot;
    for (const entry of stored) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
      snapshot.set(entry[0], entry[1].filter((id: unknown): id is string => typeof id === 'string'));
    }
    return snapshot;
  }

  /** Change the trust state and re-sign it. Throws while locked. */
  async function updateTrustState(update: (state: TrustState) => TrustState) {
    const key = await walletMacKey();
    if (!key) throw new Error('Wallet is locked');
    await serializedStorage(async () => {
      const read = await readTrustState(await browser.storage.local.get(TRUST_STATE_KEYS), key, trustEpochHighWater);
      // A state that fails verification is dropped and started over, not
      // built on.
      const base = read.intact ? { sites: read.sites, revoked: read.revoked } : emptyTrustState();
      const next = update(base);
      if (read.intact && next === base) return;
      const epoch = nextTrustEpoch(read.epoch);
      await browser.storage.local.set({
        ...(await signTrustState(next, key, epoch)),
        ...(read.intact ? {} : { [TRUST_RESET_NOTICE_KEY]: true }),
      });
      noteTrustEpoch(epoch);
      if (masterPassword) noteSilentTrust(next);
    });
  }

  function nextTrustEpoch(stored: number): number {
    return Math.max(stored, trustEpochHighWater) + 1;
  }

  function noteTrustEpoch(epoch: number) {
    if (epoch <= trustEpochHighWater) return;
    trustEpochHighWater = epoch;
    if (hasSessionStorage) browser.storage.session.set({ _trustEpoch: epoch }).catch(() => {});
  }

  function nextEpoch(kind: EpochKind, stored: number): number {
    return Math.max(stored, epochHighWater[kind]) + 1;
  }

  function noteEpoch(kind: EpochKind, epoch: number) {
    if (epoch <= epochHighWater[kind]) return;
    epochHighWater[kind] = epoch;
    if (hasSessionStorage) browser.storage.session.set({ [EPOCH_SESSION_KEYS[kind]]: epoch }).catch(() => {});
  }

  /** A new or reset wallet starts its signed state over, usage held while locked included. */
  function forgetEpochs() {
    trustEpochHighWater = 0;
    for (const kind of Object.keys(epochHighWater) as EpochKind[]) epochHighWater[kind] = 0;
    pendingUsage = {};
    if (hasSessionStorage) {
      browser.storage.session.remove(['_trustEpoch', ...Object.values(EPOCH_SESSION_KEYS), '_pendingUsage']).catch(() => {});
    }
  }

  async function addTrustedSite(origin: string, allowedProviders: string[]) {
    // Anything else would make the signed state unreadable (parseTrustedSites)
    // and so wipe every trusted site; an opaque origin would trust every
    // sandboxed frame on every site.
    if (origin === 'unknown' || !isProviderIdList(allowedProviders)) throw new Error('Invalid trusted site');
    await updateTrustState((state) => {
      const existing = state.sites.find((s) => s.origin === origin);
      if (!existing) return { ...state, sites: [...state.sites, { origin, trustedAt: Date.now(), allowedProviders }] };
      // Merge new providers into existing trust entry
      const merged = [...new Set([...(existing.allowedProviders ?? []), ...allowedProviders])];
      return { ...state, sites: state.sites.map((s) => (s === existing ? { ...s, allowedProviders: merged } : s)) };
    });
  }

  async function removeTrustedSite(origin: string) {
    await updateTrustState((state) => ({ ...state, sites: state.sites.filter((s) => s.origin !== origin) }));
  }

  /**
   * Hold the origin's next connect for a manual approval even if the site
   * is trusted, or the SDK's automatic reconnect would silently undo the
   * revocation. Cleared when the user approves the site again.
   */
  async function recordRevocation(origin: string) {
    try {
      await updateTrustState((state) => (
        state.revoked.includes(origin) ? state : { ...state, revoked: [...state.revoked, origin] }
      ));
    } catch {
      // No wallet key: the wallet is still at format 1 because its upgrade
      // failed, and nothing is trusted until it succeeds. Keep the
      // revocation the pre-1.1.2 way, unsigned, for the upgrade to sign in.
      await serializedStorage(async () => {
        const data = await browser.storage.local.get(REVOKED_ORIGINS_KEY);
        const revoked = Array.isArray(data[REVOKED_ORIGINS_KEY]) ? (data[REVOKED_ORIGINS_KEY] as unknown[]) : [];
        if (!revoked.includes(origin)) await browser.storage.local.set({ [REVOKED_ORIGINS_KEY]: [...revoked, origin] });
      }).catch(() => {});
    }
  }

  async function clearRevocation(origin: string) {
    await updateTrustState((state) => (
      state.revoked.includes(origin) ? { ...state, revoked: state.revoked.filter((o) => o !== origin) } : state
    ));
  }

  // --- Routing and usage state: groups, app bindings, allowances, usage (lib/routing-state.ts) ---

  const LIMITS_HOLD_MESSAGE = 'Apps are paused until you check your spending limits in the Byoky wallet and resume them';

  interface WalletState {
    routing: RoutingState;
    usage: UsageTotals;
    routingEpoch: number;
    usageEpoch: number;
  }

  /**
   * The routing and usage state, verified against their MACs. Runs inside
   * serializedStorage. A part that fails verification is replaced by its
   * safe state and written back: the default group alone, and apps paused
   * (limitsHold) until the user checks limits and usage and resumes them.
   */
  async function loadWalletState(key: CryptoKey): Promise<WalletState> {
    const stored = await browser.storage.local.get([...ROUTING_STATE_KEYS, ...USAGE_STATE_KEYS]);
    const routingRead = await readRoutingState(stored, key, epochHighWater.routing);
    const usageRead = await readUsageState(stored, key, epochHighWater.usage);
    const routing = usageRead.intact ? routingRead.state : withHold(routingRead.state, 'usage');
    let { epoch: routingEpoch } = routingRead;
    let { epoch: usageEpoch } = usageRead;
    const write: Record<string, unknown> = {};
    if (!routingRead.intact || routing !== routingRead.state) {
      routingEpoch = nextEpoch('routing', routingRead.epoch);
      Object.assign(write, await signRoutingState(routing, key, routingEpoch));
    }
    if (!usageRead.intact) {
      usageEpoch = nextEpoch('usage', usageRead.epoch);
      Object.assign(write, await signUsageState(usageRead.totals, key, usageEpoch));
    }
    if (Object.keys(write).length > 0) await browser.storage.local.set(write);
    noteEpoch('routing', routingEpoch);
    noteEpoch('usage', usageEpoch);
    // Open sessions follow the reset groups too. Not awaited: it reads this
    // state again, after this storage section.
    if (!routingRead.intact) refreshSessionProviders().catch(() => {});
    return { routing, usage: usageRead.totals, routingEpoch, usageEpoch };
  }

  /** The verified routing and usage state, or null without the wallet key. */
  async function readWalletState(): Promise<WalletState | null> {
    const key = await walletMacKey();
    if (!key) return null;
    return serializedStorage(() => loadWalletState(key));
  }

  type WalletStateChange<T> = { routing?: RoutingState; usage?: UsageTotals; result: T };

  /**
   * Change the routing or usage state: `change` gets the verified state and
   * returns the parts it changed, which are re-signed under the next epoch,
   * in one write. Null without the wallet key; nothing unsigned is ever
   * written.
   */
  async function changeWalletState<T>(change: (state: WalletState) => WalletStateChange<T>): Promise<{ result: T } | null> {
    const key = await walletMacKey();
    if (!key) return null;
    return serializedStorage(async () => {
      const state = await loadWalletState(key);
      const { routing, usage, result } = change(state);
      if (!routing && !usage) return { result };
      const routingEpoch = nextEpoch('routing', state.routingEpoch);
      const usageEpoch = nextEpoch('usage', state.usageEpoch);
      await browser.storage.local.set({
        ...(routing ? await signRoutingState(routing, key, routingEpoch) : {}),
        ...(usage ? await signUsageState(usage, key, usageEpoch) : {}),
      });
      if (routing) noteEpoch('routing', routingEpoch);
      if (usage) noteEpoch('usage', usageEpoch);
      return { result };
    });
  }

  /** changeWalletState for the routing state alone. */
  function changeRoutingState<T>(change: (routing: RoutingState) => { routing?: RoutingState; result: T }): Promise<{ result: T } | null> {
    return changeWalletState(({ routing }) => change(routing));
  }

  async function setAllowance(raw: unknown): Promise<{ success?: boolean; error?: string }> {
    // Only what reads back the same gets signed (parseAllowance).
    const allowance = parseAllowance(raw);
    if (!allowance) return { error: 'Invalid allowance' };
    const changed = await changeRoutingState((routing) => {
      const exists = routing.allowances.some((a) => a.origin === allowance.origin);
      const allowances = exists
        ? routing.allowances.map((a) => (a.origin === allowance.origin ? allowance : a))
        : [...routing.allowances, allowance];
      return { routing: { ...routing, allowances }, result: undefined };
    });
    return changed ? { success: true } : { error: noWalletKeyError() };
  }

  async function removeAllowance(origin: string): Promise<{ success?: boolean; error?: string }> {
    const changed = await changeRoutingState((routing) => (
      routing.allowances.some((a) => a.origin === origin)
        ? { routing: { ...routing, allowances: routing.allowances.filter((a) => a.origin !== origin) }, result: undefined }
        : { result: undefined }
    ));
    return changed ? { success: true } : { error: noWalletKeyError() };
  }

  /** Start counting the app's usage from zero again. */
  async function resetAppUsage(origin: string): Promise<{ success?: boolean; error?: string }> {
    const changed = await changeWalletState(({ usage }) => {
      // Tokens still pending for it go too.
      if (Object.hasOwn(pendingUsage, origin)) {
        pendingUsage = Object.fromEntries(Object.entries(pendingUsage).filter(([o]) => o !== origin));
        persistPendingUsage();
      }
      return Object.hasOwn(usage, origin)
        ? { usage: Object.fromEntries(Object.entries(usage).filter(([o]) => o !== origin)), result: undefined }
        : { result: undefined };
    });
    return changed ? { success: true } : { error: noWalletKeyError() };
  }

  /** Let apps through again after an integrity reset, once the user checked limits and usage. */
  async function resumeApps(): Promise<{ success?: boolean; error?: string }> {
    const changed = await changeRoutingState(({ hold, ...rest }) => ({ ...(hold ? { routing: rest } : {}), result: undefined }));
    return changed ? { success: true } : { error: noWalletKeyError() };
  }

  // --- Groups (alias layer) ---

  /** `group` without its credential pin. */
  function withoutPin(group: Group): Group {
    const { credentialId: _pin, ...rest } = group;
    return rest;
  }

  // The default group is a sentinel bucket for apps with no explicit
  // binding — it carries no routing (empty providerId), so unbound apps fall
  // through to direct credential lookup for the provider they actually
  // request.
  /**
   * `routing` with the default group present and routing-neutral, and
   * `origin`, if given, bound to a group that exists: the default one when
   * it had no binding or its group was deleted. The same object when
   * nothing changed.
   */
  function withDefaultGroup(routing: RoutingState, origin?: string): RoutingState {
    let { groups, appGroups } = routing;
    const existing = groups.find((g) => g.id === DEFAULT_GROUP_ID);
    if (!existing) {
      groups = [defaultGroup(), ...groups];
    } else if (existing.providerId || existing.credentialId) {
      // Migrate stale default groups that were auto-populated with a
      // provider binding (pre-sentinel behavior). The default group must
      // stay routing-neutral; users wire routing by creating real groups
      // and assigning apps to them.
      groups = groups.map((g) => (g === existing ? { ...withoutPin(g), providerId: '' } : g));
    }
    if (origin !== undefined && !groups.some((g) => Object.hasOwn(appGroups, origin) && g.id === appGroups[origin])) {
      appGroups = { ...appGroups, [origin]: DEFAULT_GROUP_ID };
    }
    return groups === routing.groups && appGroups === routing.appGroups ? routing : { ...routing, groups, appGroups };
  }

  // Returns the group an origin currently belongs to. Auto-assigns to the
  // default group if no binding exists yet (and persists the assignment, so
  // the next call is a pure lookup). Without the wallet key nothing is
  // verified, so the app routes as the default group does: nowhere.
  async function getGroupForOrigin(origin: string): Promise<Group | undefined> {
    const changed = await changeRoutingState((routing) => {
      const next = withDefaultGroup(routing, origin);
      const group = next.groups.find((g) => g.id === next.appGroups[origin]);
      return { ...(next !== routing ? { routing: next } : {}), result: group };
    });
    return changed ? changed.result : defaultGroup();
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
    const model = input.model?.trim() || undefined;
    const changed = await changeRoutingState((routing): { routing?: RoutingState; result: { group?: Group; error?: string } } => {
      if (routing.groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        return { result: { error: 'A group with this name already exists' } };
      }
      const group: Group = {
        id: crypto.randomUUID(),
        name,
        providerId: input.providerId,
        ...(input.credentialId ? { credentialId: input.credentialId } : {}),
        ...(model ? { model } : {}),
        createdAt: Date.now(),
      };
      return { routing: { ...routing, groups: [...routing.groups, group] }, result: { group } };
    });
    return changed ? changed.result : { error: noWalletKeyError() };
  }

  async function updateGroup(
    id: string,
    patch: { name?: string; providerId?: string; credentialId?: string | null; model?: string | null },
  ): Promise<{ group?: Group; error?: string }> {
    // Checked against the credentials as they are now, before the change.
    const creds = patch.credentialId ? await getStoredCredentials() : [];
    const changed = await changeRoutingState((routing): { routing?: RoutingState; result: { group?: Group; error?: string } } => {
      const fail = (error: string) => ({ result: { error } });
      const current = routing.groups.find((g) => g.id === id);
      if (!current) return fail('Group not found');

      let next: Group = { ...current };
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name || name.length > 200) return fail('Group name must be 1-200 characters');
        if (id !== DEFAULT_GROUP_ID && routing.groups.some((g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) {
          return fail('A group with this name already exists');
        }
        next.name = name;
      }
      if (patch.providerId !== undefined) {
        if (!PROVIDERS[patch.providerId]) return fail('Invalid provider');
        next.providerId = patch.providerId;
        // Provider change invalidates the pin unless explicitly set in this patch
        if (patch.credentialId === undefined) next = withoutPin(next);
      }
      if (patch.credentialId !== undefined) {
        if (patch.credentialId === null) {
          next = withoutPin(next);
        } else {
          const cred = creds.find((c) => c.id === patch.credentialId);
          if (!cred) return fail('Credential not found');
          if (cred.providerId !== next.providerId) return fail('Credential does not match provider');
          next.credentialId = patch.credentialId;
        }
      }
      if (patch.model !== undefined) {
        const model = patch.model === null ? undefined : (patch.model.trim() || undefined);
        const { model: _old, ...rest } = next;
        next = model ? { ...rest, model } : rest;
      }
      return { routing: { ...routing, groups: routing.groups.map((g) => (g === current ? next : g)) }, result: { group: next } };
    });
    return changed ? changed.result : { error: noWalletKeyError() };
  }

  async function deleteGroup(id: string): Promise<{ success?: boolean; error?: string }> {
    if (id === DEFAULT_GROUP_ID) return { error: 'Cannot delete the default group' };
    const changed = await changeRoutingState((routing): { routing?: RoutingState; result: { success?: boolean; error?: string } } => {
      if (!routing.groups.some((g) => g.id === id)) return { result: { error: 'Group not found' } };
      // Reassign any apps that pointed at this group back to the default
      const appGroups = Object.fromEntries(
        Object.entries(routing.appGroups).map(([origin, groupId]) => [origin, groupId === id ? DEFAULT_GROUP_ID : groupId]),
      );
      return { routing: { ...routing, groups: routing.groups.filter((g) => g.id !== id), appGroups }, result: { success: true } };
    });
    return changed ? changed.result : { error: noWalletKeyError() };
  }

  async function setAppGroup(origin: string, groupId: string): Promise<{ success?: boolean; error?: string }> {
    const changed = await changeRoutingState((routing): { routing?: RoutingState; result: { success?: boolean; error?: string } } => {
      if (!routing.groups.some((g) => g.id === groupId)) return { result: { error: 'Group not found' } };
      return { routing: { ...routing, appGroups: { ...routing.appGroups, [origin]: groupId } }, result: { success: true } };
    });
    return changed ? changed.result : { error: noWalletKeyError() };
  }

  /**
   * Sign routing and usage state that was never signed, where it can't have
   * been planted (lib/routing-state.ts): a wallet whose trust state an
   * earlier 1.1.2 build signed without it, or a wallet with nothing in it
   * yet. The trust state is re-signed in the same write, under the tag that
   * says the routing state is signed, so this happens once. Anywhere else,
   * unsigned state is left for the first read to refuse.
   */
  async function adoptRoutingState(key: CryptoKey): Promise<void> {
    await serializedStorage(async () => {
      const stored = await browser.storage.local.get([
        ...ROUTING_STATE_KEYS, ...USAGE_STATE_KEYS, ...TRUST_STATE_KEYS, 'credentials', 'requestLog',
      ]);
      if (hasSignedRoutingState(stored)) return;
      const trust = await readTrustState(stored, key, trustEpochHighWater);
      const signedBefore = trust.intact && trust.beforeRouting === true;
      if (!signedBefore && !isEmptyWallet(stored)) return;
      const { routing, usage } = adoptLegacyRoutingState(stored);
      const routingEpoch = nextEpoch('routing', 0);
      const usageEpoch = nextEpoch('usage', 0);
      const trustEpoch = nextTrustEpoch(trust.epoch);
      await browser.storage.local.set({
        ...(await signRoutingState(routing, key, routingEpoch)),
        ...(await signUsageState(usage, key, usageEpoch)),
        ...(signedBefore ? await signTrustState(trust, key, trustEpoch) : {}),
      });
      noteEpoch('routing', routingEpoch);
      noteEpoch('usage', usageEpoch);
      if (signedBefore) noteTrustEpoch(trustEpoch);
    });
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
