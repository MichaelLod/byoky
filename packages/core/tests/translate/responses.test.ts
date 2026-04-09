import { describe, it, expect } from 'vitest';
import {
  anthropicToOpenAIResponse,
  openAIToAnthropicResponse,
} from '../../src/translate/responses.js';
import { TranslationError } from '../../src/translate/types.js';
import type { TranslationContext } from '../../src/translate/types.js';

function ctxA2O(overrides: Partial<TranslationContext> = {}): TranslationContext {
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

function ctxO2A(overrides: Partial<TranslationContext> = {}): TranslationContext {
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

// ─── Anthropic Messages → OpenAI Chat Completion ────────────────────────

describe('anthropicToOpenAIResponse', () => {
  it('translates a basic text-only response', () => {
    const out = JSON.parse(anthropicToOpenAIResponse(ctxA2O(), JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'hello world' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    })));
    expect(out.id).toBe('msg_1');
    expect(out.object).toBe('chat.completion');
    expect(out.choices).toHaveLength(1);
    expect(out.choices[0].message.content).toBe('hello world');
    expect(out.choices[0].finish_reason).toBe('stop');
    expect(out.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it('echoes the source model the SDK requested, not the destination', () => {
    const out = JSON.parse(anthropicToOpenAIResponse(ctxA2O({ srcModel: 'gpt-4o-asked' }), JSON.stringify({
      id: 'msg_1', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1, output_tokens: 1 },
    })));
    expect(out.model).toBe('gpt-4o-asked');
  });

  it('translates tool_use blocks into tool_calls', () => {
    const out = JSON.parse(anthropicToOpenAIResponse(ctxA2O(), JSON.stringify({
      id: 'msg_1', content: [
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Tokyo' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 3 },
    })));
    expect(out.choices[0].message.content).toBe('checking');
    expect(out.choices[0].message.tool_calls).toHaveLength(1);
    expect(out.choices[0].message.tool_calls[0].id).toBe('toolu_1');
    expect(out.choices[0].message.tool_calls[0].function.name).toBe('get_weather');
    expect(JSON.parse(out.choices[0].message.tool_calls[0].function.arguments)).toEqual({ city: 'Tokyo' });
    expect(out.choices[0].finish_reason).toBe('tool_calls');
  });

  it('maps stop_reason → finish_reason', () => {
    const cases: Array<[string, string]> = [
      ['end_turn', 'stop'],
      ['stop_sequence', 'stop'],
      ['max_tokens', 'length'],
      ['tool_use', 'tool_calls'],
    ];
    for (const [stop, finish] of cases) {
      const out = JSON.parse(anthropicToOpenAIResponse(ctxA2O(), JSON.stringify({
        id: 'm', content: [{ type: 'text', text: 'x' }],
        stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 },
      })));
      expect(out.choices[0].finish_reason).toBe(finish);
    }
  });

  it('passes through Anthropic error responses as OpenAI-shaped errors', () => {
    const out = JSON.parse(anthropicToOpenAIResponse(ctxA2O(), JSON.stringify({
      type: 'error',
      error: { type: 'overloaded_error', message: 'try again later' },
    })));
    expect(out.error).toBeDefined();
    expect(out.error.message).toBe('try again later');
    expect(out.error.type).toBe('overloaded_error');
  });

  it('emits content: null when there are no text blocks', () => {
    const out = JSON.parse(anthropicToOpenAIResponse(ctxA2O(), JSON.stringify({
      id: 'm',
      content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }],
      stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
    })));
    expect(out.choices[0].message.content).toBeNull();
    expect(out.choices[0].message.tool_calls).toHaveLength(1);
  });

  it('throws TranslationError on invalid JSON', () => {
    expect(() => anthropicToOpenAIResponse(ctxA2O(), 'not json')).toThrow(TranslationError);
  });
});

// ─── OpenAI Chat Completion → Anthropic Messages ────────────────────────

describe('openAIToAnthropicResponse', () => {
  it('translates a basic text-only response', () => {
    const out = JSON.parse(openAIToAnthropicResponse(ctxO2A(), JSON.stringify({
      id: 'chatcmpl_1', object: 'chat.completion', created: 0,
      model: 'gpt-5.4',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'hello world' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })));
    expect(out.id).toBe('chatcmpl_1');
    expect(out.type).toBe('message');
    expect(out.role).toBe('assistant');
    expect(out.content).toEqual([{ type: 'text', text: 'hello world' }]);
    expect(out.stop_reason).toBe('end_turn');
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('echoes the source model the SDK requested', () => {
    const out = JSON.parse(openAIToAnthropicResponse(ctxO2A({ srcModel: 'claude-asked' }), JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));
    expect(out.model).toBe('claude-asked');
  });

  it('translates tool_calls into tool_use content blocks', () => {
    const out = JSON.parse(openAIToAnthropicResponse(ctxO2A(), JSON.stringify({
      choices: [{
        message: {
          role: 'assistant', content: 'checking',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));
    expect(out.content).toHaveLength(2);
    const text = out.content.find((b: { type: string }) => b.type === 'text');
    const toolUse = out.content.find((b: { type: string }) => b.type === 'tool_use');
    expect(text.text).toBe('checking');
    expect(toolUse.id).toBe('call_1');
    expect(toolUse.name).toBe('get_weather');
    expect(toolUse.input).toEqual({ city: 'Tokyo' });
    expect(out.stop_reason).toBe('tool_use');
  });

  it('maps finish_reason → stop_reason', () => {
    const cases: Array<[string, string]> = [
      ['stop', 'end_turn'],
      ['length', 'max_tokens'],
      ['tool_calls', 'tool_use'],
      ['content_filter', 'refusal'],
    ];
    for (const [finish, stop] of cases) {
      const out = JSON.parse(openAIToAnthropicResponse(ctxO2A(), JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: finish }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })));
      expect(out.stop_reason).toBe(stop);
    }
  });

  it('passes through OpenAI error responses as Anthropic-shaped errors', () => {
    const out = JSON.parse(openAIToAnthropicResponse(ctxO2A(), JSON.stringify({
      error: { message: 'rate limited', type: 'rate_limit_error' },
    })));
    expect(out.type).toBe('error');
    expect(out.error.message).toBe('rate limited');
    expect(out.error.type).toBe('rate_limit_error');
  });

  it('emits an empty text block when content is missing', () => {
    const out = JSON.parse(openAIToAnthropicResponse(ctxO2A(), JSON.stringify({
      choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toEqual({ type: 'text', text: '' });
  });

  it('preserves malformed tool_call arguments under _raw', () => {
    const out = JSON.parse(openAIToAnthropicResponse(ctxO2A(), JSON.stringify({
      choices: [{
        message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: 'NOT JSON' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));
    const toolUse = out.content.find((b: { type: string }) => b.type === 'tool_use');
    expect(toolUse.input).toEqual({ _raw: 'NOT JSON' });
  });
});
