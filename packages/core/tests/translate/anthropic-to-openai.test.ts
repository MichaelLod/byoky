import { describe, it, expect } from 'vitest';
import { anthropicToOpenAIRequest } from '../../src/translate/anthropic-to-openai.js';
import type { TranslationContext } from '../../src/translate/types.js';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'anthropic',
    dstFamily: 'openai',
    srcModel: 'claude-sonnet-4-6',
    dstModel: 'gpt-5.4',
    isStreaming: false,
    requestId: 'req-test',
    state: {},
    ...overrides,
  };
}

function tx(body: object, overrides?: Partial<TranslationContext>) {
  return JSON.parse(anthropicToOpenAIRequest(ctx(overrides), JSON.stringify(body))) as Record<string, unknown>;
}

describe('anthropicToOpenAIRequest — basics', () => {
  it('overrides the model with ctx.dstModel', () => {
    const out = tx({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] });
    expect(out.model).toBe('gpt-5.4');
  });

  it('passes plain string user content through', () => {
    const out = tx({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hello' }] });
    expect(out.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('writes max_completion_tokens for reasoning destination models', () => {
    // gpt-5.4 is reasoning=true in the registry
    const out = tx({ model: 'x', max_tokens: 256, messages: [{ role: 'user', content: 'hi' }] });
    expect(out.max_completion_tokens).toBe(256);
    expect(out.max_tokens).toBeUndefined();
  });

  it('drops temperature/top_p for reasoning destinations', () => {
    const out = tx({
      model: 'x', max_tokens: 100, temperature: 0.7, top_p: 0.9,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.temperature).toBeUndefined();
    expect(out.top_p).toBeUndefined();
  });

  it('keeps temperature for non-reasoning destinations', () => {
    // No registered non-reasoning OpenAI models; force the path with an
    // unregistered dstModel — getModel returns undefined → falls through to
    // max_tokens + temperature pass-through
    const out = tx(
      { model: 'x', max_tokens: 100, temperature: 0.7, messages: [{ role: 'user', content: 'hi' }] },
      { dstModel: 'gpt-4o-legacy' },
    );
    expect(out.max_tokens).toBe(100);
    expect(out.temperature).toBe(0.7);
  });

  it('translates stop_sequences to stop', () => {
    const out = tx({
      model: 'x', max_tokens: 10, stop_sequences: ['END', '###'],
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.stop).toEqual(['END', '###']);
  });

  it('drops top_k silently', () => {
    const out = tx({
      model: 'x', max_tokens: 10, top_k: 40,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect((out as { top_k?: unknown }).top_k).toBeUndefined();
  });
});

describe('anthropicToOpenAIRequest — system prompts', () => {
  it('translates string system into a leading system message', () => {
    const out = tx({
      model: 'x', max_tokens: 10, system: 'you are helpful',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const msgs = out.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toEqual({ role: 'system', content: 'you are helpful' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('flattens text-block-array system to a joined string', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      system: [
        { type: 'text', text: 'block one' },
        { type: 'text', text: 'block two' },
      ],
      messages: [{ role: 'user', content: 'hi' }],
    });
    const msgs = out.messages as Array<{ role: string; content: string }>;
    expect(msgs[0].content).toBe('block one\n\nblock two');
  });

  it('omits the system message entirely if system is absent', () => {
    const out = tx({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs[0].role).toBe('user');
  });
});

describe('anthropicToOpenAIRequest — content blocks', () => {
  it('preserves a single user text block as a flat string', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
    });
    const msgs = out.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0].content).toBe('hello world');
  });

  it('translates base64 image source to a data URL', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'whats this?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ABCDEF' } },
          ],
        },
      ],
    });
    const msgs = out.messages as Array<{ role: string; content: Array<{ type: string; image_url?: { url: string } }> }>;
    const parts = msgs[0].content;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe('data:image/png;base64,ABCDEF');
  });

  it('translates url image source to image_url with the same url', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/cat.png' } }],
        },
      ],
    });
    const msgs = out.messages as Array<{ role: string; content: Array<{ type: string; image_url?: { url: string } }> }>;
    expect(msgs[0].content[0].image_url?.url).toBe('https://example.com/cat.png');
  });
});

describe('anthropicToOpenAIRequest — tools', () => {
  it('translates tool definitions into OpenAI function shape', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        },
      ],
      messages: [{ role: 'user', content: 'weather?' }],
    });
    const tools = out.tools as Array<{ type: string; function: { name: string; description?: string; parameters: unknown } }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('get_weather');
    expect(tools[0].function.parameters).toEqual({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    });
  });

  it('translates tool_choice variants', () => {
    expect(tx({ model: 'x', max_tokens: 10, messages: [], tool_choice: { type: 'auto' } }).tool_choice).toBe('auto');
    expect(tx({ model: 'x', max_tokens: 10, messages: [], tool_choice: { type: 'any' } }).tool_choice).toBe('required');
    expect(tx({ model: 'x', max_tokens: 10, messages: [], tool_choice: { type: 'none' } }).tool_choice).toBe('none');
    expect(tx({
      model: 'x', max_tokens: 10, messages: [],
      tool_choice: { type: 'tool', name: 'get_weather' },
    }).tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });
  });

  it('translates assistant tool_use blocks into tool_calls', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      messages: [
        { role: 'user', content: 'whats the weather' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: "I'll check." },
            { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Tokyo' } },
          ],
        },
      ],
    });
    const msgs = out.messages as Array<{ role: string; content?: unknown; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }>;
    const assistant = msgs[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe("I'll check.");
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls?.[0].id).toBe('toolu_1');
    expect(assistant.tool_calls?.[0].function.name).toBe('get_weather');
    expect(JSON.parse(assistant.tool_calls?.[0].function.arguments ?? '{}')).toEqual({ city: 'Tokyo' });
  });

  it('hoists user tool_result blocks into separate tool messages', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      messages: [
        { role: 'user', content: 'check' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Tokyo' } }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"temperature":12}' },
            { type: 'text', text: 'now do New York' },
          ],
        },
      ],
    });
    const msgs = out.messages as Array<{ role: string; content?: unknown; tool_call_id?: string }>;
    // Sequence: user, assistant(tool_use), tool(result), user(text)
    expect(msgs[2].role).toBe('tool');
    expect(msgs[2].tool_call_id).toBe('toolu_1');
    expect(msgs[2].content).toBe('{"temperature":12}');
    expect(msgs[3].role).toBe('user');
    expect(msgs[3].content).toBe('now do New York');
  });

  it('flattens text+image-block tool_result content into a string', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [
                { type: 'text', text: 'first' },
                { type: 'text', text: 'second' },
              ],
            },
          ],
        },
      ],
    });
    const msgs = out.messages as Array<{ role: string; content?: unknown; tool_call_id?: string }>;
    expect(msgs[0].role).toBe('tool');
    expect(msgs[0].content).toBe('first\nsecond');
  });
});

describe('anthropicToOpenAIRequest — streaming', () => {
  it('preserves stream and injects stream_options.include_usage', () => {
    const out = tx({ model: 'x', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] });
    expect(out.stream).toBe(true);
    expect((out as { stream_options?: { include_usage: boolean } }).stream_options?.include_usage).toBe(true);
  });

  it('does not inject stream_options when not streaming', () => {
    const out = tx({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    expect((out as { stream_options?: unknown }).stream_options).toBeUndefined();
  });
});
