import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../src/app.js';
import { initDb, getDb } from '../src/db/index.js';
import { startIdleSweep, stopIdleSweep, evictAll } from '../src/session-keys.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL required for integration tests');

const TEST_PREFIX = `test_${Date.now()}_`;
const testUsername = `${TEST_PREFIX}user`;
const testPassword = 'MyStr0ng!Pass#2024';

let token: string;
let credentialId: string;

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

function authReq(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  return app.request(path, { ...init, headers });
}

beforeAll(() => {
  process.env.JWT_SECRET = 'integration-test-secret-that-is-at-least-32-characters-long';
  initDb(DATABASE_URL);
  startIdleSweep();
});

afterAll(async () => {
  stopIdleSweep();
  evictAll();
  const db = getDb();
  await db.execute(sql`DELETE FROM request_log WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
  await db.execute(sql`DELETE FROM credentials WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
  await db.execute(sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
  await db.execute(sql`DELETE FROM users WHERE username = ${testUsername}`);
});

describe('vault integration', () => {
  // --- Auth ---

  describe('POST /auth/signup', () => {
    it('rejects missing fields', async () => {
      const res = await req('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('rejects weak password', async () => {
      const res = await req('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'short' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('WEAK_PASSWORD');
    });

    it('rejects invalid username', async () => {
      const res = await req('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'a', password: testPassword }),
      });
      expect(res.status).toBe(400);
    });

    it('creates account and returns token', async () => {
      const res = await req('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe(testUsername);
      expect(body.sessionId).toBeDefined();
      token = body.token;
    });

    it('rejects duplicate username', async () => {
      const res = await req('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /auth/login', () => {
    it('rejects wrong password', async () => {
      const res = await req('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'WrongP@ssw0rd!!!' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects unknown username', async () => {
      const res = await req('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'nobody-exists-here', password: testPassword }),
      });
      expect(res.status).toBe(401);
    });

    it('logs in and returns token', async () => {
      const res = await req('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe(testUsername);
      token = body.token;
    });
  });

  // --- Auth middleware ---

  describe('auth middleware', () => {
    it('rejects missing token', async () => {
      const res = await req('/credentials');
      expect(res.status).toBe(401);
    });

    it('rejects invalid token', async () => {
      const res = await req('/credentials', {
        headers: { authorization: 'Bearer invalid.token.here' },
      });
      expect(res.status).toBe(401);
    });
  });

  // --- Credentials ---

  describe('POST /credentials', () => {
    it('rejects missing fields', async () => {
      const res = await authReq('/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('rejects unknown provider', async () => {
      const res = await authReq('/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'fakeprovider', apiKey: 'sk-test' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_PROVIDER');
    });

    it('adds a credential', async () => {
      const res = await authReq('/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'openai',
          apiKey: 'sk-test-1234567890abcdef',
          label: 'Test OpenAI key',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.credential.providerId).toBe('openai');
      expect(body.credential.label).toBe('Test OpenAI key');
      expect(body.credential.maskedKey).toBe('sk-t...cdef');
      credentialId = body.credential.id;
    });
  });

  describe('GET /credentials', () => {
    it('lists credentials with masked keys', async () => {
      const res = await authReq('/credentials');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.credentials.length).toBeGreaterThanOrEqual(1);
      const cred = body.credentials.find((c: any) => c.id === credentialId);
      expect(cred).toBeDefined();
      expect(cred.maskedKey).toBe('sk-t...cdef');
      expect(cred.providerId).toBe('openai');
    });
  });

  // --- Connect ---

  describe('GET /connect', () => {
    it('returns available providers', async () => {
      const res = await authReq('/connect');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers.openai).toBeDefined();
      expect(body.providers.openai.available).toBe(true);
      expect(body.providers.openai.authMethod).toBe('api_key');
    });
  });

  // --- Proxy ---

  describe('POST /proxy', () => {
    it('rejects missing fields', async () => {
      const res = await authReq('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('rejects URL that does not match provider', async () => {
      const res = await authReq('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'openai',
          url: 'https://evil.com/steal-key',
        }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_URL');
    });

    it('rejects provider with no credential', async () => {
      const res = await authReq('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'anthropic',
          url: 'https://api.anthropic.com/v1/messages',
        }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NO_CREDENTIAL');
    });
  });

  // --- Delete credential ---

  describe('DELETE /credentials/:id', () => {
    it('rejects nonexistent credential', async () => {
      const res = await authReq('/credentials/nonexistent-id', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });

    it('deletes the credential', async () => {
      const res = await authReq(`/credentials/${credentialId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const listRes = await authReq('/credentials');
      const listBody = await listRes.json();
      const deleted = listBody.credentials.find((c: any) => c.id === credentialId);
      expect(deleted).toBeUndefined();
    });
  });

  // --- Logout ---

  describe('POST /auth/logout', () => {
    it('logs out and invalidates session', async () => {
      const res = await authReq('/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Token should no longer work
      const res2 = await authReq('/credentials');
      expect(res2.status).toBe(401);
    });
  });

  // --- 404 ---

  describe('unknown routes', () => {
    it('returns 404', async () => {
      const res = await req('/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
