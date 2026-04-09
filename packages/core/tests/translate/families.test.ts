import { describe, it, expect } from 'vitest';
import {
  familyOf,
  shouldTranslate,
  canonicalChatEndpoint,
  isChatCompletionsEndpoint,
  rewriteProxyUrl,
} from '../../src/translate/families.js';

describe('familyOf', () => {
  it('classifies anthropic in the anthropic family', () => {
    expect(familyOf('anthropic')).toBe('anthropic');
  });

  it('classifies all openai-compatible providers in the openai family', () => {
    for (const id of ['openai', 'azure_openai', 'groq', 'together', 'deepseek', 'xai', 'perplexity', 'fireworks', 'openrouter', 'mistral']) {
      expect(familyOf(id)).toBe('openai');
    }
  });

  it('returns null for providers outside known families', () => {
    expect(familyOf('gemini')).toBeNull();
    expect(familyOf('cohere')).toBeNull();
    expect(familyOf('not-a-real-provider')).toBeNull();
  });
});

describe('shouldTranslate', () => {
  it('is false for same-family pairs', () => {
    expect(shouldTranslate('anthropic', 'anthropic')).toBe(false);
    expect(shouldTranslate('openai', 'groq')).toBe(false);
    expect(shouldTranslate('openai', 'together')).toBe(false);
  });

  it('is true for cross-family pairs in the supported set', () => {
    expect(shouldTranslate('anthropic', 'openai')).toBe(true);
    expect(shouldTranslate('openai', 'anthropic')).toBe(true);
    expect(shouldTranslate('anthropic', 'groq')).toBe(true);
    expect(shouldTranslate('deepseek', 'anthropic')).toBe(true);
  });

  it('is false when either side is outside the supported families', () => {
    expect(shouldTranslate('anthropic', 'gemini')).toBe(false);
    expect(shouldTranslate('gemini', 'openai')).toBe(false);
    expect(shouldTranslate('cohere', 'gemini')).toBe(false);
  });
});

describe('canonicalChatEndpoint', () => {
  it('returns the Anthropic Messages path', () => {
    expect(canonicalChatEndpoint('anthropic')).toBe('/v1/messages');
  });

  it('returns the OpenAI Chat Completions path', () => {
    expect(canonicalChatEndpoint('openai')).toBe('/v1/chat/completions');
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
    expect(rewriteProxyUrl('anthropic')).toBe('https://api.anthropic.com/v1/messages');
    expect(rewriteProxyUrl('openai')).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('returns null for unknown providers', () => {
    expect(rewriteProxyUrl('not-a-provider')).toBeNull();
  });

  it('returns null for providers outside known families', () => {
    expect(rewriteProxyUrl('gemini')).toBeNull();
  });
});
