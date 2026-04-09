import { describe, it, expect } from 'vitest';
import { openAIToAnthropicRequest } from '../../src/translate/openai-to-anthropic.js';
import { TranslationError } from '../../src/translate/types.js';
import type { TranslationContext } from '../../src/translate/types.js';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'openai',
    dstFamily: 'anthropic',
    srcModel: 'gpt-5.4',
    dstModel: 'claude-sonnet-4-6',
    isStreaming: false,
    requestId: 'req-test',
    state: {},
    ...overrides,
  };
}

function tx(body: object, overrides?: Partial<TranslationContext>) {
  return JSON.parse(openAIToAnthropicRequest(ctx(overrides), JSON.stringify(body))) as Record<string, unknown>;
}

describe('openAIToAnthropicRequest — basics', () => {
  it('overrides the model with ctx.dstModel', () => {
    const out = tx({ model: 'gpt-5.4', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] });
    expect(out.model).toBe('claude-sonnet-4-6');
  });

  it('makes max_tokens required, defaulting from the destination model', () => {
    // No max_tokens given → must default rather than producing missing required field
    const out = tx({ model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    expect(typeof out.max_tokens).toBe('number');
    expect(out.max_tokens as number).toBeGreaterThan(0);
  });

  it('reads max_completion_tokens as a fallback for max_tokens', () => {
    const out = tx({ model: 'x', max_completion_tokens: 512, messages: [{ role: 'user', content: 'hi' }] });
    expect(out.max_tokens).toBe(512);
  });

  it('clamps temperature to the [0,1] range Anthropic expects', () => {
    expect(tx({ model: 'x', temperature: 1.7, messages: [] }).temperature).toBe(1);
    expect(tx({ model: 'x', temperature: -0.5, messages: [] }).temperature).toBe(0);
    expect(tx({ model: 'x', temperature: 0.5, messages: [] }).temperature).toBe(0.5);
  });

  it('drops frequency_penalty / presence_penalty / seed / logprobs', () => {
    const out = tx({
      model: 'x', frequency_penalty: 0.5, presence_penalty: 0.5,
      seed: 42, logprobs: true, top_logprobs: 5,
      messages: [{ role: 'user', content: 'hi' }],
    });
    for (const k of ['frequency_penalty', 'presence_penalty', 'seed', 'logprobs', 'top_logprobs']) {
      expect((out as Record<string, unknown>)[k]).toBeUndefined();
    }
  });

  it('normalizes stop string into stop_sequences array', () => {
    expect(tx({ model: 'x', stop: 'END', messages: [] }).stop_sequences).toEqual(['END']);
    expect(tx({ model: 'x', stop: ['A', 'B'], messages: [] }).stop_sequences).toEqual(['A', 'B']);
  });

  it('passes user → metadata.user_id', () => {
    const out = tx({ model: 'x', user: 'user-42', messages: [] });
    expect((out as { metadata?: { user_id?: string } }).metadata?.user_id).toBe('user-42');
  });
});

describe('openAIToAnthropicRequest — system extraction', () => {
  it('extracts a single system message into top-level system', () => {
    const out = tx({
      model: 'x',
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(out.system).toBe('you are helpful');
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('joins multiple system messages with blank lines', () => {
    const out = tx({
      model: 'x',
      messages: [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'second' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(out.system).toBe('first\n\nsecond');
  });
});

describe('openAIToAnthropicRequest — refused features', () => {
  it('throws on n > 1', () => {
    expect(() => openAIToAnthropicRequest(ctx(), JSON.stringify({ model: 'x', n: 3, messages: [] }))).toThrow(TranslationError);
  });

  it('throws on response_format json_schema', () => {
    expect(() => openAIToAnthropicRequest(ctx(), JSON.stringify({
      model: 'x', messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_schema' },
    }))).toThrow(TranslationError);
  });

  it('shims response_format json_object into a system hint', () => {
    const out = tx({
      model: 'x', messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
    });
    expect((out.system as string).toLowerCase()).toContain('json');
  });
});

describe('openAIToAnthropicRequest — tools', () => {
  it('translates OpenAI function tools to Anthropic tools', () => {
    const out = tx({
      model: 'x', max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ],
    });
    const tools = out.tools as Array<{ name: string; description?: string; input_schema: unknown }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('get_weather');
    expect(tools[0].input_schema).toEqual({ type: 'object', properties: { city: { type: 'string' } } });
  });

  it('translates tool_choice variants', () => {
    expect(tx({ model: 'x', messages: [], tool_choice: 'auto' }).tool_choice).toEqual({ type: 'auto' });
    expect(tx({ model: 'x', messages: [], tool_choice: 'required' }).tool_choice).toEqual({ type: 'any' });
    expect(tx({ model: 'x', messages: [], tool_choice: 'none' }).tool_choice).toEqual({ type: 'none' });
    expect(tx({
      model: 'x', messages: [],
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
    }).tool_choice).toEqual({ type: 'tool', name: 'get_weather' });
  });

  it('translates assistant tool_calls into tool_use content blocks', () => {
    const out = tx({
      model: 'x',
      messages: [
        { role: 'user', content: 'whats the weather' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } },
          ],
        },
      ],
    });
    const msgs = out.messages as Array<{ role: string; content: unknown }>;
    const assistant = msgs[1];
    expect(assistant.role).toBe('assistant');
    const blocks = assistant.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>;
    const toolUse = blocks.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse?.id).toBe('call_1');
    expect(toolUse?.name).toBe('get_weather');
    expect(toolUse?.input).toEqual({ city: 'Tokyo' });
  });

  it('folds tool messages into the next user message as tool_result blocks', () => {
    const out = tx({
      model: 'x',
      messages: [
        { role: 'user', content: 'whats weather' },
        {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"temp":12}' },
        { role: 'user', content: 'now for New York' },
      ],
    });
    const msgs = out.messages as Array<{ role: string; content: unknown }>;
    // user, assistant, user(tool_result + text)
    expect(msgs).toHaveLength(3);
    const last = msgs[2];
    expect(last.role).toBe('user');
    const blocks = last.content as Array<{ type: string; tool_use_id?: string; content?: string; text?: string }>;
    const toolResult = blocks.find((b) => b.type === 'tool_result');
    expect(toolResult?.tool_use_id).toBe('call_1');
    expect(toolResult?.content).toBe('{"temp":12}');
    expect(blocks.find((b) => b.type === 'text')?.text).toBe('now for New York');
  });

  it('emits trailing tool messages as a standalone user turn', () => {
    const out = tx({
      model: 'x',
      messages: [
        {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'result' },
      ],
    });
    const msgs = out.messages as Array<{ role: string }>;
    // assistant, then user(tool_result)
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'user']);
  });

  it('parses malformed tool arguments without dropping the call', () => {
    const out = tx({
      model: 'x',
      messages: [
        {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: 'NOT JSON' } }],
        },
      ],
    });
    const msgs = out.messages as Array<{ role: string; content: unknown }>;
    const blocks = msgs[0].content as Array<{ type: string; input?: { _raw?: string } }>;
    const toolUse = blocks.find((b) => b.type === 'tool_use');
    expect(toolUse?.input?._raw).toBe('NOT JSON');
  });
});

describe('openAIToAnthropicRequest — content blocks', () => {
  it('preserves user string content as a string', () => {
    const out = tx({
      model: 'x', messages: [{ role: 'user', content: 'hello world' }],
    });
    const msgs = out.messages as Array<{ content: unknown }>;
    expect(msgs[0].content).toBe('hello world');
  });

  it('translates image_url data URLs to base64 image source', () => {
    const out = tx({
      model: 'x',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'whats this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,ABCDEF' } },
          ],
        },
      ],
    });
    const msgs = out.messages as Array<{ content: Array<{ type: string; source?: { type: string; media_type?: string; data?: string; url?: string } }> }>;
    const img = msgs[0].content.find((b) => b.type === 'image');
    expect(img?.source?.type).toBe('base64');
    expect(img?.source?.media_type).toBe('image/png');
    expect(img?.source?.data).toBe('ABCDEF');
  });

  it('translates image_url http URLs to url image source', () => {
    const out = tx({
      model: 'x',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/cat.png' } }],
        },
      ],
    });
    const msgs = out.messages as Array<{ content: Array<{ type: string; source?: { type: string; url?: string } }> }>;
    expect(msgs[0].content[0].source?.type).toBe('url');
    expect(msgs[0].content[0].source?.url).toBe('https://example.com/cat.png');
  });
});

describe('openAIToAnthropicRequest — error handling', () => {
  it('throws TranslationError on invalid JSON', () => {
    expect(() => openAIToAnthropicRequest(ctx(), 'not json')).toThrow(TranslationError);
  });
});
