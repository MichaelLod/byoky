import { describe, it, expect } from 'vitest';
import '../../../src/translate/index.js';
import { openaiAdapter } from '../../../src/translate/adapters/openai.js';
import type { TranslationContext } from '../../../src/translate/types.js';
import type { IRRequest, IRStreamEvent } from '../../../src/translate/ir.js';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'openai',
    dstFamily: 'openai',
    srcModel: 'gpt-5.4',
    dstModel: 'gpt-5.4',
    isStreaming: false,
    requestId: 'req-test',
    ...overrides,
  };
}

describe('openaiAdapter.parseRequest', () => {
  it('separates role:system messages into IR top-level system', () => {
    const ir = openaiAdapter.parseRequest(
      JSON.stringify({
        messages: [
          { role: 'system', content: 'part one' },
          { role: 'system', content: 'part two' },
          { role: 'user', content: 'hi' },
        ],
      }),
    );
    expect(ir.system).toEqual([{ text: 'part one' }, { text: 'part two' }]);
    expect(ir.messages).toHaveLength(1);
    expect(ir.messages[0].role).toBe('user');
  });

  it('lifts role:developer messages into IR system', () => {
    const ir = openaiAdapter.parseRequest(
      JSON.stringify({
        messages: [
          { role: 'developer', content: 'Only answer in French.' },
          { role: 'user', content: 'Hello' },
        ],
      }),
    );
    expect(ir.system).toEqual([{ text: 'Only answer in French.' }]);
    expect(ir.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]);
  });

  it('ignores stop: null and blank stop strings', () => {
    const parse = (stop: unknown) =>
      openaiAdapter.parseRequest(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stop }));
    expect(parse(null).stopSequences).toBeUndefined();
    expect(parse('').stopSequences).toBeUndefined();
    expect(parse([null, '  ']).stopSequences).toBeUndefined();
    expect(parse([null, 'x']).stopSequences).toEqual(['x']);
    expect(parse('END').stopSequences).toEqual(['END']);
  });

  it('keeps system and developer messages in their original order', () => {
    const ir = openaiAdapter.parseRequest(
      JSON.stringify({
        messages: [
          { role: 'developer', content: [{ type: 'text', text: 'one' }] },
          { role: 'system', content: 'two' },
          { role: 'user', content: 'hi' },
          { role: 'developer', content: 'three' },
        ],
      }),
    );
    expect(ir.system).toEqual([{ text: 'one' }, { text: 'two' }, { text: 'three' }]);
    expect(ir.messages).toHaveLength(1);
  });

  it('maps role:tool messages into tool_result blocks on next user turn', () => {
    const ir = openaiAdapter.parseRequest(
      JSON.stringify({
        messages: [
          { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } }] },
          { role: 'tool', tool_call_id: 't1', content: '{"temp":18}' },
          { role: 'user', content: 'thanks' },
        ],
      }),
    );
    // assistant with tool_use + user with tool_result + text
    expect(ir.messages).toHaveLength(2);
    const assistant = ir.messages[0];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content[0]).toEqual({
      type: 'tool_use',
      id: 't1',
      name: 'get_weather',
      input: { city: 'Tokyo' },
    });
    const user = ir.messages[1];
    expect(user.role).toBe('user');
    expect(user.content[0]).toEqual({
      type: 'tool_result',
      toolUseId: 't1',
      content: { kind: 'text', text: '{"temp":18}' },
    });
    expect(user.content[1]).toEqual({ type: 'text', text: 'thanks' });
  });

  it('packs trailing tool messages into a standalone user turn', () => {
    const ir = openaiAdapter.parseRequest(
      JSON.stringify({
        messages: [
          { role: 'user', content: 'look it up' },
          { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
          { role: 'tool', tool_call_id: 't1', content: 'answer' },
        ],
      }),
    );
    expect(ir.messages).toHaveLength(3);
    expect(ir.messages[2].role).toBe('user');
    expect(ir.messages[2].content[0].type).toBe('tool_result');
  });

  it('parses image_url content parts into IR image blocks', () => {
    const ir = openaiAdapter.parseRequest(
      JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
            ],
          },
        ],
      }),
    );
    const blocks = ir.messages[0].content;
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({
      type: 'image',
      source: { kind: 'base64', mediaType: 'image/png', data: 'abc' },
    });
  });

  it('parses response_format json_schema into IR json_schema', () => {
    const ir = openaiAdapter.parseRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'x' }],
        response_format: { type: 'json_schema', json_schema: { name: 'r', schema: { type: 'object' } } },
      }),
    );
    expect(ir.responseFormat).toEqual({ type: 'json_schema', schema: { type: 'object' } });
  });
});

describe('openaiAdapter.serializeRequest', () => {
  it('uses max_completion_tokens for reasoning destination models', () => {
    // gpt-5.4 is reasoning=true in the registry.
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      maxTokens: 256,
      temperature: 0.7,
    };
    const out = JSON.parse(openaiAdapter.serializeRequest(ctx({ dstModel: 'gpt-5.4' }), ir)) as Record<string, unknown>;
    expect(out.max_completion_tokens).toBe(256);
    expect(out.max_tokens).toBeUndefined();
    // temperature dropped for reasoning models
    expect(out.temperature).toBeUndefined();
  });

  it('uses max_tokens for non-reasoning destination models', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      maxTokens: 256,
      temperature: 0.7,
    };
    const out = JSON.parse(openaiAdapter.serializeRequest(ctx({ dstModel: 'gpt-unknown' }), ir)) as Record<string, unknown>;
    expect(out.max_tokens).toBe(256);
    expect(out.temperature).toBe(0.7);
  });

  it('sets stream_options.include_usage for streaming requests', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      stream: true,
    };
    const out = JSON.parse(openaiAdapter.serializeRequest(ctx(), ir)) as { stream_options?: { include_usage?: boolean } };
    expect(out.stream_options?.include_usage).toBe(true);
  });

  it('splits tool_result blocks into role:tool messages', () => {
    const ir: IRRequest = {
      system: [],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 't1', content: { kind: 'text', text: '42' } },
            { type: 'text', text: 'ok' },
          ],
        },
      ],
    };
    const out = JSON.parse(openaiAdapter.serializeRequest(ctx(), ir)) as { messages: Array<{ role: string; content?: unknown; tool_call_id?: string }> };
    const roles = out.messages.map((m) => m.role);
    expect(roles).toContain('tool');
    expect(roles).toContain('user');
    const toolMsg = out.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('t1');
    expect(toolMsg?.content).toBe('42');
  });
});

describe('openaiAdapter round-trip', () => {
  it('parse → serialize → parse preserves chat + tools', () => {
    const original = JSON.stringify({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'weather tool',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ],
      tool_choice: 'auto',
    });
    const ir1 = openaiAdapter.parseRequest(original);
    const wire = openaiAdapter.serializeRequest(ctx({ dstModel: 'gpt-unknown' }), ir1);
    const ir2 = openaiAdapter.parseRequest(wire);
    expect(ir2.system).toEqual(ir1.system);
    expect(ir2.messages).toEqual(ir1.messages);
    expect(ir2.tools).toEqual(ir1.tools);
    expect(ir2.toolChoice).toEqual(ir1.toolChoice);
  });
});

describe('openaiAdapter stream parsing', () => {
  it('synthesizes content_block_start/stop around text deltas', () => {
    const parser = openaiAdapter.createStreamParser();
    const chunks = [
      'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hel"}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"lo"}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];
    const events: IRStreamEvent[] = [];
    for (const c of chunks) events.push(...parser.process(c));
    events.push(...parser.flush());

    const types = events.map((e) => e.type);
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');

    const text = events
      .filter((e): e is Extract<IRStreamEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('Hello');
  });

  it('synthesizes tool_use block from streamed tool_calls deltas', () => {
    const parser = openaiAdapter.createStreamParser();
    const chunks = [
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"t1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Tokyo\\"}"}}]}}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const events: IRStreamEvent[] = [];
    for (const c of chunks) events.push(...parser.process(c));
    events.push(...parser.flush());

    const toolStart = events.find((e) => e.type === 'content_block_start' && e.block.type === 'tool_use');
    expect(toolStart).toBeDefined();
    if (toolStart && toolStart.type === 'content_block_start' && toolStart.block.type === 'tool_use') {
      expect(toolStart.block.name).toBe('get_weather');
      expect(toolStart.block.id).toBe('t1');
    }

    const argsDeltas = events
      .filter((e): e is Extract<IRStreamEvent, { type: 'tool_input_delta' }> => e.type === 'tool_input_delta')
      .map((e) => e.partialJson)
      .join('');
    expect(argsDeltas).toContain('Tokyo');

    const msgDelta = events.find((e) => e.type === 'message_delta');
    expect(msgDelta).toBeDefined();
    if (msgDelta && msgDelta.type === 'message_delta') {
      expect(msgDelta.stopReason).toBe('tool_use');
    }
  });
});

describe('openaiAdapter.serializeRequest — reasoning models and max_completion_tokens', () => {
  const ir: IRRequest = {
    system: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    maxTokens: 1024,
    temperature: 0.3,
    topP: 0.9,
  };
  const serialize = (overrides: Partial<TranslationContext>) =>
    JSON.parse(openaiAdapter.serializeRequest(ctx(overrides), ir)) as Record<string, unknown>;

  it.each(['gpt-5-mini', 'gpt-5.5-pro', 'gpt-5.5-2026-04-01', 'o3', 'o4-mini'])(
    '%s gets max_completion_tokens and no sampling overrides',
    (dstModel) => {
      for (const dstProviderId of ['openai', undefined]) {
        const out = serialize({ dstModel, dstProviderId });
        expect(out.max_completion_tokens).toBe(1024);
        expect(out).not.toHaveProperty('max_tokens');
        expect(out).not.toHaveProperty('temperature');
        expect(out).not.toHaveProperty('top_p');
      }
    },
  );

  it('a non-reasoning model on OpenAI gets max_completion_tokens and keeps sampling', () => {
    const out = serialize({ dstModel: 'gpt-4.1', dstProviderId: 'openai' });
    expect(out.max_completion_tokens).toBe(1024);
    expect(out).not.toHaveProperty('max_tokens');
    expect(out.temperature).toBe(0.3);
    expect(out.top_p).toBe(0.9);
  });

  it('other hosts of the dialect keep max_tokens', () => {
    const out = serialize({ dstModel: 'llama-3.3-70b-versatile', dstProviderId: 'groq' });
    expect(out.max_tokens).toBe(1024);
    expect(out).not.toHaveProperty('max_completion_tokens');
    expect(out.temperature).toBe(0.3);
  });

  it('an OpenAI reasoning model behind OpenRouter keeps max_tokens but drops sampling', () => {
    const out = serialize({ dstModel: 'openai/gpt-5', dstProviderId: 'openrouter' });
    expect(out.max_tokens).toBe(1024);
    expect(out).not.toHaveProperty('max_completion_tokens');
    expect(out).not.toHaveProperty('temperature');
    expect(out).not.toHaveProperty('top_p');
  });

  it('an unknown provider with a non-reasoning model keeps max_tokens', () => {
    const out = serialize({ dstModel: 'gpt-4.1', dstProviderId: undefined });
    expect(out.max_tokens).toBe(1024);
    expect(out.temperature).toBe(0.3);
  });
});
