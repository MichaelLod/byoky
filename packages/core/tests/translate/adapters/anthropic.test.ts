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

  it('refuses json_schema response format', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      responseFormat: { type: 'json_schema', schema: {} },
    };
    expect(() => anthropicAdapter.serializeRequest(ctx(), ir)).toThrow(/json_schema/);
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
      top_p: 0.9,
      stop_sequences: ['END'],
    });
    const ir1 = anthropicAdapter.parseRequest(original);
    const wire = anthropicAdapter.serializeRequest(ctx(), ir1);
    const ir2 = anthropicAdapter.parseRequest(wire);
    expect(ir2.system).toEqual(ir1.system);
    expect(ir2.messages).toEqual(ir1.messages);
    expect(ir2.temperature).toBe(ir1.temperature);
    expect(ir2.topP).toBe(ir1.topP);
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
