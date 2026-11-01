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
