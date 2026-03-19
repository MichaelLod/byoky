/**
 * Byoky OpenClaw Provider Plugin
 *
 * Connects OpenClaw to the Byoky browser wallet for API key management.
 * Instead of pasting API keys into OpenClaw config files, users authenticate
 * through their Byoky wallet — keys are managed in one place.
 *
 * Flow:
 * 1. `openclaw models auth login --provider byoky`
 * 2. Plugin starts a local callback server and opens the browser
 * 3. User unlocks their Byoky wallet and approves the export
 * 4. The browser page connects via Byoky SDK and retrieves the key
 * 5. Key is sent back to the CLI via localhost callback
 * 6. Plugin stores the credential in OpenClaw's auth-profiles.json
 */

import { definePluginEntry } from 'openclaw/plugin-sdk/core';
import type {
  ProviderAuthContext,
  ProviderAuthResult,
} from 'openclaw/plugin-sdk/provider-auth';
import { createServer, type Server } from 'node:http';

interface ByokyProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
}

const PROVIDERS: ByokyProvider[] = [
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'openai-completions' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions' },
  { id: 'cohere', name: 'Cohere', baseUrl: 'https://api.cohere.com/v2', api: 'openai-completions' },
  { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', api: 'openai-completions' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions' },
  { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', api: 'openai-completions' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', api: 'openai-completions' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
];

export default definePluginEntry({
  id: 'byoky',
  name: 'Byoky Wallet',
  description:
    'Manage AI API keys from your Byoky browser wallet — one wallet for all providers',

  register(api) {
    // Register a single "byoky" meta-provider for the auth flow
    api.registerProvider({
      id: 'byoky',
      label: 'Byoky Wallet',
      docsPath: '/providers/byoky',
      envVars: ['BYOKY_SESSION'],
      auth: [
        {
          id: 'browser',
          label: 'Byoky Wallet (browser)',
          hint: 'Opens browser to export keys from your Byoky wallet',
          kind: 'custom' as const,
          wizard: {
            choiceId: 'byoky',
            choiceLabel: 'Byoky Wallet',
            choiceHint: 'Export API keys from your browser wallet',
            groupId: 'byoky',
            groupLabel: 'Byoky Wallet',
            groupHint: 'Manage all AI keys from one place',
          },
          run: runByokyAuth,
        },
      ],
      catalog: {
        order: 'simple' as const,
        run: async () => null,
      },
    });

    // Register each provider that Byoky supports as a routable provider
    for (const provider of PROVIDERS) {
      const openclawId = `byoky-${provider.id}`;

      api.registerProvider({
        id: openclawId,
        label: `${provider.name} (via Byoky)`,
        docsPath: '/providers/byoky',
        envVars: [`BYOKY_${provider.id.toUpperCase()}_KEY`],
        auth: [
          {
            id: 'browser',
            label: `${provider.name} (via Byoky)`,
            hint: 'Opens browser to export key from Byoky wallet',
            kind: 'custom' as const,
            wizard: {
              choiceId: openclawId,
              choiceLabel: `${provider.name} (via Byoky)`,
              choiceHint: 'Export from Byoky wallet',
              groupId: 'byoky',
              groupLabel: 'Byoky Wallet',
              groupHint: 'Manage all AI keys from one place',
            },
            run: (ctx: ProviderAuthContext) =>
              runSingleProviderAuth(ctx, provider),
          },
        ],
        catalog: {
          order: 'simple' as const,
          run: async (ctx) => {
            const auth = ctx.resolveProviderAuth(openclawId, {});
            if (!auth?.apiKey) return null;

            return {
              provider: {
                baseUrl: provider.baseUrl,
                api: provider.api,
                apiKey: auth.apiKey,
                models: [],
              },
            };
          },
        },
        formatApiKey: (profile) => {
          if (profile?.credential?.type === 'api_key') {
            return (profile.credential as { key: string }).key;
          }
          return undefined;
        },
      });
    }
  },
});

// --- Auth flow: export all available keys from Byoky ---

async function runByokyAuth(
  ctx: ProviderAuthContext,
): Promise<ProviderAuthResult> {
  ctx.prompter.note(
    'Opening your browser to connect the Byoky wallet.\n' +
      'Unlock your wallet and select which keys to export.',
  );

  const { credentials, server } = await startCallbackServer(ctx, 'all');

  try {
    if (!credentials || credentials.length === 0) {
      throw new Error('No credentials received from Byoky wallet');
    }

    const profiles = credentials.map(
      (cred: { providerId: string; apiKey: string }) => ({
        profileId: `byoky-${cred.providerId}:byoky`,
        credential: {
          type: 'api_key' as const,
          provider: `byoky-${cred.providerId}`,
          key: cred.apiKey,
        },
      }),
    );

    const providerNames = credentials
      .map((c: { providerId: string }) => c.providerId)
      .join(', ');

    return {
      profiles,
      defaultModel: undefined,
      configPatch: {},
      notes: [
        `Connected ${credentials.length} provider(s) via Byoky: ${providerNames}`,
        'Keys are stored locally in your OpenClaw auth profiles.',
        'To update, re-run: openclaw models auth login --provider byoky',
      ],
    };
  } finally {
    server.close();
  }
}

// --- Auth flow: export a single provider key ---

async function runSingleProviderAuth(
  ctx: ProviderAuthContext,
  provider: ByokyProvider,
): Promise<ProviderAuthResult> {
  ctx.prompter.note(
    `Opening your browser to export your ${provider.name} key from Byoky.`,
  );

  const { credentials, server } = await startCallbackServer(
    ctx,
    provider.id,
  );

  try {
    const cred = credentials?.[0];
    if (!cred?.apiKey) {
      throw new Error(`No ${provider.name} key received from Byoky wallet`);
    }

    return {
      profiles: [
        {
          profileId: `byoky-${provider.id}:byoky`,
          credential: {
            type: 'api_key' as const,
            provider: `byoky-${provider.id}`,
            key: cred.apiKey,
          },
        },
      ],
      defaultModel: undefined,
      configPatch: {},
      notes: [
        `Connected ${provider.name} via Byoky wallet.`,
        'To update, re-run: openclaw models auth login --provider byoky-' +
          provider.id,
      ],
    };
  } finally {
    server.close();
  }
}

// --- Local callback server ---

interface ExportedCredential {
  providerId: string;
  apiKey: string;
}

async function startCallbackServer(
  ctx: ProviderAuthContext,
  requestProviders: string,
): Promise<{ credentials: ExportedCredential[] | null; server: Server }> {
  return new Promise((resolve) => {
    let credentials: ExportedCredential[] | null = null;

    const server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/callback') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            credentials = data.credentials || null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            resolve({ credentials, server });
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
        return;
      }

      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(buildAuthPage(requestProviders));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        ctx.openUrl(`http://127.0.0.1:${addr.port}`);
      }
    });

    setTimeout(() => {
      if (!credentials) resolve({ credentials: null, server });
    }, 120_000);
  });
}

// --- Auth page served to the browser ---

function buildAuthPage(requestProviders: string): string {
  const providerFilter =
    requestProviders === 'all'
      ? '[]'
      : `[{ id: '${requestProviders}', required: true }]`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Byoky — Export to OpenClaw</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, system-ui, sans-serif;
      background: #0a0a18; color: #f5f5f7;
      min-height: 100vh; display: flex;
      align-items: center; justify-content: center;
    }
    .card {
      background: #1c1c22; border-radius: 16px;
      padding: 40px; max-width: 440px; width: 100%; text-align: center;
    }
    h1 {
      font-size: 24px; font-weight: 700;
      background: linear-gradient(135deg, #fef3c7, #f59e0b);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .subtitle { color: #8e8e9a; font-size: 14px; margin-bottom: 24px; }
    .status {
      padding: 16px; border-radius: 8px;
      margin-bottom: 16px; font-size: 14px; line-height: 1.6;
    }
    .waiting { background: rgba(245,158,11,0.1); color: #fcd34d; }
    .success { background: rgba(52,211,153,0.1); color: #34d399; }
    .error { background: rgba(244,63,94,0.1); color: #f43f5e; }
    .info { color: #55555f; font-size: 12px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Byoky</h1>
    <p class="subtitle">Export keys to OpenClaw</p>
    <div id="status" class="status waiting">
      Connecting to Byoky wallet...
    </div>
    <p class="info">
      Your Byoky extension must be installed and unlocked.<br />
      Keys are sent to OpenClaw on your local machine only.
    </p>
  </div>
  <script>
    (async () => {
      const status = document.getElementById('status');
      try {
        // Connect to Byoky wallet via SDK protocol
        const requestId = crypto.randomUUID();
        window.postMessage({
          type: 'BYOKY_CONNECT_REQUEST',
          id: requestId,
          payload: { providers: ${providerFilter} },
        }, '*');

        const response = await new Promise((resolve, reject) => {
          function handler(event) {
            const msg = event instanceof CustomEvent ? event.detail : event.data;
            if (!msg || msg.requestId !== requestId) return;
            document.removeEventListener('byoky-message', handler);
            window.removeEventListener('message', handler);
            if (msg.type === 'BYOKY_CONNECT_RESPONSE') resolve(msg.payload);
            else reject(new Error(msg.payload?.message || 'Connection failed'));
          }
          document.addEventListener('byoky-message', handler);
          window.addEventListener('message', handler);
          setTimeout(() => reject(new Error('Timeout — is Byoky installed and unlocked?')), 30000);
        });

        // Extract available providers and their session keys
        const providers = response.providers || {};
        const available = Object.entries(providers)
          .filter(([, v]) => v.available)
          .map(([id]) => id);

        if (available.length === 0) {
          throw new Error('No matching providers found in your Byoky wallet');
        }

        // For each provider, we pass the session info back
        // The proxy approach: session key acts as the credential
        const credentials = available.map(id => ({
          providerId: id,
          apiKey: response.sessionKey,
        }));

        status.textContent = 'Connected! Exporting ' + available.length + ' provider(s): ' + available.join(', ');
        status.className = 'status success';

        await fetch('/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials }),
        });

        setTimeout(() => { status.textContent = 'Done — you can close this tab.'; }, 1500);
      } catch (err) {
        status.textContent = 'Error: ' + err.message;
        status.className = 'status error';
      }
    })();
  </script>
</body>
</html>`;
}
