/**
 * Byoky OpenClaw Provider Plugin
 *
 * Connects OpenClaw to the Byoky browser wallet via the Bridge HTTP proxy.
 * Keys NEVER leave the browser extension — the bridge is a dumb relay.
 *
 * Flow:
 * 1. `openclaw models auth login --provider byoky`
 * 2. Plugin opens browser for user to approve in their Byoky wallet
 * 3. Extension starts the Bridge HTTP proxy via native messaging
 * 4. Plugin configures OpenClaw to route API calls through the proxy
 * 5. Bridge relays requests to the extension, which injects keys and calls the real API
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

const DEFAULT_BRIDGE_PORT = 19280;

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
  { id: 'replicate', name: 'Replicate', baseUrl: 'https://api.replicate.com/v1', api: 'openai-completions' },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://api-inference.huggingface.co', api: 'openai-completions' },
  { id: 'azure_openai', name: 'Azure OpenAI', baseUrl: 'https://YOUR_RESOURCE.openai.azure.com', api: 'openai-completions' },
];

export default definePluginEntry({
  id: 'byoky',
  name: 'Byoky Wallet',
  description:
    'Route LLM API calls through your Byoky browser wallet — keys never leave the extension',

  register(api) {
    // Register the main "byoky" provider for the wallet-wide auth flow
    api.registerProvider({
      id: 'byoky',
      label: 'Byoky Wallet',
      docsPath: '/providers/byoky',
      envVars: ['BYOKY_SESSION'],
      auth: [
        {
          id: 'browser',
          label: 'Byoky Wallet (browser)',
          hint: 'Connect your Byoky wallet — keys stay in the extension',
          kind: 'custom' as const,
          wizard: {
            choiceId: 'byoky',
            choiceLabel: 'Byoky Wallet',
            choiceHint: 'Route API calls through your browser wallet',
            groupId: 'byoky',
            groupLabel: 'Byoky Wallet',
            groupHint: 'Keys never leave the extension',
          },
          run: runByokyAuth,
        },
      ],
      catalog: {
        order: 'simple' as const,
        run: async () => null,
      },
    });

    // Register each provider that routes through the Byoky bridge proxy
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
            hint: 'Route through Byoky wallet — key stays in extension',
            kind: 'custom' as const,
            wizard: {
              choiceId: openclawId,
              choiceLabel: `${provider.name} (via Byoky)`,
              choiceHint: 'Route through Byoky wallet',
              groupId: 'byoky',
              groupLabel: 'Byoky Wallet',
              groupHint: 'Keys never leave the extension',
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

            // apiKey here is "byoky-proxy" — the real key is injected by the bridge
            return {
              provider: {
                baseUrl: `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}/${provider.id}`,
                api: provider.api,
                apiKey: auth.apiKey,
                models: [],
              },
            };
          },
        },
        formatApiKey: (profile: Record<string, unknown> | null) => {
          const cred = profile?.credential as Record<string, unknown> | undefined;
          if (cred?.type === 'api_key') {
            return cred.key as string;
          }
          return undefined;
        },
      });
    }
  },
});

// --- Auth flow: connect wallet and start bridge proxy ---

async function runByokyAuth(
  ctx: ProviderAuthContext,
): Promise<ProviderAuthResult> {
  ctx.prompter.note(
    'Opening your browser to connect the Byoky wallet.\n' +
      'Unlock your wallet and approve the connection.\n' +
      'The Byoky Bridge must be installed: npm i -g @byoky/bridge && byoky-bridge install',
  );

  const result = await startCallbackServer(ctx, 'all');

  try {
    if (!result.providers || result.providers.length === 0) {
      throw new Error('No providers received from Byoky wallet');
    }

    // Configure each available provider to route through the bridge proxy
    const profiles = result.providers.map((providerId: string) => ({
      profileId: `byoky-${providerId}:byoky`,
      credential: {
        type: 'api_key' as const,
        provider: `byoky-${providerId}`,
        key: 'byoky-proxy', // Dummy key — bridge injects the real one
      },
    }));

    // Build configPatch to point providers at the bridge proxy
    const configPatch: Record<string, unknown> = {
      models: {
        providers: Object.fromEntries(
          result.providers.map((id: string) => {
            const provider = PROVIDERS.find((p) => p.id === id);
            return [
              `byoky-${id}`,
              {
                baseUrl: `http://127.0.0.1:${result.port}/${id}`,
                api: provider?.api ?? 'openai-completions',
                apiKey: 'byoky-proxy',
                models: [],
              },
            ];
          }),
        ),
      },
    };

    return {
      profiles,
      defaultModel: undefined,
      configPatch,
      notes: [
        `Connected ${result.providers.length} provider(s) via Byoky Bridge on port ${result.port}.`,
        'API calls are routed through the bridge — keys never leave your browser extension.',
        'The bridge must be running for API calls to work.',
        'To reconnect: openclaw models auth login --provider byoky',
      ],
    };
  } finally {
    result.server.close();
  }
}

// --- Auth flow: single provider ---

async function runSingleProviderAuth(
  ctx: ProviderAuthContext,
  provider: ByokyProvider,
): Promise<ProviderAuthResult> {
  ctx.prompter.note(
    `Opening your browser to connect ${provider.name} via Byoky wallet.`,
  );

  const result = await startCallbackServer(ctx, provider.id);

  try {
    if (!result.providers || !result.providers.includes(provider.id)) {
      throw new Error(`${provider.name} not available in your Byoky wallet`);
    }

    return {
      profiles: [
        {
          profileId: `byoky-${provider.id}:byoky`,
          credential: {
            type: 'api_key' as const,
            provider: `byoky-${provider.id}`,
            key: 'byoky-proxy',
          },
        },
      ],
      defaultModel: undefined,
      configPatch: {
        models: {
          providers: {
            [`byoky-${provider.id}`]: {
              baseUrl: `http://127.0.0.1:${result.port}/${provider.id}`,
              api: provider.api,
              apiKey: 'byoky-proxy',
              models: [],
            },
          },
        },
      },
      notes: [
        `Connected ${provider.name} via Byoky Bridge on port ${result.port}.`,
        'Key stays in your browser extension — the bridge relays requests.',
      ],
    };
  } finally {
    result.server.close();
  }
}

// --- Local callback server ---

interface AuthResult {
  providers: string[];
  port: number;
  server: Server;
}

async function startCallbackServer(
  ctx: ProviderAuthContext,
  requestProviders: string,
): Promise<AuthResult> {
  return new Promise((resolve) => {
    let resolved = false;

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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            if (!resolved) {
              resolved = true;
              resolve({
                providers: data.providers || [],
                port: data.bridgePort || DEFAULT_BRIDGE_PORT,
                server,
              });
            }
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
      if (!resolved) {
        resolved = true;
        resolve({ providers: [], port: DEFAULT_BRIDGE_PORT, server });
      }
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
  <title>Byoky — Connect to OpenClaw</title>
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
      background: linear-gradient(135deg, #e0f2fe, #0ea5e9);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .subtitle { color: #8e8e9a; font-size: 14px; margin-bottom: 24px; }
    .status {
      padding: 16px; border-radius: 8px;
      margin-bottom: 16px; font-size: 14px; line-height: 1.6;
    }
    .waiting { background: rgba(14,165,233,0.1); color: #7dd3fc; }
    .success { background: rgba(52,211,153,0.1); color: #34d399; }
    .error { background: rgba(244,63,94,0.1); color: #f43f5e; }
    .info { color: #55555f; font-size: 12px; line-height: 1.6; }
    .security { color: #34d399; font-size: 12px; margin-top: 16px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Byoky</h1>
    <p class="subtitle">Connect wallet to OpenClaw</p>
    <div id="status" class="status waiting">
      Connecting to Byoky wallet...
    </div>
    <p class="info">
      Your Byoky extension must be installed and unlocked.<br />
      The Byoky Bridge must be installed for the proxy to work.
    </p>
    <p class="security">
      🔒 Keys never leave your browser extension.<br />
      API calls are proxied through the local Byoky Bridge.
    </p>
  </div>
  <script>
    (async () => {
      const status = document.getElementById('status');
      try {
        // Step 1: Connect to Byoky wallet
        const requestId = crypto.randomUUID();
        window.postMessage({
          type: 'BYOKY_CONNECT_REQUEST',
          id: requestId,
          requestId,
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

        const providers = response.providers || {};
        const available = Object.entries(providers)
          .filter(([, v]) => v.available)
          .map(([id]) => id);

        if (available.length === 0) {
          throw new Error('No matching providers found in your Byoky wallet');
        }

        status.textContent = 'Wallet connected! Starting bridge proxy...';

        // Step 2: Tell the extension to start the bridge proxy
        const bridgeRequestId = crypto.randomUUID();
        window.postMessage({
          type: 'BYOKY_INTERNAL_FROM_PAGE',
          requestId: bridgeRequestId,
          action: 'startBridgeProxy',
          payload: { sessionKey: response.sessionKey, port: ${DEFAULT_BRIDGE_PORT} },
        }, '*');

        // Wait for bridge proxy confirmation
        const bridgeResult = await new Promise((resolve, reject) => {
          function handler(event) {
            const msg = event instanceof CustomEvent ? event.detail : event.data;
            if (!msg || msg.requestId !== bridgeRequestId) return;
            document.removeEventListener('byoky-message', handler);
            window.removeEventListener('message', handler);
            resolve(msg.payload);
          }
          document.addEventListener('byoky-message', handler);
          window.addEventListener('message', handler);
          setTimeout(() => reject(new Error('Bridge proxy start timed out')), 15000);
        });

        const bridgePort = bridgeResult?.port || ${DEFAULT_BRIDGE_PORT};

        status.textContent = 'Bridge proxy active on port ' + bridgePort + '. Connected ' + available.length + ' provider(s): ' + available.join(', ');
        status.className = 'status success';

        // Step 3: Send result back to OpenClaw callback server
        await fetch('/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providers: available, bridgePort: bridgePort }),
        });

        setTimeout(() => { status.textContent = 'Done — you can close this tab.'; }, 2000);
      } catch (err) {
        status.textContent = 'Error: ' + err.message;
        status.className = 'status error';
      }
    })();
  </script>
</body>
</html>`;
}
