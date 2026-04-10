import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../src/app.js';
import { initDb, getDb } from '../src/db/index.js';
import { startIdleSweep, stopIdleSweep, evictAll } from '../src/session-keys.js';

const DATABASE_URL = process.env.DATABASE_URL;

const TEST_PREFIX = `test_${Date.now()}_`;
const testUsername = `${TEST_PREFIX}user`;
const testPassword = 'MyStr0ng!Pass#2024';
const testOrigin = 'https://test-app.example.com';

let userToken: string;
let appSessionToken: string;
let credentialId: string;

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

function userAuthReq(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${userToken}`);
  return app.request(path, { ...init, headers });
}

function appAuthReq(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${appSessionToken}`);
  return app.request(path, { ...init, headers });
}

describe.skipIf(!DATABASE_URL)('vault integration', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'integration-test-secret-that-is-at-least-32-characters-long';
    initDb(DATABASE_URL!);
    startIdleSweep();
  });

  afterAll(async () => {
    stopIdleSweep();
    evictAll();
    const db = getDb();
    await db.execute(sql`DELETE FROM request_log WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM app_groups WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM groups WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM credentials WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM users WHERE username = ${testUsername}`);
  });

  // ─── Auth ────────────────────────────────────────────────────────────

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
      userToken = body.token;
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
    it('logs in and returns token', async () => {
      const res = await req('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      userToken = body.token;
    });
  });

  // ─── Auth middleware ─────────────────────────────────────────────────

  describe('auth middleware', () => {
    it('rejects missing token', async () => {
      const res = await req('/credentials');
      expect(res.status).toBe(401);
    });
  });

  // ─── Credentials ─────────────────────────────────────────────────────

  describe('POST /credentials', () => {
    it('adds an OpenAI credential', async () => {
      const res = await userAuthReq('/credentials', {
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
      credentialId = body.credential.id;
    });
  });

  // ─── Groups ──────────────────────────────────────────────────────────

  describe('POST /groups', () => {
    it('lists default group on fresh user', async () => {
      const res = await userAuthReq('/groups');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.groups.find((g: { id: string }) => g.id === 'default')).toBeDefined();
    });

    it('creates a new group bound to openai', async () => {
      const res = await userAuthReq('/groups/g-openai', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'OpenAI direct',
          providerId: 'openai',
          credentialId,
          model: 'gpt-4o-mini',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.group.providerId).toBe('openai');
      expect(body.group.model).toBe('gpt-4o-mini');
    });

    it('rejects group bound to unknown credential', async () => {
      const res = await userAuthReq('/groups/g-bad', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad',
          providerId: 'openai',
          credentialId: 'cred-does-not-exist',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects deleting the default group', async () => {
      const res = await userAuthReq('/groups/default', { method: 'DELETE' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /groups/apps/:origin', () => {
    it('binds an origin to a group', async () => {
      const res = await userAuthReq(`/groups/apps/${encodeURIComponent(testOrigin)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: 'g-openai' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.app.origin).toBe(testOrigin);
      expect(body.app.groupId).toBe('g-openai');
    });

    it('rejects binding to a nonexistent group', async () => {
      const res = await userAuthReq(`/groups/apps/${encodeURIComponent('https://other.example.com')}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: 'g-missing' }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Connect handshake ───────────────────────────────────────────────

  describe('POST /connect', () => {
    it('rejects missing origin', async () => {
      const res = await userAuthReq('/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providers: [{ id: 'openai' }] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('MISSING_ORIGIN');
    });

    it('returns app session token and provider availability', async () => {
      const res = await userAuthReq('/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appOrigin: testOrigin,
          providers: [{ id: 'openai' }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.appSessionToken).toBeDefined();
      expect(body.origin).toBe(testOrigin);
      expect(body.groupId).toBe('g-openai');
      expect(body.providers.openai.available).toBe(true);
      appSessionToken = body.appSessionToken;
    });

    it('reports provider unavailable when no credential resolves', async () => {
      const res = await userAuthReq('/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appOrigin: 'https://anthropic-only.example.com',
          providers: [{ id: 'anthropic' }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers.anthropic.available).toBe(false);
    });
  });

  // ─── Proxy ───────────────────────────────────────────────────────────

  describe('POST /proxy', () => {
    it('rejects without app session token', async () => {
      const res = await req('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it('rejects URL that does not match provider', async () => {
      const res = await appAuthReq('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'openai',
          url: 'https://evil.example.com/steal-key',
        }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_URL');
    });

    it('returns NO_CREDENTIAL with actionable message when nothing resolves', async () => {
      // Use a fresh app session for an origin that has no group → falls
      // back to the default group, which is sentinel-empty → falls through
      // to direct credential lookup → no anthropic credential → fails.
      const handshake = await userAuthReq('/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appOrigin: 'https://no-routing.example.com',
          providers: [{ id: 'anthropic' }],
        }),
      });
      const { appSessionToken: bareToken } = await handshake.json();

      const res = await app.request('/proxy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bareToken}`,
        },
        body: JSON.stringify({
          providerId: 'anthropic',
          url: 'https://api.anthropic.com/v1/messages',
        }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NO_CREDENTIAL');
      // Phrase 2: user has openai but not anthropic.
      expect(body.error.message).toContain('You have keys for: openai');
    });
  });

  // ─── Logout ──────────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('logs out and invalidates session', async () => {
      const res = await userAuthReq('/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);

      const res2 = await userAuthReq('/credentials');
      expect(res2.status).toBe(401);
    });
  });
});
