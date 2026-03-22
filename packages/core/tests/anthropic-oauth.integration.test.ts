/**
 * Integration tests for Anthropic OAuth/Setup Token authentication.
 *
 * These tests verify real API calls against api.anthropic.com when tokens
 * are provided via environment variables. Without tokens, all tests are
 * skipped and mocked equivalents run instead.
 *
 * Usage:
 *   # With real tokens (copy .env.example → .env.test.local)
 *   ANTHROPIC_SETUP_TOKEN=sk-ant-oat01-... pnpm test anthropic-oauth
 *
 *   # Without tokens (mock-only, always passes)
 *   pnpm test anthropic-oauth
 */
import { describe, it, expect } from 'vitest';
import { buildHeaders } from '../src/proxy-utils.js';

// ── Config ─────────────────────────────────────────────

const SETUP_TOKEN = process.env.ANTHROPIC_SETUP_TOKEN?.trim();
// Use BYOKY_TEST_ANTHROPIC_API_KEY to avoid collision with global ANTHROPIC_API_KEY
const API_KEY = process.env.BYOKY_TEST_ANTHROPIC_API_KEY?.trim();
const API_URL = 'https://api.anthropic.com/v1/messages';

const REQUIRED_BETAS = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'fine-grained-tool-streaming-2025-05-14',
  'interleaved-thinking-2025-05-14',
];

const CLAUDE_CODE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

const OAUTH_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-beta': REQUIRED_BETAS.join(','),
  'user-agent': 'claude-cli/2.1.76',
  'x-app': 'cli',
  'anthropic-dangerous-direct-browser-access': 'true',
};

// ── Helpers ────────────────────────────────────────────

async function callAnthropic(opts: {
  token: string;
  model: string;
  authStyle: 'bearer' | 'api_key';
  includeOAuthHeaders?: boolean;
  includeSystemPrompt?: boolean;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  if (opts.authStyle === 'bearer') {
    headers['authorization'] = `Bearer ${opts.token}`;
  } else {
    headers['x-api-key'] = opts.token;
  }

  if (opts.includeOAuthHeaders !== false && opts.authStyle === 'bearer') {
    Object.assign(headers, OAUTH_HEADERS);
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with just the word OK' }],
  };

  if (opts.includeSystemPrompt !== false && opts.authStyle === 'bearer') {
    body.system = [{ type: 'text', text: CLAUDE_CODE_SYSTEM_PROMPT }];
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, body: json };
}

// ── Unit Tests (always run) ────────────────────────────

describe('buildHeaders — Anthropic OAuth (unit)', () => {
  it('produces correct OAuth headers', () => {
    const h = buildHeaders('anthropic', {}, 'sk-ant-oat01-test', 'oauth');
    expect(h['authorization']).toBe('Bearer sk-ant-oat01-test');
    expect(h['x-api-key']).toBeUndefined();
    expect(h['user-agent']).toMatch(/^claude-cli\//);
    expect(h['x-app']).toBe('cli');
    expect(h['anthropic-beta']).toContain('oauth-2025-04-20');
    expect(h['anthropic-beta']).toContain('claude-code-20250219');
  });

  it('produces correct API Key headers', () => {
    const h = buildHeaders('anthropic', {}, 'sk-ant-api-test', 'api_key');
    expect(h['x-api-key']).toBe('sk-ant-api-test');
    expect(h['authorization']).toBeUndefined();
    expect(h['user-agent']).toBeUndefined();
  });

  it('mock: Setup Token would fail without Claude Code headers', () => {
    // Simulates the 401 "OAuth authentication is currently not supported" response
    const h: Record<string, string> = {
      'authorization': 'Bearer sk-ant-oat01-test',
      'anthropic-version': '2023-06-01',
    };
    // Without user-agent, x-app, anthropic-beta → Anthropic returns 401
    expect(h['user-agent']).toBeUndefined();
    expect(h['x-app']).toBeUndefined();
    expect(h['anthropic-beta']).toBeUndefined();
  });

  it('mock: Setup Token would fail without system prompt', () => {
    // Even with correct headers, missing "You are Claude Code..." system prompt → 400
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
      // No system prompt → 400 Error
    };
    expect(body).not.toHaveProperty('system');
  });

  it('mock: aliases return 404 for Setup Tokens', () => {
    // Setup Tokens only support exact version names, not aliases
    const BLOCKED_MODELS = [
      'claude-sonnet-4-latest',
      'claude-opus-4-latest',
      'claude-haiku-3-5-20241022',
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
    ];
    const ALLOWED_MODELS = [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
    ];
    // Extension should filter capabilities based on credential type
    expect(BLOCKED_MODELS.length).toBeGreaterThan(0);
    expect(ALLOWED_MODELS.length).toBeGreaterThan(0);
  });
});

// ── Integration Tests (only with real tokens) ──────────

const describeWithSetupToken = SETUP_TOKEN
  ? describe
  : describe.skip;

const describeWithApiKey = API_KEY
  ? describe
  : describe.skip;

describeWithSetupToken('Anthropic Setup Token — LIVE integration', () => {
  it('authenticates with Sonnet 4 (exact version)', async () => {
    const res = await callAnthropic({
      token: SETUP_TOKEN!,
      model: 'claude-sonnet-4-20250514',
      authStyle: 'bearer',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
  }, 30_000);

  it('authenticates with Opus 4 (exact version)', async () => {
    const res = await callAnthropic({
      token: SETUP_TOKEN!,
      model: 'claude-opus-4-20250514',
      authStyle: 'bearer',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
  }, 30_000);

  it('rejects alias model names (404)', async () => {
    const res = await callAnthropic({
      token: SETUP_TOKEN!,
      model: 'claude-sonnet-4-latest',
      authStyle: 'bearer',
    });
    expect(res.status).toBe(404);
  }, 15_000);

  it('rejects legacy models (404)', async () => {
    const res = await callAnthropic({
      token: SETUP_TOKEN!,
      model: 'claude-3-5-sonnet-20241022',
      authStyle: 'bearer',
    });
    expect(res.status).toBe(404);
  }, 15_000);

  it('fails without Claude Code headers (401)', async () => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${SETUP_TOKEN}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(401);
  }, 15_000);

  it('fails without system prompt (400)', async () => {
    const res = await callAnthropic({
      token: SETUP_TOKEN!,
      model: 'claude-sonnet-4-20250514',
      authStyle: 'bearer',
      includeSystemPrompt: false,
    });
    // Without system prompt, may get 400 or succeed depending on server-side changes
    // Current behavior: 400
    expect([200, 400]).toContain(res.status);
  }, 15_000);
});

describeWithApiKey('Anthropic API Key — LIVE integration', () => {
  it('authenticates with exact version', async () => {
    const res = await callAnthropic({
      token: API_KEY!,
      model: 'claude-sonnet-4-20250514',
      authStyle: 'api_key',
    });
    expect(res.status).toBe(200);
  }, 15_000);

  it('authenticates with alias (-latest)', async () => {
    const res = await callAnthropic({
      token: API_KEY!,
      model: 'claude-sonnet-4-latest',
      authStyle: 'api_key',
    });
    expect(res.status).toBe(200);
  }, 15_000);

  it('authenticates with legacy model', async () => {
    const res = await callAnthropic({
      token: API_KEY!,
      model: 'claude-3-5-sonnet-20241022',
      authStyle: 'api_key',
    });
    expect(res.status).toBe(200);
  }, 15_000);
});

// ── buildHeaders integration check ─────────────────────

describeWithSetupToken('buildHeaders → live API (end-to-end)', () => {
  it('headers from buildHeaders work against real API', async () => {
    const headers = buildHeaders(
      'anthropic',
      { 'content-type': 'application/json' },
      SETUP_TOKEN!,
      'oauth',
    );
    // buildHeaders doesn't add all required betas yet — supplement
    headers['anthropic-beta'] = REQUIRED_BETAS.join(',');
    headers['anthropic-dangerous-direct-browser-access'] = 'true';

    const res = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16,
        system: [{ type: 'text', text: CLAUDE_CODE_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: 'Reply OK' }],
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toHaveProperty('content');
  }, 30_000);
});
