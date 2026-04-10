import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  transformManifest(manifest) {
    // Safari iOS requires persistent: false for MV2 background scripts
    if (manifest.background && 'scripts' in manifest.background) {
      (manifest.background as Record<string, unknown>).persistent = false;
    }
    // Firefox: remove default_popup so icon click fires onClicked → opens sidebar
    const m = manifest as unknown as Record<string, unknown>;
    if (m.sidebar_action) {
      const action = m.browser_action as Record<string, unknown> | undefined;
      if (action) {
        delete action.default_popup;
      }
    }
  },
  manifest: {
    name: 'Byoky',
    description: 'Encrypt your AI API keys locally. Never trust another extension with your OpenAI, Anthropic, or Gemini keys.',
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
      'https://openrouter.ai/*',
      'https://*.openai.azure.com/*',
      // OAuth endpoints (narrowed to token exchange paths)
      'https://console.anthropic.com/v1/oauth/*',
      'https://oauth2.googleapis.com/token',
    ],
    browser_specific_settings: {
      gecko: {
        id: 'byoky@byoky.com',
        strict_min_version: '109.0',
        data_collection_permissions: {
          required: ['none'],
          optional: [],
        },
      } as Record<string, unknown>,
    },
  },
});
