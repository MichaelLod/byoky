import { defineConfig } from 'wxt';

/**
 * The manifest changes that depend on the browser it is built for, which
 * transformManifest can't tell apart.
 *
 * Safari's background page is non-persistent: Safari on iOS requires it.
 * Firefox keeps the MV2 default, a persistent page: an event page is
 * suspended 30 s after its last event, and the long requests and pending
 * connects it holds would go with it.
 *
 * The side panel permission and the key (the unpacked extension's ID) are
 * Chrome's; Firefox warns about both on every load.
 */
export function adjustManifestForBrowser(
  browser: string,
  manifest: { background?: object; permissions?: unknown[]; key?: string },
): void {
  if (browser === 'safari' && manifest.background && 'scripts' in manifest.background) {
    (manifest.background as Record<string, unknown>).persistent = false;
  }
  if (browser === 'firefox' || browser === 'safari') {
    manifest.permissions = manifest.permissions?.filter((p) => p !== 'sidePanel');
    delete manifest.key;
  }
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => adjustManifestForBrowser(wxt.config.browser, manifest),
  },
  transformManifest(manifest) {
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
    // App Store validation rejects Safari extensions whose description is over
    // 112 characters (Chrome Web Store allows 132). tests/manifest.test.ts checks it.
    // No other brand names here: stores block crypto-wallet impersonation.
    description: 'Keep your AI API keys in one encrypted wallet. Apps connect to it and never see the key.',
    // Pin the extension ID for unpacked / sideloaded builds so the Byoky
    // Bridge's native-messaging `allowed_origins` can whitelist a stable ID.
    // Chrome Web Store ignores this when signing the published extension, so
    // the Web Store ID (igjohldpldlahcjmefdhlnbcpldlgmon) is unaffected.
    // Derived ID: idlmdfkobnkdakcpiihighchdbbmbpep.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1n3eqKldDp0wukl8t9fVQiKZ9J1jtwcww0isKDymSOUNDBvt3ppeuRV6+8eFQ0IfKRBnqP50BHxKG7tQSAyFbNXSzFUPA6DSeFM4JVnynF6TL6FVFEPbnoGoEJp0m8T7FQMIbXKU5zTjjgeBQPffpwshOyrO3G+NcoIqSqIR/6sTRNFcOsfxaBheQf7zYAVuDTcMuOUHw4rI7FXv59Z+EwmszfUZYN/okDBtRrmsjOArNMSmr33Z9JDcGfMVnf0Iv96mbJmCQ+TPvDmV7Y7Ur/CA4M17BY/3r6sV7Th0GwCgm0sLmrfEJg6PQLPthlpQkyk1p2lOXA5iHFRoFKkZKwIDAQAB',
    permissions: ['storage', 'sidePanel', 'nativeMessaging', 'alarms'],
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
    ],
    browser_specific_settings: {
      gecko: {
        id: 'byoky@byoky.com',
        // provider.content.ts runs in the page's world (world: 'MAIN'), which
        // is how apps detect Byoky; Firefox has it from 128 (and
        // storage.session, which keeps the unlock lockout, from 115).
        // tests/manifest.test.ts checks it.
        strict_min_version: '128.0',
        data_collection_permissions: {
          required: ['none'],
          optional: [],
        },
      } as Record<string, unknown>,
    },
  },
});
