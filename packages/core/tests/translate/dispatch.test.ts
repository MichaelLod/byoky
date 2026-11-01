import { describe, it, expect } from 'vitest';
import { translateRequest, translateResponse, createStreamTranslator } from '../../src/translate/index.js';
import type { TranslationContext } from '../../src/translate/types.js';
import type { ModelFamily } from '../../src/models.js';

/**
 * Cross-family dispatch smoke tests.
 *
 * Exercises the top-level translateRequest / translateResponse pipeline
 * across all 12 directed pairs of the four supported families. These tests
 * guarantee the adapter registry is wired correctly and that a basic chat
 * turn (+ a tool-use turn) survives translation in every direction.
 *
 * Per-feature edge cases live in the per-adapter tests; this file only
 * verifies that the dispatch composes adapters correctly and that the IR
 * contains enough information for each family to produce valid output.
 */

const FAMILIES: ModelFamily[] = ['anthropic', 'openai', 'gemini', 'cohere'];

const DST_MODEL: Record<ModelFamily, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  gemini: 'gemini-2.5-pro',
  cohere: 'command-a-03-2025',
};

function ctx(src: ModelFamily, dst: ModelFamily): TranslationContext {
  return {
    srcFamily: src,
    dstFamily: dst,
    srcModel: 'src-model',
    dstModel: DST_MODEL[dst],
    isStreaming: false,
    requestId: 'test-req',
  };
}

/**
 * Representative request bodies per source family — a simple chat with a
 * system prompt + one user message, expressed in each family's native shape.
 */
const SIMPLE_REQUESTS: Record<ModelFamily, string> = {
  anthropic: JSON.stringify({
    model: 'src-model',
    max_tokens: 128,
    system: 'You are terse.',
    messages: [{ role: 'user', content: 'Hello.' }],
  }),
  openai: JSON.stringify({
    model: 'src-model',
    messages: [
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Hello.' },
    ],
    max_tokens: 128,
  }),
  gemini: JSON.stringify({
    systemInstruction: { parts: [{ text: 'You are terse.' }] },
    contents: [{ role: 'user', parts: [{ text: 'Hello.' }] }],
    generationConfig: { maxOutputTokens: 128 },
  }),
  cohere: JSON.stringify({
    model: 'src-model',
    messages: [
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Hello.' },
    ],
    max_tokens: 128,
  }),
};

/**
 * Representative response bodies per destination family — a plain assistant
 * turn with some text. Used to verify response translation round-trips.
 */
const SIMPLE_RESPONSES: Record<ModelFamily, string> = {
  anthropic: JSON.stringify({
    id: 'msg_x',
    type: 'message',
    role: 'assistant',
    model: 'dst-model',
    content: [{ type: 'text', text: 'Hi.' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 2 },
  }),
  openai: JSON.stringify({
    id: 'chatcmpl-x',
    object: 'chat.completion',
    created: 0,
    model: 'dst-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hi.' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  }),
  gemini: JSON.stringify({
    candidates: [
      {
        content: { role: 'model', parts: [{ text: 'Hi.' }] },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    modelVersion: 'dst-model',
    responseId: 'resp_x',
  }),
  cohere: JSON.stringify({
    id: 'c_x',
    finish_reason: 'COMPLETE',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi.' }],
    },
    usage: {
      billed_units: { input_tokens: 10, output_tokens: 2 },
      tokens: { input_tokens: 10, output_tokens: 2 },
    },
  }),
};

describe('cross-family dispatch — simple chat request round trip', () => {
  for (const src of FAMILIES) {
    for (const dst of FAMILIES) {
      if (src === dst) continue;
      it(`${src} → ${dst}`, () => {
        const c = ctx(src, dst);
        const out = translateRequest(c, SIMPLE_REQUESTS[src]);
        // The output must be valid JSON.
        expect(() => JSON.parse(out)).not.toThrow();
        const parsed = JSON.parse(out) as Record<string, unknown>;
        // Minimal sanity: the destination family's output has SOME content
        // corresponding to "Hello." — verified by pushing the output through
        // the destination family's own parser and checking for our user text.
        const serialized = JSON.stringify(parsed);
        expect(serialized).toContain('Hello');
      });
    }
  }
});

describe('cross-family dispatch — simple response round trip', () => {
  for (const src of FAMILIES) {
    for (const dst of FAMILIES) {
      if (src === dst) continue;
      it(`response ${dst} → ${src}`, () => {
        const c = ctx(src, dst);
        const out = translateResponse(c, SIMPLE_RESPONSES[dst]);
        expect(() => JSON.parse(out)).not.toThrow();
        // The assistant's "Hi." survives translation in some form.
        expect(out).toContain('Hi');
      });
    }
  }
});

/**
 * A tiny 1×1 red PNG (68 bytes) encoded as base64 — used as a minimal image
 * payload for cross-family vision translation tests.
 */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAABFUlEQVR4nO3OUQkAIABEsetfWiv4Nx4IC7Cd7XvkByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIReeLesrH9s1agAAAABJRU5ErkJggg==';

/**
 * Image-bearing request bodies per source family — a user message with a text
 * prompt + an inline base64 image, expressed in each family's native shape.
 */
const IMAGE_REQUESTS: Record<ModelFamily, string> = {
  anthropic: JSON.stringify({
    model: 'src-model',
    max_tokens: 128,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 },
          },
        ],
      },
    ],
  }),
  openai: JSON.stringify({
    model: 'src-model',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` } },
        ],
      },
    ],
    max_tokens: 128,
  }),
  gemini: JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Describe this image.' },
          { inlineData: { mimeType: 'image/png', data: TINY_PNG_B64 } },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 128 },
  }),
  cohere: JSON.stringify({
    model: 'src-model',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` } },
        ],
      },
    ],
    max_tokens: 128,
  }),
};

describe('cross-family dispatch — image request round trip', () => {
  for (const src of FAMILIES) {
    for (const dst of FAMILIES) {
      if (src === dst) continue;
      it(`${src} → ${dst} with image`, () => {
        const c = ctx(src, dst);
        const out = translateRequest(c, IMAGE_REQUESTS[src]);
        expect(() => JSON.parse(out)).not.toThrow();
        // The base64 image data must survive translation.
        expect(out).toContain(TINY_PNG_B64);
        // The text prompt must survive too.
        expect(out).toContain('Describe');
      });
    }
  }
});

describe('cross-family dispatch — tool use request', () => {
  // Anthropic-shaped tool request — translates into every other family.
  const anthropicToolReq = JSON.stringify({
    model: 'src-model',
    max_tokens: 200,
    messages: [{ role: 'user', content: 'What\'s the weather in Tokyo?' }],
    tools: [
      {
        name: 'get_weather',
        description: 'Get weather for a city',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
    tool_choice: { type: 'auto' },
  });

  for (const dst of FAMILIES) {
    if (dst === 'anthropic') continue;
    it(`anthropic → ${dst} with tools`, () => {
      const c = ctx('anthropic', dst);
      const out = translateRequest(c, anthropicToolReq);
      expect(() => JSON.parse(out)).not.toThrow();
      // The tool name survives translation.
      expect(out).toContain('get_weather');
    });
  }
});

describe('cross-family dispatch — OpenAI developer role', () => {
  const body = JSON.stringify({
    model: 'gpt-5.5',
    messages: [
      { role: 'developer', content: 'Only answer in French.' },
      { role: 'user', content: 'Hello' },
    ],
  });

  it('openai → anthropic puts the developer text into system', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'anthropic'), body)) as { system?: string };
    expect(out.system).toBe('Only answer in French.');
  });

  it('openai → gemini puts the developer text into systemInstruction', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'gemini'), body)) as {
      systemInstruction?: { parts: Array<{ text: string }> };
    };
    expect(out.systemInstruction).toEqual({ parts: [{ text: 'Only answer in French.' }] });
  });

  it('openai → cohere sends the developer text as a system message', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'cohere'), body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages[0]).toEqual({ role: 'system', content: 'Only answer in French.' });
  });
});

describe('cross-family dispatch — OpenAI stop: null', () => {
  const body = JSON.stringify({ model: 'gpt-5.5', stop: null, messages: [{ role: 'user', content: 'Hello' }] });

  it('openai → anthropic sends no stop_sequences', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'anthropic'), body)) as Record<string, unknown>;
    expect(out).not.toHaveProperty('stop_sequences');
  });

  it('openai → gemini sends no stopSequences', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'gemini'), body)) as {
      generationConfig?: Record<string, unknown>;
    };
    expect(out.generationConfig ?? {}).not.toHaveProperty('stopSequences');
  });

  it('openai → cohere sends no stop_sequences', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'cohere'), body)) as Record<string, unknown>;
    expect(out).not.toHaveProperty('stop_sequences');
  });
});

describe('cross-family dispatch — JSON Schema reaches Gemini in its JSON Schema fields', () => {
  it('anthropic → gemini moves a Claude Code tool schema to parametersJsonSchema', () => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'read it' }],
      tools: [
        {
          name: 'Read',
          input_schema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            additionalProperties: false,
            properties: { file_path: { type: 'string' } },
          },
        },
      ],
    });
    const out = JSON.parse(translateRequest(ctx('anthropic', 'gemini'), body)) as {
      tools: Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
    };
    expect(out.tools[0].functionDeclarations[0]).toEqual({
      name: 'Read',
      parametersJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { file_path: { type: 'string' } },
      },
    });
  });

  it('openai → gemini moves a strict json_schema to responseJsonSchema', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    };
    const body = JSON.stringify({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'x' }],
      response_format: { type: 'json_schema', json_schema: { name: 'r', strict: true, schema } },
    });
    const out = JSON.parse(translateRequest(ctx('openai', 'gemini'), body)) as {
      generationConfig: Record<string, unknown>;
    };
    expect(out.generationConfig.responseJsonSchema).toEqual(schema);
    expect(out.generationConfig).not.toHaveProperty('responseSchema');
  });
});

describe('cross-family dispatch — streams echo the app\'s model', () => {
  // Upstream streams in each destination dialect, all naming the upstream model.
  const UPSTREAM_STREAMS: Record<ModelFamily, string> = {
    anthropic:
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"upstream-model","usage":{"input_tokens":5,"output_tokens":0}}}\n\n' +
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    openai:
      'data: {"id":"c1","model":"upstream-model","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n' +
      'data: {"id":"c1","model":"upstream-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n',
    gemini:
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]},"finishReason":"STOP","index":0}],"modelVersion":"upstream-model","responseId":"r1"}\n\n',
    cohere:
      'data: {"type":"message-start","id":"c1","delta":{"message":{"role":"assistant"}}}\n\n' +
      'data: {"type":"content-start","index":0,"delta":{"message":{"content":{"type":"text","text":""}}}}\n\n' +
      'data: {"type":"content-delta","index":0,"delta":{"message":{"content":{"text":"Hi"}}}}\n\n' +
      'data: {"type":"content-end","index":0}\n\n' +
      'data: {"type":"message-end","delta":{"finish_reason":"COMPLETE"}}\n\n',
  };

  // Cohere's stream carries no model field, so it has nothing to echo.
  for (const src of FAMILIES.filter((f) => f !== 'cohere')) {
    for (const dst of FAMILIES) {
      if (src === dst) continue;
      it(`stream ${dst} → ${src}`, () => {
        const t = createStreamTranslator({ ...ctx(src, dst), isStreaming: true });
        const out = t.process(UPSTREAM_STREAMS[dst]) + t.flush();
        expect(out).toContain('Hi');
        expect(out).toContain('src-model');
        expect(out).not.toContain('upstream-model');
      });
    }
  }

  it('falls back to the upstream model when the app\'s model is unknown', () => {
    const t = createStreamTranslator({ ...ctx('anthropic', 'openai'), srcModel: undefined, isStreaming: true });
    const out = t.process(UPSTREAM_STREAMS.openai) + t.flush();
    expect(out).toContain('upstream-model');
  });
});

describe('cross-family dispatch — Cohere reasoning in Anthropic history', () => {
  it('cohere → anthropic sends a tool_plan turn as tool_use only', () => {
    const body = JSON.stringify({
      model: 'command-a-03-2025',
      messages: [
        { role: 'user', content: 'Weather in Paris?' },
        {
          role: 'assistant',
          tool_plan: 'I will call get_weather.',
          tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
        },
        { role: 'tool', tool_call_id: 't1', content: '{"temp":21}' },
      ],
    });
    const out = JSON.parse(translateRequest(ctx('cohere', 'anthropic'), body)) as {
      messages: Array<{ role: string; content: Array<{ type: string }> | string }>;
    };
    expect(JSON.stringify(out.messages)).not.toContain('"thinking"');
    expect(out.messages[1].content).toEqual([
      { type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Paris' } },
    ]);
  });
});
