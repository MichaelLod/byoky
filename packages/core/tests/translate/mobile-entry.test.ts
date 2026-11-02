import { describe, it, expect } from 'vitest';
import '../../src/translate/mobile-entry.js';

/**
 * The mobile bundle's string-in / string-out bridge, loaded from source.
 * (url-fallback.test.ts runs the shipped bundle in a bare V8 context.)
 */
interface Bridge {
  buildTranslationContext(
    srcProviderId: string,
    dstProviderId: string,
    srcModel: string,
    dstModel: string,
    isStreaming: boolean,
    requestId: string,
  ): string;
  translateRequest(ctxJson: string, body: string): string;
}

const bridge = (globalThis as unknown as { BYOKY_TRANSLATE: Bridge }).BYOKY_TRANSLATE;

describe('mobile bridge buildTranslationContext', () => {
  it('carries the destination provider id', () => {
    const ctx = JSON.parse(
      bridge.buildTranslationContext('anthropic', 'groq', 'claude-sonnet-4-6', 'llama-3.3-70b-versatile', false, 'r1'),
    ) as Record<string, unknown>;
    expect(ctx).toMatchObject({ srcFamily: 'anthropic', dstFamily: 'openai', dstProviderId: 'groq' });
  });

  it('lets the OpenAI serializer pick max_completion_tokens for OpenAI only', () => {
    const body = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 256, messages: [{ role: 'user', content: 'hi' }] });
    const toOpenAI = JSON.parse(
      bridge.translateRequest(bridge.buildTranslationContext('anthropic', 'openai', 'claude-sonnet-4-6', 'gpt-4.1', false, 'r1'), body),
    ) as Record<string, unknown>;
    expect(toOpenAI.max_completion_tokens).toBe(256);
    const toGroq = JSON.parse(
      bridge.translateRequest(
        bridge.buildTranslationContext('anthropic', 'groq', 'claude-sonnet-4-6', 'llama-3.3-70b-versatile', false, 'r1'),
        body,
      ),
    ) as Record<string, unknown>;
    expect(toGroq.max_tokens).toBe(256);
  });

  it('treats an empty source model as none, so the reply names the destination\'s model', () => {
    // The native resolvers route a request that names no model (F041) and
    // pass '' for it; the extension passes undefined.
    const ctxJson = bridge.buildTranslationContext('openai', 'anthropic', '', 'claude-sonnet-4-6', false, 'r1');
    expect((JSON.parse(ctxJson) as Record<string, unknown>).srcModel).toBeUndefined();
    const reply = JSON.parse(
      (bridge as unknown as { translateResponse(ctxJson: string, body: string): string }).translateResponse(
        ctxJson,
        JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
    ) as Record<string, unknown>;
    expect(reply.model).toBe('claude-sonnet-4-6');
  });
});

describe('mobile bridge translateErrorResponse', () => {
  const b = bridge as unknown as Bridge & { translateErrorResponse(ctxJson: string, body: string, status?: number): string | null };

  it('translates an OpenAI 401 for an Anthropic app', () => {
    const ctxJson = b.buildTranslationContext('anthropic', 'openai', 'claude-sonnet-4-6', 'gpt-5.5', false, 'r1');
    const out = b.translateErrorResponse(
      ctxJson,
      JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }),
    );
    expect(JSON.parse(out!)).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Incorrect API key provided' },
    });
  });

  it('gives the error the app dialect\'s type for the HTTP status the native side passes', () => {
    const ctxJson = b.buildTranslationContext('anthropic', 'gemini', 'claude-sonnet-4-6', 'gemini-3.8-flash', false, 'r1');
    const out = b.translateErrorResponse(
      ctxJson,
      JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' } }),
      429,
    );
    expect(JSON.parse(out!)).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'Resource has been exhausted' } });
    const openai = b.buildTranslationContext('anthropic', 'openai', 'claude-sonnet-4-6', 'gpt-5.5', false, 'r1');
    const badKey = JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } });
    expect(JSON.parse(b.translateErrorResponse(openai, badKey, 401)!).error.type).toBe('authentication_error');
  });

  it('returns null for a non-JSON body', () => {
    const ctxJson = b.buildTranslationContext('anthropic', 'openai', 'claude-sonnet-4-6', 'gpt-5.5', false, 'r1');
    expect(b.translateErrorResponse(ctxJson, '<html>502</html>')).toBeNull();
  });
});

describe('mobile bridge rewriteRequestModel', () => {
  const b = bridge as unknown as Bridge & { rewriteRequestModel(dstProviderId: string, url: string, body: string, model: string): string };
  const url = 'https://api.openai.com/v1/chat/completions';

  it('returns the body fitted to the pinned model', () => {
    const out = JSON.parse(b.rewriteRequestModel('openai', url, JSON.stringify({ model: 'gpt-4.1', max_tokens: 64, temperature: 0.5, messages: [] }), 'gpt-5.5')) as { body: string };
    expect(JSON.parse(out.body)).toEqual({ model: 'gpt-5.5', max_completion_tokens: 64, messages: [] });
  });

  it('returns a request the model can\'t serve as an error for the app', () => {
    const body = JSON.stringify({ model: 'gpt-5.5', messages: [], tools: [{ type: 'function', function: { name: 'f' } }] });
    const out = JSON.parse(b.rewriteRequestModel('openai', url, body, 'gpt-6-astra')) as { error: { code: string; message: string } };
    expect(out.error.code).toBe('UNSUPPORTED_FEATURE');
    expect(out.error.message).toContain('gpt-6-astra');
  });
});
