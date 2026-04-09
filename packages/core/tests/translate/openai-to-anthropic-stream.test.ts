import { describe, it, expect } from 'vitest';
import { createOpenAIToAnthropicStreamRewriter } from '../../src/translate/openai-to-anthropic-stream.js';
import type { TranslationContext } from '../../src/translate/types.js';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'openai',
    dstFamily: 'anthropic',
    srcModel: 'gpt-5.4',
    dstModel: 'claude-sonnet-4-6',
    isStreaming: true,
    requestId: 'req-test',
    state: {},
    ...overrides,
  };
}

/** Build an OpenAI SSE chunk frame. */
function dchunk(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const DONE_FRAME = 'data: [DONE]\n\n';

function runStream(input: string[], rew = createOpenAIToAnthropicStreamRewriter(ctx())): string {
  let out = '';
  for (const chunk of input) out += rew.process(chunk);
  out += rew.flush();
  return out;
}

interface AnthropicEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Parse the Anthropic SSE output into named events. */
function parseAnthropicEvents(out: string): AnthropicEvent[] {
  const events: AnthropicEvent[] = [];
  // Each frame is: "event: <type>\ndata: <json>\n\n"
  const frames = out.split('\n\n').filter((f) => f.length > 0);
  for (const frame of frames) {
    const lines = frame.split('\n');
    let eventType: string | null = null;
    let dataLine: string | null = null;
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7);
      else if (line.startsWith('data: ')) dataLine = line.slice(6);
    }
    if (eventType && dataLine) {
      events.push({ event: eventType, data: JSON.parse(dataLine) as Record<string, unknown> });
    }
  }
  return events;
}

describe('openai→anthropic SSE — text-only message', () => {
  const stream = [
    dchunk({
      id: 'chatcmpl_x',
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    }),
    dchunk({
      id: 'chatcmpl_x',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    }),
    dchunk({
      id: 'chatcmpl_x',
      choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
    }),
    dchunk({
      id: 'chatcmpl_x',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }),
    // Usage chunk
    dchunk({
      id: 'chatcmpl_x',
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    }),
    DONE_FRAME,
  ];

  it('emits message_start as the very first event', () => {
    const events = parseAnthropicEvents(runStream(stream));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event).toBe('message_start');
    expect((events[0].data as { type: string }).type).toBe('message_start');
  });

  it('opens a text content block before any text deltas', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const start = events.findIndex((e) => e.event === 'content_block_start');
    const firstDelta = events.findIndex((e) => e.event === 'content_block_delta');
    expect(start).toBeGreaterThan(-1);
    expect(firstDelta).toBeGreaterThan(start);
    const block = (events[start].data as { content_block: { type: string } }).content_block;
    expect(block.type).toBe('text');
  });

  it('emits text_delta events with the content fragments in order', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const deltas = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => {
        const d = (e.data as { delta: { type: string; text?: string } }).delta;
        return d.type === 'text_delta' ? d.text : undefined;
      })
      .filter((t): t is string => typeof t === 'string');
    expect(deltas).toEqual(['Hello', ' world']);
  });

  it('closes the text block before message_delta', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const stop = events.findIndex((e) => e.event === 'content_block_stop');
    const messageDelta = events.findIndex((e) => e.event === 'message_delta');
    expect(stop).toBeGreaterThan(-1);
    expect(messageDelta).toBeGreaterThan(stop);
  });

  it('emits message_delta with stop_reason: end_turn', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const md = events.find((e) => e.event === 'message_delta');
    expect(md).toBeDefined();
    expect((md!.data as { delta: { stop_reason: string } }).delta.stop_reason).toBe('end_turn');
  });

  it('folds usage from the trailing usage chunk into message_delta', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const md = events.find((e) => e.event === 'message_delta');
    expect(md).toBeDefined();
    const usage = (md!.data as { usage: { input_tokens: number; output_tokens: number } }).usage;
    expect(usage.input_tokens).toBe(7);
    expect(usage.output_tokens).toBe(5);
  });

  it('emits message_stop as the final event', () => {
    const events = parseAnthropicEvents(runStream(stream));
    expect(events[events.length - 1].event).toBe('message_stop');
  });
});

describe('openai→anthropic SSE — tool_calls', () => {
  const stream = [
    dchunk({
      id: 'chatcmpl_y',
      choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }],
    }),
    // First tool call: id + name on the first chunk
    dchunk({
      id: 'chatcmpl_y',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '' },
          }],
        },
        finish_reason: null,
      }],
    }),
    dchunk({
      id: 'chatcmpl_y',
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] },
        finish_reason: null,
      }],
    }),
    dchunk({
      id: 'chatcmpl_y',
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '"Tokyo"}' } }] },
        finish_reason: null,
      }],
    }),
    dchunk({
      id: 'chatcmpl_y',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    }),
    DONE_FRAME,
  ];

  it('opens a tool_use content block with id and name', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const start = events.find((e) => {
      if (e.event !== 'content_block_start') return false;
      const cb = (e.data as { content_block: { type: string } }).content_block;
      return cb.type === 'tool_use';
    });
    expect(start).toBeDefined();
    const cb = (start!.data as { content_block: { type: string; id: string; name: string } }).content_block;
    expect(cb.id).toBe('call_1');
    expect(cb.name).toBe('get_weather');
  });

  it('streams partial_json fragments via input_json_delta in order', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const fragments = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => {
        const d = (e.data as { delta: { type: string; partial_json?: string } }).delta;
        return d.type === 'input_json_delta' ? d.partial_json : undefined;
      })
      .filter((p): p is string => typeof p === 'string');
    expect(fragments.join('')).toBe('{"city":"Tokyo"}');
  });

  it('finishes with stop_reason: tool_use', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const md = events.find((e) => e.event === 'message_delta');
    expect((md!.data as { delta: { stop_reason: string } }).delta.stop_reason).toBe('tool_use');
  });

  it('closes the tool_use block before message_delta', () => {
    const events = parseAnthropicEvents(runStream(stream));
    const lastBlockStop = events.map((e) => e.event).lastIndexOf('content_block_stop');
    const messageDelta = events.findIndex((e) => e.event === 'message_delta');
    expect(lastBlockStop).toBeLessThan(messageDelta);
  });
});

describe('openai→anthropic SSE — text followed by tool_call', () => {
  const stream = [
    dchunk({ id: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }),
    dchunk({ id: 'm', choices: [{ index: 0, delta: { content: 'thinking…' }, finish_reason: null }] }),
    dchunk({
      id: 'm',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0, id: 'call_1', type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
          }],
        },
        finish_reason: null,
      }],
    }),
    dchunk({ id: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    DONE_FRAME,
  ];

  it('closes the text block before opening the tool_use block', () => {
    const events = parseAnthropicEvents(runStream(stream));
    // Sequence (event types): message_start, content_block_start(text),
    // content_block_delta(text), content_block_stop, content_block_start(tool_use),
    // content_block_delta(input_json), content_block_stop, message_delta, message_stop
    const seq = events.map((e) => {
      if (e.event === 'content_block_start') {
        const cb = (e.data as { content_block: { type: string } }).content_block;
        return `start:${cb.type}`;
      }
      return e.event;
    });
    const textStart = seq.indexOf('start:text');
    const toolStart = seq.indexOf('start:tool_use');
    const blockStops = seq.map((s, i) => (s === 'content_block_stop' ? i : -1)).filter((i) => i >= 0);
    expect(textStart).toBeGreaterThan(-1);
    expect(toolStart).toBeGreaterThan(-1);
    // There must be a content_block_stop between textStart and toolStart
    expect(blockStops.some((i) => i > textStart && i < toolStart)).toBe(true);
  });
});

describe('openai→anthropic SSE — chunk boundaries', () => {
  const stream = [
    dchunk({ id: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }),
    dchunk({ id: 'm', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }),
    dchunk({ id: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    DONE_FRAME,
  ];

  it('produces the same output regardless of chunk fragmentation', () => {
    const joined = stream.join('');
    const single = runStream([joined]);
    const oneByteAtATime: string[] = [];
    for (const ch of joined) oneByteAtATime.push(ch);
    const fragmented = runStream(oneByteAtATime);
    expect(fragmented).toBe(single);
  });
});

describe('openai→anthropic SSE — drops + flush', () => {
  it('flushes a synthetic message_stop when the source stream ended early', () => {
    const stream = [
      dchunk({ id: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }),
      dchunk({ id: 'm', choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] }),
    ];
    const events = parseAnthropicEvents(runStream(stream));
    expect(events[events.length - 1].event).toBe('message_stop');
    // It should also have closed the open text block
    expect(events.some((e) => e.event === 'content_block_stop')).toBe(true);
  });
});

describe('openai→anthropic SSE — finish reason mapping', () => {
  function withFinish(finish: string): AnthropicEvent[] {
    const stream = [
      dchunk({ id: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }),
      dchunk({ id: 'm', choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }] }),
      dchunk({ id: 'm', choices: [{ index: 0, delta: {}, finish_reason: finish }] }),
      DONE_FRAME,
    ];
    return parseAnthropicEvents(runStream(stream));
  }

  it.each([
    ['stop', 'end_turn'],
    ['length', 'max_tokens'],
    ['tool_calls', 'tool_use'],
    ['content_filter', 'refusal'],
  ])('maps openai finish %s → anthropic stop %s', (finish, stop) => {
    const events = withFinish(finish);
    const md = events.find((e) => e.event === 'message_delta');
    expect((md!.data as { delta: { stop_reason: string } }).delta.stop_reason).toBe(stop);
  });
});
