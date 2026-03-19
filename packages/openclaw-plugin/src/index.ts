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

import {
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from 'openclaw/plugin-sdk/core';
import { createServer, type Server } from 'node:http';

type ProviderApi = 'anthropic-messages' | 'openai-completions';

interface ByokyProvider {
  id: string;
  name: string;
  api: ProviderApi;
}

const DEFAULT_BRIDGE_PORT = 19280;

const PROVIDERS: ByokyProvider[] = [
  { id: 'anthropic', name: 'Anthropic', api: 'anthropic-messages' },
  { id: 'openai', name: 'OpenAI', api: 'openai-completions' },
  { id: 'gemini', name: 'Google Gemini', api: 'openai-completions' },
  { id: 'mistral', name: 'Mistral', api: 'openai-completions' },
  { id: 'cohere', name: 'Cohere', api: 'openai-completions' },
  { id: 'xai', name: 'xAI (Grok)', api: 'openai-completions' },
  { id: 'deepseek', name: 'DeepSeek', api: 'openai-completions' },
  { id: 'perplexity', name: 'Perplexity', api: 'openai-completions' },
  { id: 'groq', name: 'Groq', api: 'openai-completions' },
  { id: 'together', name: 'Together AI', api: 'openai-completions' },
  { id: 'fireworks', name: 'Fireworks AI', api: 'openai-completions' },
  { id: 'openrouter', name: 'OpenRouter', api: 'openai-completions' },
  { id: 'replicate', name: 'Replicate', api: 'openai-completions' },
  { id: 'huggingface', name: 'Hugging Face', api: 'openai-completions' },
  { id: 'azure_openai', name: 'Azure OpenAI', api: 'openai-completions' },
];

const byokyPlugin = {
  id: 'byoky',
  name: 'Byoky Wallet',
  description:
    'Route LLM API calls through your Byoky browser wallet — keys never leave the extension',
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // Register one provider per Byoky provider that routes through the bridge
    for (const provider of PROVIDERS) {
      const openclawId = `byoky-${provider.id}`;

      api.registerProvider({
        id: openclawId,
        label: `${provider.name} (via Byoky)`,
        docsPath: '/providers/byoky',
        auth: [
          {
            id: 'browser',
            label: `${provider.name} (via Byoky)`,
            hint: 'Route through Byoky wallet — key stays in extension',
            kind: 'custom',
            run: (ctx: ProviderAuthContext) =>
              runProviderAuth(ctx, provider),
          },
        ],
        wizard: {
          onboarding: {
            choiceId: openclawId,
            choiceLabel: `${provider.name} (via Byoky)`,
            choiceHint: 'Route through Byoky wallet',
            groupId: 'byoky',
            groupLabel: 'Byoky Wallet',
            groupHint: 'Keys never leave the extension',
            methodId: 'browser',
          },
        },
      });
    }
  },
};

export default byokyPlugin;

// --- Auth flow ---

async function runProviderAuth(
  ctx: ProviderAuthContext,
  provider: ByokyProvider,
): Promise<ProviderAuthResult> {
  ctx.prompter.note(
    `Opening your browser to connect ${provider.name} via Byoky wallet.\n` +
      'Unlock your wallet and approve the connection.\n' +
      'The Byoky Bridge must be installed: npm i -g @byoky/bridge && byoky-bridge install',
  );

  const result = await startCallbackServer(ctx, provider.id);

  try {
    if (!result.providers || !result.providers.includes(provider.id)) {
      throw new Error(`${provider.name} not available in your Byoky wallet`);
    }

    const openclawId = `byoky-${provider.id}`;

    return {
      profiles: [
        {
          profileId: `${openclawId}:byoky`,
          credential: {
            type: 'token',
            provider: openclawId,
            token: 'byoky-proxy', // Dummy — bridge injects the real key
          },
        },
      ],
      configPatch: {
        models: {
          providers: {
            [openclawId]: {
              baseUrl: `http://127.0.0.1:${result.port}/${provider.id}`,
              api: provider.api,
              apiKey: 'byoky-proxy',
              models: [],
            },
          },
        },
      },
      defaultModel: undefined,
      notes: [
        `Connected ${provider.name} via Byoky Bridge on port ${result.port}.`,
        'Key stays in your browser extension — the bridge relays requests.',
        'The bridge must be running for API calls to work.',
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
  requestProviderId: string,
): Promise<AuthResult> {
  return new Promise((resolve) => {
    let resolved = false;

    const server = createServer((req, res) => {
      const reqOrigin = req.headers.origin || '';
      let isLocalhost = false;
      try {
        const parsed = new URL(reqOrigin);
        isLocalhost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
      } catch { /* ignore */ }
      res.setHeader(
        'Access-Control-Allow-Origin',
        isLocalhost ? reqOrigin : 'http://127.0.0.1',
      );
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
        res.end(buildAuthPage(requestProviderId));
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

const VALID_PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

function buildAuthPage(requestProviderId: string): string {
  let providerFilter: string;
  if (VALID_PROVIDER_IDS.has(requestProviderId)) {
    providerFilter = `[{ id: ${JSON.stringify(requestProviderId)}, required: true }]`;
  } else {
    providerFilter = '[]';
  }

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
      Keys never leave your browser extension.<br />
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
            const msg = event.detail;
            if (!msg || msg.requestId !== requestId) return;
            document.removeEventListener('byoky-message', handler);
            if (msg.type === 'BYOKY_CONNECT_RESPONSE') resolve(msg.payload);
            else reject(new Error(msg.payload?.message || 'Connection failed'));
          }
          document.addEventListener('byoky-message', handler);
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

        const bridgeResult = await new Promise((resolve, reject) => {
          function handler(event) {
            const msg = event.detail;
            if (!msg || msg.requestId !== bridgeRequestId) return;
            document.removeEventListener('byoky-message', handler);
            resolve(msg.payload);
          }
          document.addEventListener('byoky-message', handler);
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
