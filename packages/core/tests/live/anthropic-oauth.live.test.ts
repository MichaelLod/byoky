/**
 * Live Anthropic auth tests: setup tokens (OAuth) and API keys, sent the way
 * the wallet sends them (buildHeaders, plus the Claude Code system prompt for
 * setup tokens).
 *
 * They call api.anthropic.com and cost real money, so they only run with
 * `pnpm test:live`, and each block skips when its credential is missing:
 *
 *   ANTHROPIC_SETUP_TOKEN=sk-ant-oat01-...          (from `claude setup-token`)
 *   BYOKY_TEST_ANTHROPIC_API_KEY=sk-ant-api03-...   (prefixed so a global
 *                                                    ANTHROPIC_API_KEY isn't used)
 *
 * Put them in .env.local or .env.test.local (see .env.local.example).
 */
import { describe, it, expect } from 'vitest';
import { buildHeaders, injectClaudeCodeSystemPrompt } from '../../src/proxy-utils.js';

const SETUP_TOKEN = process.env.ANTHROPIC_SETUP_TOKEN?.trim();
const API_KEY = process.env.BYOKY_TEST_ANTHROPIC_API_KEY?.trim();
const API_URL = 'https://api.anthropic.com/v1/messages';
// Cheapest current model; the translate live tests use the same one.
const MODEL = 'claude-haiku-4-5-20251001';

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

  it('is refused without the Claude Code headers', async () => {
    const res = await send(
      {
        'content-type': 'application/json',
        authorization: `Bearer ${SETUP_TOKEN}`,
        'anthropic-version': '2023-06-01',
      },
      messageBody(),
    );
    expect(res.status).toBe(401);
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
