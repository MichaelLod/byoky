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
    // Pin the extension ID for unpacked / sideloaded builds so the Byoky
    // Bridge's native-messaging `allowed_origins` can whitelist a stable ID.
    // Chrome Web Store ignores this when signing the published extension, so
    // the Web Store ID (igjohldpldlahcjmefdhlnbcpldlgmon) is unaffected.
    // Derived ID: ojbcjlaehdajgaifoonomninjhhchfkf.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1n3eqKldDp0wukl8t9fVQiKZ9J1jtwcww0isKDymSOUNDBvt3ppeuRV6+8eFQ0IfKRBnqP50BHxKG7tQSAyFbNXSzFUPA6DSeFM4JVnynF6TL6FVFEPbnoGoEJp0m8T7FQMIbXKU5zTjjgeBQPffpwshOyrO3G+NcoIqSqIR/6sTRNFcOsfxaBheQf7zYAVuDTcMuOUHw4rI7FXv59Z+EwmszfUZYN/okDBtRrmsjOArNMSmr33Z9JDcGfMVnf0Iv96mbJmCQ+TPvDmV7Y7Ur/CA4M17BY/3r6sV7Th0GwCgm0sLmrfEJg6PQLPthlpQkyk1p2lOXA5iHFRoFKkZKwIDAQAB',
    permissions: ['storage', 'sidePanel', 'identity', 'nativeMessaging', 'alarms'],
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
