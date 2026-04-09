import { describe, it, expect } from 'vitest';
import {
  anthropicToOpenAIRequest,
  openAIToAnthropicResponse,
  createOpenAIToAnthropicStreamRewriter,
} from '../../../src/translate/index.js';
import type { TranslationContext } from '../../../src/translate/types.js';

/**
 * Live Anthropic→OpenAI translation tests.
 *
 * The SDK believes it's calling Anthropic; byoky reroutes via group binding
 * to OpenAI. The test sends an Anthropic-shaped request, translates to
 * OpenAI shape, hits api.openai.com directly, then translates the response
 * back to Anthropic shape and verifies the SDK would receive a valid
 * Anthropic-shaped reply.
 *
 * Skipped when OPENAI_API_KEY is not set.
 */

const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Cheapest currently-registered OpenAI model.
const DST_MODEL = 'gpt-5.4-nano';
// Source model — what the SDK thinks it's calling. Echoed back in responses;
// doesn't have to exist for real.
const SRC_MODEL = 'claude-haiku-4-5-20251001';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'anthropic',
    dstFamily: 'openai',
    srcModel: SRC_MODEL,
    dstModel: DST_MODEL,
    isStreaming: false,
    requestId: 'live-test',
    state: {},
    ...overrides,
  };
}

const OPENAI_HEADERS = OPENAI_KEY
  ? {
      authorization: `Bearer ${OPENAI_KEY}`,
      'content-type': 'application/json',
    }
  : ({} as Record<string, string>);

describe.skipIf(!OPENAI_KEY)('live anthropic→openai — non-streaming chat', () => {
  it('translates a simple chat turn end-to-end', async () => {
    const c = ctx();
    const anthropicRequest = {
      model: SRC_MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with exactly the word "ok" and nothing else.' }],
    };

    const openAIBody = anthropicToOpenAIRequest(c, JSON.stringify(anthropicRequest));
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: OPENAI_HEADERS,
      body: openAIBody,
    });
    expect(response.status).toBe(200);

    const openAIText = await response.text();
    const translated = openAIToAnthropicResponse(c, openAIText);
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
    // Echoes the source model the SDK requested.
    expect(parsed.model).toBe(SRC_MODEL);
    expect(parsed.content.length).toBeGreaterThan(0);
    const text = parsed.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text!.text ?? '').length).toBeGreaterThan(0);
    expect(['end_turn', 'max_tokens', 'tool_use']).toContain(parsed.stop_reason);
    expect(parsed.usage.input_tokens).toBeGreaterThan(0);
    expect(parsed.usage.output_tokens).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!OPENAI_KEY)('live anthropic→openai — streaming chat', () => {
  it('translates an SSE stream end-to-end', async () => {
    const c = ctx({ isStreaming: true });
    const anthropicRequest = {
      model: SRC_MODEL,
      max_tokens: 30,
      messages: [{ role: 'user', content: 'Count to three. One word per token.' }],
      stream: true,
    };

    const openAIBody = anthropicToOpenAIRequest(c, JSON.stringify(anthropicRequest));
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: OPENAI_HEADERS,
      body: openAIBody,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toContain('text/event-stream');

    const rewriter = createOpenAIToAnthropicStreamRewriter(c);
    let translated = '';
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      translated += rewriter.process(decoder.decode(value, { stream: true }));
    }
    translated += rewriter.flush();

    // Parse the Anthropic-style SSE output: each frame is `event: <type>\ndata: <json>\n\n`.
    const frames = translated.split('\n\n').filter((f) => f.length > 0);
    interface Event {
      event: string;
      data: Record<string, unknown>;
    }
    const events: Event[] = [];
    for (const frame of frames) {
      const lines = frame.split('\n');
      let eventType: string | null = null;
      let dataLine: string | null = null;
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7);
        else if (line.startsWith('data: ')) dataLine = line.slice(6);
      }
      if (eventType && dataLine) events.push({ event: eventType, data: JSON.parse(dataLine) as Record<string, unknown> });
    }

    expect(events.length).toBeGreaterThan(3);
    // First and last events are message_start and message_stop.
    expect(events[0].event).toBe('message_start');
    expect(events[events.length - 1].event).toBe('message_stop');

    // At least one text_delta with non-empty text.
    const textDeltas = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => {
        const d = (e.data as { delta?: { type?: string; text?: string } }).delta;
        return d?.type === 'text_delta' ? d.text : undefined;
      })
      .filter((t): t is string => typeof t === 'string' && t.length > 0);
    expect(textDeltas.length).toBeGreaterThan(0);

    // message_delta carries stop_reason and final usage.
    const md = events.find((e) => e.event === 'message_delta');
    expect(md).toBeDefined();
    const stop = (md!.data as { delta: { stop_reason: string } }).delta.stop_reason;
    expect(['end_turn', 'max_tokens', 'tool_use']).toContain(stop);
  }, 30_000);
});

describe.skipIf(!OPENAI_KEY)('live anthropic→openai — tool use', () => {
  it('translates a tool-use round trip', async () => {
    const c = ctx();
    const anthropicRequest = {
      model: SRC_MODEL,
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

    const openAIBody = anthropicToOpenAIRequest(c, JSON.stringify(anthropicRequest));
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: OPENAI_HEADERS,
      body: openAIBody,
    });
    expect(response.status).toBe(200);

    const openAIText = await response.text();
    const translated = openAIToAnthropicResponse(c, openAIText);
    const parsed = JSON.parse(translated) as {
      type: string;
      role: string;
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason: string;
    };

    expect(parsed.type).toBe('message');
    const toolUse = parsed.content.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse!.name).toBe('get_weather');
    expect(toolUse!.id).toBeTruthy();
    const input = toolUse!.input as { city?: string };
    expect(input.city).toBeTruthy();
    expect(parsed.stop_reason).toBe('tool_use');
  }, 30_000);
});
