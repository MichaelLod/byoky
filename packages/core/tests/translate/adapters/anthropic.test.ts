import { describe, it, expect } from 'vitest';
import '../../../src/translate/index.js';
import { anthropicAdapter } from '../../../src/translate/adapters/anthropic.js';
import type { TranslationContext } from '../../../src/translate/types.js';
import type { IRRequest, IRStreamEvent } from '../../../src/translate/ir.js';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'anthropic',
    dstFamily: 'anthropic',
    srcModel: 'claude-sonnet-4-6',
    dstModel: 'claude-sonnet-4-6',
    isStreaming: false,
    requestId: 'req-test',
    ...overrides,
  };
}

describe('anthropicAdapter.parseRequest', () => {
  it('parses system as a string', () => {
    const ir = anthropicAdapter.parseRequest(
      JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        system: 'Be terse.',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(ir.system).toEqual([{ text: 'Be terse.' }]);
    expect(ir.maxTokens).toBe(100);
  });

  it('parses system as an array of text blocks', () => {
    const ir = anthropicAdapter.parseRequest(
      JSON.stringify({
        max_tokens: 10,
        system: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }],
        messages: [{ role: 'user', content: 'x' }],
      }),
    );
    expect(ir.system).toEqual([{ text: 'one' }, { text: 'two' }]);
  });

  it('parses tool_use inside assistant content', () => {
    const ir = anthropicAdapter.parseRequest(
      JSON.stringify({
        max_tokens: 10,
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'checking...' },
              { type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Tokyo' } },
            ],
          },
        ],
      }),
    );
    const assistant = ir.messages[0];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toHaveLength(2);
    expect(assistant.content[0]).toEqual({ type: 'text', text: 'checking...' });
    expect(assistant.content[1]).toEqual({
      type: 'tool_use',
      id: 't1',
      name: 'get_weather',
      input: { city: 'Tokyo' },
    });
  });

  it('parses tool_result content as structured blocks', () => {
    const ir = anthropicAdapter.parseRequest(
      JSON.stringify({
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 't1',
                content: [{ type: 'text', text: 'sunny' }],
                is_error: false,
              },
            ],
          },
        ],
      }),
    );
    const block = ir.messages[0].content[0];
    expect(block.type).toBe('tool_result');
    if (block.type === 'tool_result') {
      expect(block.content).toEqual({
        kind: 'blocks',
        blocks: [{ type: 'text', text: 'sunny' }],
      });
    }
  });

  it('parses thinking block from assistant content', () => {
    const ir = anthropicAdapter.parseRequest(
      JSON.stringify({
        max_tokens: 10,
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'let me think', signature: 'sig' },
              { type: 'text', text: 'answer' },
            ],
          },
        ],
      }),
    );
    const first = ir.messages[0].content[0];
    expect(first).toEqual({ type: 'thinking', text: 'let me think', signature: 'sig' });
  });

  it('parses thinking config from top level', () => {
    const ir = anthropicAdapter.parseRequest(
      JSON.stringify({
        max_tokens: 10,
        thinking: { type: 'enabled', budget_tokens: 5000 },
        messages: [{ role: 'user', content: 'x' }],
      }),
    );
    expect(ir.thinking).toEqual({ enabled: true, budgetTokens: 5000 });
  });
});

describe('anthropicAdapter.serializeRequest', () => {
  it('joins system parts and requires max_tokens default', () => {
    const ir: IRRequest = {
      system: [{ text: 'one' }, { text: 'two' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    };
    const out = JSON.parse(anthropicAdapter.serializeRequest(ctx(), ir)) as Record<string, unknown>;
    expect(out.system).toBe('one\n\ntwo');
    expect(typeof out.max_tokens).toBe('number');
    expect((out.max_tokens as number)).toBeGreaterThan(0);
  });

  it('collapses single text block user messages to a string', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxTokens: 10,
    };
    const out = JSON.parse(anthropicAdapter.serializeRequest(ctx(), ir)) as { messages: Array<{ content: unknown }> };
    expect(out.messages[0].content).toBe('hi');
  });

  it('refuses n > 1', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      n: 2,
    };
    expect(() => anthropicAdapter.serializeRequest(ctx(), ir)).toThrow(/multiple completions/);
  });

  it('an empty json_schema (any JSON) becomes the system hint', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      responseFormat: { type: 'json_schema', schema: {} },
    };
    const out = JSON.parse(anthropicAdapter.serializeRequest(ctx(), ir)) as Record<string, unknown>;
    expect(out).not.toHaveProperty('output_config');
    expect(out.system).toContain('JSON');
  });

  it('shims plain json into a system hint', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      responseFormat: { type: 'json' },
    };
    const out = JSON.parse(anthropicAdapter.serializeRequest(ctx(), ir)) as { system?: string };
    expect(out.system ?? '').toContain('JSON');
  });
});

describe('anthropicAdapter round-trip', () => {
  it('parse → serialize → parse produces equivalent IR', () => {
    const original = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: 'Be terse.',
      messages: [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
      ],
      temperature: 0.5,
      top_k: 40,
      stop_sequences: ['END'],
    });
    const ir1 = anthropicAdapter.parseRequest(original);
    const wire = anthropicAdapter.serializeRequest(ctx(), ir1);
    const ir2 = anthropicAdapter.parseRequest(wire);
    expect(ir2.system).toEqual(ir1.system);
    expect(ir2.messages).toEqual(ir1.messages);
    expect(ir2.temperature).toBe(ir1.temperature);
    expect(ir2.topK).toBe(ir1.topK);
    expect(ir2.stopSequences).toEqual(ir1.stopSequences);
    expect(ir2.maxTokens).toBe(ir1.maxTokens);
  });
});

describe('anthropicAdapter stream parsing', () => {
  it('emits message_start → content_block_start → text_deltas → stop events', () => {
    const parser = anthropicAdapter.createStreamParser();
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-6","usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"!"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const events: IRStreamEvent[] = [];
    for (const c of chunks) events.push(...parser.process(c));
    events.push(...parser.flush());

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'message_start',
      'content_block_start',
      'text_delta',
      'text_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    const textDeltas = events
      .filter((e): e is Extract<IRStreamEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(textDeltas).toBe('Hello!');
  });

  it('tolerates chunk splits on arbitrary byte boundaries', () => {
    const parser = anthropicAdapter.createStreamParser();
    const full =
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":1,"output_tokens":0}}}\n\n' +
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"abc"}}\n\n' +
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';

    const events: IRStreamEvent[] = [];
    // Feed one byte at a time.
    for (const ch of full) events.push(...parser.process(ch));
    events.push(...parser.flush());
    const text = events
      .filter((e): e is Extract<IRStreamEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('abc');
    expect(events[events.length - 1].type).toBe('message_stop');
  });
});

describe('anthropicAdapter.parseResponse', () => {
  it('parses a normal message', () => {
    const ir = anthropicAdapter.parseResponse(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Hi.' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    );
    if ('error' in ir) throw new Error('expected success');
    expect(ir.content).toEqual([{ type: 'text', text: 'Hi.' }]);
    expect(ir.stopReason).toBe('end_turn');
    expect(ir.usage).toEqual({ inputTokens: 5, outputTokens: 1 });
  });

  it('parses an error response', () => {
    const ir = anthropicAdapter.parseResponse(
      JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'bad' },
      }),
    );
    if (!('error' in ir)) throw new Error('expected error');
    expect(ir.error.message).toBe('bad');
    expect(ir.error.type).toBe('invalid_request_error');
  });
});

describe('anthropicAdapter.serializeRequest — thinking blocks in history', () => {
  it('drops unsigned thinking blocks and keeps the rest of the turn', () => {
    const ir: IRRequest = {
      system: [],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'I will call get_weather.', toolPlanning: true },
            { type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Paris' } },
          ],
        },
      ],
    };
    const out = JSON.parse(anthropicAdapter.serializeRequest(ctx(), ir)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Paris' } }],
    });
  });

  it('leaves out a turn that held only unsigned thinking', () => {
    const ir: IRRequest = {
      system: [],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'one' }] },
        { role: 'assistant', content: [{ type: 'thinking', text: 'hmm' }] },
        { role: 'user', content: [{ type: 'text', text: 'two' }] },
      ],
    };
    const out = JSON.parse(anthropicAdapter.serializeRequest(ctx(), ir)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages).toEqual([
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
    ]);
  });

  it('keeps signed thinking blocks', () => {
    const ir: IRRequest = {
      system: [],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'reasoning', signature: 'sig' },
            { type: 'text', text: 'a' },
          ],
        },
      ],
    };
    const out = JSON.parse(anthropicAdapter.serializeRequest(ctx(), ir)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages[1].content).toEqual([
      { type: 'thinking', thinking: 'reasoning', signature: 'sig' },
      { type: 'text', text: 'a' },
    ]);
  });
});

describe('anthropicAdapter.serializeRequest — sampling parameters per model', () => {
  const base: IRRequest = {
    system: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    maxTokens: 1000,
  };
  const serialize = (dstModel: string, extra: Partial<IRRequest>) =>
    JSON.parse(anthropicAdapter.serializeRequest(ctx({ dstModel }), { ...base, ...extra })) as Record<string, unknown>;

  it.each(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-1-20250805'])(
    '%s keeps temperature and drops top_p when both are set',
    (model) => {
      const out = serialize(model, { temperature: 0.7, topP: 1, topK: 20 });
      expect(out.temperature).toBe(0.7);
      expect(out).not.toHaveProperty('top_p');
      expect(out.top_k).toBe(20);
    },
  );

  it('sends top_p alone when temperature is unset', () => {
    const out = serialize('claude-sonnet-4-6', { topP: 0.95 });
    expect(out.top_p).toBe(0.95);
    expect(out).not.toHaveProperty('temperature');
  });

  it.each(['claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'])(
    '%s gets no sampling parameters',
    (model) => {
      const out = serialize(model, { temperature: 0.2, topP: 0.9, topK: 5 });
      expect(out).not.toHaveProperty('temperature');
      expect(out).not.toHaveProperty('top_p');
      expect(out).not.toHaveProperty('top_k');
    },
  );
});

describe('anthropicAdapter.serializeRequest — thinking', () => {
  const user: IRRequest['messages'] = [{ role: 'user', content: [{ type: 'text', text: 'x' }] }];
  const serialize = (dstModel: string, ir: Partial<IRRequest>) =>
    JSON.parse(
      anthropicAdapter.serializeRequest(ctx({ dstModel }), { system: [], messages: user, ...ir }),
    ) as Record<string, unknown>;

  it('a budget model gets a budget of at least 1024 tokens, below max_tokens', () => {
    const out = serialize('claude-haiku-4-5-20251001', { maxTokens: 4000, thinking: { enabled: true, budgetTokens: 10 } });
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(out.max_tokens).toBe(4000);
  });

  it('raises a defaulted max_tokens above the budget', () => {
    const out = serialize('claude-haiku-4-5-20251001', { thinking: { enabled: true, budgetTokens: 8192 } });
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(out.max_tokens).toBe(8192 + 4096);
  });

  it('lowers the budget below an explicit max_tokens', () => {
    const out = serialize('claude-haiku-4-5-20251001', { maxTokens: 4096, thinking: { enabled: true, budgetTokens: 8192 } });
    expect(out.max_tokens).toBe(4096);
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 4095 });
  });

  it('leaves thinking off when max_tokens has no room for the minimum budget', () => {
    const out = serialize('claude-haiku-4-5-20251001', { maxTokens: 512, thinking: { enabled: true } });
    expect(out).not.toHaveProperty('thinking');
  });

  it('a budget model gets a default budget when none is given', () => {
    const out = serialize('claude-haiku-4-5-20251001', { thinking: { enabled: true } });
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
  });

  it('Opus 4.7 thinks adaptively and never gets budget_tokens', () => {
    const out = serialize('claude-opus-4-7', { thinking: { enabled: true, budgetTokens: 8192 } });
    expect(out.thinking).toEqual({ type: 'adaptive' });
    expect(out.max_tokens).toBe(8192 + 4096);
  });

  it('Sonnet 4.6 honours an explicit budget and thinks adaptively without one', () => {
    expect(serialize('claude-sonnet-4-6', { thinking: { enabled: true, budgetTokens: 2048 } }).thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2048,
    });
    expect(serialize('claude-sonnet-4-6', { thinking: { enabled: true } }).thinking).toEqual({ type: 'adaptive' });
  });

  it('drops temperature and top_k with thinking, and keeps top_p only in [0.95, 1]', () => {
    const out = serialize('claude-sonnet-4-6', {
      thinking: { enabled: true },
      temperature: 0.4,
      topK: 10,
      topP: 0.97,
    });
    expect(out).not.toHaveProperty('temperature');
    expect(out).not.toHaveProperty('top_k');
    expect(out.top_p).toBe(0.97);
    const low = serialize('claude-sonnet-4-6', { thinking: { enabled: true }, topP: 0.5 });
    expect(low).not.toHaveProperty('top_p');
  });

  it('leaves thinking off when a tool is forced', () => {
    const tools = [{ name: 'f', parameters: { type: 'object', properties: {} } }];
    for (const toolChoice of [{ type: 'any' }, { type: 'tool', name: 'f' }] as const) {
      const out = serialize('claude-sonnet-4-6', { tools, toolChoice, thinking: { enabled: true }, temperature: 0.2 });
      expect(out).not.toHaveProperty('thinking');
      expect(out.tool_choice).toEqual(toolChoice);
      expect(out.temperature).toBe(0.2);
    }
  });

  it('leaves adaptive thinking out of the IR', () => {
    const ir = anthropicAdapter.parseRequest(
      JSON.stringify({ model: 'claude-opus-4-7', max_tokens: 100, thinking: { type: 'adaptive' }, messages: [] }),
    );
    expect(ir.thinking).toBeUndefined();
  });
});

describe('anthropicAdapter.serializeRequest — forced tool choice per model', () => {
  // Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 answer tool_choice
  // `any` / `tool` with a 400 ("tool_choice: type "tool" and "any" are not
  // supported for this model."). Anthropic's migration advice is `auto` plus
  // an instruction naming the tool.
  const tools = [{ name: 'get_weather', parameters: { type: 'object', properties: {} } }];
  const user: IRRequest['messages'] = [{ role: 'user', content: [{ type: 'text', text: 'x' }] }];
  const serialize = (dstModel: string, ir: Partial<IRRequest>) =>
    JSON.parse(
      anthropicAdapter.serializeRequest(ctx({ dstModel }), { system: [], messages: user, maxTokens: 1000, ...ir }),
    ) as { tool_choice?: unknown; system?: string; thinking?: unknown };

  it.each([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-fable-5-1',
    'claude-mythos-5-1',
    'claude-opus-6',
    'anthropic.claude-sonnet-5-5',
  ])('%s gets auto and an instruction naming the tool', (model) => {
    const named = serialize(model, { tools, toolChoice: { type: 'tool', name: 'get_weather' } });
    expect(named.tool_choice).toEqual({ type: 'auto' });
    expect(named.system).toContain('You must call the get_weather tool in this response.');

    const any = serialize(model, { tools, toolChoice: { type: 'any' } });
    expect(any.tool_choice).toEqual({ type: 'auto' });
    expect(any.system).toContain('You must call one of the provided tools in this response.');
  });

  it('keeps the app\'s system prompt ahead of the instruction', () => {
    const out = serialize('claude-opus-5-5', {
      system: [{ text: 'Be terse.' }],
      tools,
      toolChoice: { type: 'any' },
    });
    expect(out.system).toBe(
      'Be terse.\n\nYou must call one of the provided tools in this response. Start your response with a tool call.',
    );
  });

  it('keeps requested thinking, since no forced choice is sent', () => {
    const out = serialize('claude-opus-5-5', { tools, toolChoice: { type: 'any' }, thinking: { enabled: true } });
    expect(out.thinking).toEqual({ type: 'adaptive' });
  });

  it('adds no instruction when there are no tools to call', () => {
    const out = serialize('claude-sonnet-5-5', { toolChoice: { type: 'any' } });
    expect(out.tool_choice).toEqual({ type: 'auto' });
    expect(out).not.toHaveProperty('system');
  });

  it.each(['claude-opus-5-5', 'claude-fable-5-1'])('%s keeps auto and none as they are', (model) => {
    expect(serialize(model, { tools, toolChoice: { type: 'auto' } })).toMatchObject({ tool_choice: { type: 'auto' } });
    const none = serialize(model, { tools, toolChoice: { type: 'none' } });
    expect(none.tool_choice).toEqual({ type: 'none' });
    expect(none).not.toHaveProperty('system');
  });

  it.each([
    'claude-haiku-5-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5',
    'claude-mythos-5',
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ])('%s keeps the forced choice', (model) => {
    const named = serialize(model, { tools, toolChoice: { type: 'tool', name: 'get_weather' } });
    expect(named.tool_choice).toEqual({ type: 'tool', name: 'get_weather' });
    expect(named).not.toHaveProperty('system');
    expect(serialize(model, { tools, toolChoice: { type: 'any' } }).tool_choice).toEqual({ type: 'any' });
  });
});

describe('anthropicAdapter — structured outputs (output_config.format)', () => {
  function serialize(schema: unknown, dstModel = 'claude-sonnet-4-6'): Record<string, unknown> {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      responseFormat: { type: 'json_schema', schema },
    };
    return JSON.parse(anthropicAdapter.serializeRequest(ctx({ dstModel }), ir)) as Record<string, unknown>;
  }

  it('sends a json_schema as output_config.format, fitted to what Claude takes', () => {
    const out = serialize({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80, description: 'Full name' },
        email: { type: 'string', format: 'email' },
        age: { type: ['integer', 'null'], minimum: 0 },
        tags: { type: 'array', items: { type: 'string', pattern: '^[a-z]+$' }, minItems: 1, maxItems: 5 },
        kind: { oneOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'object', properties: { x: { type: 'number' } } }] },
      },
      required: ['name', 'email'],
    });
    expect(out.output_config).toEqual({
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full name\n\n{minLength: 1, maxLength: 80}' },
            email: { type: 'string', format: 'email' },
            age: { type: ['integer', 'null'], description: '{minimum: 0}' },
            tags: {
              type: 'array',
              items: { type: 'string', description: '{pattern: "^[a-z]+$"}' },
              minItems: 1,
              description: '{maxItems: 5}',
            },
            kind: {
              anyOf: [
                { type: 'string', enum: ['a', 'b'] },
                { type: 'object', properties: { x: { type: 'number' } }, additionalProperties: false },
              ],
            },
          },
          additionalProperties: false,
          required: ['name', 'email'],
        },
      },
    });
    expect(out.system).toBeUndefined();
  });

  it('keeps $defs and acyclic $refs', () => {
    const out = serialize({
      type: 'object',
      properties: { a: { $ref: '#/$defs/Point' }, b: { $ref: '#/$defs/Point' } },
      $defs: { Point: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } },
    });
    expect((out.output_config as { format: { schema: unknown } }).format.schema).toEqual({
      $defs: { Point: { type: 'object', properties: { x: { type: 'number' } }, additionalProperties: false, required: ['x'] } },
      type: 'object',
      properties: { a: { $ref: '#/$defs/Point' }, b: { $ref: '#/$defs/Point' } },
      additionalProperties: false,
    });
  });

  it('refuses what Claude cannot express, without naming another provider', () => {
    const recursive = {
      type: 'object',
      properties: { root: { $ref: '#/$defs/Node' } },
      $defs: { Node: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/$defs/Node' } } } } },
    };
    expect(() => serialize(recursive)).toThrow(/recursive/);
    expect(() => serialize({ type: 'object', properties: { self: { $ref: '#' } } })).toThrow(/recursive/);
    expect(() => serialize({ type: 'object', properties: { a: { $ref: 'https://x.test/s.json' } } })).toThrow(/another document/);
    expect(() => serialize({ type: 'object', additionalProperties: { type: 'string' } })).toThrow(/any property names/);
    expect(() => serialize({ type: 'object', properties: { any: {} } })).toThrow(/no type/);
    for (const schema of [recursive, { type: 'object', properties: { any: {} } }]) {
      try {
        serialize(schema);
      } catch (err) {
        expect((err as { code?: string }).code).toBe('UNSUPPORTED_FEATURE');
        expect(String(err)).not.toMatch(/OpenAI/);
      }
    }
  });

  it('refuses a schema for a model without structured outputs, in words that fit every dialect', () => {
    expect(() => serialize({ type: 'object', properties: { a: { type: 'string' } } }, 'claude-3-5-haiku-20241022'))
      .toThrow(/^(?!.*OpenAI).*claude-3-5-haiku-20241022 can't produce/);
  });

  it('a bare {type: object} asks for any JSON object: the system hint', () => {
    const out = serialize({ type: 'object' });
    expect(out).not.toHaveProperty('output_config');
    expect(out.system).toContain('JSON');
  });

  it('parses output_config.format (and the older output_format) into the IR', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
    const ir = anthropicAdapter.parseRequest(
      JSON.stringify({
        model: 'claude-opus-5-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'x' }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      }),
    );
    expect(ir.responseFormat).toEqual({ type: 'json_schema', schema });
    const old = anthropicAdapter.parseRequest(
      JSON.stringify({ max_tokens: 100, messages: [{ role: 'user', content: 'x' }], output_format: { type: 'json_schema', schema } }),
    );
    expect(old.responseFormat).toEqual({ type: 'json_schema', schema });
  });
});
