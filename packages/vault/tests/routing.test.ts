import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../src/app.js';
import { initDb, getDb } from '../src/db/index.js';
import { startIdleSweep, stopIdleSweep, evictAll } from '../src/session-keys.js';

const DATABASE_URL = process.env.DATABASE_URL;

const TEST_PREFIX = `routing_${Date.now()}_`;
const testUsername = `${TEST_PREFIX}user`;
const testPassword = 'MyStr0ng!Pass#2024';

let userToken: string;
let openaiCredId: string;
let anthropicCredId: string;

const realFetch = globalThis.fetch;

function userAuthReq(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${userToken}`);
  return app.request(path, { ...init, headers });
}

async function handshake(origin: string, providers: string[]): Promise<string> {
  const res = await userAuthReq('/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appOrigin: origin,
      providers: providers.map((id) => ({ id })),
    }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.appSessionToken;
}

async function setupGroup(id: string, providerId: string, model?: string, credentialId?: string) {
  const res = await userAuthReq(`/groups/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: id,
      providerId,
      credentialId,
      model: model ?? null,
    }),
  });
  expect(res.status).toBe(200);
}

async function bindAppToGroup(origin: string, groupId: string) {
  const res = await userAuthReq(`/groups/apps/${encodeURIComponent(origin)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groupId }),
  });
  expect(res.status).toBe(200);
}

describe.skipIf(!DATABASE_URL)('vault routing', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'integration-test-secret-that-is-at-least-32-characters-long';
    initDb(DATABASE_URL!);
    startIdleSweep();
    await getDb().execute(sql`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS encrypted_key TEXT`);
    await getDb().execute(sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS gift_id TEXT`);

    // Sign up the test user.
    const signup = await app.request('/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    expect(signup.status).toBe(201);
    userToken = (await signup.json()).token;

    // Add an OpenAI credential and an Anthropic credential. Different
    // routing branches need different combinations of these.
    const openaiRes = await userAuthReq('/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'openai',
        apiKey: 'sk-openai-test-1234567890',
        label: 'openai',
      }),
    });
    openaiCredId = (await openaiRes.json()).credential.id;

    const anthropicRes = await userAuthReq('/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'anthropic',
        apiKey: 'sk-ant-test-1234567890',
        label: 'anthropic',
      }),
    });
    anthropicCredId = (await anthropicRes.json()).credential.id;
  });

  afterAll(async () => {
    stopIdleSweep();
    evictAll();
    globalThis.fetch = realFetch;
    const db = getDb();
    await db.execute(sql`DELETE FROM request_log WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM app_groups WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM groups WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM credentials WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ${testUsername})`);
    await db.execute(sql`DELETE FROM users WHERE username = ${testUsername}`);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // ─── Direct credential pass-through ──────────────────────────────────

  describe('direct credential', () => {
    it('forwards to the requested provider when no group is set', async () => {
      const calls: Array<{ url: string; headers: Headers; body: string }> = [];
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: input.toString(),
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? init.body : '',
        });
        return new Response(JSON.stringify({ id: 'resp', model: 'gpt-4o-mini', usage: { prompt_tokens: 10, completion_tokens: 20 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      const token = await handshake('https://direct.example.com', ['openai']);
      const res = await app.request('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          providerId: 'openai',
          url: 'https://api.openai.com/v1/chat/completions',
          method: 'POST',
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
        }),
      });

      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
      expect(calls[0].headers.get('authorization')).toBe('Bearer sk-openai-test-1234567890');
    });
  });

  // ─── Same-family swap ────────────────────────────────────────────────

  describe('same-family swap', () => {
    it('routes a Groq request to the OpenAI endpoint with OpenAI credentials', async () => {
      // Group: groq-app routed to openai (same family). No model pin.
      await setupGroup('g-swap-openai', 'openai', undefined, openaiCredId);
      await bindAppToGroup('https://swap-test.example.com', 'g-swap-openai');

      const calls: Array<{ url: string; headers: Headers; body: string }> = [];
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: input.toString(),
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? init.body : '',
        });
        return new Response(
          JSON.stringify({ id: 'resp', model: 'llama-3.1-70b-versatile', usage: { prompt_tokens: 5, completion_tokens: 10 } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch;

      const token = await handshake('https://swap-test.example.com', ['groq']);
      const res = await app.request('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          providerId: 'groq',
          url: 'https://api.groq.com/openai/v1/chat/completions',
          method: 'POST',
          body: JSON.stringify({
            model: 'llama-3.1-70b-versatile',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        }),
      });

      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      // URL was rewritten from groq → openai's chat endpoint.
      expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
      // Auth header carries the OpenAI key, not the (nonexistent) Groq key.
      expect(calls[0].headers.get('authorization')).toBe('Bearer sk-openai-test-1234567890');
      // Body model is unchanged because the group has no model pin.
      expect(JSON.parse(calls[0].body).model).toBe('llama-3.1-70b-versatile');
    });

    it('substitutes the body model when the group pins a destination model', async () => {
      await setupGroup('g-swap-pinned', 'openai', 'gpt-4o', openaiCredId);
      await bindAppToGroup('https://swap-pinned.example.com', 'g-swap-pinned');

      const calls: Array<{ body: string }> = [];
      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ body: typeof init?.body === 'string' ? init.body : '' });
        return new Response(JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 2 } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      const token = await handshake('https://swap-pinned.example.com', ['groq']);
      await app.request('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          providerId: 'groq',
          url: 'https://api.groq.com/openai/v1/chat/completions',
          method: 'POST',
          body: JSON.stringify({
            model: 'llama-3.1-70b-versatile',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        }),
      });

      expect(JSON.parse(calls[0].body).model).toBe('gpt-4o');
    });
  });

  // ─── Cross-family translation ────────────────────────────────────────

  describe('cross-family translation', () => {
    it('translates an OpenAI-dialect request to Anthropic dialect upstream', async () => {
      await setupGroup('g-cross-anthropic', 'anthropic', 'claude-sonnet-4-5', anthropicCredId);
      await bindAppToGroup('https://cross-test.example.com', 'g-cross-anthropic');

      const calls: Array<{ url: string; headers: Headers; body: string }> = [];
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: input.toString(),
          headers: new Headers(init?.headers),
          body: typeof init?.body === 'string' ? init.body : '',
        });
        // Return an Anthropic-shaped response so the response translator
        // has something realistic to chew on.
        return new Response(
          JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: 'hello back' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 10 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch;

      const token = await handshake('https://cross-test.example.com', ['openai']);
      const res = await app.request('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          providerId: 'openai',
          url: 'https://api.openai.com/v1/chat/completions',
          method: 'POST',
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: 'be brief' },
              { role: 'user', content: 'hi' },
            ],
            max_tokens: 100,
          }),
        }),
      });

      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      // URL was rewritten to Anthropic's messages endpoint.
      expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
      // Anthropic auth header (x-api-key) was set, OpenAI auth was stripped.
      expect(calls[0].headers.get('x-api-key')).toBe('sk-ant-test-1234567890');
      expect(calls[0].headers.get('authorization')).toBeNull();
      // Body was translated: model swapped, system pulled out of messages.
      const upstreamBody = JSON.parse(calls[0].body);
      expect(upstreamBody.model).toBe('claude-sonnet-4-5');
      expect(upstreamBody.system).toBe('be brief');
      expect(upstreamBody.messages).toHaveLength(1);
      expect(upstreamBody.messages[0].role).toBe('user');

      // Response was translated back to OpenAI dialect (so the SDK sees
      // what it expects).
      const responseBody = await res.json();
      expect(responseBody.choices).toBeDefined();
      expect(responseBody.choices[0].message.content).toContain('hello back');
    });
  });

  // ─── NO_CREDENTIAL with actionable message ───────────────────────────

  describe('NO_CREDENTIAL', () => {
    it('returns the group-routing branch message when both target and direct lookups fail', { timeout: 15_000 }, async () => {
      // To hit the "routes to <X>" branch of buildNoCredentialMessage we
      // need the resolver to return null AND a group binding to a different
      // provider than the request. The resolver falls through to direct
      // credential lookup, so we have to ensure the user has NO credential
      // for the requested provider — otherwise direct lookup would
      // succeed and the request would go upstream.
      const username = `${TEST_PREFIX}solo`;
      const signup = await app.request('/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: testPassword }),
      });
      const soloToken = (await signup.json()).token;

      // Add a Gemini credential (something unrelated to the request) and
      // a group bound to Anthropic with model. Request will be for OpenAI.
      // → Cross-family resolves to no anthropic credential.
      // → Direct lookup finds no openai credential.
      // → Resolver returns null, group is set, group.providerId !== requested
      //   → "routes to anthropic" branch fires.
      await app.request('/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${soloToken}` },
        body: JSON.stringify({ providerId: 'gemini', apiKey: 'AIza-solo-key', label: 'solo' }),
      });
      await app.request('/groups/g-cross', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${soloToken}` },
        body: JSON.stringify({
          name: 'cross',
          providerId: 'anthropic',
          model: 'claude-sonnet-4-5',
        }),
      });
      await app.request('/groups/apps/' + encodeURIComponent('https://solo.example.com'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${soloToken}` },
        body: JSON.stringify({ groupId: 'g-cross' }),
      });

      const handshakeRes = await app.request('/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${soloToken}` },
        body: JSON.stringify({ appOrigin: 'https://solo.example.com', providers: [{ id: 'openai' }] }),
      });
      expect(handshakeRes.status).toBe(200);
      const handshakeBody = await handshakeRes.json();
      const soloAppToken = handshakeBody.appSessionToken;
      expect(soloAppToken).toBeDefined();

      const res = await app.request('/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${soloAppToken}` },
        body: JSON.stringify({
          providerId: 'openai',
          url: 'https://api.openai.com/v1/chat/completions',
          body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
        }),
      });

      expect(res.status).toBe(404);
      const bodyJson = await res.json();
      expect(bodyJson.error.code).toBe('NO_CREDENTIAL');
      expect(bodyJson.error.message).toContain('No anthropic API key found');

      // Cleanup the second user
      const db = getDb();
      await db.execute(sql`DELETE FROM request_log WHERE user_id IN (SELECT id FROM users WHERE username = ${username})`);
      await db.execute(sql`DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ${username})`);
      await db.execute(sql`DELETE FROM app_groups WHERE user_id IN (SELECT id FROM users WHERE username = ${username})`);
      await db.execute(sql`DELETE FROM groups WHERE user_id IN (SELECT id FROM users WHERE username = ${username})`);
      await db.execute(sql`DELETE FROM credentials WHERE user_id IN (SELECT id FROM users WHERE username = ${username})`);
      await db.execute(sql`DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ${username})`);
      await db.execute(sql`DELETE FROM users WHERE username = ${username}`);
    });
  });
});
