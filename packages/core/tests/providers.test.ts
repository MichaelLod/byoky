import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, getProviderIds } from '../src/providers.js';

describe('PROVIDERS', () => {
  it('includes all supported providers', () => {
    const expected = [
      'anthropic', 'openai', 'gemini', 'mistral', 'cohere', 'xai',
      'deepseek', 'perplexity', 'groq', 'together', 'fireworks',
      'openrouter', 'azure_openai',
    ];
    for (const id of expected) {
      expect(PROVIDERS).toHaveProperty(id);
    }
  });

  it('does not include providers that cannot be translated', () => {
    // replicate and huggingface were removed because their inference APIs
    // are per-model and have no canonical chat shape. See TODO.md.
    expect(PROVIDERS).not.toHaveProperty('replicate');
    expect(PROVIDERS).not.toHaveProperty('huggingface');
  });

  it('anthropic supports api_key and oauth', () => {
    expect(PROVIDERS.anthropic.authMethods).toContain('api_key');
    expect(PROVIDERS.anthropic.authMethods).toContain('oauth');
  });

  it('openai supports api_key only', () => {
    expect(PROVIDERS.openai.authMethods).toEqual(['api_key']);
  });

  it('gemini supports api_key only', () => {
    expect(PROVIDERS.gemini.authMethods).toEqual(['api_key']);
    expect(PROVIDERS.gemini.oauthConfig).toBeUndefined();
  });

  it('all providers have required fields', () => {
    for (const provider of Object.values(PROVIDERS)) {
      expect(provider.id).toBeDefined();
      expect(provider.name).toBeDefined();
      expect(provider.baseUrl).toBeDefined();
      expect(provider.authMethods.length).toBeGreaterThan(0);
    }
  });

  it('anthropic supports setup token via oauth auth method', () => {
    expect(PROVIDERS.anthropic.authMethods).toContain('oauth');
  });

  it('provider base URLs are valid HTTPS', () => {
    for (const provider of Object.values(PROVIDERS)) {
      expect(provider.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it('api_key-only providers have no oauth', () => {
    const apiKeyOnly = [
      'mistral', 'cohere', 'xai', 'deepseek', 'perplexity',
      'groq', 'together', 'fireworks', 'openrouter', 'azure_openai',
    ];
    for (const id of apiKeyOnly) {
      expect(PROVIDERS[id].authMethods).toEqual(['api_key']);
    }
  });
});

describe('getProvider', () => {
  it('returns a provider by id', () => {
    const provider = getProvider('anthropic');
    expect(provider).toBeDefined();
    expect(provider!.name).toBe('Anthropic');
  });

  it('returns undefined for unknown provider', () => {
    expect(getProvider('nonexistent')).toBeUndefined();
  });
});

describe('getProviderIds', () => {
  it('returns all provider ids', () => {
    const ids = getProviderIds();
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('gemini');
    expect(ids).toContain('groq');
    expect(ids).toContain('deepseek');
    expect(ids).toContain('openrouter');
  });

  it('returns the correct count', () => {
    expect(getProviderIds().length).toBe(Object.keys(PROVIDERS).length);
  });
});
