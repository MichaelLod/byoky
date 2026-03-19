import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Byoky',
    description: 'Bring Your Own Key — Secure wallet for your AI credentials',
    permissions: ['storage', 'sidePanel', 'identity'],
    host_permissions: [
      'https://api.anthropic.com/*',
      'https://api.openai.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://console.anthropic.com/*',
      'https://api-inference.huggingface.co/*',
      'https://huggingface.co/oauth/*',
      'https://oauth2.googleapis.com/*',
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
