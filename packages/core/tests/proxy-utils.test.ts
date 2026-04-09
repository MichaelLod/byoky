import { describe, it, expect } from 'vitest';
import {
  buildHeaders,
  parseModel,
  parseUsage,
  extractUsageFromParsed,
  injectStreamUsageOptions,
  computeAllowanceCheck,
  validateProxyUrl,
  detectRequestCapabilities,
  rewriteToolNamesInJSONBody,
} from '../src/proxy-utils.js';

// ── validateProxyUrl ────────────────────────────────────

describe('validateProxyUrl', () => {
  it('accepts valid Anthropic API URL', () => {
    expect(validateProxyUrl('anthropic', 'https://api.anthropic.com/v1/messages')).toBe(true);
  });

  it('accepts valid OpenAI API URL', () => {
    expect(validateProxyUrl('openai', 'https://api.openai.com/v1/chat/completions')).toBe(true);
  });

  it('accepts valid Gemini API URL', () => {
    expect(validateProxyUrl('gemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent')).toBe(true);
  });

  it('rejects URL targeting wrong domain', () => {
    expect(validateProxyUrl('anthropic', 'https://evil.com/steal-key')).toBe(false);
  });

  it('rejects URL with matching subdomain but different base', () => {
    expect(validateProxyUrl('anthropic', 'https://api.anthropic.com.evil.com/v1/messages')).toBe(false);
  });

  it('rejects unknown provider', () => {
    expect(validateProxyUrl('nonexistent', 'https://api.example.com/')).toBe(false);
  });

  it('rejects invalid URL', () => {
    expect(validateProxyUrl('anthropic', 'not-a-url')).toBe(false);
  });

  it('rejects HTTP (non-HTTPS) URL', () => {
    expect(validateProxyUrl('anthropic', 'http://api.anthropic.com/v1/messages')).toBe(false);
  });

  it('accepts URL with different path', () => {
    expect(validateProxyUrl('openai', 'https://api.openai.com/v1/embeddings')).toBe(true);
  });

  it('accepts URL with query params', () => {
    expect(validateProxyUrl('gemini', 'https://generativelanguage.googleapis.com/v1/models?key=test')).toBe(true);
  });
});

// ── buildHeaders ───────────────────────────────────────

describe('buildHeaders', () => {
  it('sets x-api-key for Anthropic', () => {
    const headers = buildHeaders('anthropic', { 'content-type': 'application/json' }, 'sk-ant-key');
    expect(headers['x-api-key']).toBe('sk-ant-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['authorization']).toBeUndefined();
  });

  it('preserves custom anthropic-version if set', () => {
    const headers = buildHeaders('anthropic', { 'anthropic-version': '2024-01-01' }, 'sk-ant-key');
    expect(headers['anthropic-version']).toBe('2024-01-01');
  });

  it('merges app beta flags with OAuth-required flags for Anthropic', () => {
    const headers = buildHeaders(
      'anthropic',
      { 'anthropic-beta': 'prompt-caching-2024-07-31' },
      'sk-ant-oat01-token',
      'oauth',
    );
    expect(headers['anthropic-beta']).toContain('prompt-caching-2024-07-31');
    expect(headers['anthropic-beta']).toContain('oauth-2025-04-20');
    expect(headers['authorization']).toBe('Bearer sk-ant-oat01-token');
  });

  it('preserves app accept header for OAuth Anthropic', () => {
    const headers = buildHeaders(
      'anthropic',
      { 'accept': 'text/event-stream' },
      'sk-ant-oat01-token',
      'oauth',
    );
    expect(headers['accept']).toBe('text/event-stream');
  });

  it('defaults accept to application/json for OAuth Anthropic', () => {
    const headers = buildHeaders('anthropic', {}, 'sk-ant-oat01-token', 'oauth');
    expect(headers['accept']).toBe('application/json');
  });

  it('sets api-key for Azure OpenAI', () => {
    const headers = buildHeaders('azure_openai', {}, 'azure-key');
    expect(headers['api-key']).toBe('azure-key');
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('sets Bearer token for OpenAI', () => {
    const headers = buildHeaders('openai', {}, 'sk-openai-key');
    expect(headers['authorization']).toBe('Bearer sk-openai-key');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('sets Bearer token for Gemini', () => {
    const headers = buildHeaders('gemini', {}, 'AIza-key');
    expect(headers['authorization']).toBe('Bearer AIza-key');
  });

  const bearerProviders = [
    'openai', 'gemini', 'mistral', 'cohere', 'xai', 'deepseek',
    'perplexity', 'groq', 'together', 'fireworks', 'replicate',
    'openrouter', 'huggingface',
  ];

  for (const provider of bearerProviders) {
    it(`sets Bearer token for ${provider}`, () => {
      const headers = buildHeaders(provider, {}, 'test-key');
      expect(headers['authorization']).toBe('Bearer test-key');
    });
  }

  it('strips fake session-key authorization header', () => {
    const headers = buildHeaders('openai', {
      'authorization': 'Bearer byk_fake_session_key',
      'content-type': 'application/json',
    }, 'sk-real-key');
    expect(headers['authorization']).toBe('Bearer sk-real-key');
    expect(headers['content-type']).toBe('application/json');
  });

  it('strips fake x-api-key header', () => {
    const headers = buildHeaders('anthropic', {
      'x-api-key': 'byk_fake_session_key',
    }, 'sk-ant-real');
    expect(headers['x-api-key']).toBe('sk-ant-real');
  });

  it('does not mutate the input headers object', () => {
    const input = { 'authorization': 'Bearer fake', 'content-type': 'application/json' };
    const frozen = { ...input };
    buildHeaders('openai', input, 'real-key');
    expect(input).toEqual(frozen);
  });
});

// ── parseModel ─────────────────────────────────────────

describe('parseModel', () => {
  it('extracts model from Anthropic request body', () => {
    const body = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages: [] });
    expect(parseModel(body)).toBe('claude-sonnet-4-20250514');
  });

  it('extracts model from OpenAI request body', () => {
    const body = JSON.stringify({ model: 'gpt-4o', messages: [] });
    expect(parseModel(body)).toBe('gpt-4o');
  });

  it('returns undefined for missing model', () => {
    const body = JSON.stringify({ messages: [] });
    expect(parseModel(body)).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseModel('not json')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(parseModel(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseModel('')).toBeUndefined();
  });
});

// ── extractUsageFromParsed ─────────────────────────────

describe('extractUsageFromParsed', () => {
  it('parses Anthropic usage', () => {
    const parsed = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      usage: { input_tokens: 42, output_tokens: 88 },
    };
    expect(extractUsageFromParsed('anthropic', parsed)).toEqual({
      inputTokens: 42,
      outputTokens: 88,
    });
  });

  it('parses Anthropic streaming message_delta usage', () => {
    const parsed = {
      type: 'message_delta',
      usage: { input_tokens: 0, output_tokens: 150 },
    };
    expect(extractUsageFromParsed('anthropic', parsed)).toEqual({
      inputTokens: 0,
      outputTokens: 150,
    });
  });

  it('parses Gemini usage', () => {
    const parsed = {
      candidates: [{ content: { parts: [{ text: 'Hi' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 25, totalTokenCount: 35 },
    };
    expect(extractUsageFromParsed('gemini', parsed)).toEqual({
      inputTokens: 10,
      outputTokens: 25,
    });
  });

  it('parses Gemini usage with missing candidatesTokenCount', () => {
    const parsed = {
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
    };
    expect(extractUsageFromParsed('gemini', parsed)).toEqual({
      inputTokens: 10,
      outputTokens: 0,
    });
  });

  it('parses OpenAI usage', () => {
    const parsed = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      choices: [{ message: { content: 'Hi' } }],
      usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
    };
    expect(extractUsageFromParsed('openai', parsed)).toEqual({
      inputTokens: 20,
      outputTokens: 30,
    });
  });

  const openaiCompatProviders = [
    'groq', 'together', 'deepseek', 'xai', 'perplexity',
    'fireworks', 'openrouter', 'mistral', 'azure_openai', 'cohere',
  ];

  for (const provider of openaiCompatProviders) {
    it(`parses ${provider} usage (OpenAI-compatible format)`, () => {
      const parsed = {
        usage: { prompt_tokens: 15, completion_tokens: 22, total_tokens: 37 },
      };
      expect(extractUsageFromParsed(provider, parsed)).toEqual({
        inputTokens: 15,
        outputTokens: 22,
      });
    });
  }

  it('parses Groq x_groq streaming usage', () => {
    const parsed = {
      x_groq: {
        id: 'req_123',
        usage: { prompt_tokens: 30, completion_tokens: 45, total_tokens: 75 },
      },
    };
    expect(extractUsageFromParsed('groq', parsed)).toEqual({
      inputTokens: 30,
      outputTokens: 45,
    });
  });

  it('returns undefined when no usage present', () => {
    expect(extractUsageFromParsed('openai', { choices: [] })).toBeUndefined();
  });

  it('returns undefined for Anthropic with partial usage', () => {
    expect(extractUsageFromParsed('anthropic', { usage: { input_tokens: 5 } })).toBeUndefined();
  });

  it('returns undefined for Gemini with no usageMetadata', () => {
    expect(extractUsageFromParsed('gemini', { candidates: [] })).toBeUndefined();
  });

  it('handles zero token values', () => {
    const parsed = { usage: { input_tokens: 0, output_tokens: 0 } };
    expect(extractUsageFromParsed('anthropic', parsed)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});

// ── parseUsage ─────────────────────────────────────────

describe('parseUsage', () => {
  it('parses Anthropic JSON response', () => {
    const body = JSON.stringify({
      id: 'msg_123',
      type: 'message',
      content: [{ type: 'text', text: 'Hello' }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    expect(parseUsage('anthropic', body)).toEqual({
      inputTokens: 100,
      outputTokens: 200,
    });
  });

  it('parses OpenAI JSON response', () => {
    const body = JSON.stringify({
      id: 'chatcmpl-123',
      choices: [{ message: { content: 'Hi' } }],
      usage: { prompt_tokens: 50, completion_tokens: 75, total_tokens: 125 },
    });
    expect(parseUsage('openai', body)).toEqual({
      inputTokens: 50,
      outputTokens: 75,
    });
  });

  it('parses Gemini JSON response', () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Howdy' }] } }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 12, totalTokenCount: 20 },
    });
    expect(parseUsage('gemini', body)).toEqual({
      inputTokens: 8,
      outputTokens: 12,
    });
  });

  it('parses Anthropic SSE streaming response', () => {
    const body = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":0}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"input_tokens":25,"output_tokens":42}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const usage = parseUsage('anthropic', body);
    expect(usage).toEqual({ inputTokens: 25, outputTokens: 42 });
  });

  it('parses OpenAI SSE streaming response with usage in last chunk', () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"choices":[{"delta":{"content":"!"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      'data: [DONE]',
      '',
    ].join('\n');
    const usage = parseUsage('openai', body);
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('skips [DONE] lines in SSE', () => {
    const body = [
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
      'data: [DONE]',
    ].join('\n');
    expect(parseUsage('openai', body)).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('returns undefined for invalid JSON body', () => {
    expect(parseUsage('anthropic', 'not-json')).toBeUndefined();
  });

  it('returns undefined for empty SSE stream', () => {
    expect(parseUsage('openai', 'data: [DONE]\n')).toBeUndefined();
  });

  it('returns undefined for SSE with no usage data', () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"choices":[{"delta":{"content":"!"}}]}',
      'data: [DONE]',
    ].join('\n');
    expect(parseUsage('openai', body)).toBeUndefined();
  });

  it('handles large token counts', () => {
    const body = JSON.stringify({
      usage: { input_tokens: 128000, output_tokens: 4096 },
    });
    expect(parseUsage('anthropic', body)).toEqual({
      inputTokens: 128000,
      outputTokens: 4096,
    });
  });
});

// ── injectStreamUsageOptions ──────────────────────────

describe('injectStreamUsageOptions', () => {
  it('injects stream_options for OpenAI streaming request', () => {
    const body = JSON.stringify({ model: 'gpt-4o', stream: true, messages: [] });
    const result = JSON.parse(injectStreamUsageOptions('openai', body)!);
    expect(result.stream_options).toEqual({ include_usage: true });
    expect(result.stream).toBe(true);
    expect(result.model).toBe('gpt-4o');
  });

  it('injects for azure_openai', () => {
    const body = JSON.stringify({ model: 'gpt-4', stream: true });
    const result = JSON.parse(injectStreamUsageOptions('azure_openai', body)!);
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it('injects for together', () => {
    const body = JSON.stringify({ stream: true });
    const result = JSON.parse(injectStreamUsageOptions('together', body)!);
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it('injects for deepseek', () => {
    const body = JSON.stringify({ stream: true });
    const result = JSON.parse(injectStreamUsageOptions('deepseek', body)!);
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it('does not inject for non-streaming request', () => {
    const body = JSON.stringify({ model: 'gpt-4o', messages: [] });
    expect(injectStreamUsageOptions('openai', body)).toBe(body);
  });

  it('does not inject for anthropic', () => {
    const body = JSON.stringify({ stream: true });
    expect(injectStreamUsageOptions('anthropic', body)).toBe(body);
  });

  it('does not inject for gemini', () => {
    const body = JSON.stringify({ stream: true });
    expect(injectStreamUsageOptions('gemini', body)).toBe(body);
  });

  it('preserves existing stream_options fields', () => {
    const body = JSON.stringify({ stream: true, stream_options: { custom: 'value' } });
    const result = JSON.parse(injectStreamUsageOptions('openai', body)!);
    expect(result.stream_options).toEqual({ custom: 'value', include_usage: true });
  });

  it('no-ops when include_usage already set', () => {
    const body = JSON.stringify({ stream: true, stream_options: { include_usage: true } });
    expect(injectStreamUsageOptions('openai', body)).toBe(body);
  });

  it('returns undefined for undefined body', () => {
    expect(injectStreamUsageOptions('openai', undefined)).toBeUndefined();
  });

  it('returns non-JSON body unchanged', () => {
    expect(injectStreamUsageOptions('openai', 'not-json')).toBe('not-json');
  });
});

// ── computeAllowanceCheck ──────────────────────────────

describe('computeAllowanceCheck', () => {
  const makeEntry = (providerId: string, input: number, output: number) => ({
    providerId,
    inputTokens: input,
    outputTokens: output,
  });

  it('allows when no allowance is set', () => {
    const result = computeAllowanceCheck(undefined, [], 'anthropic');
    expect(result).toEqual({ allowed: true });
  });

  it('allows when under total limit', () => {
    const allowance = { origin: 'https://app.com', totalLimit: 1000 };
    const entries = [makeEntry('anthropic', 100, 200)];
    expect(computeAllowanceCheck(allowance, entries, 'anthropic')).toEqual({ allowed: true });
  });

  it('blocks when at total limit', () => {
    const allowance = { origin: 'https://app.com', totalLimit: 300 };
    const entries = [makeEntry('anthropic', 100, 200)];
    const result = computeAllowanceCheck(allowance, entries, 'anthropic');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('https://app.com');
  });

  it('blocks when over total limit', () => {
    const allowance = { origin: 'https://app.com', totalLimit: 100 };
    const entries = [
      makeEntry('anthropic', 50, 50),
      makeEntry('openai', 30, 20),
    ];
    const result = computeAllowanceCheck(allowance, entries, 'anthropic');
    expect(result.allowed).toBe(false);
  });

  it('allows when under per-provider limit', () => {
    const allowance = {
      origin: 'https://app.com',
      providerLimits: { anthropic: 500 },
    };
    const entries = [makeEntry('anthropic', 100, 100)];
    expect(computeAllowanceCheck(allowance, entries, 'anthropic')).toEqual({ allowed: true });
  });

  it('blocks when at per-provider limit', () => {
    const allowance = {
      origin: 'https://app.com',
      providerLimits: { anthropic: 200 },
    };
    const entries = [makeEntry('anthropic', 100, 100)];
    const result = computeAllowanceCheck(allowance, entries, 'anthropic');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('anthropic');
  });

  it('per-provider limit only counts that provider', () => {
    const allowance = {
      origin: 'https://app.com',
      providerLimits: { anthropic: 500 },
    };
    const entries = [
      makeEntry('openai', 400, 400),
      makeEntry('anthropic', 100, 100),
    ];
    expect(computeAllowanceCheck(allowance, entries, 'anthropic')).toEqual({ allowed: true });
  });

  it('total limit counts all providers', () => {
    const allowance = { origin: 'https://app.com', totalLimit: 500 };
    const entries = [
      makeEntry('anthropic', 100, 100),
      makeEntry('openai', 200, 200),
    ];
    const result = computeAllowanceCheck(allowance, entries, 'anthropic');
    expect(result.allowed).toBe(false);
  });

  it('checks total limit before per-provider limit', () => {
    const allowance = {
      origin: 'https://app.com',
      totalLimit: 100,
      providerLimits: { anthropic: 50 },
    };
    const entries = [
      makeEntry('openai', 80, 30),
    ];
    const result = computeAllowanceCheck(allowance, entries, 'anthropic');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('https://app.com');
  });

  it('allows different provider when only one provider has limit', () => {
    const allowance = {
      origin: 'https://app.com',
      providerLimits: { anthropic: 100 },
    };
    const entries = [makeEntry('anthropic', 200, 200)];
    expect(computeAllowanceCheck(allowance, entries, 'openai')).toEqual({ allowed: true });
  });

  it('handles entries with undefined token counts', () => {
    const allowance = { origin: 'https://app.com', totalLimit: 100 };
    const entries = [
      { providerId: 'anthropic', inputTokens: undefined, outputTokens: undefined } as unknown as { providerId: string; inputTokens: number; outputTokens: number },
    ];
    expect(computeAllowanceCheck(allowance, entries, 'anthropic')).toEqual({ allowed: true });
  });

  it('handles empty entries list', () => {
    const allowance = { origin: 'https://app.com', totalLimit: 100 };
    expect(computeAllowanceCheck(allowance, [], 'anthropic')).toEqual({ allowed: true });
  });

  it('handles zero limits (blocks everything)', () => {
    const allowance = { origin: 'https://app.com', totalLimit: 0 };
    // 0 >= 0 is true, so even with no usage a zero limit blocks
    const result = computeAllowanceCheck(allowance, [], 'anthropic');
    expect(result.allowed).toBe(false);
  });

  it('accumulates across multiple entries for same provider', () => {
    const allowance = {
      origin: 'https://app.com',
      providerLimits: { anthropic: 100 },
    };
    const entries = [
      makeEntry('anthropic', 20, 20),
      makeEntry('anthropic', 25, 25),
      makeEntry('anthropic', 10, 10),
    ];
    // Total for anthropic: 110 >= 100
    const result = computeAllowanceCheck(allowance, entries, 'anthropic');
    expect(result.allowed).toBe(false);
  });
});

// ── detectRequestCapabilities ────────────────────────────

describe('detectRequestCapabilities', () => {
  it('returns all-false for an empty body', () => {
    expect(detectRequestCapabilities()).toEqual({ tools: false, vision: false, structuredOutput: false, reasoning: false });
    expect(detectRequestCapabilities(undefined)).toEqual({ tools: false, vision: false, structuredOutput: false, reasoning: false });
  });

  it('returns all-false for non-JSON bodies', () => {
    expect(detectRequestCapabilities('not json')).toEqual({ tools: false, vision: false, structuredOutput: false, reasoning: false });
  });

  it('flags tools when the body has a non-empty tools[]', () => {
    const body = JSON.stringify({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'get_weather', input_schema: {} }],
    });
    expect(detectRequestCapabilities(body).tools).toBe(true);
  });

  it('does not flag tools when tools[] is empty', () => {
    expect(detectRequestCapabilities(JSON.stringify({ tools: [] })).tools).toBe(false);
  });

  it('flags structuredOutput on response_format json_schema (not json_object)', () => {
    expect(detectRequestCapabilities(JSON.stringify({
      response_format: { type: 'json_schema' },
    })).structuredOutput).toBe(true);
    expect(detectRequestCapabilities(JSON.stringify({
      response_format: { type: 'json_object' },
    })).structuredOutput).toBe(false);
  });

  it('flags reasoning when the body has a thinking field', () => {
    expect(detectRequestCapabilities(JSON.stringify({ thinking: { type: 'enabled' } })).reasoning).toBe(true);
  });

  it('flags vision on Anthropic image content blocks', () => {
    const body = JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'whats this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'X' } },
          ],
        },
      ],
    });
    expect(detectRequestCapabilities(body).vision).toBe(true);
  });

  it('flags vision on OpenAI image_url content parts', () => {
    const body = JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'whats this' },
            { type: 'image_url', image_url: { url: 'https://x' } },
          ],
        },
      ],
    });
    expect(detectRequestCapabilities(body).vision).toBe(true);
  });
});

// ── rewriteToolNamesInJSONBody ───────────────────────────

describe('rewriteToolNamesInJSONBody', () => {
  it('returns the body unchanged when the map is empty', () => {
    const body = JSON.stringify({ content: [{ type: 'tool_use', name: 'GetWeather' }] });
    expect(rewriteToolNamesInJSONBody(body, {})).toBe(body);
  });

  it('rewrites tool_use block names according to the map', () => {
    const body = JSON.stringify({
      type: 'message',
      content: [
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 't1', name: 'GetWeather', input: { city: 'Tokyo' } },
        { type: 'tool_use', id: 't2', name: 'ConvertTemperature', input: {} },
      ],
    });
    const out = rewriteToolNamesInJSONBody(body, {
      GetWeather: 'get_weather',
      ConvertTemperature: 'convert_temperature',
    });
    const parsed = JSON.parse(out);
    expect(parsed.content[1].name).toBe('get_weather');
    expect(parsed.content[2].name).toBe('convert_temperature');
  });

  it('leaves other content blocks untouched', () => {
    const body = JSON.stringify({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', name: 'GetWeather', input: {} },
      ],
    });
    const out = rewriteToolNamesInJSONBody(body, { GetWeather: 'get_weather' });
    const parsed = JSON.parse(out);
    expect(parsed.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('returns the input unchanged when no tool_use names match the map', () => {
    const body = JSON.stringify({ content: [{ type: 'tool_use', name: 'Untouched' }] });
    expect(rewriteToolNamesInJSONBody(body, { GetWeather: 'get_weather' })).toBe(body);
  });

  it('returns the input unchanged on unparseable JSON', () => {
    expect(rewriteToolNamesInJSONBody('not json', { X: 'y' })).toBe('not json');
  });

  it('returns the input unchanged when content is not an array', () => {
    const body = JSON.stringify({ content: 'string content' });
    expect(rewriteToolNamesInJSONBody(body, { X: 'y' })).toBe(body);
  });
});
