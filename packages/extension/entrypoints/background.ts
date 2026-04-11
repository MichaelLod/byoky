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
  type Gift,
  type GiftedCredential,
  type GiftLink,
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
  validateProxyUrl,
  injectClaudeCodeSystemPrompt,
  rewriteToolNamesForClaudeCode,
  createGiftLink,
  decodeGiftLink,
  validateGiftLink,
  familyOf,
  rewriteProxyUrl,
  translateRequest,
  translateResponse,
  createStreamTranslator,
  TranslationError,
  resolveCrossFamilyRoute,
  resolveCrossFamilyGiftRoute,
  resolveSameFamilySwapRoute,
  buildNoCredentialMessage,
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
      await browser.storage.session.remove('_mp');
    } catch {}
  }

  async function restoreSession() {
    if (!hasSessionStorage) return;
    try {
      const data = await browser.storage.session.get('_mp');
      if (data._mp) {
        masterPassword = data._mp as string;
        resetIdleTimer();
        await migrateGiftTokens(data._mp as string);
        reconnectGiftRelays();
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

  async function clearPersistedSessions() {
    if (!hasSessionStorage) return;
    try {
      await browser.storage.session.remove('_sessions');
    } catch {}
  }

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
    clearPersistedSessions();
    authorizedBridgeSessionKey = null;
    disconnectAllGiftRelays();
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

  // Restore session after MV3 service worker restart
  restoreSession();
  restoreSessions();

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
              persistSessions();
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
        persistSessions();
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

      // Identify the session provider and whether this request will route
      // through a gift relay. Gift handling is deferred until AFTER request
      // translation so cross-family-via-gift can translate the request body
      // up-front and hand the translated body/URL to proxyViaGiftRelay.
      const sessionProvider = session.providers.find((sp) => sp.providerId === msg.providerId);
      const isGift = !!(sessionProvider?.giftId && sessionProvider.giftRelayUrl && sessionProvider.giftAuthToken);

      // Cross-family translation context (set when the resolved group routes
      // this app to a credential — owned or gifted — in a different provider family).
      const translation = sessionProvider?.translation;
      // Same-family swap context (set when the resolved group routes this
      // app to a different provider in the same translation family — no
      // translation needed, just URL rewrite + credential swap + optional
      // body.model override). Not applicable to gifts today.
      const swap = sessionProvider?.swap;
      // The "effective" provider id is the one we actually call upstream:
      // the destination if translation or swap is on, otherwise the source.
      const effectiveProviderId = translation?.dstProviderId ?? swap?.dstProviderId ?? msg.providerId;

      // Gift path skips owned-credential resolution entirely — the gift
      // carries its own auth via the relay. For own-key requests we look
      // up and refresh the credential before entering the try/catch below.
      let credential: Credential | undefined;
      if (!isGift) {
        credential = await resolveCredential(session, msg.providerId);
        if (!credential) {
          const allCreds = await getStoredCredentials();
          const group = await getGroupForOrigin(session.appOrigin);
          const message = buildNoCredentialMessage(
            msg.providerId,
            Array.from(new Set(allCreds.map((c) => c.providerId))).sort(),
            group,
          );
          port.postMessage({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 403,
            error: { code: 'PROVIDER_UNAVAILABLE', message },
          });
          return;
        }

        // Refresh OAuth token if expired or about to expire. Key off the
        // credential's own providerId so cross-family routing still refreshes
        // a destination-side OAuth token correctly.
        if (
          credential.authMethod === 'oauth' &&
          (credential as { expiresAt?: number }).expiresAt &&
          (credential as { expiresAt: number }).expiresAt < Date.now() + 60_000 &&
          PROVIDERS[credential.providerId]?.oauthConfig
        ) {
          const refreshed = await refreshOAuthToken(credential);
          if (refreshed) {
            credential = (await resolveCredential(session, msg.providerId))!;
          }
        }
      }

      try {
        // Gift requests don't need a decrypted key — the sender holds the
        // key and applies it on their side of the relay.
        const apiKey = isGift ? '' : await decryptCredentialKey(credential!);

        // The URL the SDK sent must match the SOURCE provider's base URL.
        // (After translation we issue against the destination's URL — see
        // rewriteProxyUrl below.)
        if (!validateProxyUrl(msg.providerId, msg.url)) {
          port.postMessage({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: msg.requestId,
            status: 403,
            error: { code: 'INVALID_URL', message: 'Request URL does not match the provider\'s registered base URL' },
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
            port.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 400,
              error: { code: 'TRANSLATION_NOT_SUPPORTED', message: 'Cross-family routing does not support binary request bodies.' },
            });
            return;
          }
          try {
            translatedBody = applyRequestTranslation(translation, msg.body, msg.requestId);
          } catch (err) {
            const code = err instanceof TranslationError ? err.code : 'TRANSLATION_FAILED';
            port.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 502,
              error: { code, message: err instanceof Error ? err.message : 'Translation failed' },
            });
            return;
          }
          const isStreaming = detectStreamingRequest(msg.body);
          const rewritten = rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming);
          if (!rewritten) {
            port.postMessage({
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
          const isStreaming = detectStreamingRequest(msg.body);
          const rewritten = rewriteProxyUrl(swap.dstProviderId, swap.dstModel ?? '', isStreaming);
          if (!rewritten) {
            port.postMessage({
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
        }

        // Gift path: hand the translated body/URL to the gift relay, along
        // with the translation context so proxyViaGiftRelay can translate
        // response chunks back to the source dialect before returning to
        // the caller. Bypasses OAuth bridge and direct fetch entirely.
        if (isGift) {
          await proxyViaGiftRelay(
            port,
            { ...msg, body: translatedBody, url: translatedUrl },
            sessionProvider!,
            session,
            translation ? { translation, originalBody: msg.body } : undefined,
          );
          return;
        }

        const realHeaders = buildHeaders(effectiveProviderId, msg.headers, apiKey, credential!.authMethod);

        // OAuth tokens for Anthropic route through the bridge (Node.js) to bypass TLS fingerprint detection.
        // Setup tokens require the Claude Code system prompt + Claude-Code-shaped tool names.
        // When the tool name rewriter fires, also relocate the system prompt (third-party framework).
        // After translation, the body is already in Anthropic shape — the
        // Claude Code injection still applies because the bridge expects an
        // Anthropic-shaped request.
        if (credential!.authMethod === 'oauth' && effectiveProviderId === 'anthropic') {
          const { body: rewrittenBody, toolNameMap } = rewriteToolNamesForClaudeCode(translatedBody);
          const isThirdParty = Object.keys(toolNameMap).length > 0;
          const body = injectClaudeCodeSystemPrompt(rewrittenBody, {
            relocateExisting: isThirdParty,
          });
          const sseRewriter = translation
            ? buildResponseStreamRewriter(translation, msg.requestId)
            : undefined;
          await proxyViaBridge(
            port,
            { ...msg, body, url: translatedUrl, providerId: effectiveProviderId },
            realHeaders,
            session,
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

        const response = await fetch(translatedUrl, {
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

        // Decide streaming vs single-shot from the response Content-Type.
        // Translation activates a per-chunk SSE rewriter for streaming
        // responses, or a one-shot JSON translator for non-streaming.
        const isStreamingResponse = (respHeaders['content-type'] ?? '').includes('text/event-stream');
        const sseRewriter = translation && isStreamingResponse
          ? buildResponseStreamRewriter(translation, msg.requestId)
          : undefined;

        const chunks: string[] = [];
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
                port.postMessage({
                  type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                  requestId: msg.requestId,
                  chunk: rewritten,
                });
              }
            } else if (!translation) {
              // Pass-through path: forward each chunk as-is.
              port.postMessage({
                type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                requestId: msg.requestId,
                chunk: text,
              });
            }
            // Non-streaming + translation: buffer everything in chunks[],
            // emit one translated chunk after the loop.
          }
        }

        if (sseRewriter) {
          const tail = sseRewriter.flush();
          if (tail) {
            port.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: tail,
            });
          }
        } else if (translation && !isStreamingResponse) {
          // Non-streaming translation: translate the buffered JSON body
          // and emit it as a single chunk.
          try {
            const translatedResponse = applyResponseTranslation(translation, msg.body, msg.requestId, chunks.join(''));
            port.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_CHUNK',
              requestId: msg.requestId,
              chunk: translatedResponse,
            });
          } catch (err) {
            port.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: msg.requestId,
              status: 502,
              error: { code: 'TRANSLATION_FAILED', message: err instanceof Error ? err.message : 'Response translation failed' },
            });
            return;
          }
        }

        port.postMessage({
          type: 'BYOKY_PROXY_RESPONSE_DONE',
          requestId: msg.requestId,
        });

        // Parse token usage from the buffered response. We always read from
        // the *destination* format (effectiveProviderId), since chunks[]
        // holds the untranslated upstream body.
        const fullBody = chunks.join('');
        const model = msg.bodyEncoding ? undefined : parseModel(msg.body);
        const usage = parseUsage(effectiveProviderId, fullBody);
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
      providerMap[sp.providerId] = { available: sp.available, authMethod: sp.authMethod, ...(sp.giftId ? { gift: true } : {}) };
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
    const giftPrefs = await getGiftPreferences();
    const result: Array<{ id: string; authMethod: AuthMethod; sessionProvider: Session['providers'][number] }> = [];
    const seen = new Set<string>();

    // First pass: check if any provider should prefer a gift
    const preferredGiftProviders = new Set<string>();
    for (const gc of giftedCreds) {
      if (gc.expiresAt > Date.now() && gc.usedTokens < gc.maxTokens && giftPrefs[gc.providerId] === gc.giftId) {
        preferredGiftProviders.add(gc.providerId);
      }
    }

    for (const cred of credentials) {
      if (preferredGiftProviders.has(cred.providerId)) continue; // gift preferred, skip own key
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
        seen.add(gc.providerId);
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

    const giftPrefs = await getGiftPreferences();
    // Resolve the group this app belongs to (auto-assigns to default if first contact)
    const group = await getGroupForOrigin(origin);

    for (const req of request.providers ?? []) {
      // If the group is bound to this provider with a specific credential pin,
      // it overrides everything else for credential selection.
      const groupPinnedCred =
        group && group.providerId === req.id && group.credentialId
          ? credentials.find((c) => c.id === group.credentialId)
          : undefined;

      // If the group pins a received gift for this provider, it overrides
      // both credential lookup and translation routing — the gift carries
      // its own auth + relay and the app talks to the sender's key.
      const groupPinnedGift =
        group && group.providerId === req.id && group.giftId
          ? giftedCreds.find((g) => g.giftId === group.giftId && g.expiresAt > Date.now() && g.usedTokens < g.maxTokens)
          : undefined;

      // Cross-family routing via gift: group pins a gift whose provider
      // differs from the app's request, and the provider pair is
      // translatable with a destination model set. Recipient translates
      // request/response; sender sees a native dst-provider request.
      const crossGiftRoute = groupPinnedGift ? undefined : resolveCrossFamilyGiftRoute(group, req.id, giftedCreds);

      // Cross-family routing via owned credential: the group's bound
      // provider differs from what the app asked for, both providers are
      // in known translation families, and a credential resolves for the
      // destination. Record translation metadata so the proxy handler
      // knows to translate.
      const crossRoute = groupPinnedGift || crossGiftRoute ? undefined : resolveCrossFamilyRoute(group, req.id, credentials);

      // Same-family swap: the group's bound provider differs from what the
      // app asked for, and both providers are in the SAME family (identical
      // wire format). No translation needed — just URL rewrite + credential
      // swap + optional model override. Only consulted when cross-family
      // routing doesn't apply, so the branches are mutually exclusive.
      const swapRoute = !crossRoute && !groupPinnedGift && !crossGiftRoute
        ? resolveSameFamilySwapRoute(group, req.id, credentials)
        : undefined;

      const cred = groupPinnedCred ?? crossRoute?.cred ?? swapRoute?.cred ?? credentials.find((c) => c.providerId === req.id);
      const gc = groupPinnedGift ?? crossGiftRoute?.gc ?? giftedCreds.find((g) => g.providerId === req.id && g.expiresAt > Date.now() && g.usedTokens < g.maxTokens);
      // Group gift pin wins over everything. Cross-family gift route is
      // next. Otherwise group credential pin wins over gift preference.
      // Cross-family routing and same-family swap beat own-key direct
      // lookup. Otherwise prefer gift if user explicitly chose it, else
      // prefer own key.
      const preferGift = !!groupPinnedGift || !!crossGiftRoute || (!groupPinnedCred && !crossRoute && !swapRoute && gc && giftPrefs[req.id] === gc.giftId);
      const useGift = preferGift || (!cred && gc);
      providerMap[req.id] = {
        available: !!(cred || gc),
        authMethod: useGift ? 'api_key' : (cred?.authMethod ?? 'api_key'),
        ...(useGift ? { gift: true } : {}),
      };
      if (useGift && gc) {
        const sp: SessionProvider = {
          providerId: req.id,
          credentialId: gc.id,
          available: true,
          authMethod: 'api_key',
          giftId: gc.giftId,
          giftRelayUrl: gc.relayUrl,
          giftAuthToken: gc.authToken,
        };
        // Cross-family gift carries translation context alongside the
        // relay fields so the proxy handler translates request/response.
        if (crossGiftRoute) sp.translation = crossGiftRoute.translation;
        sessionProviders.push(sp);
      } else if (cred) {
        const sp: SessionProvider = {
          providerId: req.id,
          credentialId: cred.id,
          available: true,
          authMethod: cred.authMethod,
        };
        if (crossRoute) sp.translation = crossRoute.translation;
        else if (swapRoute) sp.swap = swapRoute.swap;
        sessionProviders.push(sp);
      }
    }

    if (request.providers?.length === 0 || !request.providers) {
      // Empty provider list: resolve to all available credentials.
      // This path is only reached via explicit user approval — trusted
      // auto-approvals always scope providers before calling createSession.
      const resolved = await resolveAllProviders();
      for (const rp of resolved) {
        providerMap[rp.id] = { available: true, authMethod: rp.authMethod, ...(rp.sessionProvider.giftId ? { gift: true } : {}) };
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
          persistSession();
          resetIdleTimer();
          processPendingAfterUnlock();
          await migrateGiftTokens(password);
          reconnectGiftRelays();
          enqueueVaultSync(async () => {
            await syncPendingCredentials();
            await syncPendingGroups();
          });
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
        clearPersistedSessions();
        authorizedBridgeSessionKey = null;
        disconnectAllGiftRelays();
        clearSessionStorage();
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
        const isFirstCredential = creds.length === 0;
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

        // First credential becomes the default group's pin. If the default
        // group already exists with no pin, adopt this credential.
        const groups = await getGroups();
        const defIdx = groups.findIndex((g) => g.id === DEFAULT_GROUP_ID);
        if (defIdx < 0) {
          groups.unshift({
            id: DEFAULT_GROUP_ID,
            name: 'Default',
            providerId: cpId,
            credentialId: newCred.id as string,
            createdAt: Date.now(),
          });
          await setGroups(groups);
        } else if (isFirstCredential || !groups[defIdx].credentialId) {
          groups[defIdx] = {
            ...groups[defIdx],
            providerId: cpId,
            credentialId: newCred.id as string,
          };
          await setGroups(groups);
        }

        refreshSessionProviders();
        fireVaultSync(newCred.id as string, cpId, cLabel, cAuth, cleanValue).catch(() => {});
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
        fireVaultRemove(rmId).catch(() => {});
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
        disconnectAllGiftRelays();
        clearSessionStorage();
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
            persistSessions();
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

      case 'addTrustedSite': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { origin, allowedProviders } = message.payload as { origin: string; allowedProviders: string[] };
        await addTrustedSite(origin, allowedProviders);
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
        // Export gifts (sender side) — re-encrypt authToken with export password
        const giftsData = await browser.storage.local.get('gifts');
        const storedGifts = (giftsData.gifts ?? []) as Gift[];
        const exportedGifts = await Promise.all(
          storedGifts.map(async (g) => {
            const result = { ...g };
            if (g.authToken) {
              try {
                const plain = g.authToken.startsWith('gft_') ? g.authToken : await decrypt(g.authToken, pw);
                result.authToken = await encrypt(plain, exportPassword);
              } catch {
                result.authToken = await encrypt(g.authToken, exportPassword);
              }
            }
            return result;
          }),
        );
        // Export gifted credentials (recipient side) — encrypt authToken for export
        const gcData = await browser.storage.local.get('giftedCredentials');
        const storedGifted = (gcData.giftedCredentials ?? []) as GiftedCredential[];
        const exportedGifted = await Promise.all(
          storedGifted.map(async (gc) => {
            const result = { ...gc };
            if (gc.authToken) {
              result.authToken = await encrypt(gc.authToken, exportPassword);
            }
            return result;
          }),
        );
        const vault = {
          version: 2, exportedAt: Date.now(), credentials: reEncrypted,
          gifts: exportedGifts, giftedCredentials: exportedGifted,
        };
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
        const vault = JSON.parse(vaultJson) as {
          version?: number; credentials?: unknown[];
          gifts?: unknown[]; giftedCredentials?: unknown[];
        };
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
        // Import gifts (sender side) — re-encrypt authToken with master password
        if (vault.gifts && Array.isArray(vault.gifts)) {
          disconnectAllGiftRelays();
          const importedGifts = await Promise.all(
            vault.gifts.map(async (g: unknown) => {
              const gift = g as Record<string, unknown>;
              if (gift.authToken && typeof gift.authToken === 'string') {
                try {
                  const plain = await decrypt(gift.authToken, impPw);
                  gift.authToken = await encrypt(plain, pw);
                } catch {
                  // Leave as-is if decryption fails
                }
              }
              return gift;
            }),
          );
          await browser.storage.local.set({ gifts: importedGifts });
          reconnectGiftRelays();
        }
        // Import gifted credentials (recipient side) — decrypt authToken back to plaintext
        if (vault.giftedCredentials && Array.isArray(vault.giftedCredentials)) {
          const importedGifted = await Promise.all(
            vault.giftedCredentials.map(async (gc: unknown) => {
              const cred = gc as Record<string, unknown>;
              if (cred.authToken && typeof cred.authToken === 'string') {
                try {
                  cred.authToken = await decrypt(cred.authToken, impPw);
                } catch {
                  // Leave as-is if decryption fails
                }
              }
              return cred;
            }),
          );
          await browser.storage.local.set({ giftedCredentials: importedGifted });
        }
        // Re-sync all imported credentials to cloud vault
        const cvState = await getCloudVaultState();
        if (cvState.enabled && cvState.token && !cvState.tokenExpired) {
          await saveCloudVaultState({ credentialMap: {} });
          enqueueVaultSync(() => syncAllCredentialsToVault(cvState.token!));
        }
        refreshSessionProviders();
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
        // Encrypt authToken at rest for defense-in-depth (protects against local storage exfiltration)
        const encryptedAuthToken = await encrypt(authToken, masterPassword!);
        const storageGift = { ...gift, authToken: encryptedAuthToken };
        const data = await browser.storage.local.get('gifts');
        const gifts = (data.gifts ?? []) as Gift[];
        gifts.push(storageGift);
        await browser.storage.local.set({ gifts });
        const { encoded } = createGiftLink(gift);
        connectGiftRelay(gift);

        // Register with Cloud Vault as fallback sender
        registerGiftWithVault(gift, credentialId).catch(() => {});

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
          unregisterGiftFromVault(giftId).catch(() => {});
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

      case 'probeGiftPeers': {
        // Open short WebSockets to each non-expired gift's relay, auth as
        // recipient, and read peerOnline from relay:auth:result. Used by the
        // popup to show an online/offline dot next to each received gift.
        // Probes run in parallel with a 5s cap each so a dead relay doesn't
        // block the rest.
        const data = await browser.storage.local.get('giftedCredentials');
        const giftedCreds = (data.giftedCredentials ?? []) as GiftedCredential[];
        const active = giftedCreds.filter((gc) => gc.expiresAt > Date.now() && gc.usedTokens < gc.maxTokens);
        const results = await Promise.all(active.map((gc) => probeGiftPeerOnline(gc)));
        const online: Record<string, boolean> = {};
        active.forEach((gc, i) => { online[gc.giftId] = results[i]; });
        return { online };
      }

      case 'removeGiftedCredential': {
        const { id } = message.payload as { id: string };
        const data = await browser.storage.local.get('giftedCredentials');
        const giftedCreds = (data.giftedCredentials ?? []) as GiftedCredential[];
        const removed = giftedCreds.find((gc) => gc.id === id);
        await browser.storage.local.set({
          giftedCredentials: giftedCreds.filter((gc) => gc.id !== id),
        });
        // Clear preference if it pointed to this gift
        if (removed) {
          const prefs = await getGiftPreferences();
          if (prefs[removed.providerId] === removed.giftId) {
            delete prefs[removed.providerId];
            await browser.storage.local.set({ giftPreferences: prefs });
          }
          // Unpin any group that was bound to this gift — avoids a dangling
          // reference that the session resolver would silently fall through.
          const localGroups = await getGroups();
          let groupsChanged = false;
          for (const g of localGroups) {
            if (g.giftId === removed.giftId) {
              g.giftId = undefined;
              groupsChanged = true;
              void fireVaultGroupSave(g);
            }
          }
          if (groupsChanged) await setGroups(localGroups);
        }
        refreshSessionProviders();
        return { success: true };
      }

      case 'getGiftPreferences': {
        return { preferences: await getGiftPreferences() };
      }

      case 'setGiftPreference': {
        const { providerId, giftId } = message.payload as { providerId: string; giftId: string | null };
        const prefs = await getGiftPreferences();
        if (giftId) {
          prefs[providerId] = giftId;
        } else {
          delete prefs[providerId];
        }
        await browser.storage.local.set({ giftPreferences: prefs });
        refreshSessionProviders();
        return { success: true };
      }

      // --- Groups (alias layer) ---

      case 'getGroups': {
        // Ensure a default group exists so the UI never has to synthesize one.
        await ensureDefaultGroup();
        return { groups: await getGroups(), appGroups: await getAppGroups() };
      }

      case 'createGroup': {
        const result = await createGroup(message.payload as {
          name: string; providerId: string; credentialId?: string; giftId?: string; model?: string;
        });
        if (result.error) return { error: result.error };
        return { group: result.group };
      }

      case 'updateGroup': {
        const { id, patch } = message.payload as {
          id: string;
          patch: { name?: string; providerId?: string; credentialId?: string | null; giftId?: string | null; model?: string | null };
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

      // --- Installed Apps ---

      case 'getInstalledApps': {
        const stored = await browser.storage.local.get('installedApps');
        return { apps: (stored.installedApps ?? []) as unknown[] };
      }

      case 'setInstalledApps': {
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { apps } = message.payload as { apps: unknown[] };
        await browser.storage.local.set({ installedApps: apps });
        return { success: true };
      }

      // --- Cloud Vault ---

      case 'cloudVaultCheckUsername': {
        const { username } = message.payload as { username: string };
        const result = await vaultFetch(`/auth/check-username/${encodeURIComponent(username)}`, 'GET');
        if (!result.ok) return { available: false };
        return result.data as { available: boolean; reason?: string };
      }

      case 'cloudVaultSignup': {
        const rlErr = checkVaultAuthRate(); if (rlErr) return rlErr;
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { username, password } = message.payload as { username: string; password: string };
        const result = await vaultFetch('/auth/signup', 'POST', { username, password });
        if (!result.ok) {
          const err = result.data.error as Record<string, string> | undefined;
          return { error: err?.message ?? 'Signup failed' };
        }
        const token = result.data.token as string;
        const sessionId = result.data.sessionId as string;
        await saveCloudVaultState({
          enabled: true,
          username,
          token,
          sessionId,
          tokenIssuedAt: Date.now(),
          tokenExpired: false,
          credentialMap: {},
        });
        enqueueVaultSync(() => syncAllCredentialsToVault(token));
        return { success: true };
      }

      case 'getVaultBannerDismissedAt': {
        const data = await browser.storage.local.get('vaultBannerDismissedAt');
        return { dismissedAt: (data.vaultBannerDismissedAt as number | null) ?? null };
      }

      case 'setVaultBannerDismissedAt': {
        const { dismissedAt } = message.payload as { dismissedAt: number };
        await browser.storage.local.set({ vaultBannerDismissedAt: dismissedAt });
        return { success: true };
      }

      case 'cloudVaultActivate': {
        const rlErr = checkVaultAuthRate(); if (rlErr) return rlErr;
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { username } = message.payload as { username: string };
        const result = await vaultFetch('/auth/signup', 'POST', { username, password: masterPassword });
        if (!result.ok) {
          const err = result.data.error as Record<string, string> | undefined;
          return { error: err?.message ?? 'Signup failed' };
        }
        const token = result.data.token as string;
        const sessionId = result.data.sessionId as string;
        await saveCloudVaultState({
          enabled: true,
          username,
          token,
          sessionId,
          tokenIssuedAt: Date.now(),
          tokenExpired: false,
          credentialMap: {},
        });
        enqueueVaultSync(() => syncAllCredentialsToVault(token));
        return { success: true };
      }

      case 'cloudVaultLogin': {
        const rlErr = checkVaultAuthRate(); if (rlErr) return rlErr;
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { username, password } = message.payload as { username: string; password: string };
        const result = await vaultFetch('/auth/login', 'POST', { username, password });
        if (!result.ok) {
          const err = result.data.error as Record<string, string> | undefined;
          return { error: err?.message ?? 'Login failed' };
        }
        const token = result.data.token as string;
        const sessionId = result.data.sessionId as string;
        await saveCloudVaultState({
          enabled: true,
          username,
          token,
          sessionId,
          tokenIssuedAt: Date.now(),
          tokenExpired: false,
          credentialMap: {},
        });
        enqueueVaultSync(() => syncAllCredentialsToVault(token));
        return { success: true };
      }

      case 'cloudVaultDisable': {
        const state = await getCloudVaultState();
        if (state.token && !state.tokenExpired) {
          vaultFetch('/auth/logout', 'POST', undefined, state.token).catch(() => {});
        }
        await clearCloudVaultState();
        return { success: true };
      }

      case 'cloudVaultStatus': {
        const state = await getCloudVaultState();
        let pendingCount = 0;
        if (state.enabled) {
          const credentials = await getStoredCredentials();
          pendingCount = credentials.filter((c) => !state.credentialMap[c.id]).length;
        }
        return {
          enabled: state.enabled,
          username: state.username,
          tokenExpired: state.tokenExpired || (state.enabled && state.tokenIssuedAt > 0 && isVaultTokenExpired(state.tokenIssuedAt)),
          pendingCount,
        };
      }

      case 'cloudVaultRelogin': {
        const rlErr = checkVaultAuthRate(); if (rlErr) return rlErr;
        if (!masterPassword) return { error: 'Wallet is locked' };
        const { password } = message.payload as { password: string };
        const state = await getCloudVaultState();
        if (!state.username) return { error: 'No vault account configured' };
        const result = await vaultFetch('/auth/login', 'POST', { username: state.username, password });
        if (!result.ok) {
          const err = result.data.error as Record<string, string> | undefined;
          return { error: err?.message ?? 'Login failed' };
        }
        const token = result.data.token as string;
        const sessionId = result.data.sessionId as string;
        await saveCloudVaultState({
          token,
          sessionId,
          tokenIssuedAt: Date.now(),
          tokenExpired: false,
        });
        enqueueVaultSync(async () => {
          await syncPendingCredentials();
          await syncPendingGroups();
        });
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

  /**
   * Briefly connects to a received gift's relay to check whether the sender
   * peer is currently online. Returns true/false; treats any error or
   * timeout as offline. Intentionally keeps the connection short — the
   * relay reports `peerOnline` in `relay:auth:result`, so we can close as
   * soon as we read that field.
   */
  async function probeGiftPeerOnline(gc: GiftedCredential): Promise<boolean> {
    try {
      const parsed = new URL(gc.relayUrl);
      const isSecure = parsed.protocol === 'wss:';
      const isLocalWs = parsed.protocol === 'ws:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
      if (!isSecure && !isLocalWs) return false;
    } catch {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (online: boolean) => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* already closed */ }
        clearTimeout(timer);
        resolve(online);
      };
      const timer = setTimeout(() => done(false), 5_000);

      let ws: WebSocket;
      try {
        ws = new WebSocket(gc.relayUrl);
      } catch {
        done(false);
        return;
      }

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({
            type: 'relay:auth',
            roomId: gc.giftId,
            authToken: gc.authToken,
            role: 'recipient',
          }));
        } catch {
          done(false);
        }
      };
      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : '';
          if (raw.length > 65_536) return;
          const data = JSON.parse(raw);
          if (data.type === 'relay:auth:result') {
            done(data.success === true && data.peerOnline === true);
          }
        } catch {
          // Ignore parse errors — timeout will resolve false
        }
      };
      ws.onerror = () => done(false);
      ws.onclose = () => done(false);
    });
  }

  async function proxyViaGiftRelay(
    responsePort: Runtime.Port,
    msg: ProxyRequest,
    sp: { giftId?: string; giftRelayUrl?: string; giftAuthToken?: string },
    session: Session,
    translateCtx?: { translation: SessionTranslation; originalBody: string | undefined },
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
      // Translation state: when the group routes this request cross-family
      // through a gift, the request body has already been translated
      // src→dst before we got here. We now also need to translate the
      // response back dst→src before emitting it to the caller. For
      // streaming responses that means an SSE rewriter; for non-streaming
      // we buffer the whole body and translate once at DONE time.
      let isStreamingResponse = false;
      let sseRewriter: { process(s: string): string; flush(): string } | undefined;
      // Gate the pass-through chunk emission: when translation is on we
      // don't forward raw chunks to the caller (the caller is expecting
      // src-dialect bytes, not dst-dialect).
      const passThrough = !translateCtx;

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

      let requestSent = false;

      function sendRelayRequest() {
        if (requestSent) return;
        requestSent = true;
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
                error: { code: 'GIFT_AUTH_FAILED', message: `Gift authentication failed: ${data.error ?? 'unknown'}` },
              });
              return;
            }
            authenticated = true;
            if (data.peerOnline) {
              sendRelayRequest();
            } else {
              // Wait up to 15s for sender to come online
              setPhaseTimeout(15_000, 'GIFT_SENDER_OFFLINE', 'Gift sender is not online', 503);
            }
          }

          // Sender came online while we were waiting
          if (data.type === 'relay:peer:status' && data.online && authenticated && !requestSent) {
            sendRelayRequest();
          }

          // Forward relay responses to the port
          if (data.type === 'relay:response:meta' && data.requestId === msg.requestId) {
            clearActiveTimeout();
            // Strip potentially sensitive upstream headers from relay responses
            const relayHeaders = { ...(data.headers ?? {}) };
            for (const h of ['server', 'x-request-id', 'x-cloud-trace-context', 'set-cookie', 'set-cookie2', 'alt-svc', 'via']) {
              delete relayHeaders[h];
            }
            // Decide streaming vs single-shot from Content-Type. When
            // translation is on, build the SSE rewriter now so the first
            // chunk can be processed without a race.
            const contentType = (relayHeaders['content-type'] ?? relayHeaders['Content-Type'] ?? '') as string;
            isStreamingResponse = contentType.includes('text/event-stream');
            if (translateCtx && isStreamingResponse) {
              sseRewriter = buildResponseStreamRewriter(translateCtx.translation, msg.requestId);
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
            const chunk = data.chunk ?? '';
            chunks.push(chunk);
            if (sseRewriter) {
              // Streaming + translation: rewrite each chunk before
              // forwarding so the caller sees src-dialect SSE.
              const rewritten = sseRewriter.process(chunk);
              if (rewritten) {
                responsePort.postMessage({
                  type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                  requestId: msg.requestId,
                  chunk: rewritten,
                });
              }
            } else if (passThrough) {
              responsePort.postMessage({
                type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                requestId: msg.requestId,
                chunk,
              });
            }
            // Non-streaming + translation: buffer until DONE, translate once.
          }

          if (data.type === 'relay:response:done' && data.requestId === msg.requestId) {
            clearActiveTimeout();
            if (sseRewriter) {
              const tail = sseRewriter.flush();
              if (tail) {
                responsePort.postMessage({
                  type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                  requestId: msg.requestId,
                  chunk: tail,
                });
              }
            } else if (translateCtx && !isStreamingResponse) {
              // Non-streaming + translation: translate the buffered body
              // once, emit as a single chunk to the caller.
              try {
                const translated = applyResponseTranslation(
                  translateCtx.translation,
                  translateCtx.originalBody,
                  msg.requestId,
                  chunks.join(''),
                );
                responsePort.postMessage({
                  type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                  requestId: msg.requestId,
                  chunk: translated,
                });
              } catch (err) {
                responsePort.postMessage({
                  type: 'BYOKY_PROXY_RESPONSE_ERROR',
                  requestId: msg.requestId,
                  status: 502,
                  error: { code: 'TRANSLATION_FAILED', message: err instanceof Error ? err.message : 'Response translation failed' },
                });
                ws.close();
                return;
              }
            }
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_DONE',
              requestId: msg.requestId,
            });
            // Delay close to allow relay:usage message to arrive from sender
            setTimeout(() => ws.close(), 2000);
            const fullBody = chunks.join('');
            // Parse usage/model from the upstream (dst) body when
            // translation is on — chunks[] holds the untranslated bytes.
            // effectiveProviderId for parseUsage is translateCtx's dst, or
            // the original msg.providerId otherwise.
            const effectiveProvider = translateCtx?.translation.dstProviderId ?? msg.providerId;
            const model = parseModel(msg.body);
            const usage = parseUsage(effectiveProvider, fullBody);
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
    toolNameMap: Record<string, string> = {},
    translationCtx?: BridgeTranslation,
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
        toolNameMap,
      });

      let bridgeResponded = false;
      let logEntryId: string | undefined;
      const chunks: string[] = [];
      let isStreamingResponse = false;

      nativePort.onMessage.addListener(
        (raw: unknown) => {
          const response = raw as { type: string; requestId: string; status?: number; headers?: Record<string, string>; chunk?: string; error?: string };
          if (response.requestId !== msg.requestId) return;

          if (response.type === 'proxy_response_meta') {
            bridgeResponded = true;
            const respHeaders = response.headers ?? {};
            isStreamingResponse = (respHeaders['content-type'] ?? '').includes('text/event-stream');
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_META',
              requestId: msg.requestId,
              status: response.status,
              statusText: response.status === 200 ? 'OK' : 'Error',
              headers: respHeaders,
            });
            logRequest(session, msg, response.status ?? 0).then((id) => { logEntryId = id; });
          } else if (response.type === 'proxy_response_chunk') {
            chunks.push(response.chunk ?? '');
            // Translation: route chunks through the SSE rewriter when
            // streaming, otherwise buffer for one-shot translation at done.
            if (translationCtx && isStreamingResponse && translationCtx.sseRewriter) {
              const rewritten = translationCtx.sseRewriter.process(response.chunk ?? '');
              if (rewritten) {
                responsePort.postMessage({
                  type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                  requestId: msg.requestId,
                  chunk: rewritten,
                });
              }
            } else if (!translationCtx) {
              responsePort.postMessage({
                type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                requestId: msg.requestId,
                chunk: response.chunk,
              });
            }
            // Non-streaming + translation: hold chunks until done.
          } else if (response.type === 'proxy_response_done') {
            // Flush any trailing translated bytes / emit one-shot translation.
            if (translationCtx) {
              if (isStreamingResponse && translationCtx.sseRewriter) {
                const tail = translationCtx.sseRewriter.flush();
                if (tail) {
                  responsePort.postMessage({
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
                  );
                  responsePort.postMessage({
                    type: 'BYOKY_PROXY_RESPONSE_CHUNK',
                    requestId: msg.requestId,
                    chunk: translated,
                  });
                } catch (err) {
                  responsePort.postMessage({
                    type: 'BYOKY_PROXY_RESPONSE_ERROR',
                    requestId: msg.requestId,
                    status: 502,
                    error: { code: 'TRANSLATION_FAILED', message: err instanceof Error ? err.message : 'Response translation failed' },
                  });
                  nativePort.disconnect();
                  return;
                }
              }
            }
            responsePort.postMessage({
              type: 'BYOKY_PROXY_RESPONSE_DONE',
              requestId: msg.requestId,
            });
            nativePort.disconnect();
            const fullBody = chunks.join('');
            // parseModel runs against the SDK's original body, even when
            // the bridge saw the translated body. parseUsage runs against
            // the destination format (msg.providerId here is already the
            // effective/destination provider).
            const model = parseModel(translationCtx?.originalBody ?? msg.body);
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
      persistSessions();
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
    const sessionProvider = session.providers.find((sp) => sp.providerId === providerId);
    const translation = sessionProvider?.translation;
    const swap = sessionProvider?.swap;
    const effectiveProviderId = translation?.dstProviderId ?? swap?.dstProviderId ?? providerId;

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

      // Translate the request body up front, before any branch.
      let translatedBody: string | undefined = body;
      let translatedUrl = url;
      if (translation) {
        try {
          translatedBody = applyRequestTranslation(translation, body, requestId);
        } catch (err) {
          bridgeProxyPort?.postMessage({
            type: 'proxy_http_error',
            requestId,
            error: err instanceof Error ? err.message : 'Translation failed',
          });
          return;
        }
        const isStreaming = detectStreamingRequest(body);
        const rewritten = rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming);
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
        const isStreaming = detectStreamingRequest(body);
        const rewritten = rewriteProxyUrl(swap.dstProviderId, swap.dstModel ?? '', isStreaming);
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

        bridgeProxyPort.postMessage({
          type: 'proxy_direct_fetch',
          requestId,
          url: translatedUrl,
          method,
          headers: realHeaders,
          body: finalBody,
          toolNameMap,
        });
        const model = parseModel(body);
        logRequest(session, { providerId, url, method } as ProxyRequest, 200).then((logId) => {
          if (model) updateLogEntry(logId, { model });
        });
        return;
      }

      const bridgeBody = injectStreamUsageOptions(effectiveProviderId, translatedBody);
      const response = await fetch(translatedUrl, {
        method,
        headers: realHeaders,
        body: bridgeBody || undefined,
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

      // Translation: stream rewriter for SSE responses, one-shot for JSON.
      const isStreamingResponse = (responseHeaders['content-type'] ?? '').includes('text/event-stream');
      const sseRewriter = translation && isStreamingResponse
        ? buildResponseStreamRewriter(translation, requestId)
        : undefined;

      const chunks: string[] = [];
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
          const translatedResponse = applyResponseTranslation(translation, body, requestId, chunks.join(''));
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

      const fullBody = chunks.join('');
      const model = parseModel(body);
      const usage = parseUsage(effectiveProviderId, fullBody);
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

  async function getGiftPreferences(): Promise<Record<string, string>> {
    const data = await browser.storage.local.get('giftPreferences');
    return (data.giftPreferences as Record<string, string>) ?? {};
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
  ): TranslationContext | null {
    const srcFamily = familyOf(translation.srcProviderId);
    const dstFamily = familyOf(translation.dstProviderId);
    if (!srcFamily || !dstFamily) return null;
    return {
      srcFamily: srcFamily as ModelFamily,
      dstFamily: dstFamily as ModelFamily,
      srcModel: requestBody ? parseModel(requestBody) : undefined,
      dstModel: translation.dstModel,
      isStreaming: detectStreamingRequest(requestBody),
      requestId,
    };
  }

  function detectStreamingRequest(body: string | undefined): boolean {
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
  ): string | undefined {
    if (!body) return body;
    const ctx = buildTranslationContext(translation, body, requestId);
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
  ): string {
    const ctx = buildTranslationContext(translation, requestBody, requestId);
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
  ): { process(s: string): string; flush(): string } | undefined {
    const ctx = buildTranslationContext(translation, undefined, requestId);
    if (!ctx) return undefined;
    return createStreamTranslator(ctx);
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
    const giftPrefs = await getGiftPreferences();

    for (const [sessionKey, session] of sessions) {
      const requested = session.requestedProviders;
      const providerIds = requested.length > 0 ? requested : [
        ...new Set([...credentials.map(c => c.providerId), ...giftedCreds.filter(g => g.expiresAt > Date.now() && g.usedTokens < g.maxTokens).map(g => g.providerId)]),
      ];

      // Re-resolve group binding for this session's origin (may have changed)
      const group = await getGroupForOrigin(session.appOrigin);

      const providerMap: ConnectResponse['providers'] = {};
      const newSessionProviders: Session['providers'] = [];

      for (const providerId of providerIds) {
        const groupPinnedCred =
          group && group.providerId === providerId && group.credentialId
            ? credentials.find(c => c.id === group.credentialId)
            : undefined;
        const groupPinnedGift =
          group && group.providerId === providerId && group.giftId
            ? giftedCreds.find(g => g.giftId === group.giftId && g.expiresAt > Date.now() && g.usedTokens < g.maxTokens)
            : undefined;
        const crossGiftRoute = groupPinnedGift ? undefined : resolveCrossFamilyGiftRoute(group, providerId, giftedCreds);
        const crossRoute = groupPinnedGift || crossGiftRoute ? undefined : resolveCrossFamilyRoute(group, providerId, credentials);
        const swapRoute = !crossRoute && !groupPinnedGift && !crossGiftRoute
          ? resolveSameFamilySwapRoute(group, providerId, credentials)
          : undefined;
        const cred = groupPinnedCred ?? crossRoute?.cred ?? swapRoute?.cred ?? credentials.find(c => c.providerId === providerId);
        const gc = groupPinnedGift ?? crossGiftRoute?.gc ?? giftedCreds.find(g => g.providerId === providerId && g.expiresAt > Date.now() && g.usedTokens < g.maxTokens);
        const preferGift = !!groupPinnedGift || !!crossGiftRoute || (!groupPinnedCred && !crossRoute && !swapRoute && gc && giftPrefs[providerId] === gc.giftId);
        const useGift = preferGift || (!cred && gc);
        providerMap[providerId] = { available: !!(cred || gc), authMethod: useGift ? 'api_key' : (cred?.authMethod ?? 'api_key'), ...(useGift ? { gift: true } : {}) };
        if (useGift && gc) {
          const sp: SessionProvider = { providerId, credentialId: gc.id, available: true, authMethod: 'api_key', giftId: gc.giftId, giftRelayUrl: gc.relayUrl, giftAuthToken: gc.authToken };
          if (crossGiftRoute) sp.translation = crossGiftRoute.translation;
          newSessionProviders.push(sp);
        } else if (cred) {
          const sp: SessionProvider = { providerId, credentialId: cred.id, available: true, authMethod: cred.authMethod };
          if (crossRoute) sp.translation = crossRoute.translation;
          else if (swapRoute) sp.swap = swapRoute.swap;
          newSessionProviders.push(sp);
        }
      }

      session.providers = newSessionProviders;
      persistSessions();

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

  // Ensures the default group exists. Called on first credential add and
  // before any group resolution. Returns the default group.
  async function ensureDefaultGroup(): Promise<Group> {
    const groups = await getGroups();
    let def = groups.find((g) => g.id === DEFAULT_GROUP_ID);
    if (def) return def;

    // Pick a sensible default provider/credential: the first credential the
    // user has added. If they have none yet, the default group is created
    // lazily on first add and we use the freshly-added credential's provider.
    const credentials = await getStoredCredentials();
    const first = credentials[0];
    def = {
      id: DEFAULT_GROUP_ID,
      name: 'Default',
      providerId: first?.providerId ?? 'anthropic',
      credentialId: first?.id,
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
    giftId?: string;
    model?: string;
  }): Promise<{ group?: Group; error?: string }> {
    const name = input.name?.trim();
    if (!name || name.length > 200) return { error: 'Group name must be 1-200 characters' };
    if (!PROVIDERS[input.providerId]) return { error: 'Invalid provider' };
    if (input.credentialId && input.giftId) {
      return { error: 'Credential and gift are mutually exclusive' };
    }
    if (input.credentialId) {
      const creds = await getStoredCredentials();
      const cred = creds.find((c) => c.id === input.credentialId);
      if (!cred) return { error: 'Credential not found' };
      if (cred.providerId !== input.providerId) return { error: 'Credential does not match provider' };
    }
    if (input.giftId) {
      const gcData = await browser.storage.local.get('giftedCredentials');
      const giftedCreds = (gcData.giftedCredentials ?? []) as GiftedCredential[];
      const gc = giftedCreds.find((g) => g.giftId === input.giftId);
      if (!gc) return { error: 'Gift not found' };
      if (gc.providerId !== input.providerId) return { error: 'Gift does not match provider' };
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
      giftId: input.giftId,
      model: input.model?.trim() || undefined,
      createdAt: Date.now(),
    };
    groups.push(group);
    await setGroups(groups);
    void fireVaultGroupSave(group);
    return { group };
  }

  async function updateGroup(
    id: string,
    patch: { name?: string; providerId?: string; credentialId?: string | null; giftId?: string | null; model?: string | null },
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
      // Provider change invalidates both pins unless explicitly set in this patch
      if (patch.credentialId === undefined) next.credentialId = undefined;
      if (patch.giftId === undefined) next.giftId = undefined;
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
        // Setting a credential pin clears any gift pin
        next.giftId = undefined;
      }
    }
    if (patch.giftId !== undefined) {
      if (patch.giftId === null) {
        next.giftId = undefined;
      } else {
        const gcData = await browser.storage.local.get('giftedCredentials');
        const giftedCreds = (gcData.giftedCredentials ?? []) as GiftedCredential[];
        const gc = giftedCreds.find((g) => g.giftId === patch.giftId);
        if (!gc) return { error: 'Gift not found' };
        if (gc.providerId !== next.providerId) return { error: 'Gift does not match provider' };
        next.giftId = patch.giftId;
        // Setting a gift pin clears any credential pin
        next.credentialId = undefined;
      }
    }
    if (patch.model !== undefined) {
      next.model = patch.model === null ? undefined : (patch.model.trim() || undefined);
    }
    groups[idx] = next;
    await setGroups(groups);
    void fireVaultGroupSave(next);
    return { group: next };
  }

  async function deleteGroup(id: string): Promise<{ success?: boolean; error?: string }> {
    if (id === DEFAULT_GROUP_ID) return { error: 'Cannot delete the default group' };
    const groups = await getGroups();
    if (!groups.some((g) => g.id === id)) return { error: 'Group not found' };
    await setGroups(groups.filter((g) => g.id !== id));
    // Reassign any apps that pointed at this group back to the default
    const appGroups = await getAppGroups();
    const reassignedOrigins: string[] = [];
    for (const origin of Object.keys(appGroups)) {
      if (appGroups[origin] === id) {
        appGroups[origin] = DEFAULT_GROUP_ID;
        reassignedOrigins.push(origin);
      }
    }
    if (reassignedOrigins.length > 0) await setAppGroups(appGroups);
    void fireVaultGroupDelete(id);
    for (const origin of reassignedOrigins) {
      void fireVaultAppGroupSet(origin, DEFAULT_GROUP_ID);
    }
    return { success: true };
  }

  async function setAppGroup(origin: string, groupId: string): Promise<{ success?: boolean; error?: string }> {
    const groups = await getGroups();
    if (!groups.some((g) => g.id === groupId)) return { error: 'Group not found' };
    const appGroups = await getAppGroups();
    appGroups[origin] = groupId;
    await setAppGroups(appGroups);
    void fireVaultAppGroupSet(origin, groupId);
    return { success: true };
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

      let pingInterval: ReturnType<typeof setInterval> | null = null;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'relay:auth',
          roomId: gift.id,
          authToken: gift.authToken,
          role: 'sender',
          priority: 1, // primary — takes over from vault fallback (priority 0)
        }));
        // Keep connection alive — relay has 5min idle timeout
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'relay:ping' }));
          }
        }, 2 * 60 * 1000);
      };

      ws.onmessage = async (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : '';
          if (raw.length > 10_485_760) return;
          const msg = JSON.parse(raw);

          if (msg.type === 'relay:auth:result') {
            if (!msg.success) {
              ws.close();
              giftRelayConnections.delete(gift.id);
              return;
            }
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
        if (pingInterval) clearInterval(pingInterval);
        giftRelayConnections.delete(gift.id);
        // Reconnect if gift is still active and wallet is unlocked
        setTimeout(async () => {
          if (!masterPassword) return;
          const gifts = await getGiftsFromStorage();
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

  async function getGiftsFromStorage(): Promise<Gift[]> {
    if (!masterPassword) return [];
    const data = await browser.storage.local.get('gifts');
    const stored = (data.gifts ?? []) as Gift[];
    const result: Gift[] = [];
    for (const gift of stored) {
      if (!gift.active || gift.expiresAt <= Date.now()) {
        result.push(gift);
        continue;
      }
      try {
        const decryptedToken = await decrypt(gift.authToken, masterPassword);
        result.push({ ...gift, authToken: decryptedToken });
      } catch {
        result.push(gift);
      }
    }
    return result;
  }

  // Migrate old plaintext authTokens (gft_*) to encrypted
  async function migrateGiftTokens(password: string) {
    const data = await browser.storage.local.get('gifts');
    const gifts = (data.gifts ?? []) as Gift[];
    let changed = false;
    for (const gift of gifts) {
      if (gift.authToken && gift.authToken.startsWith('gft_')) {
        try {
          gift.authToken = await encrypt(gift.authToken, password);
          changed = true;
        } catch {
          // Can't encrypt — leave as-is
        }
      }
    }
    if (changed) {
      await browser.storage.local.set({ gifts });
    }
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

        // OAuth tokens route through Bridge (native messaging) to avoid CORS restrictions
        if (credential.authMethod === 'oauth') {
          const bridgeOk = await checkBridgeAvailable();
          if (!bridgeOk) {
            ws.send(JSON.stringify({
              type: 'relay:response:error',
              requestId: msg.requestId,
              error: { code: 'BRIDGE_UNAVAILABLE', message: 'Gift sender needs Byoky Bridge installed for OAuth credentials' },
            }));
            return;
          }

          await new Promise<void>((resolve) => {
            const nativePort = browser.runtime.connectNative(BRIDGE_HOST);
            let body = injectStreamUsageOptions(gift.providerId, msg.body);
            let toolNameMap: Record<string, string> = {};
            if (gift.providerId === 'anthropic') {
              const rewritten = rewriteToolNamesForClaudeCode(body);
              const isThirdParty = Object.keys(rewritten.toolNameMap).length > 0;
              body = injectClaudeCodeSystemPrompt(rewritten.body, {
                relocateExisting: isThirdParty,
              });
              toolNameMap = rewritten.toolNameMap;
            }
            nativePort.postMessage({
              type: 'proxy',
              requestId: msg.requestId,
              url: msg.url,
              method: msg.method,
              headers: realHeaders,
              body,
              toolNameMap,
            });

            const chunks: string[] = [];
            let responded = false;

            nativePort.onMessage.addListener((raw: unknown) => {
              const resp = raw as { type: string; requestId: string; status?: number; headers?: Record<string, string>; chunk?: string };
              if (resp.requestId !== msg.requestId) return;

              if (resp.type === 'proxy_response_meta') {
                responded = true;
                ws.send(JSON.stringify({
                  type: 'relay:response:meta',
                  requestId: msg.requestId,
                  status: resp.status,
                  statusText: resp.status === 200 ? 'OK' : 'Error',
                  headers: resp.headers ?? {},
                }));
              } else if (resp.type === 'proxy_response_chunk') {
                chunks.push(resp.chunk ?? '');
                ws.send(JSON.stringify({
                  type: 'relay:response:chunk',
                  requestId: msg.requestId,
                  chunk: resp.chunk,
                }));
              } else if (resp.type === 'proxy_response_done') {
                ws.send(JSON.stringify({
                  type: 'relay:response:done',
                  requestId: msg.requestId,
                }));
                nativePort.disconnect();
                updateGiftUsage(gift, gift.providerId, chunks.join(''), ws);
                resolve();
              } else if (resp.type === 'proxy_error') {
                responded = true;
                ws.send(JSON.stringify({
                  type: 'relay:response:error',
                  requestId: msg.requestId,
                  error: { code: 'BRIDGE_ERROR', message: 'Bridge request failed' },
                }));
                nativePort.disconnect();
                resolve();
              }
            });

            nativePort.onDisconnect.addListener(() => {
              if (!responded) {
                ws.send(JSON.stringify({
                  type: 'relay:response:error',
                  requestId: msg.requestId,
                  error: { code: 'BRIDGE_ERROR', message: 'Bridge disconnected unexpectedly' },
                }));
              }
              resolve();
            });
          });
          return;
        }

        const controller = new AbortController();
        const requestTimeout = setTimeout(() => controller.abort(), 120_000);

        const giftBody = injectStreamUsageOptions(gift.providerId, msg.body);
        const giftReconstructed = reconstructBody(giftBody, undefined);
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

        await updateGiftUsage(gift, gift.providerId, chunks.join(''), ws);
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

  async function updateGiftUsage(gift: Gift, providerId: string, fullBody: string, ws: WebSocket) {
    const usage = parseUsage(providerId, fullBody);
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
  }

  async function reconnectGiftRelays() {
    if (!masterPassword) return;
    const gifts = await getGiftsFromStorage();
    for (const gift of gifts) {
      if (gift.active && gift.expiresAt > Date.now()) {
        // Sync usage from vault before reconnecting (vault may have handled requests while we were offline)
        syncGiftUsageFromVault(gift.id).catch(() => {});
        connectGiftRelay(gift);
      }
    }
  }

  // --- Cloud Vault sync ---

  const VAULT_URL = 'https://vault.byoky.com';
  let vaultSyncQueue: Promise<void> = Promise.resolve();
  let vaultAuthAttempts: number[] = [];

  function checkVaultAuthRate(): { error: string } | null {
    const now = Date.now();
    vaultAuthAttempts = vaultAuthAttempts.filter((t) => now - t < 60_000);
    if (vaultAuthAttempts.length >= 5) {
      return { error: 'Too many auth attempts — try again in a minute' };
    }
    vaultAuthAttempts.push(now);
    return null;
  }

  function enqueueVaultSync<T>(fn: () => Promise<T>): Promise<T> {
    const result = vaultSyncQueue.then(fn, fn);
    vaultSyncQueue = result.then(() => {}, () => {});
    return result;
  }

  async function vaultFetch(
    path: string,
    method: string,
    body?: Record<string, unknown>,
    token?: string,
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(`${VAULT_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: resp.ok, status: resp.status, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getCloudVaultState(): Promise<{
    enabled: boolean;
    username: string | null;
    token: string | null;
    sessionId: string | null;
    tokenIssuedAt: number;
    tokenExpired: boolean;
    credentialMap: Record<string, string>;
  }> {
    const data = await browser.storage.local.get([
      'cloudVault.enabled',
      'cloudVault.username',
      'cloudVault.token',
      'cloudVault.sessionId',
      'cloudVault.tokenIssuedAt',
      'cloudVault.tokenExpired',
      'cloudVault.credentialMap',
    ]);
    let token: string | null = data['cloudVault.token'] as string ?? null;
    if (token && masterPassword) {
      try { token = await decrypt(token, masterPassword); } catch { token = null; }
    }
    return {
      enabled: data['cloudVault.enabled'] as boolean ?? false,
      username: data['cloudVault.username'] as string ?? null,
      token,
      sessionId: data['cloudVault.sessionId'] as string ?? null,
      tokenIssuedAt: data['cloudVault.tokenIssuedAt'] as number ?? 0,
      tokenExpired: data['cloudVault.tokenExpired'] as boolean ?? false,
      credentialMap: (data['cloudVault.credentialMap'] as Record<string, string>) ?? {},
    };
  }

  async function saveCloudVaultState(
    updates: Record<string, unknown>,
  ): Promise<void> {
    const storageUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'token' && typeof value === 'string' && masterPassword) {
        storageUpdates['cloudVault.token'] = await encrypt(value, masterPassword);
      } else {
        storageUpdates[`cloudVault.${key}`] = value;
      }
    }
    await browser.storage.local.set(storageUpdates);
  }

  async function clearCloudVaultState(): Promise<void> {
    await browser.storage.local.remove([
      'cloudVault.enabled',
      'cloudVault.username',
      'cloudVault.token',
      'cloudVault.sessionId',
      'cloudVault.tokenIssuedAt',
      'cloudVault.tokenExpired',
      'cloudVault.credentialMap',
    ]);
  }

  function isVaultTokenExpired(tokenIssuedAt: number): boolean {
    return Date.now() - tokenIssuedAt > 6 * 24 * 60 * 60 * 1000; // 6 days
  }

  async function handleVaultAuthError(): Promise<void> {
    await saveCloudVaultState({ tokenExpired: true });
  }

  async function syncCredentialToVault(
    localId: string,
    providerId: string,
    label: string,
    authMethod: string,
    plainKey: string,
    token: string,
  ): Promise<void> {
    const result = await vaultFetch('/credentials', 'POST', {
      providerId,
      apiKey: plainKey,
      label,
      authMethod,
    }, token);

    if (result.status === 401) {
      await handleVaultAuthError();
      return;
    }

    if (result.ok) {
      const vaultCred = result.data.credential as Record<string, unknown>;
      const vaultId = vaultCred.id as string;
      const state = await getCloudVaultState();
      state.credentialMap[localId] = vaultId;
      await saveCloudVaultState({ credentialMap: state.credentialMap });
    }
  }

  async function syncRemoveFromVault(
    localId: string,
    token: string,
  ): Promise<void> {
    const state = await getCloudVaultState();
    const vaultId = state.credentialMap[localId];
    if (!vaultId) return;

    const result = await vaultFetch(`/credentials/${vaultId}`, 'DELETE', undefined, token);

    if (result.status === 401) {
      await handleVaultAuthError();
      return;
    }

    delete state.credentialMap[localId];
    await saveCloudVaultState({ credentialMap: state.credentialMap });
  }

  /**
   * Backfill local groups + app→group bindings to the cloud vault.
   *
   * Runs on two triggers: (1) initial cloud-vault enable, (2) wallet unlock
   * when a vault session is already configured. Idempotent — the vault
   * endpoints are upserts, so re-pushing existing rows is a no-op.
   *
   * Sequencing: credentials must sync BEFORE groups, because group rows
   * may carry a credential pin that resolves via state.credentialMap
   * (local id → vault id). Callers should await syncPendingCredentials()
   * first. If they don't, pinned groups will be pushed with credentialId
   * null and the user would need to re-save the group to fix it.
   */
  async function syncPendingGroups(): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }

    const groups = await getGroups();
    for (const group of groups) {
      const vaultCredentialId = group.credentialId
        ? state.credentialMap[group.credentialId]
        : undefined;
      try {
        const result = await vaultFetch(
          `/groups/${encodeURIComponent(group.id)}`,
          'PUT',
          {
            name: group.name,
            providerId: group.providerId,
            credentialId: vaultCredentialId ?? null,
            giftId: group.giftId ?? null,
            model: group.model ?? null,
          },
          state.token,
        );
        if (result.status === 401) {
          await handleVaultAuthError();
          return;
        }
      } catch {
        // Non-blocking — will retry next enable/unlock
      }
    }

    const appGroups = await getAppGroups();
    for (const [origin, groupId] of Object.entries(appGroups)) {
      try {
        const result = await vaultFetch(
          `/groups/apps/${encodeURIComponent(origin)}`,
          'PUT',
          { groupId },
          state.token,
        );
        if (result.status === 401) {
          await handleVaultAuthError();
          return;
        }
      } catch {
        // Non-blocking
      }
    }
  }

  async function syncPendingCredentials(): Promise<void> {
    if (!masterPassword) return;
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }

    const credentials = await getStoredCredentials();
    for (const cred of credentials) {
      if (state.credentialMap[cred.id]) continue;
      try {
        const plainKey = await decryptCredentialKey(cred);
        await syncCredentialToVault(
          cred.id, cred.providerId, cred.label, cred.authMethod, plainKey, state.token,
        );
      } catch {
        // Non-blocking — will retry next time
      }
    }
  }

  async function syncAllCredentialsToVault(token: string): Promise<void> {
    if (!masterPassword) return;
    const credentials = await getStoredCredentials();
    for (const cred of credentials) {
      try {
        const plainKey = await decryptCredentialKey(cred);
        await syncCredentialToVault(
          cred.id, cred.providerId, cred.label, cred.authMethod, plainKey, token,
        );
      } catch {
        // Non-blocking — pending sync will pick these up
      }
    }
  }

  async function fireVaultSync(localId: string, providerId: string, label: string, authMethod: string, plainKey: string): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }
    enqueueVaultSync(() => syncCredentialToVault(localId, providerId, label, authMethod, plainKey, state.token!));
  }

  async function fireVaultRemove(localId: string): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }
    enqueueVaultSync(() => syncRemoveFromVault(localId, state.token!));
  }

  // ─── Cloud Vault group sync ─────────────────────────────────────────
  //
  // Mirrors the user's group/app-group state to the vault so the vault can
  // serve as an offline replacement for the extension. Eager: every
  // mutation that lands in browser.storage.local also fires a vault sync.
  // Gated on cloudVaultEnabled and a non-expired token; failures don't
  // block the user (they get retried by syncPendingCredentials' sibling
  // syncPendingGroups on next opportunity).

  async function fireVaultGroupSave(group: Group): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }
    // The vault keys credentialId by its own credential id (returned at
    // sync time and stored in credentialMap). Translate the local pin
    // before sending — a stale local pin maps to undefined which the
    // vault treats as "no pin".
    const vaultCredentialId = group.credentialId
      ? state.credentialMap[group.credentialId]
      : undefined;
    enqueueVaultSync(async () => {
      const result = await vaultFetch(`/groups/${encodeURIComponent(group.id)}`, 'PUT', {
        name: group.name,
        providerId: group.providerId,
        credentialId: vaultCredentialId ?? null,
        giftId: group.giftId ?? null,
        model: group.model ?? null,
      }, state.token!);
      if (result.status === 401) await handleVaultAuthError();
    });
  }

  async function fireVaultGroupDelete(groupId: string): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }
    enqueueVaultSync(async () => {
      const result = await vaultFetch(`/groups/${encodeURIComponent(groupId)}`, 'DELETE', undefined, state.token!);
      if (result.status === 401) await handleVaultAuthError();
    });
  }

  async function fireVaultAppGroupSet(origin: string, groupId: string): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }
    enqueueVaultSync(async () => {
      const result = await vaultFetch(
        `/groups/apps/${encodeURIComponent(origin)}`,
        'PUT',
        { groupId },
        state.token!,
      );
      if (result.status === 401) await handleVaultAuthError();
    });
  }

  // --- Cloud Vault gift relay ---

  async function registerGiftWithVault(gift: Gift, credentialId: string): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }
    if (!masterPassword) return;

    const credentials = await getStoredCredentials();
    const credential = credentials.find((c) => c.id === credentialId);
    if (!credential) return;

    let apiKey: string;
    try {
      apiKey = await decryptCredentialKey(credential);
    } catch {
      return;
    }

    enqueueVaultSync(async () => {
      const result = await vaultFetch('/gifts', 'POST', {
        giftId: gift.id,
        providerId: gift.providerId,
        authMethod: credential.authMethod,
        apiKey,
        relayAuthToken: gift.authToken,
        relayUrl: gift.relayUrl,
        maxTokens: gift.maxTokens,
        usedTokens: gift.usedTokens,
        expiresAt: gift.expiresAt,
      }, state.token!);

      if (result.status === 401) {
        await handleVaultAuthError();
      }
    });
  }

  async function unregisterGiftFromVault(giftId: string): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }

    enqueueVaultSync(async () => {
      const result = await vaultFetch(`/gifts/${giftId}`, 'DELETE', undefined, state.token!);
      if (result.status === 401) {
        await handleVaultAuthError();
      }
    });
  }

  async function syncGiftUsageFromVault(giftId: string): Promise<void> {
    const state = await getCloudVaultState();
    if (!state.enabled || !state.token || state.tokenExpired) return;
    if (isVaultTokenExpired(state.tokenIssuedAt)) {
      await handleVaultAuthError();
      return;
    }

    const result = await vaultFetch(`/gifts/${giftId}`, 'GET', undefined, state.token!);
    if (result.status === 401) {
      await handleVaultAuthError();
      return;
    }
    if (!result.ok) return;

    const vaultGift = result.data.gift as { usedTokens: number } | undefined;
    if (!vaultGift) return;

    // If vault tracked more usage, update local
    const data = await browser.storage.local.get('gifts');
    const gifts = (data.gifts ?? []) as Gift[];
    const idx = gifts.findIndex((g) => g.id === giftId);
    if (idx !== -1 && vaultGift.usedTokens > gifts[idx].usedTokens) {
      gifts[idx].usedTokens = vaultGift.usedTokens;
      await browser.storage.local.set({ gifts });
    }
  }
});
