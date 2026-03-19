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
    authMethods: ['api_key', 'oauth'],
    baseUrl: 'https://generativelanguage.googleapis.com',
    oauthConfig: {
      clientId: '', // Register at console.cloud.google.com → APIs & Services → Credentials
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/generative-language'],
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    },
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    authMethods: ['api_key'],
    baseUrl: 'https://api.mistral.ai',
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    authMethods: ['api_key'],
    baseUrl: 'https://api.cohere.com',
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    authMethods: ['api_key'],
    baseUrl: 'https://api.x.ai',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    authMethods: ['api_key'],
    baseUrl: 'https://api.deepseek.com',
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    authMethods: ['api_key'],
    baseUrl: 'https://api.perplexity.ai',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    authMethods: ['api_key'],
    baseUrl: 'https://api.groq.com',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    authMethods: ['api_key'],
    baseUrl: 'https://api.together.xyz',
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    authMethods: ['api_key'],
    baseUrl: 'https://api.fireworks.ai',
  },
  replicate: {
    id: 'replicate',
    name: 'Replicate',
    authMethods: ['api_key'],
    baseUrl: 'https://api.replicate.com',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    authMethods: ['api_key'],
    baseUrl: 'https://openrouter.ai/api',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    authMethods: ['api_key', 'oauth'],
    baseUrl: 'https://api-inference.huggingface.co',
    oauthConfig: {
      clientId: '', // Register at huggingface.co/settings/connected-applications
      authorizationUrl: 'https://huggingface.co/oauth/authorize',
      tokenUrl: 'https://huggingface.co/oauth/token',
      scopes: ['inference-api'],
    },
  },
  azure_openai: {
    id: 'azure_openai',
    name: 'Azure OpenAI',
    authMethods: ['api_key'],
    baseUrl: 'https://YOUR_RESOURCE.openai.azure.com',
  },
};

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS[id];
}

export function getProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}
