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

    it('strips query params from request log URLs', () => {
      expect(bg).toContain('parsed.search');
      expect(bg).toContain('sanitizedUrl');
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

    it('limits concurrent pending requests', () => {
      expect(proxy).toContain('MAX_PENDING_REQUESTS');
    });

    it('uses crypto.randomUUID for request IDs', () => {
      expect(proxy).toContain('crypto.randomUUID()');
    });
  });

  describe('bridge host', () => {
    const host = readFile('packages/bridge/src/host.ts');

    it('limits native message size', () => {
      expect(host).toContain('1_048_576');
    });
  });

  describe('openclaw plugin', () => {
    const plugin = readFile('packages/openclaw-plugin/src/index.ts');

    it('uses exact hostname match for CORS (not startsWith)', () => {
      expect(plugin).not.toContain("startsWith('http://127.0.0.1')");
      expect(plugin).toContain("parsed.hostname === '127.0.0.1'");
    });

    it('validates provider ID in buildAuthPage', () => {
      expect(plugin).toContain('VALID_PROVIDER_IDS');
      expect(plugin).toContain('JSON.stringify(requestProviders)');
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
