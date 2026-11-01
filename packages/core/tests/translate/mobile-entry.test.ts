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
});

describe('mobile bridge translateErrorResponse', () => {
  const b = bridge as unknown as Bridge & { translateErrorResponse(ctxJson: string, body: string): string | null };

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

  it('returns null for a non-JSON body', () => {
    const ctxJson = b.buildTranslationContext('anthropic', 'openai', 'claude-sonnet-4-6', 'gpt-5.5', false, 'r1');
    expect(b.translateErrorResponse(ctxJson, '<html>502</html>')).toBeNull();
  });
});
