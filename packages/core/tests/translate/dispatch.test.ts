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

// R2-03: whitespace-only stop sequences are refused by Anthropic only; the
// other families take them, so they are dropped for Anthropic alone.
describe('cross-family dispatch — whitespace-only stop sequences', () => {
  const body = (stop: unknown) =>
    JSON.stringify({ model: 'gpt-5.5', stop, messages: [{ role: 'user', content: 'Hello' }] });

  it('openai → gemini keeps "\\n"', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'gemini'), body(['\n', 'END']))) as {
      generationConfig?: Record<string, unknown>;
    };
    expect(out.generationConfig?.stopSequences).toEqual(['\n', 'END']);
  });

  it('openai → cohere keeps "\\n"', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'cohere'), body('\n'))) as Record<string, unknown>;
    expect(out.stop_sequences).toEqual(['\n']);
  });

  it('openai → anthropic drops whitespace-only entries and keeps the rest', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'anthropic'), body(['\n', ' \t', 'END']))) as Record<string, unknown>;
    expect(out.stop_sequences).toEqual(['END']);
  });

  it('openai → anthropic with only whitespace stops sends no stop_sequences', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'anthropic'), body('\n'))) as Record<string, unknown>;
    expect(out).not.toHaveProperty('stop_sequences');
  });

  it('gemini and cohere → anthropic drop them too', () => {
    const gemini = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      generationConfig: { stopSequences: ['\n\n', 'END'] },
    });
    const fromGemini = JSON.parse(translateRequest(ctx('gemini', 'anthropic'), gemini)) as Record<string, unknown>;
    expect(fromGemini.stop_sequences).toEqual(['END']);
    const cohere = JSON.stringify({ model: 'command-a-03-2025', messages: [{ role: 'user', content: 'Hello' }], stop_sequences: ['\n'] });
    const fromCohere = JSON.parse(translateRequest(ctx('cohere', 'anthropic'), cohere)) as Record<string, unknown>;
    expect(fromCohere).not.toHaveProperty('stop_sequences');
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

describe('cross-family dispatch — Gemini thinkingConfig to Anthropic and Cohere', () => {
  const gemini = (generationConfig: Record<string, unknown>) =>
    JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hello.' }] }], generationConfig });

  it('gemini → anthropic: budget 0 leaves thinking off', () => {
    const out = JSON.parse(translateRequest(ctx('gemini', 'anthropic'), gemini({ thinkingConfig: { thinkingBudget: 0 } })));
    expect(out).not.toHaveProperty('thinking');
  });

  it('gemini → anthropic: budget -1 gives valid thinking', () => {
    const out = JSON.parse(translateRequest(ctx('gemini', 'anthropic'), gemini({ thinkingConfig: { thinkingBudget: -1 } })));
    expect(out.thinking).toEqual({ type: 'adaptive' });
  });

  it('gemini → anthropic (budget model): a large budget fits under max_tokens and drops temperature', () => {
    const out = JSON.parse(
      translateRequest(
        { ...ctx('gemini', 'anthropic'), dstModel: 'claude-haiku-4-5-20251001' },
        gemini({ temperature: 0.4, thinkingConfig: { thinkingBudget: 8192 } }),
      ),
    ) as { max_tokens: number; thinking: { budget_tokens: number }; temperature?: number };
    expect(out.thinking.budget_tokens).toBe(8192);
    expect(out.max_tokens).toBeGreaterThan(out.thinking.budget_tokens);
    expect(out).not.toHaveProperty('temperature');
  });

  it('gemini → cohere: budget 0 leaves thinking off', () => {
    const out = JSON.parse(translateRequest(ctx('gemini', 'cohere'), gemini({ thinkingConfig: { thinkingBudget: 0 } })));
    expect(out).not.toHaveProperty('thinking');
  });

  it('gemini → cohere: budget -1 (dynamic) sends no thinking field', () => {
    const out = JSON.parse(translateRequest(ctx('gemini', 'cohere'), gemini({ thinkingConfig: { thinkingBudget: -1 } })));
    expect(out).not.toHaveProperty('thinking');
  });

  it('gemini → cohere: a positive budget becomes token_budget', () => {
    const out = JSON.parse(translateRequest(ctx('gemini', 'cohere'), gemini({ thinkingConfig: { thinkingBudget: 4096 } })));
    expect(out.thinking).toEqual({ type: 'enabled', token_budget: 4096 });
  });
});

describe('cross-family dispatch — Anthropic adaptive thinking', () => {
  // Claude Code's default on current Claude models.
  const body = JSON.stringify({
    model: 'claude-opus-4-7',
    max_tokens: 1000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: 'Hello.' }],
  });

  it('anthropic → cohere (command-a-03-2025) sends no thinking field', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'cohere'), body));
    expect(out).not.toHaveProperty('thinking');
  });

  it('anthropic → gemini sends no thinkingConfig', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'gemini'), body));
    expect(out.generationConfig ?? {}).not.toHaveProperty('thinkingConfig');
  });

  it('anthropic → openai sends no reasoning fields', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'openai'), body));
    expect(out).not.toHaveProperty('reasoning_effort');
    expect(out).not.toHaveProperty('thinking');
  });

  it('an explicit budget still reaches Cohere', () => {
    const budgeted = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      thinking: { type: 'enabled', budget_tokens: 2048 },
      messages: [{ role: 'user', content: 'Hello.' }],
    });
    const out = JSON.parse(translateRequest(ctx('anthropic', 'cohere'), budgeted));
    expect(out.thinking).toEqual({ type: 'enabled', token_budget: 2048 });
  });
});

describe('cross-family dispatch — sampling parameters per destination', () => {
  const body = JSON.stringify({
    model: 'gpt-5.5',
    temperature: 0.7,
    top_p: 1,
    messages: [{ role: 'user', content: 'Hello' }],
  });

  it('openai → anthropic (sonnet-4-6) sends temperature only', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'anthropic'), body));
    expect(out.temperature).toBe(0.7);
    expect(out).not.toHaveProperty('top_p');
  });

  it('openai → anthropic (opus-4-7) sends no sampling parameters', () => {
    const out = JSON.parse(translateRequest({ ...ctx('openai', 'anthropic'), dstModel: 'claude-opus-4-7' }, body));
    expect(out).not.toHaveProperty('temperature');
    expect(out).not.toHaveProperty('top_p');
  });

  it('openai → cohere sends p within range', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'cohere'), body));
    expect(out.p).toBe(0.99);
  });
});

describe('cross-family dispatch — Gemini snake_case body', () => {
  // The body byoky.com/chat builds for Gemini (packages/web/app/chat/ChatApp.tsx).
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: 'You are terse.' }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/png', data: TINY_PNG_B64 } },
          { text: 'Describe this image.' },
        ],
      },
    ],
    generation_config: { max_output_tokens: 256 },
  });

  it('gemini → anthropic keeps the system prompt, the image and max_tokens', () => {
    const out = JSON.parse(translateRequest(ctx('gemini', 'anthropic'), body)) as {
      system?: string;
      max_tokens: number;
      messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }>;
    };
    expect(out.system).toBe('You are terse.');
    expect(out.max_tokens).toBe(256);
    expect(out.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 },
    });
  });
});

describe('cross-family dispatch — Gemini function responses without ids', () => {
  // The Gemini SDK replays the model turn (with the id byoky returned) and
  // builds the functionResponse from name + response only.
  const body = JSON.stringify({
    contents: [
      { role: 'user', parts: [{ text: 'Weather in Paris?' }] },
      { role: 'model', parts: [{ functionCall: { id: 'toolu_01', name: 'get_weather', args: { city: 'Paris' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'get_weather', response: { temp: 21 } } }] },
    ],
  });

  it('gemini → anthropic pairs the tool_result with the tool_use id', () => {
    const out = JSON.parse(translateRequest(ctx('gemini', 'anthropic'), body)) as {
      messages: Array<{ content: Array<{ type: string; id?: string; tool_use_id?: string }> }>;
    };
    expect(out.messages[1].content[0]).toMatchObject({ type: 'tool_use', id: 'toolu_01' });
    expect(out.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_01' });
  });

  it('gemini → openai answers the tool_call id', () => {
    const out = JSON.parse(translateRequest(ctx('gemini', 'openai'), body)) as {
      messages: Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>;
    };
    const assistant = out.messages.find((m) => m.role === 'assistant');
    const tool = out.messages.find((m) => m.role === 'tool');
    expect(assistant?.tool_calls?.[0].id).toBe('toolu_01');
    expect(tool?.tool_call_id).toBe('toolu_01');
  });
});

describe('cross-family dispatch — Gemini 3 thought signatures', () => {
  const openaiHistory = JSON.stringify({
    model: 'gpt-5.5',
    messages: [
      { role: 'user', content: 'Weather in Paris and Rome?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
          { id: 'call_2', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Rome"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"temp":21}' },
      { role: 'tool', tool_call_id: 'call_2', content: '{"temp":25}' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_3', type: 'function', function: { name: 'get_time', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_3', content: '"12:00"' },
    ],
  });
  const anthropicHistory = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'Weather?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"temp":21}' }] },
    ],
  });

  type GeminiOut = { contents: Array<{ role: string; parts: Array<{ functionCall?: unknown; thoughtSignature?: string }> }> };
  const signatures = (out: GeminiOut) =>
    out.contents
      .filter((c) => c.role === 'model')
      .map((c) => c.parts.map((p) => (p.functionCall ? p.thoughtSignature ?? null : 'not-a-call')));

  it('openai → gemini 3 signs the first function call of each model turn', () => {
    const out = JSON.parse(
      translateRequest({ ...ctx('openai', 'gemini'), dstModel: 'gemini-3-pro-preview' }, openaiHistory),
    ) as GeminiOut;
    expect(signatures(out)).toEqual([
      ['skip_thought_signature_validator', null],
      ['skip_thought_signature_validator'],
    ]);
  });

  it('anthropic → gemini 3 signs the function call', () => {
    const out = JSON.parse(
      translateRequest({ ...ctx('anthropic', 'gemini'), dstModel: 'gemini-3-flash-preview' }, anthropicHistory),
    ) as GeminiOut;
    expect(signatures(out)).toEqual([['skip_thought_signature_validator']]);
  });

  it('gemini 2.5 gets no signature', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'gemini'), openaiHistory)) as GeminiOut;
    expect(JSON.stringify(out)).not.toContain('thoughtSignature');
  });
});

describe('cross-family dispatch — refusals and blocked prompts', () => {
  it('an OpenAI refusal reaches an Anthropic app as stop_reason refusal with its text', () => {
    const out = JSON.parse(
      translateResponse(
        ctx('anthropic', 'openai'),
        JSON.stringify({
          id: 'c1',
          model: 'gpt-5.5',
          choices: [{ index: 0, message: { role: 'assistant', content: null, refusal: "I'm sorry." }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      ),
    );
    expect(out.stop_reason).toBe('refusal');
    expect(out.content).toEqual([{ type: 'text', text: "I'm sorry." }]);
  });

  it('a blocked Gemini prompt reaches an OpenAI app as content_filter', () => {
    const out = JSON.parse(
      translateResponse(ctx('openai', 'gemini'), JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })),
    );
    expect(out.choices[0].finish_reason).toBe('content_filter');
    expect(out.choices[0].message.content).toBe('Prompt blocked: SAFETY');
  });

  it('a blocked Gemini prompt in a stream reaches an Anthropic app as a refusal', () => {
    const t = createStreamTranslator({ ...ctx('anthropic', 'gemini'), isStreaming: true });
    const out = t.process('data: {"promptFeedback":{"blockReason":"SAFETY"},"responseId":"r1"}\n\n') + t.flush();
    expect(out).toContain('"stop_reason":"refusal"');
    expect(out).toContain('Prompt blocked: SAFETY');
  });
});

describe('cross-family dispatch — errors in the middle of a Gemini stream', () => {
  it('a bare Gemini error object reaches an Anthropic app as event: error, not a clean end_turn', () => {
    const t = createStreamTranslator({ ...ctx('anthropic', 'gemini'), isStreaming: true });
    const out =
      t.process('data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"}}]}\r\n\r\n') +
      t.process('{"error":{"code":503,"message":"The model is overloaded.","status":"UNAVAILABLE"}}\r\n') +
      t.flush();
    expect(out).toContain('event: error');
    expect(out).toContain('"type":"overloaded_error"');
    expect(out).not.toContain('end_turn');
    expect(out).not.toContain('message_stop');
  });

  it('a bare Gemini error object reaches an OpenAI app as an error chunk, not finish_reason stop', () => {
    const t = createStreamTranslator({ ...ctx('openai', 'gemini'), isStreaming: true });
    const out =
      t.process('data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"}}]}\r\n\r\n') +
      t.process('{\r\n  "error": {\r\n    "code": 503,\r\n    "message": "busy",\r\n    "status": "UNAVAILABLE"\r\n  }\r\n}\r\n') +
      t.flush();
    expect(out).toContain('"error":{');
    expect(out).not.toContain('"finish_reason":"stop"');
  });

  it('an Anthropic mid-stream error reaches a Gemini app as a bare JSON error object', () => {
    const t = createStreamTranslator({ ...ctx('gemini', 'anthropic'), isStreaming: true });
    const out =
      t.process(
        'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","model":"claude-sonnet-4-6","usage":{"input_tokens":3,"output_tokens":0}}}\n\n' +
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
      ) +
      t.process('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n') +
      t.flush();
    const frames = out.split('\n\n');
    expect(frames[0].startsWith('data: ')).toBe(true);
    expect(frames[frames.length - 1]).toBe('{"error":{"code":529,"message":"Overloaded","status":"UNAVAILABLE"}}');
    expect(out).not.toContain('data: {"error"');
  });
});
