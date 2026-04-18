import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deriveKey, encryptWithKey } from '@byoky/core';

const VAULT_URL = process.env.VAULT_URL ?? 'https://vault.byoky.com';

const TEST_PREFIX = `e2e_${Date.now()}_`;
const testUsername = `${TEST_PREFIX}user`;
const testPassword = 'MyStr0ng!Pass#2024';

let token: string;
let credentialId: string;
let vaultKey: CryptoKey;

async function api(path: string, init?: RequestInit) {
  return fetch(`${VAULT_URL}${path}`, init);
}

async function authApi(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  return fetch(`${VAULT_URL}${path}`, { ...init, headers });
}

beforeAll(async () => {
  // Verify vault is reachable
  const res = await api('/connect');
  expect(res.status).toBe(401); // should reject unauthenticated
});

describe('vault e2e', () => {
  // --- Signup ---

  describe('signup flow', () => {
    it('rejects weak password', async () => {
      const res = await api('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'weak' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('WEAK_PASSWORD');
    });

    it('creates account', async () => {
      const res = await api('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe(testUsername);
      expect(body.encryptionSalt).toBeDefined();
      token = body.token;
      const saltBytes = Uint8Array.from(Buffer.from(body.encryptionSalt, 'base64'));
      vaultKey = await deriveKey(testPassword, saltBytes, true);
    });

    it('rejects duplicate signup', async () => {
      const res = await api('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
      });
      expect(res.status).toBe(409);
    });
  });

  // --- Login ---

  describe('login flow', () => {
    it('rejects wrong password', async () => {
      const res = await api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'WrongP@ssw0rd!!!' }),
      });
      expect(res.status).toBe(401);
    });

    it('logs in successfully', async () => {
      const res = await api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeDefined();
      expect(body.encryptionSalt).toBeDefined();
      token = body.token;
      const saltBytes = Uint8Array.from(Buffer.from(body.encryptionSalt, 'base64'));
      vaultKey = await deriveKey(testPassword, saltBytes, true);
    });
  });

  // --- Credentials CRUD ---

  describe('credentials', () => {
    it('starts with empty list', async () => {
      const res = await authApi('/credentials');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.credentials).toEqual([]);
    });

    it('adds an OpenAI credential', async () => {
      const res = await authApi('/credentials', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'openai',
          encryptedApiKey: await encryptWithKey('sk-e2e-test-1234567890ab', vaultKey),
          label: 'E2E Test Key',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.credential.providerId).toBe('openai');
      expect(body.credential.label).toBe('E2E Test Key');
      credentialId = body.credential.id;
    });

    it('lists the credential', async () => {
      const res = await authApi('/credentials');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.credentials).toHaveLength(1);
      expect(body.credentials[0].id).toBe(credentialId);
      expect(body.credentials[0].maskedKey).toBe('sk-e...90ab');
    });

    it('rejects unknown provider', async () => {
      const res = await authApi('/credentials', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'nonexistent', encryptedApiKey: await encryptWithKey('key', vaultKey) }),
      });
      expect(res.status).toBe(400);
    });
  });

  // --- Connect handshake (new app-session flow) ---

  describe('connect handshake', () => {
    let appSessionToken: string;

    it('rejects missing origin', async () => {
      const res = await authApi('/connect', {
        method: 'POST',
        body: JSON.stringify({ providers: [{ id: 'openai' }] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('MISSING_ORIGIN');
    });

    it('returns app session token and provider availability', async () => {
      const res = await authApi('/connect', {
        method: 'POST',
        body: JSON.stringify({
          appOrigin: 'https://e2e.example.com',
          providers: [{ id: 'openai' }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.appSessionToken).toBeDefined();
      expect(body.origin).toBe('https://e2e.example.com');
      expect(body.groupId).toBe('default');
      expect(body.providers.openai).toEqual({
        available: true,
        authMethod: 'api_key',
      });
      appSessionToken = body.appSessionToken;
    });

    it('reports providers without credentials as unavailable', async () => {
      const res = await authApi('/connect', {
        method: 'POST',
        body: JSON.stringify({
          appOrigin: 'https://e2e.example.com',
          providers: [{ id: 'anthropic' }],
        }),
      });
      const body = await res.json();
      expect(body.providers.anthropic.available).toBe(false);
    });

    // --- Proxy security (needs the app session token) ---

    describe('proxy security', () => {
      async function appAuthApi(path: string, init?: RequestInit) {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${appSessionToken}`);
        headers.set('content-type', 'application/json');
        return fetch(`${VAULT_URL}${path}`, { ...init, headers });
      }

      it('rejects URL not matching provider', async () => {
        const res = await appAuthApi('/proxy', {
          method: 'POST',
          body: JSON.stringify({
            providerId: 'openai',
            url: 'https://evil.com/v1/chat/completions',
          }),
        });
        expect(res.status).toBe(403);
      });

      it('rejects HTTP URLs', async () => {
        const res = await appAuthApi('/proxy', {
          method: 'POST',
          body: JSON.stringify({
            providerId: 'openai',
            url: 'http://api.openai.com/v1/chat/completions',
          }),
        });
        expect(res.status).toBe(403);
      });

      it('rejects provider with no credential', async () => {
        const res = await appAuthApi('/proxy', {
          method: 'POST',
          body: JSON.stringify({
            providerId: 'anthropic',
            url: 'https://api.anthropic.com/v1/messages',
          }),
        });
        expect(res.status).toBe(404);
      });

      it('rejects app session token on user-only routes', async () => {
        const res = await appAuthApi('/credentials');
        expect(res.status).toBe(401);
      });
    });
  });

  // --- Delete credential ---

  describe('delete credential', () => {
    it('deletes the credential', async () => {
      const res = await authApi(`/credentials/${credentialId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);

      const listRes = await authApi('/credentials');
      const body = await listRes.json();
      expect(body.credentials).toHaveLength(0);
    });
  });

  // --- Logout ---

  describe('logout', () => {
    it('logs out successfully', async () => {
      const res = await authApi('/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('token is invalid after logout', async () => {
      const res = await authApi('/credentials');
      expect(res.status).toBe(401);
    });
  });

  // --- Unauthenticated access ---

  describe('unauthenticated access', () => {
    it('rejects all protected routes', async () => {
      const routes = [
        ['GET', '/credentials'],
        ['POST', '/credentials'],
        ['POST', '/connect'],
        ['POST', '/proxy'],
        ['POST', '/auth/logout'],
      ];

      for (const [method, path] of routes) {
        const res = await api(path, { method });
        expect(res.status).toBe(401);
      }
    });
  });

  // --- CORS ---

  describe('CORS', () => {
    it('responds to preflight requests', async () => {
      const res = await api('/auth/login', {
        method: 'OPTIONS',
        headers: {
          'origin': 'https://example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,authorization',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });
});

afterAll(async () => {
  // Clean up: log in again and delete the user's data
  // The user account remains (no delete user endpoint) but credentials/sessions are cleaned
  const loginRes = await api('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: testUsername, password: testPassword }),
  });
  if (loginRes.ok) {
    const { token: cleanupToken } = await loginRes.json();
    await fetch(`${VAULT_URL}/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cleanupToken}` },
    });
  }
});
