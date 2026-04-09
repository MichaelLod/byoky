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

interface ModelDef {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

interface ByokyProvider {
  id: string;
  name: string;
  api: ProviderApi;
  models: ModelDef[];
}

const DEFAULT_BRIDGE_PORT = 19280;

// --- Model catalogs per provider ---

const ANTHROPIC_MODELS: ModelDef[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 200_000,
    maxTokens: 32_000,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200_000,
    maxTokens: 16_000,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    contextWindow: 200_000,
    maxTokens: 8_192,
  },
];

const OPENAI_MODELS: ModelDef[] = [
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 1_047_576,
    maxTokens: 32_768,
  },
  {
    id: 'o3',
    name: 'o3',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 10, output: 40, cacheRead: 2.5, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 100_000,
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 100_000,
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 1_047_576,
    maxTokens: 32_768,
  },
];

const GEMINI_MODELS: ModelDef[] = [
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.25, output: 10, cacheRead: 0.315, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
];

const DEEPSEEK_MODELS: ModelDef[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
    contextWindow: 65_536,
    maxTokens: 8_192,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 },
    contextWindow: 65_536,
    maxTokens: 8_192,
  },
];

const XAI_MODELS: ModelDef[] = [
  {
    id: 'grok-3',
    name: 'Grok 3',
    reasoning: false,
    input: ['text'],
    cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 16_384,
  },
  {
    id: 'grok-3-mini',
    name: 'Grok 3 Mini',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.3, output: 0.5, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 16_384,
  },
];

const MISTRAL_MODELS: ModelDef[] = [
  {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },
];

const GROQ_MODELS: ModelDef[] = [
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.59, output: 0.79, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_768,
  },
];

// Providers with no pre-defined model catalog (models vary widely or require discovery)
const EMPTY_MODELS: ModelDef[] = [];

const PROVIDERS: ByokyProvider[] = [
  { id: 'anthropic', name: 'Anthropic', api: 'anthropic-messages', models: ANTHROPIC_MODELS },
  { id: 'openai', name: 'OpenAI', api: 'openai-completions', models: OPENAI_MODELS },
  { id: 'gemini', name: 'Google Gemini', api: 'openai-completions', models: GEMINI_MODELS },
  { id: 'mistral', name: 'Mistral', api: 'openai-completions', models: MISTRAL_MODELS },
  { id: 'cohere', name: 'Cohere', api: 'openai-completions', models: EMPTY_MODELS },
  { id: 'xai', name: 'xAI (Grok)', api: 'openai-completions', models: XAI_MODELS },
  { id: 'deepseek', name: 'DeepSeek', api: 'openai-completions', models: DEEPSEEK_MODELS },
  { id: 'perplexity', name: 'Perplexity', api: 'openai-completions', models: EMPTY_MODELS },
  { id: 'groq', name: 'Groq', api: 'openai-completions', models: GROQ_MODELS },
  { id: 'together', name: 'Together AI', api: 'openai-completions', models: EMPTY_MODELS },
  { id: 'fireworks', name: 'Fireworks AI', api: 'openai-completions', models: EMPTY_MODELS },
  { id: 'openrouter', name: 'OpenRouter', api: 'openai-completions', models: EMPTY_MODELS },
  { id: 'azure_openai', name: 'Azure OpenAI', api: 'openai-completions', models: EMPTY_MODELS },
];

const byokyPlugin = {
  id: 'byoky',
  name: 'Byoky Wallet',
  description:
    'Route LLM API calls through your Byoky browser wallet — keys never leave the extension',
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
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
          setup: {
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

    // /byoky command — check bridge status
    api.registerCommand({
      name: 'byoky',
      description: 'Show Byoky bridge status and connected providers',
      acceptsArgs: false,
      handler: async () => {
        const health = await checkBridgeHealth();
        if (!health) {
          return {
            text: 'Byoky Bridge: **offline**\n\nStart the bridge with `openclaw models auth login --provider byoky-anthropic` or ensure it is running on port ' + DEFAULT_BRIDGE_PORT + '.',
          };
        }
        const providerList = health.providers.length > 0
          ? health.providers.join(', ')
          : 'none';
        return {
          text: `Byoky Bridge: **online** (port ${DEFAULT_BRIDGE_PORT})\nProviders: ${providerList}`,
        };
      },
    });
  },
};

export default byokyPlugin;

// --- Bridge health check ---

async function checkBridgeHealth(): Promise<{ providers: string[] } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://127.0.0.1:${DEFAULT_BRIDGE_PORT}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as { status?: string; providers?: string[] };
    if (data.status !== 'ok') return null;
    return { providers: data.providers ?? [] };
  } catch {
    return null;
  }
}

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
            type: 'api_key',
            provider: openclawId,
            key: 'byoky-proxy',
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
              models: provider.models,
            },
          },
        },
      },
      defaultModel: provider.models.length > 0
        ? `${openclawId}/${provider.models[0].id}`
        : undefined,
      notes: [
        `Connected ${provider.name} via Byoky Bridge on port ${result.port}.`,
        'Key stays in your browser extension — the bridge relays requests.',
        'The bridge must be running for API calls to work.',
        ...(provider.models.length > 0
          ? [`Available models: ${provider.models.map((m) => m.id).join(', ')}`]
          : ['No pre-defined models — set agents.defaults.model manually.']),
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
      res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/callback') {
        const MAX_BODY_SIZE = 1_048_576; // 1MB
        let body = '';
        let oversized = false;
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > MAX_BODY_SIZE) {
            oversized = true;
            req.destroy();
          }
        });
        req.on('end', () => {
          if (oversized) {
            res.writeHead(413);
            res.end('Request body too large');
            return;
          }
          try {
            const data = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            if (!resolved) {
              resolved = true;
              resolve({
                providers: Array.isArray(data.providers) ? data.providers : [],
                port: typeof data.bridgePort === 'number' ? data.bridgePort : DEFAULT_BRIDGE_PORT,
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
        }, window.location.origin);

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
        }, window.location.origin);

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
