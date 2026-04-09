import { describe, it, expect } from 'vitest';
import {
  openAIToAnthropicRequest,
  anthropicToOpenAIResponse,
  createAnthropicToOpenAIStreamRewriter,
} from '../../../src/translate/index.js';
import type { TranslationContext } from '../../../src/translate/types.js';
import {
  buildHeaders,
  injectClaudeCodeSystemPrompt,
  rewriteToolNamesForClaudeCode,
} from '../../../src/proxy-utils.js';
import { isBridgeAvailable, runBridgeProxy } from './bridge-client.js';

/**
 * Live OpenAI→Anthropic translation tests.
 *
 * The SDK believes it's calling OpenAI; byoky reroutes via group binding to
 * Anthropic. The test sends an OpenAI-shaped request, translates to
 * Anthropic shape, fetches Anthropic, translates the response back to
 * OpenAI shape, and verifies the SDK would receive a valid OpenAI reply.
 *
 * Skipped when ANTHROPIC_API_KEY is not set.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Two auth modes are supported, picked by token format:
 *
 *  - sk-ant-api03-... → regular API key. Sent via `x-api-key`. Direct fetch.
 *  - sk-ant-oat01-... → OAuth setup token. Cannot use x-api-key. Routed
 *    through the byoky bridge subprocess: build OAuth headers via
 *    buildHeaders(..., 'oauth'), inject the Claude Code system prompt,
 *    rewrite snake_case tool names to PascalCase, send through bridge
 *    native messaging, bridge does the fetch + reverse-rewrites tool
 *    names in response chunks. Requires `byoky-bridge` on PATH.
 * ──────────────────────────────────────────────────────────────────────────
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const IS_OAUTH = ANTHROPIC_KEY?.startsWith('sk-ant-oat01-') ?? false;

const DST_MODEL = 'claude-haiku-4-5-20251001';
const SRC_MODEL = 'gpt-5.4-nano';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'openai',
    dstFamily: 'anthropic',
    srcModel: SRC_MODEL,
    dstModel: DST_MODEL,
    isStreaming: false,
    requestId: 'live-test',
    state: {},
    ...overrides,
  };
}

/**
 * Cached bridge availability check. The result is computed lazily on first
 * access (inside a test) and reused thereafter, so we don't spawn a bridge
 * subprocess for every single test.
 */
let bridgeUpCache: Promise<boolean> | null = null;
function bridgeAvailable(): Promise<boolean> {
  if (!bridgeUpCache) bridgeUpCache = isBridgeAvailable();
  return bridgeUpCache;
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const API_KEY_HEADERS = ANTHROPIC_KEY
  ? {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }
  : ({} as Record<string, string>);

/**
 * Send the prepared Anthropic request body to api.anthropic.com using the
 * appropriate auth path for the credential type. For OAuth setup tokens,
 * routes through the bridge subprocess (matching what the production
 * extension does); for API keys, uses a direct fetch.
 *
 * Returns { status, headers, body } where body is the full response payload
 * (JSON string for non-streaming, raw SSE text for streaming).
 */
async function callAnthropic(
  anthropicBody: string,
  isStreaming: boolean,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (IS_OAUTH) {
    // Build OAuth-style headers (Bearer + Claude Code beta flags + UA spoof).
    const oauthHeaders = buildHeaders('anthropic', { 'content-type': 'application/json' }, ANTHROPIC_KEY!, 'oauth');
    // For setup tokens, byoky must inject the Claude Code system prompt
    // (relocateExisting=true relocates any existing system content into
    // the first user message, which is what we need when the request
    // didn't originate from Claude Code).
    const withSystem = injectClaudeCodeSystemPrompt(anthropicBody, { relocateExisting: true });
    // Rewrite snake_case tool names to PascalCase Claude-Code aliases
    // and capture the inverse map for the bridge to apply on responses.
    const { body: rewrittenBody, toolNameMap } = rewriteToolNamesForClaudeCode(withSystem);
    return runBridgeProxy({
      url: ANTHROPIC_API_URL,
      method: 'POST',
      headers: oauthHeaders,
      body: rewrittenBody,
      toolNameMap,
    });
  }

  // API key path: direct fetch.
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: API_KEY_HEADERS,
    body: anthropicBody,
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  // For streaming we still buffer the entire response — the test rewrites
  // chunks all at once after, so we don't need true streaming here.
  const body = await response.text();
  return { status: response.status, headers, body };
}

/**
 * Helper that callers invoke at the start of OAuth-path tests to skip
 * cleanly when the bridge isn't installed/running. Vitest evaluates skip
 * decisions in `it.skipIf` at definition time, which is too early for an
 * async bridge check, so we use the runtime `t.skip()` API instead.
 */
async function skipIfOAuthBridgeMissing(t: { skip(reason?: string): void }): Promise<boolean> {
  if (!IS_OAUTH) return false;
  if (await bridgeAvailable()) return false;
  t.skip('OAuth setup token requires byoky-bridge on PATH (npm install -g @byoky/bridge)');
  return true;
}

describe.skipIf(!ANTHROPIC_KEY)('live openai→anthropic — non-streaming chat', () => {
  it('translates a simple chat turn end-to-end', async (t) => {
    if (await skipIfOAuthBridgeMissing(t)) return;
    const c = ctx();
    const openAIRequest = {
      model: SRC_MODEL,
      messages: [{ role: 'user', content: 'Reply with exactly the word "ok" and nothing else.' }],
      max_tokens: 10,
    };

    const anthropicBody = openAIToAnthropicRequest(c, JSON.stringify(openAIRequest));
    const { status, body: anthropicText } = await callAnthropic(anthropicBody, false);
    expect(status).toBe(200);

    const translated = anthropicToOpenAIResponse(c, anthropicText);
    const parsed = JSON.parse(translated) as {
      object: string;
      model: string;
      choices: Array<{
        message: { role: string; content: string | null; tool_calls?: unknown };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    expect(parsed.object).toBe('chat.completion');
    expect(parsed.model).toBe(SRC_MODEL);
    expect(parsed.choices).toHaveLength(1);
    expect(parsed.choices[0].message.role).toBe('assistant');
    expect((parsed.choices[0].message.content ?? '').length).toBeGreaterThan(0);
    expect(['stop', 'length', 'tool_calls']).toContain(parsed.choices[0].finish_reason);
    expect(parsed.usage.prompt_tokens).toBeGreaterThan(0);
    expect(parsed.usage.completion_tokens).toBeGreaterThan(0);
    expect(parsed.usage.total_tokens).toBe(parsed.usage.prompt_tokens + parsed.usage.completion_tokens);
  }, 30_000);
});

describe.skipIf(!ANTHROPIC_KEY)('live openai→anthropic — streaming chat', () => {
  it('translates an SSE stream end-to-end', async (t) => {
    if (await skipIfOAuthBridgeMissing(t)) return;
    const c = ctx({ isStreaming: true });
    const openAIRequest = {
      model: SRC_MODEL,
      messages: [{ role: 'user', content: 'Count to three. One word per response.' }],
      max_tokens: 30,
      stream: true,
    };

    const anthropicBody = openAIToAnthropicRequest(c, JSON.stringify(openAIRequest));
    const { status, headers, body: rawSSE } = await callAnthropic(anthropicBody, true);
    expect(status).toBe(200);
    expect(headers['content-type'] ?? '').toContain('text/event-stream');

    // Feed the entire buffered SSE body through the rewriter in one shot
    // (the rewriter handles arbitrary buffering boundaries internally).
    const rewriter = createAnthropicToOpenAIStreamRewriter(c);
    let translated = rewriter.process(rawSSE);
    translated += rewriter.flush();

    // Parse the OpenAI-style SSE output: each frame is `data: <json>\n\n` or `data: [DONE]`.
    const dataLines = translated.split('\n').filter((l) => l.startsWith('data: '));
    const chunks: Array<Record<string, unknown> | '[DONE]'> = dataLines.map((l) => {
      const payload = l.slice(6);
      return payload === '[DONE]' ? '[DONE]' : (JSON.parse(payload) as Record<string, unknown>);
    });

    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[chunks.length - 1]).toBe('[DONE]');

    // Find the role-establishing chunk
    const firstChunk = chunks.find((c) => c !== '[DONE]') as Record<string, unknown>;
    expect(firstChunk.object).toBe('chat.completion.chunk');
    expect(firstChunk.model).toBe(SRC_MODEL);

    // Concatenate all content deltas — should yield non-empty text.
    const text = (chunks.filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>)
      .map((c) => {
        const choices = c.choices as Array<{ delta?: { content?: string } }> | undefined;
        return choices?.[0]?.delta?.content;
      })
      .filter((t): t is string => typeof t === 'string')
      .join('');
    expect(text.length).toBeGreaterThan(0);

    // Last non-DONE chunk has finish_reason and (if include_usage worked) usage.
    const lastChunkBeforeDone = (chunks.filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>).pop();
    expect(lastChunkBeforeDone).toBeDefined();
    const usage = (lastChunkBeforeDone as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    expect(usage).toBeDefined();
    expect(usage!.prompt_tokens).toBeGreaterThan(0);
    expect(usage!.completion_tokens).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!ANTHROPIC_KEY)('live openai→anthropic — tool use', () => {
  it('translates a tool-use round trip', async (t) => {
    if (await skipIfOAuthBridgeMissing(t)) return;
    const c = ctx();
    const openAIRequest = {
      model: SRC_MODEL,
      messages: [{ role: 'user', content: 'Use the get_weather tool to look up the weather for Tokyo.' }],
      max_tokens: 200,
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a city.',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string', description: 'City name' } },
              required: ['city'],
            },
          },
        },
      ],
      tool_choice: 'auto',
    };

    const anthropicBody = openAIToAnthropicRequest(c, JSON.stringify(openAIRequest));
    const { status, body: anthropicText } = await callAnthropic(anthropicBody, false);
    expect(status).toBe(200);

    const translated = anthropicToOpenAIResponse(c, anthropicText);
    const parsed = JSON.parse(translated) as {
      object: string;
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
        };
        finish_reason: string;
      }>;
    };

    expect(parsed.object).toBe('chat.completion');
    const choice = parsed.choices[0];
    expect(choice.message.role).toBe('assistant');
    expect(choice.message.tool_calls).toBeDefined();
    expect(choice.message.tool_calls!.length).toBeGreaterThan(0);
    const tc = choice.message.tool_calls![0];
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('get_weather');
    expect(tc.id).toBeTruthy();
    const args = JSON.parse(tc.function.arguments) as { city?: string };
    expect(args.city).toBeTruthy();
    expect(choice.finish_reason).toBe('tool_calls');
  }, 30_000);
});
