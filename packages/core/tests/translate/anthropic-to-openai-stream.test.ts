import { describe, it, expect } from 'vitest';
import { createAnthropicToOpenAIStreamRewriter } from '../../src/translate/anthropic-to-openai-stream.js';
import type { TranslationContext } from '../../src/translate/types.js';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'anthropic',
    dstFamily: 'openai',
    srcModel: 'claude-sonnet-4-6',
    dstModel: 'gpt-5.4',
    isStreaming: true,
    requestId: 'req-test',
    state: {},
    ...overrides,
  };
}

/** Build an Anthropic SSE frame. */
function frame(eventType: string, data: object): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Run a list of input chunks through the rewriter and collect ALL output by
 * concatenating process() returns + flush() at the end.
 */
function runStream(input: string[], rew = createAnthropicToOpenAIStreamRewriter(ctx())): string {
  let out = '';
  for (const chunk of input) out += rew.process(chunk);
  out += rew.flush();
  return out;
}

/** Parse all `data: <json>\n\n` chunks out of an OpenAI SSE-style output. */
function parseOpenAIChunks(out: string): Array<Record<string, unknown> | '[DONE]'> {
  const lines = out.split('\n').filter((l) => l.startsWith('data: '));
  return lines.map((l) => {
    const payload = l.slice(6);
    if (payload === '[DONE]') return '[DONE]';
    return JSON.parse(payload) as Record<string, unknown>;
  });
}

describe('anthropic→openai SSE — text-only message', () => {
  const stream = [
    frame('message_start', {
      type: 'message_start',
      message: { id: 'msg_x', usage: { input_tokens: 7, output_tokens: 1 } },
    }),
    frame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: ' world' },
    }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 5 },
    }),
    frame('message_stop', { type: 'message_stop' }),
  ];

  it('emits a role-establishing chunk first', () => {
    const out = parseOpenAIChunks(runStream(stream));
    expect(out.length).toBeGreaterThan(0);
    const first = out[0] as Record<string, unknown>;
    const choices = first.choices as Array<{ delta: { role?: string } }>;
    expect(choices[0].delta.role).toBe('assistant');
  });

  it('emits text deltas in order', () => {
    const out = parseOpenAIChunks(runStream(stream));
    const textChunks = (out
      .filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>)
      .map((c) => {
        const choices = c.choices as Array<{ delta: { content?: string } }>;
        return choices.length > 0 ? choices[0].delta.content : undefined;
      })
      .filter((c): c is string => typeof c === 'string' && c.length > 0);
    expect(textChunks).toEqual(['Hello', ' world']);
  });

  it('emits finish_reason: stop after the message_stop event', () => {
    const out = parseOpenAIChunks(runStream(stream));
    const finished = (out
      .filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>)
      .find((c) => {
        const choices = c.choices as Array<{ finish_reason: string | null }>;
        return choices.length > 0 && choices[0]?.finish_reason !== null;
      });
    expect(finished).toBeDefined();
    const choices = finished!.choices as Array<{ finish_reason: string }>;
    expect(choices[0].finish_reason).toBe('stop');
  });

  it('emits a final usage chunk and a [DONE] terminator', () => {
    const out = parseOpenAIChunks(runStream(stream));
    expect(out[out.length - 1]).toBe('[DONE]');
    const usageChunk = (out.filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>)
      .find((c) => 'usage' in c && c.usage);
    expect(usageChunk).toBeDefined();
    const usage = (usageChunk as { usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }).usage;
    expect(usage.prompt_tokens).toBe(7);
    expect(usage.completion_tokens).toBe(5);
    expect(usage.total_tokens).toBe(12);
  });

  it('echoes the source model in every chunk', () => {
    const out = parseOpenAIChunks(runStream(stream)).filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>;
    for (const c of out) {
      expect(c.model).toBe('claude-sonnet-4-6');
    }
  });

  it('preserves the message id from message_start', () => {
    const out = parseOpenAIChunks(runStream(stream)).filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>;
    for (const c of out) {
      expect(c.id).toBe('msg_x');
    }
  });
});

describe('anthropic→openai SSE — tool_use', () => {
  const stream = [
    frame('message_start', { type: 'message_start', message: { id: 'msg_y', usage: { input_tokens: 5, output_tokens: 1 } } }),
    frame('content_block_start', {
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"city":' },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: '"Tokyo"}' },
    }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('message_delta', {
      type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 },
    }),
    frame('message_stop', { type: 'message_stop' }),
  ];

  it('opens a tool_call with id, name, and an empty arguments string', () => {
    const out = parseOpenAIChunks(runStream(stream)).filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>;
    const opener = out.find((c) => {
      const choices = c.choices as Array<{ delta: { tool_calls?: Array<{ id?: string; function?: { name?: string } }> } }>;
      return choices[0]?.delta?.tool_calls?.[0]?.id === 'toolu_1';
    });
    expect(opener).toBeDefined();
    const tc = (opener!.choices as Array<{ delta: { tool_calls: Array<{ index: number; id: string; type: string; function: { name: string; arguments: string } }> } }>)[0].delta.tool_calls[0];
    expect(tc.index).toBe(0);
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('get_weather');
    expect(tc.function.arguments).toBe('');
  });

  it('streams tool argument fragments under the same tool_call index', () => {
    const out = parseOpenAIChunks(runStream(stream)).filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>;
    const fragments = out
      .map((c) => {
        const choices = c.choices as Array<{ delta: { tool_calls?: Array<{ index?: number; function?: { arguments?: string } }> } }>;
        const tc = choices[0]?.delta?.tool_calls?.[0];
        return tc && typeof tc.function?.arguments === 'string' && tc.function.arguments.length > 0
          ? { index: tc.index, args: tc.function.arguments }
          : null;
      })
      .filter((x): x is { index: number; args: string } => x !== null);
    // Skip the very first fragment which is the opener with arguments=''
    expect(fragments).toHaveLength(2);
    expect(fragments.every((f) => f.index === 0)).toBe(true);
    expect(fragments.map((f) => f.args).join('')).toBe('{"city":"Tokyo"}');
  });

  it('emits finish_reason: tool_calls', () => {
    const out = parseOpenAIChunks(runStream(stream)).filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>;
    const finished = out.find((c) => {
      const choices = c.choices as Array<{ finish_reason: string | null }>;
      return choices[0]?.finish_reason === 'tool_calls';
    });
    expect(finished).toBeDefined();
  });
});

describe('anthropic→openai SSE — multiple tool_use blocks', () => {
  const stream = [
    frame('message_start', { type: 'message_start', message: { id: 'msg_z', usage: { input_tokens: 5, output_tokens: 1 } } }),
    frame('content_block_start', {
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"city":"Tokyo"}' },
    }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('content_block_start', {
      type: 'content_block_start', index: 1,
      content_block: { type: 'tool_use', id: 'toolu_2', name: 'get_weather', input: {} },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta', index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"city":"NY"}' },
    }),
    frame('content_block_stop', { type: 'content_block_stop', index: 1 }),
    frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }),
    frame('message_stop', { type: 'message_stop' }),
  ];

  it('assigns sequential tool_call indices', () => {
    const out = parseOpenAIChunks(runStream(stream)).filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>;
    const opens = out
      .map((c) => {
        const choices = c.choices as Array<{ delta: { tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string } }> } }>;
        const tc = choices[0]?.delta?.tool_calls?.[0];
        return tc?.id ? { index: tc.index, id: tc.id } : null;
      })
      .filter((x): x is { index: number; id: string } => x !== null);
    expect(opens).toEqual([
      { index: 0, id: 'toolu_1' },
      { index: 1, id: 'toolu_2' },
    ]);
  });
});

describe('anthropic→openai SSE — chunk boundaries', () => {
  const stream = [
    frame('message_start', { type: 'message_start', message: { id: 'msg_b', usage: { input_tokens: 1, output_tokens: 1 } } }),
    frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
    frame('message_stop', { type: 'message_stop' }),
  ];

  it('produces the same output regardless of how chunks are split mid-frame', () => {
    const joined = stream.join('');
    const single = runStream([joined]);
    // Split at every byte to maximize buffering pressure
    const oneByteAtATime: string[] = [];
    for (const ch of joined) oneByteAtATime.push(ch);
    const fragmented = runStream(oneByteAtATime);
    expect(fragmented).toBe(single);
  });

  it('handles split frame boundaries (\\n\\n bisected across chunks)', () => {
    const joined = stream.join('');
    const mid = Math.floor(joined.length / 2);
    const fragmented = runStream([joined.slice(0, mid), joined.slice(mid)]);
    const single = runStream([joined]);
    expect(fragmented).toBe(single);
  });
});

describe('anthropic→openai SSE — flush', () => {
  it('flush() emits a synthetic terminator if the source stream ended early', () => {
    const partial = [
      frame('message_start', { type: 'message_start', message: { id: 'msg_p', usage: { input_tokens: 1, output_tokens: 1 } } }),
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }),
    ];
    const out = parseOpenAIChunks(runStream(partial));
    expect(out[out.length - 1]).toBe('[DONE]');
  });
});

describe('anthropic→openai SSE — drops + ignores', () => {
  it('drops ping events', () => {
    const stream = [
      frame('message_start', { type: 'message_start', message: { id: 'm', usage: { input_tokens: 1, output_tokens: 1 } } }),
      frame('ping', { type: 'ping' }),
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
      frame('message_stop', { type: 'message_stop' }),
    ];
    const out = parseOpenAIChunks(runStream(stream)).filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>;
    // No chunks should reference ping
    for (const c of out) {
      expect(JSON.stringify(c)).not.toContain('ping');
    }
  });

  it('drops thinking_delta blocks', () => {
    const stream = [
      frame('message_start', { type: 'message_start', message: { id: 'm', usage: { input_tokens: 1, output_tokens: 1 } } }),
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', text: 'silent' } }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } }),
      frame('message_stop', { type: 'message_stop' }),
    ];
    const out = parseOpenAIChunks(runStream(stream)).filter((c) => c !== '[DONE]') as Array<Record<string, unknown>>;
    for (const c of out) {
      expect(JSON.stringify(c)).not.toContain('silent');
    }
  });
});
