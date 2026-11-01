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

describe('geminiAdapter.serializeRequest — functionResponse.response is always an object', () => {
  function responseFor(content: IRRequest['messages'][number]['content'][number]): unknown {
    const ir: IRRequest = {
      system: [],
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'fc1', name: 'lookup', input: {} }] },
        { role: 'user', content: [content] },
      ],
    };
    const out = JSON.parse(geminiAdapter.serializeRequest(ctx(), ir)) as {
      contents: Array<{ parts: Array<{ functionResponse?: { response?: unknown } }> }>;
    };
    return out.contents[1].parts[0].functionResponse?.response;
  }
  const textResult = (text: string) =>
    ({ type: 'tool_result', toolUseId: 'fc1', content: { kind: 'text', text } }) as const;

  it.each([
    ['[1,2,3]', { result: [1, 2, 3] }],
    ['42', { result: 42 }],
    ['true', { result: true }],
    ['null', { result: null }],
    ['"done"', { result: 'done' }],
    ['plain text', { result: 'plain text' }],
  ])('wraps %s', (text, expected) => {
    expect(responseFor(textResult(text))).toEqual(expected);
  });

  it('passes a JSON object through unwrapped', () => {
    expect(responseFor(textResult('{"temp":18}'))).toEqual({ temp: 18 });
  });

  it('wraps non-object JSON in the blocks form too', () => {
    expect(
      responseFor({
        type: 'tool_result',
        toolUseId: 'fc1',
        content: { kind: 'blocks', blocks: [{ type: 'text', text: '[1,2]' }] },
      }),
    ).toEqual({ result: [1, 2] });
  });
});

describe('geminiAdapter — JSON Schema fields', () => {
  const claudeCodeSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    properties: {
      file_path: { type: 'string' },
      limit: { type: 'number', exclusiveMinimum: 0 },
    },
    required: ['file_path'],
  };

  it('sends tool schemas as parametersJsonSchema, without the $schema marker', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      tools: [{ name: 'Read', parameters: claudeCodeSchema }],
    };
    const out = JSON.parse(geminiAdapter.serializeRequest(ctx(), ir)) as {
      tools: Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
    };
    const fn = out.tools[0].functionDeclarations[0];
    expect(fn).not.toHaveProperty('parameters');
    const { $schema: _omitted, ...expected } = claudeCodeSchema;
    void _omitted;
    expect(fn.parametersJsonSchema).toEqual(expected);
  });

  it('leaves the parameters unset for a tool that takes none', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      tools: [{ name: 'now', parameters: { type: 'object', properties: {} } }],
    };
    const out = JSON.parse(geminiAdapter.serializeRequest(ctx(), ir)) as {
      tools: Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
    };
    expect(out.tools[0].functionDeclarations[0]).toEqual({ name: 'now' });
  });

  it('sends a json_schema response format as responseJsonSchema', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    };
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      responseFormat: { type: 'json_schema', schema },
    };
    const out = JSON.parse(geminiAdapter.serializeRequest(ctx(), ir)) as {
      generationConfig: Record<string, unknown>;
    };
    expect(out.generationConfig.responseMimeType).toBe('application/json');
    expect(out.generationConfig).not.toHaveProperty('responseSchema');
    expect(out.generationConfig.responseJsonSchema).toEqual(schema);
  });

  it('parses parametersJsonSchema and responseJsonSchema back into the IR', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        tools: [{ functionDeclarations: [{ name: 'Read', parametersJsonSchema: claudeCodeSchema }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } },
      }),
    );
    expect(ir.tools).toEqual([{ name: 'Read', parameters: claudeCodeSchema }]);
    expect(ir.responseFormat).toEqual({ type: 'json_schema', schema: { type: 'object' } });
  });

  it('still parses the OpenAPI parameters and responseSchema fields', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        tools: [{ functionDeclarations: [{ name: 'f', parameters: { type: 'OBJECT' } }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'STRING' } },
      }),
    );
    expect(ir.tools?.[0].parameters).toEqual({ type: 'OBJECT' });
    expect(ir.responseFormat).toEqual({ type: 'json_schema', schema: { type: 'STRING' } });
  });
});

describe('geminiAdapter.parseRequest — thinkingBudget', () => {
  const parse = (thinkingBudget: number) =>
    geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        generationConfig: { thinkingConfig: { thinkingBudget } },
      }),
    );

  it('0 turns thinking off', () => {
    expect(parse(0).thinking).toBeUndefined();
  });

  it('-1 asks for thinking without a budget', () => {
    expect(parse(-1).thinking).toEqual({ enabled: true });
  });

  it('a positive budget is kept', () => {
    expect(parse(4096).thinking).toEqual({ enabled: true, budgetTokens: 4096 });
  });
});

describe('geminiAdapter.parseRequest — snake_case bodies (Google REST docs style)', () => {
  const camel = {
    systemInstruction: { parts: [{ text: 'You are a cat.' }] },
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'What is in this picture?' },
          { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
          { fileData: { mimeType: 'image/jpeg', fileUri: 'https://example.com/cat.jpg' } },
        ],
      },
      { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city_name: 'Paris' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'get_weather', response: { temp_c: 21 } } }] },
    ],
    generationConfig: {
      maxOutputTokens: 256,
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      stopSequences: ['END'],
      thinkingConfig: { thinkingBudget: 2048 },
    },
    tools: [
      {
        functionDeclarations: [
          {
            name: 'get_weather',
            parameters: { type: 'object', properties: { city_name: { type: 'string' } } },
          },
        ],
      },
    ],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['get_weather'] } },
  };
  const snake = {
    system_instruction: { parts: [{ text: 'You are a cat.' }] },
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'What is in this picture?' },
          { inline_data: { mime_type: 'image/png', data: 'AAAA' } },
          { file_data: { mime_type: 'image/jpeg', file_uri: 'https://example.com/cat.jpg' } },
        ],
      },
      { role: 'model', parts: [{ function_call: { name: 'get_weather', args: { city_name: 'Paris' } } }] },
      { role: 'user', parts: [{ function_response: { name: 'get_weather', response: { temp_c: 21 } } }] },
    ],
    generation_config: {
      max_output_tokens: 256,
      temperature: 0.2,
      top_p: 0.9,
      top_k: 20,
      stop_sequences: ['END'],
      thinking_config: { thinking_budget: 2048 },
    },
    tools: [
      {
        function_declarations: [
          {
            name: 'get_weather',
            parameters: { type: 'object', properties: { city_name: { type: 'string' } } },
          },
        ],
      },
    ],
    tool_config: { function_calling_config: { mode: 'ANY', allowed_function_names: ['get_weather'] } },
  };

  it('parses a snake_case body into the same IR as its camelCase twin', () => {
    const fromCamel = geminiAdapter.parseRequest(JSON.stringify(camel));
    const fromSnake = geminiAdapter.parseRequest(JSON.stringify(snake));
    expect(fromSnake).toEqual(fromCamel);
    expect(fromSnake.system).toEqual([{ text: 'You are a cat.' }]);
    expect(fromSnake.maxTokens).toBe(256);
    expect(fromSnake.toolChoice).toEqual({ type: 'tool', name: 'get_weather' });
  });

  it('leaves keys inside schemas, args and responses alone', () => {
    const ir = geminiAdapter.parseRequest(JSON.stringify(snake));
    expect(ir.tools?.[0].parameters).toEqual({ type: 'object', properties: { city_name: { type: 'string' } } });
    expect(ir.messages[1].content[0]).toMatchObject({ type: 'tool_use', input: { city_name: 'Paris' } });
  });

  it('camelCase wins when a body carries both spellings', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        generationConfig: { maxOutputTokens: 100 },
        generation_config: { max_output_tokens: 999 },
      }),
    );
    expect(ir.maxTokens).toBe(100);
  });
});

describe('geminiAdapter — function call ids', () => {
  it('pairs an id-less functionResponse with the call of the same name', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: 'weather?' }] },
          {
            role: 'model',
            parts: [
              { functionCall: { id: 'toolu_01', name: 'get_time', args: {} } },
              { functionCall: { id: 'toolu_02', name: 'get_weather', args: { city: 'Paris' } } },
            ],
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { name: 'get_weather', response: { temp: 21 } } },
              { functionResponse: { name: 'get_time', response: { t: '12:00' } } },
            ],
          },
        ],
      }),
    );
    expect(ir.messages[2].content.map((b) => (b.type === 'tool_result' ? b.toolUseId : null))).toEqual([
      'toolu_02',
      'toolu_01',
    ]);
  });

  it('gives id-less parallel calls to one function distinct ids and pairs them in order', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: 'weather in two cities?' }] },
          {
            role: 'model',
            parts: [
              { functionCall: { name: 'weather.get', args: { city: 'Paris' } } },
              { functionCall: { name: 'weather.get', args: { city: 'Rome' } } },
            ],
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { name: 'weather.get', response: { temp: 21 } } },
              { functionResponse: { name: 'weather.get', response: { temp: 25 } } },
            ],
          },
        ],
      }),
    );
    const callIds = ir.messages[1].content.map((b) => (b.type === 'tool_use' ? b.id : null));
    const resultIds = ir.messages[2].content.map((b) => (b.type === 'tool_result' ? b.toolUseId : null));
    expect(new Set(callIds).size).toBe(2);
    for (const id of callIds) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(resultIds).toEqual(callIds);
  });

  it('keeps a functionResponse id that matches its call', () => {
    const ir = geminiAdapter.parseRequest(
      JSON.stringify({
        contents: [
          { role: 'model', parts: [{ functionCall: { id: 'a', name: 'f' } }, { functionCall: { id: 'b', name: 'f' } }] },
          { role: 'user', parts: [{ functionResponse: { id: 'b', name: 'f', response: {} } }] },
        ],
      }),
    );
    expect(ir.messages[1].content[0]).toMatchObject({ type: 'tool_result', toolUseId: 'b' });
  });

  it('gives id-less upstream calls unique ids in a response', () => {
    const ir = geminiAdapter.parseResponse(
      JSON.stringify({
        responseId: 'resp-42',
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { functionCall: { name: 'get_weather', args: { city: 'Paris' } } },
                { functionCall: { name: 'get_weather', args: { city: 'Rome' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    );
    if ('error' in ir) throw new Error('unexpected error');
    const ids = ir.content.map((b) => (b.type === 'tool_use' ? b.id : ''));
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
      expect(id).not.toBe('get_weather');
    }
  });

  it('gives id-less upstream calls unique ids in a stream', () => {
    const parser = geminiAdapter.createStreamParser();
    const frame = (parts: unknown[]) =>
      `data: ${JSON.stringify({ responseId: 'r1', candidates: [{ content: { role: 'model', parts } }] })}\n\n`;
    const events = parser.process(
      frame([{ functionCall: { name: 'get_weather', args: { city: 'Paris' } } }]) +
        frame([{ functionCall: { name: 'get_weather', args: { city: 'Rome' } } }]),
    );
    const ids = events.flatMap((e) =>
      e.type === 'content_block_start' && e.block.type === 'tool_use' ? [e.block.id] : [],
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });

  it('a call id stays within 40 characters for a long response id', () => {
    const ir = geminiAdapter.parseResponse(
      JSON.stringify({
        responseId: 'x'.repeat(80),
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'f', args: {} } }] }, finishReason: 'STOP' }],
      }),
    );
    if ('error' in ir) throw new Error('unexpected error');
    const block = ir.content[0];
    expect(block.type === 'tool_use' && block.id.length).toBeLessThanOrEqual(40);
  });
});
