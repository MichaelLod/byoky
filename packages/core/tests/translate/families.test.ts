import { describe, it, expect } from 'vitest';
// Importing from the public surface (index.ts) ensures adapter registration
// has run, which shouldTranslate / rewriteProxyUrl depend on.
import {
  familyOf,
  shouldTranslate,
  sameFamily,
  isChatCompletionsEndpoint,
  rewriteProxyUrl,
} from '../../src/translate/index.js';

describe('familyOf', () => {
  it('classifies anthropic in the anthropic family', () => {
    expect(familyOf('anthropic')).toBe('anthropic');
  });

  it('classifies all openai-compatible providers in the openai family', () => {
    for (const id of ['openai', 'azure_openai', 'groq', 'together', 'deepseek', 'xai', 'perplexity', 'fireworks', 'openrouter', 'mistral']) {
      expect(familyOf(id)).toBe('openai');
    }
  });

  it('classifies gemini in the gemini family', () => {
    expect(familyOf('gemini')).toBe('gemini');
  });

  it('classifies cohere in the cohere family', () => {
    expect(familyOf('cohere')).toBe('cohere');
  });

  it('returns null for providers outside any known family', () => {
    expect(familyOf('not-a-real-provider')).toBeNull();
  });
});

describe('shouldTranslate', () => {
  it('is false for same-family pairs', () => {
    expect(shouldTranslate('anthropic', 'anthropic')).toBe(false);
    expect(shouldTranslate('openai', 'groq')).toBe(false);
    expect(shouldTranslate('openai', 'together')).toBe(false);
  });

  it('is true for every cross-family pair among the registered families', () => {
    // Ordering pairs: only runs the pairs whose both families have adapters.
    // In this test file only anthropic + openai are imported by the core
    // registration — gemini / cohere adapters are imported by their own tests.
    expect(shouldTranslate('anthropic', 'openai')).toBe(true);
    expect(shouldTranslate('openai', 'anthropic')).toBe(true);
    expect(shouldTranslate('anthropic', 'groq')).toBe(true);
    expect(shouldTranslate('deepseek', 'anthropic')).toBe(true);
  });

  it('is false for unknown providers', () => {
    expect(shouldTranslate('not-real', 'openai')).toBe(false);
    expect(shouldTranslate('openai', 'not-real')).toBe(false);
  });
});

describe('sameFamily', () => {
  it('is true for two providers within the openai family', () => {
    expect(sameFamily('openai', 'groq')).toBe(true);
    expect(sameFamily('groq', 'deepseek')).toBe(true);
    expect(sameFamily('xai', 'openai')).toBe(true);
  });

  it('is true for a provider compared against itself', () => {
    expect(sameFamily('anthropic', 'anthropic')).toBe(true);
    expect(sameFamily('openai', 'openai')).toBe(true);
  });

  it('is false for cross-family pairs', () => {
    expect(sameFamily('anthropic', 'openai')).toBe(false);
    expect(sameFamily('groq', 'anthropic')).toBe(false);
    expect(sameFamily('gemini', 'cohere')).toBe(false);
  });

  it('is false when either provider is unknown', () => {
    expect(sameFamily('not-real', 'openai')).toBe(false);
    expect(sameFamily('openai', 'not-real')).toBe(false);
  });
});

describe('isChatCompletionsEndpoint', () => {
  it('matches the canonical Anthropic path', () => {
    expect(isChatCompletionsEndpoint('anthropic', 'https://api.anthropic.com/v1/messages')).toBe(true);
  });

  it('matches the canonical OpenAI path', () => {
    expect(isChatCompletionsEndpoint('openai', 'https://api.openai.com/v1/chat/completions')).toBe(true);
  });

  it('rejects unrelated paths', () => {
    expect(isChatCompletionsEndpoint('anthropic', 'https://api.anthropic.com/v1/embeddings')).toBe(false);
    expect(isChatCompletionsEndpoint('openai', 'https://api.openai.com/v1/audio/transcriptions')).toBe(false);
  });

  it('rejects malformed URLs without throwing', () => {
    expect(isChatCompletionsEndpoint('openai', 'not a url')).toBe(false);
  });
});

describe('rewriteProxyUrl', () => {
  it('produces the destination provider canonical chat URL', () => {
    expect(rewriteProxyUrl('anthropic', 'claude-sonnet-4-6', false))
      .toBe('https://api.anthropic.com/v1/messages');
    expect(rewriteProxyUrl('openai', 'gpt-4o', false))
      .toBe('https://api.openai.com/v1/chat/completions');
  });

  it('honors chatPath overrides for openai-family providers with non-default paths', () => {
    expect(rewriteProxyUrl('groq', 'llama-3.3-70b-versatile', false))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(rewriteProxyUrl('fireworks', 'any-model', false))
      .toBe('https://api.fireworks.ai/inference/v1/chat/completions');
    expect(rewriteProxyUrl('perplexity', 'sonar', false))
      .toBe('https://api.perplexity.ai/chat/completions');
    expect(rewriteProxyUrl('deepseek', 'deepseek-chat', false))
      .toBe('https://api.deepseek.com/chat/completions');
  });

  it('returns null for unknown providers', () => {
    expect(rewriteProxyUrl('not-a-provider', 'any-model', false)).toBeNull();
  });
});
