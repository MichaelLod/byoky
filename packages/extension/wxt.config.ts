import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Byoky',
    description: 'Bring Your Own Key — Secure wallet for your AI credentials',
    permissions: ['storage', 'sidePanel', 'identity', 'nativeMessaging'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    host_permissions: [
      // Provider API hosts
      'https://api.anthropic.com/*',
      'https://api.openai.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.mistral.ai/*',
      'https://api.cohere.com/*',
      'https://api.x.ai/*',
      'https://api.deepseek.com/*',
      'https://api.perplexity.ai/*',
      'https://api.groq.com/*',
      'https://api.together.xyz/*',
      'https://api.fireworks.ai/*',
      'https://api.replicate.com/*',
      'https://openrouter.ai/*',
      'https://api-inference.huggingface.co/*',
      'https://*.openai.azure.com/*',
      // OAuth endpoints (narrowed to token exchange paths)
      'https://console.anthropic.com/v1/oauth/*',
      'https://oauth2.googleapis.com/token',
      'https://huggingface.co/oauth/token',
    ],
    browser_specific_settings: {
      gecko: {
        id: 'byoky@byoky.com',
        strict_min_version: '109.0',
        data_collection_permissions: {
          required: ['none'],
          optional: [],
        },
      },
    },
  },
});
