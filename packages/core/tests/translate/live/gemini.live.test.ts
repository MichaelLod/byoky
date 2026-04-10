import { describe, it, expect } from 'vitest';
import {
  translateRequest,
  translateResponse,
  createStreamTranslator,
} from '../../../src/translate/index.js';
import type { TranslationContext } from '../../../src/translate/types.js';

/**
 * Live Gemini tests via the canonical IR dispatch.
 *
 * Two families of tests:
 *  1. Gemini as destination (anthropic → gemini): SDK sends anthropic shape,
 *     byoky translates to gemini, calls the live API, translates response back.
 *  2. Gemini as source (gemini → openai): SDK sends gemini shape, byoky
 *     translates to openai and calls the live OpenAI API. Only runs when
 *     OPENAI_API_KEY is also set.
 *
 * Gemini API auth: `x-goog-api-key` header (not Bearer). See proxy-utils
 * buildHeaders for the matching production behavior.
 *
 * Skipped when GEMINI_API_KEY is not set.
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const GEMINI_DST_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

function anthropicToGeminiCtx(streaming = false): TranslationContext {
  return {
    srcFamily: 'anthropic',
    dstFamily: 'gemini',
    srcModel: 'claude-haiku-4-5-20251001',
    dstModel: GEMINI_DST_MODEL,
    isStreaming: streaming,
    requestId: 'live-gemini',
  };
}

function geminiToOpenAICtx(): TranslationContext {
  return {
    srcFamily: 'gemini',
    dstFamily: 'openai',
    srcModel: 'gemini-2.5-flash',
    dstModel: 'gpt-5.4-nano',
    isStreaming: false,
    requestId: 'live-gemini',
  };
}

const GEMINI_HEADERS = GEMINI_KEY
  ? {
      'x-goog-api-key': GEMINI_KEY,
      'content-type': 'application/json',
    }
  : ({} as Record<string, string>);

describe.skipIf(!GEMINI_KEY)('live anthropic→gemini — non-streaming chat', () => {
  it('translates a simple chat turn end-to-end', async () => {
    const c = anthropicToGeminiCtx(false);
    // max_tokens has to leave room for the gemini-2.5-flash default thinking
    // budget (8192) — too small a budget hits MAX_TOKENS before any visible
    // output is emitted. Pick something well above the default budget.
    const anthropicRequest = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      messages: [{ role: 'user', content: 'Reply with exactly "ok" and nothing else.' }],
    };

    const geminiBody = translateRequest(c, JSON.stringify(anthropicRequest));
    const url = `${GEMINI_BASE}/v1beta/models/${GEMINI_DST_MODEL}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: GEMINI_HEADERS,
      body: geminiBody,
    });
    expect(response.status).toBe(200);

    const geminiText = await response.text();
    const translated = translateResponse(c, geminiText);
    const parsed = JSON.parse(translated) as {
      type: string;
      role: string;
      model: string;
      content: Array<{ type: string; text?: string }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    expect(parsed.type).toBe('message');
    expect(parsed.role).toBe('assistant');
    expect(parsed.model).toBe('claude-haiku-4-5-20251001');
    expect(parsed.content.length).toBeGreaterThan(0);
    const text = parsed.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text!.text ?? '').length).toBeGreaterThan(0);
    expect(parsed.usage.input_tokens).toBeGreaterThan(0);
    expect(parsed.usage.output_tokens).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!GEMINI_KEY)('live anthropic→gemini — streaming chat', () => {
  it('translates an SSE stream end-to-end', async () => {
    const c = anthropicToGeminiCtx(true);
    // See note above about gemini-2.5-flash thinking budget vs max_tokens.
    const anthropicRequest = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      messages: [{ role: 'user', content: 'Count to three. One word per line.' }],
      stream: true,
    };

    const geminiBody = translateRequest(c, JSON.stringify(anthropicRequest));
    const url = `${GEMINI_BASE}/v1beta/models/${GEMINI_DST_MODEL}:streamGenerateContent?alt=sse`;
    const response = await fetch(url, {
      method: 'POST',
      headers: GEMINI_HEADERS,
      body: geminiBody,
    });
    expect(response.status).toBe(200);

    const streamer = createStreamTranslator(c);
    let translated = '';
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      translated += streamer.process(decoder.decode(value, { stream: true }));
    }
    translated += streamer.flush();

    // Verify we got a well-formed anthropic SSE stream back.
    const frames = translated.split('\n\n').filter((f) => f.length > 0);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    for (const frame of frames) {
      let eventType: string | null = null;
      let dataLine: string | null = null;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7);
        else if (line.startsWith('data: ')) dataLine = line.slice(6);
      }
      if (eventType && dataLine) events.push({ event: eventType, data: JSON.parse(dataLine) as Record<string, unknown> });
    }

    expect(events.length).toBeGreaterThan(3);
    expect(events[0].event).toBe('message_start');
    expect(events[events.length - 1].event).toBe('message_stop');

    const textDeltas = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => {
        const d = (e.data as { delta?: { type?: string; text?: string } }).delta;
        return d?.type === 'text_delta' ? d.text : undefined;
      })
      .filter((t): t is string => typeof t === 'string' && t.length > 0);
    expect(textDeltas.length).toBeGreaterThan(0);

    const md = events.find((e) => e.event === 'message_delta');
    expect(md).toBeDefined();
  }, 30_000);
});

describe.skipIf(!GEMINI_KEY)('live anthropic→gemini — tool use', () => {
  it('translates a tool-use round trip', async () => {
    const c = anthropicToGeminiCtx(false);
    const anthropicRequest = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: 'Use the get_weather tool to look up the weather for Tokyo.' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get the current weather for a city.',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string', description: 'City name' } },
            required: ['city'],
          },
        },
      ],
      tool_choice: { type: 'auto' },
    };

    const geminiBody = translateRequest(c, JSON.stringify(anthropicRequest));
    const url = `${GEMINI_BASE}/v1beta/models/${GEMINI_DST_MODEL}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: GEMINI_HEADERS,
      body: geminiBody,
    });
    expect(response.status).toBe(200);

    const geminiText = await response.text();
    const translated = translateResponse(c, geminiText);
    const parsed = JSON.parse(translated) as {
      type: string;
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason: string;
    };

    expect(parsed.type).toBe('message');
    const toolUse = parsed.content.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse!.name).toBe('get_weather');
    const input = toolUse!.input as { city?: string };
    expect(input.city).toBeTruthy();
    expect(parsed.stop_reason).toBe('tool_use');
  }, 30_000);
});

/** Tiny 1×1 red PNG as base64 — minimal image payload for vision tests. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAABFUlEQVR4nO3OUQkAIABEsetfWiv4Nx4IC7Cd7XvkByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIReeLesrH9s1agAAAABJRU5ErkJggg==';

describe.skipIf(!GEMINI_KEY)('live anthropic→gemini — vision (image)', () => {
  it('translates an image request end-to-end', async () => {
    const c = anthropicToGeminiCtx(false);
    const anthropicRequest = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What color is this single-pixel image? Reply with one word.' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 },
            },
          ],
        },
      ],
    };

    const geminiBody = translateRequest(c, JSON.stringify(anthropicRequest));
    // The translated body must contain the base64 data (image survived translation).
    expect(geminiBody).toContain(TINY_PNG_B64);

    const url = `${GEMINI_BASE}/v1beta/models/${GEMINI_DST_MODEL}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: GEMINI_HEADERS,
      body: geminiBody,
    });
    expect(response.status).toBe(200);

    const geminiText = await response.text();
    const translated = translateResponse(c, geminiText);
    const parsed = JSON.parse(translated) as {
      type: string;
      role: string;
      content: Array<{ type: string; text?: string }>;
      stop_reason: string;
    };

    expect(parsed.type).toBe('message');
    expect(parsed.role).toBe('assistant');
    expect(parsed.content.length).toBeGreaterThan(0);
    const text = parsed.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text!.text ?? '').length).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!GEMINI_KEY || !OPENAI_KEY)('live gemini→openai — non-streaming chat', () => {
  it('translates a gemini-shaped request into openai and back', async () => {
    const c = geminiToOpenAICtx();
    const geminiRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Reply with exactly "ok" and nothing else.' }],
        },
      ],
      generationConfig: { maxOutputTokens: 10 },
    };

    const openaiBody = translateRequest(c, JSON.stringify(geminiRequest));
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${OPENAI_KEY}`,
        'content-type': 'application/json',
      },
      body: openaiBody,
    });
    expect(response.status).toBe(200);

    const openaiText = await response.text();
    const translated = translateResponse(c, openaiText);
    const parsed = JSON.parse(translated) as {
      candidates: Array<{
        content: { role: string; parts: Array<{ text?: string }> };
        finishReason: string;
      }>;
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    };

    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].content.role).toBe('model');
    expect(parsed.candidates[0].content.parts[0].text).toBeTruthy();
    expect(parsed.usageMetadata.promptTokenCount).toBeGreaterThan(0);
    expect(parsed.usageMetadata.candidatesTokenCount).toBeGreaterThan(0);
  }, 30_000);
});
