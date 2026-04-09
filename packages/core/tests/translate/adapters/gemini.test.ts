import { describe, it, expect } from 'vitest';
import '../../../src/translate/index.js';
import { geminiAdapter } from '../../../src/translate/adapters/gemini.js';
import type { TranslationContext } from '../../../src/translate/types.js';
import type { IRRequest, IRStreamEvent } from '../../../src/translate/ir.js';

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    srcFamily: 'gemini',
    dstFamily: 'gemini',
    srcModel: 'gemini-2.5-pro',
    dstModel: 'gemini-2.5-pro',
    isStreaming: false,
    requestId: 'req-test',
    ...overrides,
  };
}

describe('geminiAdapter.matchesChatEndpoint', () => {
  it('matches generateContent and streamGenerateContent paths', () => {
    expect(geminiAdapter.matchesChatEndpoint('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent')).toBe(true);
    expect(geminiAdapter.matchesChatEndpoint('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse')).toBe(true);
  });

  it('rejects non-chat paths', () => {
    expect(geminiAdapter.matchesChatEndpoint('https://generativelanguage.googleapis.com/v1beta/files')).toBe(false);
    expect(geminiAdapter.matchesChatEndpoint('https://api.openai.com/v1/chat/completions')).toBe(false);
  });
});

describe('geminiAdapter.buildChatUrl', () => {
  it('builds non-streaming URL', () => {
    expect(geminiAdapter.buildChatUrl('https://generativelanguage.googleapis.com', 'gemini-2.5-pro', false))
      .toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent');
  });

  it('builds streaming URL with ?alt=sse', () => {
    expect(geminiAdapter.buildChatUrl('https://generativelanguage.googleapis.com', 'gemini-2.5-flash', true))
      .toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
  });
});

describe('geminiAdapter.parseRequest', () => {
  it('parses systemInstruction into IR top-level system', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        systemInstruction: { parts: [{ text: 'Be terse.' }] },
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      }),
    );
    expect(ir.system).toEqual([{ text: 'Be terse.' }]);
  });

  it('maps `model` role to IR assistant', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: 'hi' }] },
          { role: 'model', parts: [{ text: 'hello' }] },
        ],
      }),
    );
    expect(ir.messages).toHaveLength(2);
    expect(ir.messages[1].role).toBe('assistant');
  });

  it('parses functionCall parts into tool_use blocks', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [
          {
            role: 'model',
            parts: [
              { text: 'calling...' },
              { functionCall: { id: 'fc1', name: 'get_weather', args: { city: 'Tokyo' } } },
            ],
          },
        ],
      }),
    );
    const blocks = ir.messages[0].content;
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({
      type: 'tool_use',
      id: 'fc1',
      name: 'get_weather',
      input: { city: 'Tokyo' },
    });
  });

  it('parses functionResponse parts into tool_result blocks', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { functionResponse: { id: 'fc1', name: 'get_weather', response: { temp: 18 } } },
            ],
          },
        ],
      }),
    );
    const block = ir.messages[0].content[0];
    expect(block.type).toBe('tool_result');
    if (block.type === 'tool_result') {
      expect(block.toolUseId).toBe('fc1');
      expect(block.content.kind).toBe('text');
      if (block.content.kind === 'text') {
        expect(JSON.parse(block.content.text)).toEqual({ temp: 18 });
      }
    }
  });

  it('parses inlineData into base64 image sources', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'what is this' },
              { inlineData: { mimeType: 'image/png', data: 'abc' } },
            ],
          },
        ],
      }),
    );
    const img = ir.messages[0].content[1];
    expect(img).toEqual({
      type: 'image',
      source: { kind: 'base64', mediaType: 'image/png', data: 'abc' },
    });
  });

  it('parses generationConfig.thinkingConfig.thinkingBudget into IR thinking', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        generationConfig: { thinkingConfig: { thinkingBudget: 2048 } },
      }),
    );
    expect(ir.thinking).toEqual({ enabled: true, budgetTokens: 2048 });
  });
});

describe('geminiAdapter.serializeRequest', () => {
  it('refuses tools + responseFormat combination', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      tools: [{ name: 'fn', parameters: {} }],
      responseFormat: { type: 'json' },
    };
    expect(() => geminiAdapter.serializeRequest(ctx(), ir)).toThrow(/tools with JSON/);
  });

  it('propagates tool_use name into tool_result functionResponse.name', () => {
    const ir: IRRequest = {
      system: [],
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'fc1', name: 'get_weather', input: { city: 'Tokyo' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'fc1', content: { kind: 'text', text: '{"temp":18}' } }],
        },
      ],
    };
    const out = JSON.parse(geminiAdapter.serializeRequest(ctx(), ir)) as {
      contents: Array<{ role: string; parts: Array<{ functionResponse?: { name?: string; id?: string; response?: unknown } }> }>;
    };
    const userTurn = out.contents[1];
    const fr = userTurn.parts[0].functionResponse;
    expect(fr).toBeDefined();
    expect(fr!.name).toBe('get_weather');
    expect(fr!.id).toBe('fc1');
  });

  it('converts `auto` toolChoice to AUTO and `any` to ANY', () => {
    const baseIR: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      tools: [{ name: 'fn', parameters: {} }],
    };
    const auto = JSON.parse(geminiAdapter.serializeRequest(ctx(), { ...baseIR, toolChoice: { type: 'auto' } })) as {
      toolConfig: { functionCallingConfig: { mode: string } };
    };
    expect(auto.toolConfig.functionCallingConfig.mode).toBe('AUTO');

    const any = JSON.parse(geminiAdapter.serializeRequest(ctx(), { ...baseIR, toolChoice: { type: 'any' } })) as {
      toolConfig: { functionCallingConfig: { mode: string } };
    };
    expect(any.toolConfig.functionCallingConfig.mode).toBe('ANY');

    const named = JSON.parse(geminiAdapter.serializeRequest(ctx(), { ...baseIR, toolChoice: { type: 'tool', name: 'fn' } })) as {
      toolConfig: { functionCallingConfig: { mode: string; allowedFunctionNames?: string[] } };
    };
    expect(named.toolConfig.functionCallingConfig.mode).toBe('ANY');
    expect(named.toolConfig.functionCallingConfig.allowedFunctionNames).toEqual(['fn']);
  });
});

describe('geminiAdapter.parseResponse', () => {
  it('disambiguates STOP with tool_use as tool_use stop reason', () => {
    const ir = geminiAdapter.parseResponse(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'calling' },
                { functionCall: { id: 'fc1', name: 'get_weather', args: { city: 'Tokyo' } } },
              ],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
      }),
    );
    if ('error' in ir) throw new Error('expected success');
    expect(ir.stopReason).toBe('tool_use');
    expect(ir.content.some((b) => b.type === 'tool_use')).toBe(true);
  });

  it('folds thoughtsTokenCount into output tokens', () => {
    const ir = geminiAdapter.parseResponse(
      JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP', index: 0 }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 100, totalTokenCount: 115 },
      }),
    );
    if ('error' in ir) throw new Error('expected success');
    expect(ir.usage.inputTokens).toBe(10);
    expect(ir.usage.outputTokens).toBe(105); // 5 + 100
  });

  it('parses an error response', () => {
    const ir = geminiAdapter.parseResponse(
      JSON.stringify({ error: { code: 400, message: 'bad', status: 'INVALID_ARGUMENT' } }),
    );
    if (!('error' in ir)) throw new Error('expected error');
    expect(ir.error.type).toBe('INVALID_ARGUMENT');
    expect(ir.error.message).toBe('bad');
  });
});

describe('geminiAdapter round-trip', () => {
  it('parse → serialize → parse preserves simple chat', () => {
    const original = JSON.stringify({
      systemInstruction: { parts: [{ text: 'Be terse.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
      ],
      generationConfig: { temperature: 0.5, maxOutputTokens: 128 },
    });
    const ir1 = geminiAdapter.parseRequest(original);
    const wire = geminiAdapter.serializeRequest(ctx(), ir1);
    const ir2 = geminiAdapter.parseRequest(wire);
    expect(ir2.system).toEqual(ir1.system);
    expect(ir2.messages).toEqual(ir1.messages);
    expect(ir2.temperature).toBe(ir1.temperature);
    expect(ir2.maxTokens).toBe(ir1.maxTokens);
  });
});

describe('geminiAdapter stream parsing', () => {
  it('synthesizes block scaffolding around text deltas', () => {
    const parser = geminiAdapter.createStreamParser();
    const chunks = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hel"}]},"index":0}],"modelVersion":"gemini-2.5-pro","responseId":"r1"}\n\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"lo"}]},"index":0}]}\n\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}\n\n',
    ];
    const events: IRStreamEvent[] = [];
    for (const c of chunks) events.push(...parser.process(c));
    events.push(...parser.flush());

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('content_block_stop');
    expect(types[types.length - 1]).toBe('message_stop');

    const text = events
      .filter((e): e is Extract<IRStreamEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('Hello');
  });

  it('emits tool_use block in one go when functionCall arrives', () => {
    const parser = geminiAdapter.createStreamParser();
    const chunks = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"id":"fc1","name":"get_weather","args":{"city":"Tokyo"}}}]},"finishReason":"STOP","index":0}],"responseId":"r1"}\n\n',
    ];
    const events: IRStreamEvent[] = [];
    for (const c of chunks) events.push(...parser.process(c));
    events.push(...parser.flush());

    const types = events.map((e) => e.type);
    expect(types).toContain('content_block_start');
    expect(types).toContain('tool_input_delta');
    expect(types).toContain('content_block_stop');

    const toolStart = events.find((e) => e.type === 'content_block_start' && e.block.type === 'tool_use');
    expect(toolStart).toBeDefined();
    if (toolStart && toolStart.type === 'content_block_start' && toolStart.block.type === 'tool_use') {
      expect(toolStart.block.name).toBe('get_weather');
    }

    // Since finishReason is STOP + there's a tool_use, message_delta should have tool_use stop reason.
    const msgDelta = events.find((e) => e.type === 'message_delta');
    expect(msgDelta).toBeDefined();
    if (msgDelta && msgDelta.type === 'message_delta') {
      expect(msgDelta.stopReason).toBe('tool_use');
    }
  });
});
