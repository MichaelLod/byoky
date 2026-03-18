import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, getProviderIds } from '../src/providers.js';

describe('PROVIDERS', () => {
  it('includes anthropic, openai, and gemini', () => {
    expect(PROVIDERS).toHaveProperty('anthropic');
    expect(PROVIDERS).toHaveProperty('openai');
    expect(PROVIDERS).toHaveProperty('gemini');
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
  });

  it('all providers have required fields', () => {
    for (const provider of Object.values(PROVIDERS)) {
      expect(provider.id).toBeDefined();
      expect(provider.name).toBeDefined();
      expect(provider.baseUrl).toBeDefined();
      expect(provider.authMethods.length).toBeGreaterThan(0);
    }
  });

  it('anthropic has oauth config', () => {
    expect(PROVIDERS.anthropic.oauthConfig).toBeDefined();
    expect(PROVIDERS.anthropic.oauthConfig!.authorizationUrl).toContain(
      'anthropic.com',
    );
    expect(PROVIDERS.anthropic.oauthConfig!.tokenUrl).toContain(
      'anthropic.com',
    );
  });

  it('provider base URLs are valid HTTPS', () => {
    for (const provider of Object.values(PROVIDERS)) {
      expect(provider.baseUrl).toMatch(/^https:\/\//);
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
  });

  it('returns the correct count', () => {
    expect(getProviderIds().length).toBe(Object.keys(PROVIDERS).length);
  });
});
