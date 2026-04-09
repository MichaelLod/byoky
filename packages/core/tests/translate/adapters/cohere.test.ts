import { describe, it, expect } from 'vitest';
import '../../../src/translate/index.js';
import { cohereAdapter } from '../../../src/translate/adapters/cohere.js';
import type { TranslationContext } from '../../../src/translate/types.js';
import type { IRRequest, IRStreamEvent } from '../../../src/translate/ir.js';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'cohere',
    dstFamily: 'cohere',
    srcModel: 'command-a-03-2025',
    dstModel: 'command-a-03-2025',
    isStreaming: false,
    requestId: 'req-test',
    ...overrides,
  };
}

describe('cohereAdapter.parseRequest', () => {
  it('maps role:system messages into IR top-level system', () => {
    const ir = cohereAdapter.parseRequest(
      JSON.stringify({
        model: 'command-a-03-2025',
        messages: [
          { role: 'system', content: 'Be terse.' },
          { role: 'user', content: 'hi' },
        ],
      }),
    );
    expect(ir.system).toEqual([{ text: 'Be terse.' }]);
  });

  it('maps p/k into topP/topK (Cohere\'s single-letter naming)', () => {
    const ir = cohereAdapter.parseRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'x' }],
        p: 0.75,
        k: 40,
      }),
    );
    expect(ir.topP).toBe(0.75);
    expect(ir.topK).toBe(40);
  });

  it('parses tool_plan as a thinking block with toolPlanning=true', () => {
    const ir = cohereAdapter.parseRequest(
      JSON.stringify({
        messages: [
          {
            role: 'assistant',
            tool_plan: 'let me look that up',
            tool_calls: [
              {
                id: 't1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
              },
            ],
            content: [],
          },
        ],
      }),
    );
    const blocks = ir.messages[0].content;
    expect(blocks[0]).toEqual({ type: 'thinking', text: 'let me look that up', toolPlanning: true });
    expect(blocks[1].type).toBe('tool_use');
  });

  it('parses tool_use arguments from JSON string into object', () => {
    const ir = cohereAdapter.parseRequest(
      JSON.stringify({
        messages: [
          {
            role: 'assistant',
            content: [],
            tool_calls: [
              { id: 't1', type: 'function', function: { name: 'fn', arguments: '{"x":1}' } },
            ],
          },
        ],
      }),
    );
    const tu = ir.messages[0].content[0];
    if (tu.type !== 'tool_use') throw new Error('expected tool_use');
    expect(tu.input).toEqual({ x: 1 });
  });

  it('maps tool_choice REQUIRED to IR any, NONE to IR none, absent to undefined', () => {
    const required = cohereAdapter.parseRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'x' }],
        tool_choice: 'REQUIRED',
      }),
    );
    expect(required.toolChoice).toEqual({ type: 'any' });

    const none = cohereAdapter.parseRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'x' }],
        tool_choice: 'NONE',
      }),
    );
    expect(none.toolChoice).toEqual({ type: 'none' });

    const auto = cohereAdapter.parseRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'x' }],
      }),
    );
    expect(auto.toolChoice).toBeUndefined();
  });

  it('packs role:tool messages into the next user turn as tool_result blocks', () => {
    const ir = cohereAdapter.parseRequest(
      JSON.stringify({
        messages: [
          {
            role: 'assistant',
            content: [],
            tool_calls: [
              { id: 't1', type: 'function', function: { name: 'fn', arguments: '{}' } },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 't1',
            content: [{ type: 'document', document: { data: '{"temp":18}' } }],
          },
          { role: 'user', content: 'thanks' },
        ],
      }),
    );
    expect(ir.messages).toHaveLength(2);
    const user = ir.messages[1];
    expect(user.role).toBe('user');
    expect(user.content[0]).toEqual({
      type: 'tool_result',
      toolUseId: 't1',
      content: { kind: 'text', text: '{"temp":18}' },
    });
  });
});

describe('cohereAdapter.serializeRequest', () => {
  it('emits p/k single-letter sampling params', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      topP: 0.5,
      topK: 10,
    };
    const out = JSON.parse(cohereAdapter.serializeRequest(ctx(), ir)) as { p?: number; k?: number };
    expect(out.p).toBe(0.5);
    expect(out.k).toBe(10);
  });

  it('emits tool_plan when thinking block has toolPlanning=true', () => {
    const ir: IRRequest = {
      system: [],
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'reasoning...', toolPlanning: true },
            { type: 'tool_use', id: 't1', name: 'fn', input: {} },
          ],
        },
      ],
    };
    const out = JSON.parse(cohereAdapter.serializeRequest(ctx(), ir)) as {
      messages: Array<{ role: string; tool_plan?: string; tool_calls?: unknown[] }>;
    };
    const assistant = out.messages[0];
    expect(assistant.tool_plan).toBe('reasoning...');
    expect(assistant.tool_calls).toBeDefined();
  });

  it('uses REQUIRED for any/tool and NONE for none; omits for auto', () => {
    const baseIR: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    };
    const anyOut = JSON.parse(cohereAdapter.serializeRequest(ctx(), { ...baseIR, toolChoice: { type: 'any' } })) as { tool_choice?: string };
    expect(anyOut.tool_choice).toBe('REQUIRED');

    const noneOut = JSON.parse(cohereAdapter.serializeRequest(ctx(), { ...baseIR, toolChoice: { type: 'none' } })) as { tool_choice?: string };
    expect(noneOut.tool_choice).toBe('NONE');

    const autoOut = JSON.parse(cohereAdapter.serializeRequest(ctx(), { ...baseIR, toolChoice: { type: 'auto' } })) as { tool_choice?: string };
    expect(autoOut.tool_choice).toBeUndefined();
  });

  it('serializes tool_use.input as a JSON string in tool_calls.function.arguments', () => {
    const ir: IRRequest = {
      system: [],
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'fn', input: { x: 1 } }],
        },
      ],
    };
    const out = JSON.parse(cohereAdapter.serializeRequest(ctx(), ir)) as {
      messages: Array<{ tool_calls?: Array<{ function: { arguments: string } }> }>;
    };
    const args = out.messages[0].tool_calls![0].function.arguments;
    expect(typeof args).toBe('string');
    expect(JSON.parse(args)).toEqual({ x: 1 });
  });
});

describe('cohereAdapter.parseResponse', () => {
  it('parses a normal message response', () => {
    const ir = cohereAdapter.parseResponse(
      JSON.stringify({
        id: 'c1',
        finish_reason: 'COMPLETE',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi.' }],
        },
        usage: {
          tokens: { input_tokens: 5, output_tokens: 1 },
          billed_units: { input_tokens: 5, output_tokens: 1 },
        },
      }),
    );
    if ('error' in ir) throw new Error('expected success');
    expect(ir.content).toEqual([{ type: 'text', text: 'Hi.' }]);
    expect(ir.stopReason).toBe('end_turn');
    expect(ir.usage).toEqual({ inputTokens: 5, outputTokens: 1 });
  });

  it('parses tool_plan + tool_calls response', () => {
    const ir = cohereAdapter.parseResponse(
      JSON.stringify({
        id: 'c1',
        finish_reason: 'TOOL_CALL',
        message: {
          role: 'assistant',
          tool_plan: 'looking up weather',
          tool_calls: [
            { id: 't1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } },
          ],
          content: [],
        },
        usage: { tokens: { input_tokens: 5, output_tokens: 3 } },
      }),
    );
    if ('error' in ir) throw new Error('expected success');
    expect(ir.content[0]).toEqual({ type: 'thinking', text: 'looking up weather', toolPlanning: true });
    expect(ir.content[1].type).toBe('tool_use');
    expect(ir.stopReason).toBe('tool_use');
  });
});

describe('cohereAdapter round-trip', () => {
  it('parse → serialize → parse preserves simple chat', () => {
    const original = JSON.stringify({
      model: 'command-a-03-2025',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'hi' },
      ],
      temperature: 0.3,
      max_tokens: 128,
    });
    const ir1 = cohereAdapter.parseRequest(original);
    const wire = cohereAdapter.serializeRequest(ctx(), ir1);
    const ir2 = cohereAdapter.parseRequest(wire);
    expect(ir2.system).toEqual(ir1.system);
    expect(ir2.messages).toEqual(ir1.messages);
    expect(ir2.temperature).toBe(ir1.temperature);
    expect(ir2.maxTokens).toBe(ir1.maxTokens);
  });
});

describe('cohereAdapter stream parsing', () => {
  it('emits the full event sequence for a plain text turn', () => {
    const parser = cohereAdapter.createStreamParser();
    const chunks = [
      'data: {"type":"message-start","id":"c1","delta":{"message":{"role":"assistant"}}}\n\n',
      'data: {"type":"content-start","index":0,"delta":{"message":{"content":{"type":"text","text":""}}}}\n\n',
      'data: {"type":"content-delta","index":0,"delta":{"message":{"content":{"text":"Hel"}}}}\n\n',
      'data: {"type":"content-delta","index":0,"delta":{"message":{"content":{"text":"lo"}}}}\n\n',
      'data: {"type":"content-end","index":0}\n\n',
      'data: {"type":"message-end","delta":{"finish_reason":"COMPLETE","usage":{"tokens":{"input_tokens":3,"output_tokens":2}}}}\n\n',
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

    const text = events
      .filter((e): e is Extract<IRStreamEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('Hello');
  });

  it('emits thinking block for tool-plan-delta frames', () => {
    const parser = cohereAdapter.createStreamParser();
    const chunks = [
      'data: {"type":"message-start","id":"c1","delta":{"message":{"role":"assistant"}}}\n\n',
      'data: {"type":"tool-plan-delta","delta":{"message":{"tool_plan":"looking"}}}\n\n',
      'data: {"type":"tool-plan-delta","delta":{"message":{"tool_plan":" up"}}}\n\n',
      'data: {"type":"tool-call-start","index":0,"delta":{"message":{"tool_calls":{"id":"t1","type":"function","function":{"name":"get_weather"}}}}}\n\n',
      'data: {"type":"tool-call-delta","index":0,"delta":{"message":{"tool_calls":{"function":{"arguments":"{\\"city\\""}}}}}\n\n',
      'data: {"type":"tool-call-delta","index":0,"delta":{"message":{"tool_calls":{"function":{"arguments":":\\"Tokyo\\"}"}}}}}\n\n',
      'data: {"type":"tool-call-end","index":0}\n\n',
      'data: {"type":"message-end","delta":{"finish_reason":"TOOL_CALL","usage":{"tokens":{"input_tokens":5,"output_tokens":10}}}}\n\n',
    ];
    const events: IRStreamEvent[] = [];
    for (const c of chunks) events.push(...parser.process(c));
    events.push(...parser.flush());

    // Expect: message_start, content_block_start(thinking toolPlanning), thinking_delta*2,
    // content_block_stop (thinking), content_block_start(tool_use), tool_input_delta*2,
    // content_block_stop (tool_use), message_delta, message_stop
    const thinkingStart = events.find((e) => e.type === 'content_block_start' && e.block.type === 'thinking');
    expect(thinkingStart).toBeDefined();
    if (thinkingStart && thinkingStart.type === 'content_block_start' && thinkingStart.block.type === 'thinking') {
      expect(thinkingStart.block.toolPlanning).toBe(true);
    }

    const thinkingDeltas = events
      .filter((e): e is Extract<IRStreamEvent, { type: 'thinking_delta' }> => e.type === 'thinking_delta')
      .map((e) => e.text)
      .join('');
    expect(thinkingDeltas).toBe('looking up');

    const toolStart = events.find((e) => e.type === 'content_block_start' && e.block.type === 'tool_use');
    expect(toolStart).toBeDefined();

    const toolArgs = events
      .filter((e): e is Extract<IRStreamEvent, { type: 'tool_input_delta' }> => e.type === 'tool_input_delta')
      .map((e) => e.partialJson)
      .join('');
    expect(toolArgs).toContain('Tokyo');

    const mdlt = events.find((e) => e.type === 'message_delta');
    if (mdlt && mdlt.type === 'message_delta') {
      expect(mdlt.stopReason).toBe('tool_use');
    }
  });

  it('forwards stream errors via message-end finish_reason:ERROR', () => {
    const parser = cohereAdapter.createStreamParser();
    parser.process('data: {"type":"message-start","id":"c1","delta":{"message":{"role":"assistant"}}}\n\n');
    const events = parser.process('data: {"type":"message-end","delta":{"finish_reason":"ERROR","error":"oops"}}\n\n');
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    if (err && err.type === 'error') {
      expect(err.error.message).toBe('oops');
    }
  });
});
