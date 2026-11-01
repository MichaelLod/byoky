/**
 * Live Anthropic auth tests: setup tokens (OAuth) and API keys, sent the way
 * the wallet sends them (buildHeaders, plus the Claude Code system prompt for
 * setup tokens).
 *
 * They call api.anthropic.com and cost real money, so they only run with
 * `pnpm test:live`, and each block skips when its credential is missing:
 *
 *   ANTHROPIC_SETUP_TOKEN=sk-ant-oat01-...          (from `claude setup-token`)
 *   BYOKY_TEST_ANTHROPIC_API_KEY=sk-ant-api03-...   (or else ANTHROPIC_API_KEY,
 *                                                    when it holds an API key)
 *
 * Put them in .env.local or .env.test.local (see .env.local.example).
 *
 * Anthropic used to refuse a setup token sent without the Claude Code
 * headers (401); since about 2026-11-01 it answers 200, so there is nothing
 * to assert about that. What matters is that the headers and system prompt
 * the wallet sends keep working.
 */
import { describe, it, expect } from 'vitest';
import { buildHeaders, injectClaudeCodeSystemPrompt } from '../../src/proxy-utils.js';

const SETUP_TOKEN = process.env.ANTHROPIC_SETUP_TOKEN?.trim();
const API_KEY = process.env.BYOKY_TEST_ANTHROPIC_API_KEY?.trim() || anthropicApiKey(process.env.ANTHROPIC_API_KEY);
const API_URL = 'https://api.anthropic.com/v1/messages';
// Cheapest current model; the translate live tests use the same one.
const MODEL = 'claude-haiku-4-5-20251001';

/** ANTHROPIC_API_KEY, unless it holds a setup token rather than an API key. */
function anthropicApiKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  return key && !key.startsWith('sk-ant-oat') ? key : undefined;
}

function messageBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: MODEL,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with just the word OK' }],
    ...extra,
  });
}

async function send(headers: Record<string, string>, body: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(API_URL, { method: 'POST', headers, body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe.skipIf(!SETUP_TOKEN)('Anthropic setup token (live)', () => {
  it('is accepted with the headers and system prompt the wallet sends', async () => {
    // context-1m is what Hermes attaches; buildHeaders must strip it or the
    // request is billed as long context (or refused on Pro/Max plans).
    const headers = buildHeaders(
      'anthropic',
      { 'content-type': 'application/json', 'anthropic-beta': 'context-1m-2025-08-07' },
      SETUP_TOKEN!,
      'oauth',
    );
    const res = await send(headers, injectClaudeCodeSystemPrompt(messageBody())!);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveProperty('content');
  });
});

describe.skipIf(!API_KEY)('Anthropic API key (live)', () => {
  it('is accepted with the headers the wallet sends', async () => {
    const headers = buildHeaders('anthropic', { 'content-type': 'application/json' }, API_KEY!, 'api_key');
    const res = await send(headers, messageBody());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveProperty('content');
  });
});
