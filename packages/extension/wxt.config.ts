import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'byoky',
    description: 'Bring Your Own Key — Secure wallet for your AI credentials',
    permissions: ['storage'],
    host_permissions: [
      'https://api.anthropic.com/*',
      'https://api.openai.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://console.anthropic.com/*',
    ],
  },
});
