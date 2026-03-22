/**
 * Security invariant tests.
 *
 * These tests codify the security properties established during the audit.
 * If any of these fail, a security regression has been introduced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

function readFile(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf-8');
}

describe('security invariants', () => {
  describe('content script', () => {
    const content = readFile('packages/extension/entrypoints/content.ts');

    it('uses exact hostname match for localhost (not startsWith)', () => {
      expect(content).not.toContain("startsWith('http://localhost')");
      expect(content).not.toContain('startsWith("http://localhost")');
      expect(content).toContain("hostname !== 'localhost'");
    });

    it('blocks IPv6 loopback bypass', () => {
      expect(content).toContain("[::1]");
    });

    it('validates proxy request message structure before forwarding', () => {
      expect(content).toContain("typeof data.requestId !== 'string'");
      expect(content).toContain("typeof data.sessionKey !== 'string'");
      expect(content).toContain("typeof data.url !== 'string'");
    });

    it('validates connect message structure before forwarding', () => {
      expect(content).toContain("typeof data.id !== 'string'");
    });

    it('has an action allowlist for BYOKY_INTERNAL_FROM_PAGE', () => {
      expect(content).toContain('ALLOWED_PAGE_ACTIONS');
    });

    it('allowlist does not include sensitive actions', () => {
      const match = content.match(/ALLOWED_PAGE_ACTIONS\s*=\s*\[([^\]]+)\]/);
      expect(match).not.toBeNull();
      const actions = match![1];
      expect(actions).not.toContain('unlock');
      expect(actions).not.toContain('lock');
      expect(actions).not.toContain('encryptValue');
      expect(actions).not.toContain('decryptValue');
      expect(actions).not.toContain('getCredentials');
      expect(actions).not.toContain('getSessions');
      expect(actions).not.toContain('addCredential');
      expect(actions).not.toContain('removeCredential');
      expect(actions).not.toContain('setupWallet');
      expect(actions).not.toContain('exportVault');
      expect(actions).not.toContain('importVault');
      expect(actions).not.toContain('approveConnect');
      expect(actions).not.toContain('rejectConnect');
      expect(actions).not.toContain('revokeSession');
      expect(actions).not.toContain('setAllowance');
      expect(actions).not.toContain('removeAllowance');
    });
  });

  describe('background script', () => {
    const bg = readFile('packages/extension/entrypoints/background.ts');

    it('imports validateProxyUrl', () => {
      expect(bg).toContain('validateProxyUrl');
    });

    it('calls validateProxyUrl before fetch with API keys', () => {
      // Every fetch(msg.url or fetch(url that injects API keys must be preceded by validateProxyUrl
      const fetchCalls = bg.match(/await fetch\((msg\.url|url),/g) || [];
      const validateCalls = bg.match(/validateProxyUrl/g) || [];
      expect(validateCalls.length).toBeGreaterThanOrEqual(fetchCalls.length);
    });

    it('uses deny-by-default for portOrigin', () => {
      expect(bg).toContain('!portOrigin ||');
      expect(bg).not.toMatch(/portOrigin && portOrigin !== session\.appOrigin/);
    });

    it('strips sessionKey from getSessions response', () => {
      // getSessions should destructure and exclude sessionKey
      expect(bg).not.toMatch(/case 'getSessions':\s*\n\s*return \{ sessions: Array\.from\(sessions\.values\(\)\) \}/);
    });

    it('guards setupWallet against already-initialized wallets', () => {
      const setupSection = bg.slice(bg.indexOf("case 'setupWallet'"));
      expect(setupSection).toContain('passwordHash');
      expect(setupSection).toContain('already initialized');
    });

    it('validates origin on BYOKY_DISCONNECT', () => {
      const disconnectSection = bg.slice(
        bg.indexOf('BYOKY_DISCONNECT'),
        bg.indexOf('BYOKY_SESSION_STATUS'),
      );
      expect(disconnectSection).toContain('appOrigin');
    });

    it('has brute-force protection on unlock', () => {
      expect(bg).toContain('unlockFailures');
      expect(bg).toContain('unlockLockedUntil');
      // Verify actual lockout behavior: 5 failures triggers lock
      expect(bg).toContain('unlockFailures >= 5');
      // Verify lockout uses exponential backoff
      expect(bg).toContain('Math.pow(2, exponent)');
    });

    it('scopes trusted site auto-approval to allowedProviders', () => {
      expect(bg).toContain('scopeProvidersForTrust');
      expect(bg).toContain('trustedSite.allowedProviders');
      // Must NOT auto-approve without allowedProviders
      expect(bg).not.toContain("trustedSites.some((s) => s.origin === origin)");
    });

    it('stores allowedProviders when trusting a site', () => {
      expect(bg).toContain('addTrustedSite(pending.approval.appOrigin, approvedProviderIds)');
    });

    it('clears sessions on wallet lock', () => {
      const lockSection = bg.slice(bg.indexOf("case 'lock'"), bg.indexOf("case 'isUnlocked'"));
      expect(lockSection).toContain('sessions.clear()');
      expect(lockSection).toContain('authorizedBridgeSessionKey = null');
    });

    it('has rate limiting on connect requests with cleanup', () => {
      expect(bg).toContain('isConnectRateLimited');
      expect(bg).toContain('CONNECT_RATE_LIMIT');
      // Must clean up stale entries to prevent memory leak
      expect(bg).toContain('connectRateLimit.delete(key)');
    });

    it('has rate limiting on OAuth flow', () => {
      expect(bg).toContain('isOAuthRateLimited');
      expect(bg).toContain('OAUTH_RATE_LIMIT');
    });

    it('wraps credential decryption in try-catch', () => {
      const fn = bg.slice(bg.indexOf('async function decryptCredentialKey'));
      expect(fn).toContain('try {');
      expect(fn).toContain('Failed to decrypt credential');
    });

    it('strips sensitive headers from relay responses on recipient side', () => {
      const relayHandler = bg.slice(bg.indexOf('function proxyViaGiftRelay'));
      expect(relayHandler).toContain("delete relayHeaders[");
      expect(relayHandler).toContain("'server'");
    });

    it('strips sensitive headers from relay responses on sender side', () => {
      const handler = bg.slice(bg.indexOf('function handleGiftProxyRequest'));
      expect(handler).toContain("delete respHeaders[");
    });

    it('clears authorizedBridgeSessionKey on session revocation', () => {
      const revokeSection = bg.slice(bg.indexOf("case 'revokeSession'"), bg.indexOf("case 'checkBridge'"));
      expect(revokeSection).toContain('authorizedBridgeSessionKey');
    });

    it('clears authorizedBridgeSessionKey on disconnect', () => {
      const disconnectSection = bg.slice(
        bg.indexOf('BYOKY_DISCONNECT'),
        bg.indexOf('BYOKY_SESSION_STATUS'),
      );
      expect(disconnectSection).toContain('authorizedBridgeSessionKey');
    });

    it('pins bridge proxy session key', () => {
      expect(bg).toContain('authorizedBridgeSessionKey');
    });

    it('checks session expiry in handleBridgeProxyRequest', () => {
      const bridgeHandler = bg.slice(bg.indexOf('handleBridgeProxyRequest'));
      expect(bridgeHandler).toContain('expiresAt');
      expect(bridgeHandler).toContain('Session has expired');
    });

    it('checks allowance in handleBridgeProxyRequest', () => {
      const bridgeHandler = bg.slice(bg.indexOf('handleBridgeProxyRequest'));
      expect(bridgeHandler).toContain('checkAllowance');
    });

    it('validates bridge proxy providerId against session providers', () => {
      const bridgeHandler = bg.slice(bg.indexOf('handleBridgeProxyRequest'));
      expect(bridgeHandler).toContain('Provider not available in this session');
      expect(bridgeHandler).toContain('p.providerId === providerId');
    });

    it('strips query params from request log URLs', () => {
      expect(bg).toContain('parsed.search');
      expect(bg).toContain('sanitizedUrl');
      // Verify the sanitized URL replaces the original
      const logSection = bg.slice(bg.indexOf('async function logRequest'));
      expect(logSection).toContain("parsed.search = ''");
      expect(logSection).toContain('url: sanitizedUrl');
    });

    it('validates session expiry before proxying', () => {
      // Main proxy path checks session.expiresAt
      expect(bg).toContain('session.expiresAt < Date.now()');
      // And deletes expired sessions
      expect(bg).toContain('sessions.delete(msg.sessionKey)');
    });

    it('uses deny-by-default for session status origin', () => {
      const statusSection = bg.slice(bg.indexOf('BYOKY_SESSION_STATUS'), bg.indexOf('BYOKY_SESSION_USAGE'));
      expect(statusSection).toContain("statusOrigin === 'unknown'");
      // Must deny when origin is unknown, not allow
      expect(statusSection).not.toContain("statusOrigin !== 'unknown' && statusOrigin !== session.appOrigin");
    });

    it('uses deny-by-default for session usage origin', () => {
      // Find the usage handler (starts with the type check)
      const usageStart = bg.indexOf("message.type === 'BYOKY_SESSION_USAGE'");
      const usageSection = bg.slice(usageStart, usageStart + 500);
      expect(usageSection).toContain("usageOrigin === 'unknown'");
      // Must deny when origin is unknown
      expect(usageSection).not.toContain("usageOrigin !== 'unknown' && usageOrigin !== session.appOrigin");
    });

    it('validates OAuth token response before encrypting', () => {
      expect(bg).toContain('OAuth provider returned no access token');
      expect(bg).toContain("typeof tokens.access_token !== 'string'");
    });

    it('does not leak raw OAuth error responses', () => {
      // Should not include raw error body from provider
      expect(bg).not.toContain('Token exchange failed: ${err}');
    });
  });

  describe('proxy-utils', () => {
    const proxyUtils = readFile('packages/core/src/proxy-utils.ts');

    it('validateProxyUrl explicitly checks for HTTPS', () => {
      expect(proxyUtils).toContain("target.protocol !== 'https:'");
    });

    it('buildHeaders normalizes keys to lowercase', () => {
      expect(proxyUtils).toContain('key.toLowerCase()');
    });

    it('sanitizes token counts to non-negative integers', () => {
      expect(proxyUtils).toContain('sanitizeTokenCounts');
      expect(proxyUtils).toContain('Math.max(0');
      expect(proxyUtils).toContain('Number.isFinite');
    });

    it('buildHeaders strips all auth header variants', () => {
      expect(proxyUtils).toContain("delete headers['authorization']");
      expect(proxyUtils).toContain("delete headers['x-api-key']");
      expect(proxyUtils).toContain("delete headers['api-key']");
    });
  });

  describe('crypto', () => {
    const crypto = readFile('packages/core/src/crypto.ts');

    it('uses constant-time comparison for password verification', () => {
      // Must NOT use Array.every (short-circuits)
      expect(crypto).not.toContain('originalHash.every');
      // Must use XOR-reduce
      expect(crypto).toContain('result |=');
    });

    it('uses 600K PBKDF2 iterations', () => {
      expect(crypto).toContain('600_000');
    });

    it('generates fresh IV and salt per encryption', () => {
      expect(crypto).toContain('crypto.getRandomValues(new Uint8Array(SALT_LENGTH))');
      expect(crypto).toContain('crypto.getRandomValues(new Uint8Array(IV_LENGTH))');
    });

    it('sets CryptoKey as non-extractable', () => {
      // deriveKey extractable param must be false
      expect(crypto).toMatch(/deriveKey\(\s*\{[^}]+\}[\s\S]*?false\s*,/m);
    });
  });

  describe('sdk', () => {
    const sdk = readFile('packages/sdk/src/byoky.ts');

    it('uses window.location.origin instead of wildcard for postMessage', () => {
      expect(sdk).not.toContain("'*'");
      expect(sdk).toContain('window.location.origin');
    });
  });

  describe('relay', () => {
    const relayClient = readFile('packages/sdk/src/relay-client.ts');

    it('enforces TLS via URL parsing (not startsWith)', () => {
      expect(relayClient).not.toContain("startsWith('wss://')");
      expect(relayClient).toContain("parsed.protocol === 'wss:'");
      expect(relayClient).toContain("parsed.hostname === 'localhost'");
    });

    it('sends a separate relayId instead of real sessionKey', () => {
      expect(relayClient).toContain('relayId');
      expect(relayClient).toContain('sessionId: relayId');
    });

    it('validates IPv6 loopback for WebSocket URLs', () => {
      expect(relayClient).toContain("[::1]");
    });
  });

  describe('bridge proxy', () => {
    const proxy = readFile('packages/bridge/src/proxy-server.ts');

    it('has no CORS headers', () => {
      expect(proxy).not.toContain('Access-Control-Allow-Origin');
    });

    it('validates Host header against DNS rebinding', () => {
      expect(proxy).toContain("hostWithoutPort !== '127.0.0.1'");
      expect(proxy).toContain("hostWithoutPort !== 'localhost'");
    });

    it('limits request body size', () => {
      expect(proxy).toContain('MAX_BODY_SIZE');
    });

    it('limits URI length', () => {
      expect(proxy).toContain('MAX_URI_LENGTH');
      expect(proxy).toContain('URI too long');
    });

    it('limits concurrent pending requests', () => {
      expect(proxy).toContain('MAX_PENDING_REQUESTS');
    });

    it('uses crypto.randomUUID for request IDs', () => {
      expect(proxy).toContain('crypto.randomUUID()');
    });

    it('pre-validates Content-Length header before reading body', () => {
      expect(proxy).toContain("content-length");
      expect(proxy).toContain('Payload too large');
    });

    it('strips set-cookie headers from proxy responses', () => {
      expect(proxy).toContain("delete headers['set-cookie']");
    });

    it('strips auth and cookie headers from forwarded requests', () => {
      expect(proxy).toContain("'authorization'");
      expect(proxy).toContain("'cookie'");
      expect(proxy).toContain("'proxy-authorization'");
    });
  });

  describe('bridge host', () => {
    const host = readFile('packages/bridge/src/host.ts');

    it('limits native message size', () => {
      expect(host).toContain('1_048_576');
    });
  });

  describe('extension manifest', () => {
    const manifest = readFile('packages/extension/wxt.config.ts');

    it('has explicit Content Security Policy', () => {
      expect(manifest).toContain('content_security_policy');
      expect(manifest).toContain("script-src 'self'");
      expect(manifest).toContain("object-src 'self'");
    });
  });

  describe('gift relay server', () => {
    const relay = readFile('packages/gift-relay/src/server.ts');

    it('uses constant-time comparison without timing leak on length', () => {
      expect(relay).toContain('Buffer.alloc(maxLen)');
      expect(relay).toContain('timingSafeEqual(a, b)');
    });
  });

  describe('gift relay security', () => {
    const bg = readFile('packages/extension/entrypoints/background.ts');

    it('validates relay URL protocol before connecting', () => {
      // connectGiftRelay must validate wss:// or localhost ws://
      const relaySection = bg.slice(bg.indexOf('function connectGiftRelay'));
      expect(relaySection).toContain("parsed.protocol === 'wss:'");
      expect(relaySection).toContain("parsed.hostname === 'localhost'");
    });

    it('validates gift creation inputs', () => {
      const createSection = bg.slice(bg.indexOf("case 'createGift'"), bg.indexOf("case 'getGifts'"));
      expect(createSection).toContain('Invalid provider');
      expect(createSection).toContain('Invalid maxTokens');
      expect(createSection).toContain('Invalid expiry');
      expect(createSection).toContain('Invalid relay URL');
    });

    it('checks gift budget before proxying', () => {
      const handler = bg.slice(bg.indexOf('handleGiftProxyRequest'));
      expect(handler).toContain('usedTokens >= c.maxTokens');
      expect(handler).toContain('GIFT_BUDGET_EXHAUSTED');
    });

    it('checks gift expiry before proxying', () => {
      const handler = bg.slice(bg.indexOf('handleGiftProxyRequest'));
      expect(handler).toContain('current.expiresAt');
      expect(handler).toContain('GIFT_EXPIRED');
    });

    it('validates URL in gift proxy requests', () => {
      const handler = bg.slice(bg.indexOf('handleGiftProxyRequest'));
      expect(handler).toContain('validateProxyUrl');
    });

    it('uses atomic gift budget updates with re-check under lock', () => {
      expect(bg).toContain('giftBudgetLocks');
      // Must re-validate budget inside the locked section to prevent overspend
      const lockSection = bg.slice(bg.indexOf('giftBudgetLocks.get(gift.id)'));
      expect(lockSection).toContain('usedTokens + totalTokens > refreshGifts');
    });

    it('checks gift budget under lock before proxying', () => {
      const handler = bg.slice(bg.indexOf('handleGiftProxyRequest'));
      // Budget check must acquire the lock to prevent race conditions
      expect(handler).toContain('budgetPrev = giftBudgetLocks.get(gift.id)');
      expect(handler).toContain('budgetCheck');
    });

    it('has request timeout on gift proxy fetch', () => {
      const handler = bg.slice(bg.indexOf('handleGiftProxyRequest'));
      expect(handler).toContain('AbortController');
      expect(handler).toContain('controller.abort()');
    });

    it('does not leak error details in gift proxy responses', () => {
      const handler = bg.slice(bg.indexOf('handleGiftProxyRequest'));
      const catchBlock = handler.slice(handler.lastIndexOf('catch ('));
      expect(catchBlock).not.toContain('(error as Error).message');
    });

    it('does not leak raw error messages in any proxy responses', () => {
      // No proxy/bridge error path should expose raw Error.message to clients
      expect(bg).not.toContain("code: 'PROXY_ERROR', message: (error as Error).message");
      expect(bg).not.toContain("message: response.error ||");
    });

    it('validates relay URL on recipient side too', () => {
      const recipientHandler = bg.slice(bg.indexOf('proxyViaGiftRelay'));
      expect(recipientHandler).toContain("relayParsed.protocol === 'wss:'");
      expect(recipientHandler).toContain('Insecure relay URL rejected');
    });

    it('has request-level timeout on recipient gift relay', () => {
      const recipientHandler = bg.slice(bg.indexOf('proxyViaGiftRelay'));
      // Must have both auth phase timeout AND request phase timeout
      expect(recipientHandler).toContain('Gift relay connection timed out');
      expect(recipientHandler).toContain('Gift relay request timed out');
      expect(recipientHandler).toContain('120_000');
    });
  });

  describe('openclaw plugin', () => {
    const plugin = readFile('packages/openclaw-plugin/src/index.ts');

    it('uses fixed CORS origin (not echoed)', () => {
      expect(plugin).toContain("'Access-Control-Allow-Origin', 'http://127.0.0.1'");
      // Must not echo back the request origin
      expect(plugin).not.toContain('isLocalhost ? reqOrigin');
    });

    it('limits request body size', () => {
      expect(plugin).toContain('MAX_BODY_SIZE');
    });

    it('validates provider ID in buildAuthPage', () => {
      expect(plugin).toContain('VALID_PROVIDER_IDS');
      expect(plugin).toContain('JSON.stringify(requestProviderId)');
    });
  });

  describe('popup isolation', () => {
    const store = readFile('packages/extension/entrypoints/popup/store.ts');

    it('does not access browser.storage.local directly', () => {
      expect(store).not.toContain('browser.storage.local');
    });

    it('does not cache plaintext passwords', () => {
      expect(store).not.toContain('cachedPassword');
      expect(store).not.toContain('masterPassword');
    });

    it('does not import encrypt or decrypt from core', () => {
      // encrypt/decrypt should only happen in background
      const importLine = store.match(/from '@byoky\/core'/)?.[0];
      expect(store).not.toMatch(/import\s*\{[^}]*\bencrypt\b[^}]*\}\s*from\s*'@byoky\/core'/);
      expect(store).not.toMatch(/import\s*\{[^}]*\bdecrypt\b[^}]*\}\s*from\s*'@byoky\/core'/);
    });
  });

  describe('web security headers', () => {
    const nextConfig = readFile('packages/web/next.config.ts');

    it('sets Content-Security-Policy', () => {
      expect(nextConfig).toContain('Content-Security-Policy');
    });

    it('sets X-Content-Type-Options', () => {
      expect(nextConfig).toContain('nosniff');
    });

    it('sets X-Frame-Options', () => {
      expect(nextConfig).toContain('DENY');
    });
  });
});
