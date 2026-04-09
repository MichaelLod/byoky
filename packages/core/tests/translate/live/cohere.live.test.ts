import { describe, it, expect } from 'vitest';
import {
  translateRequest,
  translateResponse,
  createStreamTranslator,
} from '../../../src/translate/index.js';
import type { TranslationContext } from '../../../src/translate/types.js';

/**
 * Live Cohere v2 tests via the canonical IR dispatch.
 *
 * Skipped when COHERE_API_KEY is not set. Unit tests in adapters/cohere.test.ts
 * carry the coverage when this is skipped.
 */

const COHERE_KEY = process.env.COHERE_API_KEY;

const COHERE_DST_MODEL = 'command-a-03-2025';
const COHERE_URL = 'https://api.cohere.com/v2/chat';

function ctx(streaming = false): TranslationContext {
  return {
    srcFamily: 'openai',
    dstFamily: 'cohere',
    srcModel: 'gpt-5.4-nano',
    dstModel: COHERE_DST_MODEL,
    isStreaming: streaming,
    requestId: 'live-cohere',
  };
}

const COHERE_HEADERS = COHERE_KEY
  ? {
      authorization: `Bearer ${COHERE_KEY}`,
      'content-type': 'application/json',
    }
  : ({} as Record<string, string>);

describe.skipIf(!COHERE_KEY)('live openai→cohere — non-streaming chat', () => {
  it('translates a simple chat turn end-to-end', async () => {
    const c = ctx(false);
    const openaiRequest = {
      model: 'gpt-5.4-nano',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Reply with exactly "ok" and nothing else.' },
      ],
      max_tokens: 10,
    };

    const cohereBody = translateRequest(c, JSON.stringify(openaiRequest));
    const response = await fetch(COHERE_URL, {
      method: 'POST',
      headers: COHERE_HEADERS,
      body: cohereBody,
    });
    expect(response.status).toBe(200);

    const cohereText = await response.text();
    const translated = translateResponse(c, cohereText);
    const parsed = JSON.parse(translated) as {
      object: string;
      model: string;
      choices: Array<{
        message: { role: string; content: string | null };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    expect(parsed.object).toBe('chat.completion');
    expect(parsed.model).toBe('gpt-5.4-nano');
    expect(parsed.choices).toHaveLength(1);
    expect(parsed.choices[0].message.role).toBe('assistant');
    expect((parsed.choices[0].message.content ?? '').length).toBeGreaterThan(0);
    expect(parsed.usage.prompt_tokens).toBeGreaterThan(0);
    expect(parsed.usage.completion_tokens).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!COHERE_KEY)('live openai→cohere — streaming chat', () => {
  it('translates an SSE stream end-to-end', async () => {
    const c = ctx(true);
    const openaiRequest = {
      model: 'gpt-5.4-nano',
      messages: [{ role: 'user', content: 'Count to three.' }],
      max_tokens: 20,
      stream: true,
    };

    const cohereBody = translateRequest(c, JSON.stringify(openaiRequest));
    const response = await fetch(COHERE_URL, {
      method: 'POST',
      headers: COHERE_HEADERS,
      body: cohereBody,
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

    // Translated stream is OpenAI-shaped SSE.
    const dataLines = translated.split('\n').filter((l) => l.startsWith('data: '));
    const chunks = dataLines.map((l) => {
      const payload = l.slice(6);
      return payload === '[DONE]' ? '[DONE]' : (JSON.parse(payload) as Record<string, unknown>);
    });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[chunks.length - 1]).toBe('[DONE]');

    const text = (chunks.filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>)
      .map((c) => {
        const choices = c.choices as Array<{ delta?: { content?: string } }> | undefined;
        return choices?.[0]?.delta?.content;
      })
      .filter((t): t is string => typeof t === 'string')
      .join('');
    expect(text.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!COHERE_KEY)('live openai→cohere — tool use', () => {
  it('translates a tool-use round trip', async () => {
    const c = ctx(false);
    const openaiRequest = {
      model: 'gpt-5.4-nano',
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
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      ],
      tool_choice: 'auto',
    };

    const cohereBody = translateRequest(c, JSON.stringify(openaiRequest));
    const response = await fetch(COHERE_URL, {
      method: 'POST',
      headers: COHERE_HEADERS,
      body: cohereBody,
    });
    expect(response.status).toBe(200);

    const cohereText = await response.text();
    const translated = translateResponse(c, cohereText);
    const parsed = JSON.parse(translated) as {
      object: string;
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
        finish_reason: string;
      }>;
    };

    expect(parsed.object).toBe('chat.completion');
    const choice = parsed.choices[0];
    expect(choice.message.tool_calls).toBeDefined();
    expect(choice.message.tool_calls!.length).toBeGreaterThan(0);
    const tc = choice.message.tool_calls![0];
    expect(tc.function.name).toBe('get_weather');
    const args = JSON.parse(tc.function.arguments) as { city?: string };
    expect(args.city).toBeTruthy();
    expect(choice.finish_reason).toBe('tool_calls');
  }, 30_000);
});
