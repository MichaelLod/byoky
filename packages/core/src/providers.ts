import type { ProviderConfig } from './types.js';

export const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    authMethods: ['api_key', 'oauth'],
    baseUrl: 'https://api.anthropic.com',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    authMethods: ['api_key'],
    baseUrl: 'https://api.openai.com',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    authMethods: ['api_key'],
    baseUrl: 'https://generativelanguage.googleapis.com',
  },
};

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS[id];
}

export function getProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}
