/**
 * Byoky OpenClaw Provider Plugin
 *
 * Connects OpenClaw to the Byoky browser wallet via the Bridge HTTP proxy.
 * API keys never leave the browser extension — the bridge is a dumb relay.
 * (A Claude setup token is handed to the local bridge for each request:
 * Anthropic needs a non-browser TLS client for it.)
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
  type OpenClawConfig,
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from 'openclaw/plugin-sdk/core';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { createRequire } from 'node:module';
// Bundled into dist at build time (see tsup.config.ts), so the plugin and
// `byoky-bridge install` share one allow-list, one set of browser
// locations and one token file.
import { getRegistrationStatusAt, registerHostAt } from '@byoky/bridge/native-manifest';
import { loadOrCreateToken } from '@byoky/bridge/token';
import {
  cleanPageMessage, createPageNonce, isFromPage, isPageHost, sameSecret,
} from '@byoky/bridge/loopback-page';

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
  // Appended to the bridge URL so the SDK's own suffix (`/v1/messages`,
  // `/chat/completions`) lands on the provider's real endpoint.
  basePath: string;
  models: ModelDef[];
}

const DEFAULT_BRIDGE_PORT = 19280;
// The login page's port. Fixed: the wallet knows OpenClaw by the page's
// origin, with its spending cap and routing group, so it must not change
// between logins. (`byoky-bridge connect` uses 19281.)
export const CALLBACK_PORT = 19282;
const CALLBACK_TIMEOUT_MS = 180_000;

// --- Model catalogs per provider ---

// Native max_tokens per model. Overwritten at auth time by
// `plugins.entries.byoky.config.anthropicMaxTokens` (default 4096) so
// Tier-1 keys aren't pre-rejected by Anthropic's OTPM gate.
const ANTHROPIC_MODELS: ModelDef[] = [
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
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
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200_000,
    maxTokens: 8_192,
  },
];

const OPENAI_MODELS: ModelDef[] = [
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
    contextWindow: 400_000,
    maxTokens: 128_000,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
    contextWindow: 400_000,
    maxTokens: 128_000,
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

// basePath values mirror each provider's OpenAI-compatible chat endpoint
// (see chatPath in @byoky/core's provider registry).
const PROVIDERS: ByokyProvider[] = [
  { id: 'anthropic', name: 'Anthropic', api: 'anthropic-messages', basePath: '', models: ANTHROPIC_MODELS },
  { id: 'openai', name: 'OpenAI', api: 'openai-completions', basePath: '/v1', models: OPENAI_MODELS },
  { id: 'gemini', name: 'Google Gemini', api: 'openai-completions', basePath: '/v1beta/openai', models: GEMINI_MODELS },
  { id: 'mistral', name: 'Mistral', api: 'openai-completions', basePath: '/v1', models: MISTRAL_MODELS },
  { id: 'cohere', name: 'Cohere', api: 'openai-completions', basePath: '/compatibility/v1', models: EMPTY_MODELS },
  { id: 'xai', name: 'xAI (Grok)', api: 'openai-completions', basePath: '/v1', models: XAI_MODELS },
  { id: 'deepseek', name: 'DeepSeek', api: 'openai-completions', basePath: '', models: DEEPSEEK_MODELS },
  { id: 'perplexity', name: 'Perplexity', api: 'openai-completions', basePath: '', models: EMPTY_MODELS },
  { id: 'groq', name: 'Groq', api: 'openai-completions', basePath: '/openai/v1', models: GROQ_MODELS },
  { id: 'together', name: 'Together AI', api: 'openai-completions', basePath: '/v1', models: EMPTY_MODELS },
  { id: 'fireworks', name: 'Fireworks AI', api: 'openai-completions', basePath: '/inference/v1', models: EMPTY_MODELS },
  { id: 'openrouter', name: 'OpenRouter', api: 'openai-completions', basePath: '/v1', models: EMPTY_MODELS },
  // Azure, Ollama and LM Studio run on the credential's own host, which the
  // extension fills in. Azure's v1 API takes the deployment name as model.
  { id: 'azure_openai', name: 'Azure OpenAI', api: 'openai-completions', basePath: '/openai/v1', models: EMPTY_MODELS },
  { id: 'ollama', name: 'Ollama', api: 'openai-completions', basePath: '/v1', models: EMPTY_MODELS },
  { id: 'lm_studio', name: 'LM Studio', api: 'openai-completions', basePath: '/v1', models: EMPTY_MODELS },
];

export interface ByokyPluginOptions {
  /** For tests. Real logins keep CALLBACK_PORT: the wallet knows OpenClaw by it. */
  callbackPort?: number;
}

export function createByokyPlugin(options: ByokyPluginOptions = {}) {
  const callbackPort = options.callbackPort ?? CALLBACK_PORT;
  return {
    id: 'byoky',
    name: 'Byoky Wallet',
    description:
      'Route LLM API calls through your Byoky browser wallet — API keys stay in the extension',
    configSchema: emptyPluginConfigSchema(),

    register(api: OpenClawPluginApi) {
      // Meta-provider: `byoky` — connects every provider available in the wallet
      // in a single auth round. This is the recommended entry point.
      api.registerProvider({
        id: 'byoky',
        label: 'Byoky Wallet (all providers)',
        docsPath: '/providers/byoky',
        auth: [
          {
            id: 'browser',
            label: 'Byoky Wallet',
            hint: 'Connects every provider you have in the wallet, in one step',
            kind: 'custom',
            run: (ctx: ProviderAuthContext) => runProviderAuth(ctx, null, callbackPort),
          },
        ],
        wizard: {
          setup: {
            choiceId: 'byoky',
            choiceLabel: 'Byoky Wallet (all providers)',
            choiceHint: 'One auth connects every provider you have',
            groupId: 'byoky',
            groupLabel: 'Byoky Wallet',
            groupHint: 'API keys stay in the extension',
            methodId: 'browser',
          },
        },
      });

      // Per-provider variants — still registered for users who want to connect
      // only a specific provider (or already have `byoky-anthropic` in their config).
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
              hint: 'Route through Byoky wallet — API keys stay in the extension',
              kind: 'custom',
              run: (ctx: ProviderAuthContext) =>
                runProviderAuth(ctx, provider, callbackPort),
            },
          ],
          wizard: {
            setup: {
              choiceId: openclawId,
              choiceLabel: `${provider.name} (via Byoky)`,
              choiceHint: 'Route through Byoky wallet',
              groupId: 'byoky',
              groupLabel: 'Byoky Wallet',
              groupHint: 'API keys stay in the extension',
              methodId: 'browser',
            },
          },
        });
      }

      // /byoky command — bridge status + provider table
      api.registerCommand({
        name: 'byoky',
        description: 'Show Byoky bridge status and connected providers',
        acceptsArgs: false,
        handler: async () => ({ text: await renderByokyStatus() }),
      });
    },
  };
}

const byokyPlugin = createByokyPlugin();

export default byokyPlugin;

// --- Native messaging host registration (scanner-safe) ---
//
// We avoid importing @byoky/bridge/installer so OpenClaw's plugin sandbox
// doesn't see child_process in the same module as `fetch` (its scanner flags
// that combination). @byoky/bridge/native-manifest, which does the actual
// registration, has neither.

function resolveBridgeBin(): string {
  // Prefer @byoky/bridge's shipped bin when the package is installed alongside
  // the plugin. Fall back to a sibling path resolved from this file's URL.
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('@byoky/bridge/package.json');
    return resolve(dirname(pkgPath), 'bin/byoky-bridge.js');
  } catch {
    return resolve(dirname(new URL(import.meta.url).pathname), '../bin/byoky-bridge.js');
  }
}

function getRegistrationStatus(): { registered: string[]; missing: string[] } {
  return getRegistrationStatusAt(homedir(), platform());
}

function registerHost(): { browsers: string[]; unsupported?: boolean } {
  return registerHostAt(homedir(), platform(), resolveBridgeBin());
}

// --- Bridge health check ---

// /health lists providers only to a caller with the bridge token. A bridge
// that answers without them is running with a different token.
async function checkBridgeHealth(): Promise<{ providers: string[] } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://127.0.0.1:${DEFAULT_BRIDGE_PORT}/health`, {
      headers: { authorization: `Bearer ${loadOrCreateToken()}` },
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

type BridgeSessionState = 'ok' | 'stale' | 'bad-token';

// Probes whether the bridge's current session key is still authorized by the
// extension. /health is not enough — it only confirms the bridge process is up,
// not that its sessionKey still matches the extension's authorizedBridgeSessionKey
// (which gets rotated on extension reload, wallet unlock, or a newer auth).
// 'stale' means the wallet must be reconnected; 'bad-token' means the running
// bridge predates the current ~/.byoky-bridge/token and must be restarted.
export async function probeBridgeSession(port: number, providerId: string): Promise<BridgeSessionState> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://127.0.0.1:${port}/${providerId}/v1/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${loadOrCreateToken()}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.status === 401) {
      const data = await res.json().catch(() => ({})) as { code?: string };
      return data.code === 'bridge_token_invalid' ? 'bad-token' : 'stale';
    }
    // Bridges before 1.1.2 passed a dead session on as a 502.
    if (res.status === 502) {
      const text = await res.text().catch(() => '');
      if (/unauthorized session key|session has expired|session not found/i.test(text)) {
        return 'stale';
      }
    }
    return 'ok';
  } catch {
    return 'ok';
  }
}

// --- /byoky status command output ---

async function renderByokyStatus(): Promise<string> {
  const health = await checkBridgeHealth();
  const reg = getRegistrationStatus();

  const lines: string[] = [];
  lines.push(`**Byoky Bridge**  ·  port ${DEFAULT_BRIDGE_PORT}`);
  lines.push('');

  if (!health) {
    lines.push(`Status: **offline**`);
    if (reg.registered.length === 0) {
      lines.push('');
      lines.push('Native messaging host is not registered with any browser.');
      lines.push('Run: `openclaw models auth login --provider byoky`');
    } else {
      lines.push('');
      lines.push(`Registered with: ${reg.registered.join(', ')}`);
      lines.push('Open your Byoky wallet so the bridge can start.');
    }
    return lines.join('\n');
  }

  lines.push(`Status: **online**`);
  lines.push('');
  if (health.providers.length === 0) {
    lines.push('No providers connected yet — approve a connection in your wallet.');
    return lines.join('\n');
  }

  lines.push(`Connected providers (${health.providers.length}):`);
  for (const id of health.providers) {
    const meta = PROVIDERS.find((p) => p.id === id);
    const label = meta ? meta.name : id;
    lines.push(`  • ${label}  \`byoky-${id}\``);
  }
  if (reg.registered.length > 0) {
    lines.push('');
    lines.push(`Registered with: ${reg.registered.join(', ')}`);
  }
  return lines.join('\n');
}

// --- Preflight: ensure native messaging host is registered ---

async function ensureNativeHostRegistered(
  ctx: ProviderAuthContext,
): Promise<boolean> {
  const reg = getRegistrationStatus();
  if (reg.registered.length > 0) return true;

  const ok = await ctx.prompter.confirm({
    message:
      'Byoky Bridge native messaging host is not registered. Register it now so the wallet can reach the bridge?',
    initialValue: true,
  });
  if (!ok) {
    await ctx.prompter.note(
      'Skipped. You can register later with `byoky-bridge install`.',
    );
    return false;
  }

  const progress = ctx.prompter.progress('Registering native messaging host…');
  try {
    const result = registerHost();
    if (result.unsupported) {
      progress.stop('Unsupported platform — Byoky Bridge supports macOS and Linux only');
      return false;
    }
    if (result.browsers.length === 0) {
      progress.stop('No supported browsers found');
      return false;
    }
    progress.stop(`Registered with ${result.browsers.join(', ')}`);
    await ctx.prompter.note(
      'Restart your browser if the Byoky extension was already open — the host is loaded on browser start.',
    );
    return true;
  } catch (err) {
    progress.stop(`Failed: ${(err as Error).message}`);
    return false;
  }
}

// --- Auth flow ---

async function runProviderAuth(
  ctx: ProviderAuthContext,
  // null = meta-provider "byoky": connect every provider the wallet exposes.
  provider: ByokyProvider | null,
  callbackPort: number,
): Promise<ProviderAuthResult> {
  const ok = await ensureNativeHostRegistered(ctx);
  if (!ok) {
    throw new Error(
      'Byoky Bridge native messaging host is not registered. Run `byoky-bridge install` and try again.',
    );
  }

  const overrides = readPluginOverrides(ctx.config);

  // Fast path: if the bridge is already healthy and already has providers,
  // reuse them instead of opening a browser tab.
  const health = await checkBridgeHealth();
  if (health && health.providers.length > 0) {
    const selected = provider
      ? health.providers.filter((id) => id === provider.id)
      : health.providers;

    if (selected.length === 0) {
      await ctx.prompter.note(
        `Bridge is running with ${health.providers.length} provider(s), but not ${provider!.name}. Opening the wallet to add it.`,
      );
    } else {
      const probeProviderId = selected[0];
      const state = await probeBridgeSession(DEFAULT_BRIDGE_PORT, probeProviderId);
      if (state === 'ok') {
        await ctx.prompter.note(
          `Reusing live Byoky Bridge on port ${DEFAULT_BRIDGE_PORT} — no browser round-trip needed.`,
        );
        return buildAuthResult(selected, DEFAULT_BRIDGE_PORT, provider, overrides);
      }
      await ctx.prompter.note(
        state === 'bad-token'
          ? 'Byoky Bridge is running with an older token than ~/.byoky-bridge/token. Opening the wallet to restart it.'
          : 'Byoky Bridge is running but its session key no longer matches the extension (the extension was reloaded or the wallet was re-locked). Opening the wallet to reconnect.',
      );
    }
  }

  await ctx.prompter.note(
    provider
      ? `Opening your browser to connect ${provider.name} via Byoky wallet.\nUnlock your wallet and approve the connection.`
      : 'Opening your browser to connect every provider in your Byoky wallet.\nUnlock your wallet and approve the connection.',
  );

  const progress = ctx.prompter.progress(`Waiting for approval in the browser (http://127.0.0.1:${callbackPort})…`);
  let result: CallbackResult;
  try {
    result = await startCallbackServer({
      requestProviderId: provider?.id ?? null,
      port: callbackPort,
      openUrl: (url) => ctx.openUrl(url),
      // The tab stays open for a retry, so keep waiting, but show it now.
      onPageError: (message) => progress.update(`The browser tab reported: ${message}. Try again there, or press Ctrl-C.`),
    });
  } catch (err) {
    progress.stop('Could not open the login page');
    throw err;
  }
  if (!result.ok) {
    progress.stop('Not connected');
    throw new Error(result.message);
  }
  progress.stop('Wallet connected');

  const selected = provider
    ? result.providers.filter((id) => id === provider.id)
    : result.providers;

  if (selected.length === 0) {
    if (provider) {
      throw new Error(`${provider.name} not available in your Byoky wallet`);
    }
    throw new Error('No providers found in your Byoky wallet');
  }

  return buildAuthResult(selected, result.port, provider, overrides);
}

interface PluginOverrides {
  // Cap max_tokens for every Anthropic model. Default 4096 — low enough to
  // stay under Tier-1 OTPM gates (Anthropic pre-rejects requests whose
  // declared max_tokens exceed the remaining output-tokens-per-minute budget).
  // Users on Tier 3+ keys can raise it via
  //   plugins.entries.byoky.config.anthropicMaxTokens
  anthropicMaxTokens: number;
}

function readPluginOverrides(config: OpenClawConfig): PluginOverrides {
  const raw = config.plugins?.entries?.byoky?.config as
    | { anthropicMaxTokens?: unknown }
    | undefined;
  const override = typeof raw?.anthropicMaxTokens === 'number' ? raw.anthropicMaxTokens : undefined;
  return {
    anthropicMaxTokens: override && override > 0 ? override : 4096,
  };
}

function applyOverrides(providers: ByokyProvider[], overrides: PluginOverrides): ByokyProvider[] {
  return providers.map((p) => {
    if (p.api !== 'anthropic-messages') return p;
    return {
      ...p,
      models: p.models.map((m) => ({ ...m, maxTokens: overrides.anthropicMaxTokens })),
    };
  });
}

function buildAuthResult(
  providerIds: string[],
  port: number,
  single: ByokyProvider | null,
  overrides: PluginOverrides,
): ProviderAuthResult {
  const providers = applyOverrides(
    providerIds
      .map((id) => PROVIDERS.find((p) => p.id === id))
      .filter((p): p is ByokyProvider => Boolean(p)),
    overrides,
  );

  // The bridge rejects requests without its token; OpenClaw sends the
  // provider apiKey, so that is where it goes.
  const token = loadOrCreateToken();

  const profiles = providers.map((p) => {
    const openclawId = `byoky-${p.id}`;
    return {
      profileId: `${openclawId}:byoky`,
      credential: {
        type: 'api_key' as const,
        provider: openclawId,
        key: token,
      },
    };
  });

  const providerConfig: Record<string, {
    baseUrl: string;
    api: ProviderApi;
    apiKey: string;
    models: ModelDef[];
  }> = {};
  const agentModels: Record<string, Record<string, never>> = {};
  for (const p of providers) {
    providerConfig[`byoky-${p.id}`] = {
      baseUrl: `http://127.0.0.1:${port}/${p.id}${p.basePath}`,
      api: p.api,
      apiKey: token,
      models: p.models,
    };
    for (const m of p.models) {
      agentModels[`byoky-${p.id}/${m.id}`] = {};
    }
  }

  const firstWithModels = providers.find((p) => p.models.length > 0);
  const defaultModel = single
    ? (single.models.length > 0 ? `byoky-${single.id}/${single.models[0].id}` : undefined)
    : (firstWithModels ? `byoky-${firstWithModels.id}/${firstWithModels.models[0].id}` : undefined);

  const notes: string[] = [];
  if (providers.length === 1) {
    notes.push(`Connected ${providers[0].name} via Byoky Bridge on port ${port}.`);
  } else {
    notes.push(
      `Connected ${providers.length} providers via Byoky Bridge on port ${port}: ${providers
        .map((p) => p.name)
        .join(', ')}.`,
    );
  }
  notes.push('API keys stay in your Byoky wallet; the bridge relays requests to it. A Claude setup token is the exception: Anthropic needs a non-browser client for it, so the bridge makes those calls, holding the token in memory only.');
  notes.push('The bridge must be running for API calls to work.');
  if (defaultModel) notes.push(`Default model set to ${defaultModel}.`);
  notes.push('Run `/byoky` inside OpenClaw anytime to check bridge status.');

  const configPatch: Partial<OpenClawConfig> = {
    models: { providers: providerConfig },
  };
  if (Object.keys(agentModels).length > 0) {
    configPatch.agents = { defaults: { models: agentModels } };
  }

  return {
    profiles,
    configPatch,
    defaultModel,
    notes,
  };
}

// --- Local callback server ---

export type CallbackResult =
  | { ok: true; providers: string[]; port: number }
  | { ok: false; reason: 'timeout' | 'page-error'; message: string };

export interface CallbackServerOptions {
  requestProviderId: string | null;
  openUrl: (url: string) => void | Promise<void>;
  /** The page hit an error; it stays open for a retry. */
  onPageError?: (message: string) => void;
  /** For tests. */
  port?: number;
  timeoutMs?: number;
}

/**
 * Serves the login page and waits for it to report the wallet's providers.
 * Resolves (and closes the server) on success, or on timeout with the last
 * error the page reported; rejects only when the port can't be bound.
 */
export function startCallbackServer(opts: CallbackServerOptions): Promise<CallbackResult> {
  const port = opts.port ?? CALLBACK_PORT;
  const timeoutMs = opts.timeoutMs ?? CALLBACK_TIMEOUT_MS;
  // Only the served page knows this, so only it can report back.
  const nonce = createPageNonce();

  return new Promise((resolve, reject) => {
    let resolved = false;
    let lastError: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: CallbackResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      // close() waits for open connections, and the tab keeps its sockets.
      server.close();
      server.closeAllConnections();
      resolve(result);
    };

    // Counted from the user's last step in the tab, not from opening it.
    const armTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(lastError
        ? { ok: false, reason: 'page-error', message: `The browser tab reported: ${lastError}` }
        : {
          ok: false,
          reason: 'timeout',
          message: `Timed out waiting for the browser tab. Run the login again and approve it within ${Math.round(timeoutMs / 60_000)} minutes.`,
        }), timeoutMs);
    };

    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');

      // A page on another site that rebinds its hostname to 127.0.0.1
      // would reach this server under its own Host name.
      if (!isPageHost(req, port)) {
        res.writeHead(403);
        res.end();
        return;
      }

      if (req.method === 'POST' && (req.url === '/callback' || req.url === '/started')) {
        if (!isFromPage(req, port)) {
          res.writeHead(403);
          res.end();
          return;
        }
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
          let data: { nonce?: unknown; error?: unknown; providers?: unknown; bridgePort?: unknown };
          try {
            data = JSON.parse(body);
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
            return;
          }
          if (typeof data.nonce !== 'string' || !sameSecret(data.nonce, nonce)) {
            res.writeHead(403);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          if (resolved) return;
          if (req.url === '/started') {
            armTimer();
          } else if (typeof data.error === 'string') {
            lastError = cleanPageMessage(data.error) || 'unknown error';
            armTimer();
            opts.onPageError?.(lastError);
          } else {
            finish({
              ok: true,
              providers: Array.isArray(data.providers)
                ? data.providers.filter((id): id is string => typeof id === 'string' && VALID_PROVIDER_IDS.has(id))
                : [],
              port: isValidBridgePort(data.bridgePort) ? data.bridgePort : DEFAULT_BRIDGE_PORT,
            });
          }
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/auth-sdk.js') {
        try {
          const js = readAuthSdkBundle();
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          res.end(js);
        } catch {
          res.writeHead(500);
          res.end('SDK bundle missing');
        }
        return;
      }

      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(buildAuthPage(opts.requestProviderId, nonce));
        return;
      }

      res.writeHead(req.method === 'POST' ? 404 : 405, { Allow: 'GET, POST' });
      res.end();
    });

    server.once('error', (err: NodeJS.ErrnoException) => {
      resolved = true;
      clearTimeout(timer);
      reject(err.code === 'EADDRINUSE'
        ? new Error(`Port ${port} is already in use — another OpenClaw login with Byoky may be running. Finish or close it and try again.`)
        : err);
    });

    server.listen(port, '127.0.0.1', () => {
      armTimer();
      void Promise.resolve(opts.openUrl(`http://127.0.0.1:${port}`)).catch(() => {
        // The URL is shown in the terminal; the user can open it by hand.
      });
    });
  });
}

function isValidBridgePort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535;
}

// --- Browser SDK bundle (served to the auth page) ---

let authSdkCache: string | null = null;

function readAuthSdkBundle(): string {
  if (authSdkCache !== null) return authSdkCache;
  // The IIFE bundle ships next to this file in dist/ (see tsup.config.ts).
  const here = dirname(fileURLToPath(import.meta.url));
  const bundlePath = resolve(here, 'auth-sdk.js');
  authSdkCache = readFileSync(bundlePath, 'utf8');
  return authSdkCache;
}

// --- Auth page served to the browser ---

const VALID_PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

function buildAuthPage(requestProviderId: string | null, nonce: string): string {
  let providersJson: string;
  if (requestProviderId && VALID_PROVIDER_IDS.has(requestProviderId)) {
    providersJson = JSON.stringify([{ id: requestProviderId, required: true }]);
  } else {
    // Meta-provider: ask the wallet for every provider it has.
    providersJson = JSON.stringify(
      PROVIDERS.map((p) => ({ id: p.id, required: false })),
    );
  }
  const headline = requestProviderId
    ? 'Connect your <span class="grad">wallet</span>'
    : 'Connect <span class="grad">all providers</span>';
  const subtitle = requestProviderId
    ? 'Linking your Byoky wallet to OpenClaw.'
    : 'Linking every provider in your Byoky wallet to OpenClaw.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Byoky — Connect to OpenClaw</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #fafaf9;
      --bg-card: #ffffff;
      --bg-elevated: #f5f5f4;
      --border: #e7e5e4;
      --border-hover: #d6d3d1;
      --text: #1c1917;
      --text-secondary: #57534e;
      --text-muted: #a8a29e;
      --teal: #FF4F00;
      --teal-light: #ff6a2a;
      --teal-dark: #e64500;
      --teal-glow: rgba(255, 79, 0, 0.15);
      --green: #16a34a;
    }
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    body {
      font-family: 'Sora', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      line-height: 1.6;
      position: relative;
      overflow-x: hidden;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: radial-gradient(circle at 1px 1px, rgba(28, 25, 23, 0.04) 1px, transparent 0);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 0;
    }
    body::after {
      content: '';
      position: fixed;
      top: -20%;
      left: 50%;
      transform: translateX(-50%);
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, var(--teal-glow), transparent 60%);
      pointer-events: none;
      z-index: 0;
      filter: blur(60px);
    }
    .card {
      position: relative;
      z-index: 1;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 40px 36px 32px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(28, 25, 23, 0.04);
    }
    .eyebrow {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--teal);
      background: rgba(255, 79, 0, 0.08);
      border: 1px solid rgba(255, 79, 0, 0.25);
      padding: 5px 11px;
      border-radius: 999px;
      margin-bottom: 18px;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.15;
      margin-bottom: 8px;
      color: var(--text);
    }
    h1 .grad {
      background: linear-gradient(90deg, var(--teal-light), var(--teal));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .subtitle {
      color: var(--text-secondary);
      font-size: 15px;
      margin-bottom: 24px;
    }
    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 10px;
      margin-bottom: 18px;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.5;
      border: 1px solid transparent;
      text-align: left;
    }
    .status .dot {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .waiting {
      background: rgba(255, 79, 0, 0.06);
      border-color: rgba(255, 79, 0, 0.2);
      color: var(--teal-dark);
    }
    .waiting .dot {
      background: var(--teal);
      box-shadow: 0 0 0 0 var(--teal-glow);
      animation: pulse 1.6s ease-in-out infinite;
    }
    .success {
      background: rgba(22, 163, 74, 0.07);
      border-color: rgba(22, 163, 74, 0.25);
      color: #15803d;
    }
    .success .dot {
      background: var(--green);
      box-shadow: 0 0 8px rgba(22, 163, 74, 0.6);
    }
    .error {
      background: rgba(220, 38, 38, 0.06);
      border-color: rgba(220, 38, 38, 0.22);
      color: #b91c1c;
    }
    .error .dot { background: #dc2626; }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255, 79, 0, 0.35); }
      50% { box-shadow: 0 0 0 6px rgba(255, 79, 0, 0); }
    }
    .info {
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.6;
      padding: 14px 16px;
      background: var(--bg-elevated);
      border-radius: 10px;
      text-align: left;
    }
    .info strong { color: var(--text); font-weight: 600; }
    .security {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      color: var(--text-muted);
      font-size: 12px;
      margin-top: 16px;
      line-height: 1.55;
      text-align: left;
    }
    .security svg { flex-shrink: 0; margin-top: 2px; color: var(--green); }
    .connect-btn {
      display: block;
      width: 100%;
      margin-bottom: 16px;
      padding: 13px 20px;
      border: none;
      border-radius: 10px;
      background: var(--teal);
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
    }
    .connect-btn:hover { background: var(--teal-dark); transform: translateY(-1px); }
    .connect-btn:disabled { opacity: 0.6; cursor: default; transform: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">OpenClaw × Byoky</div>
    <h1>${headline}</h1>
    <p class="subtitle">${subtitle}</p>
    <div id="status" class="status waiting">
      <span class="dot"></span>
      <span id="status-text">Click connect to link your wallet.</span>
    </div>
    <button id="connect-btn" class="connect-btn" type="button">Connect wallet</button>
    <p class="info">
      The <strong>Byoky extension</strong> must be installed in this browser.<br />
      The <strong>Byoky Bridge</strong> must be installed for the OpenClaw proxy to work.
    </p>
    <p class="security">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>API keys stay in your wallet; the local Byoky Bridge relays each call to it. A Claude setup token is the exception: the bridge makes those calls, holding the token in memory only.</span>
    </p>
  </div>
  <script src="/auth-sdk.js"></script>
  <script>
    (() => {
      const status = document.getElementById('status');
      const statusText = document.getElementById('status-text');
      const btn = document.getElementById('connect-btn');
      function setStatus(text, kind) {
        statusText.textContent = text;
        status.className = 'status ' + (kind || 'waiting');
      }

      // Reports to the OpenClaw login waiting in the terminal.
      async function report(path, body) {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ nonce: ${JSON.stringify(nonce)} }, body)),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      }

      async function startBridge(sessionKey) {
        return new Promise((resolve, reject) => {
          const bridgeRequestId = crypto.randomUUID();
          function handler(event) {
            const msg = event.detail;
            if (!msg || msg.requestId !== bridgeRequestId) return;
            document.removeEventListener('byoky-message', handler);
            resolve(msg.payload);
          }
          document.addEventListener('byoky-message', handler);
          window.postMessage({
            type: 'BYOKY_INTERNAL_FROM_PAGE',
            requestId: bridgeRequestId,
            action: 'startBridgeProxy',
            payload: { sessionKey, port: ${DEFAULT_BRIDGE_PORT} },
          }, window.location.origin);
          setTimeout(() => {
            document.removeEventListener('byoky-message', handler);
            reject(new Error('Bridge proxy start timed out'));
          }, 15000);
        });
      }

      async function runConnect() {
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        setStatus('Opening wallet…', 'waiting');
        // Restarts the login's timeout: it counts from this click.
        report('/started', {}).catch(() => {});
        try {
          if (!window.ByokySDK || !window.ByokySDK.Byoky || !window.ByokySDK.connectCovering) {
            throw new Error('SDK failed to load');
          }
          const byoky = new window.ByokySDK.Byoky({ timeout: 120000 });
          // An older wallet can hand back this page's session from an earlier
          // login with other providers; connectCovering then asks it again.
          const session = await window.ByokySDK.connectCovering(byoky, {
            providers: ${providersJson},
            modal: true,
          }, {
            onRetry: (missing) => setStatus(
              'Your wallet’s earlier session for this page lacks ' +
                (missing.length > 3 ? missing.length + ' of these providers' : missing.join(', ')) +
                '. Approve the new request in your wallet…',
              'waiting',
            ),
          });

          const providers = session.providers || {};
          const available = Object.entries(providers)
            .filter(([, v]) => v && v.available)
            .map(([id]) => id);

          if (available.length === 0) {
            throw new Error('No matching providers in your wallet');
          }

          const sessionKey = session.sessionKey || '';

          setStatus('Wallet connected — starting bridge proxy…', 'waiting');
          const bridgeResult = await startBridge(sessionKey);
          if (!bridgeResult || !bridgeResult.success) {
            throw new Error((bridgeResult && bridgeResult.error) || 'Bridge proxy failed to start');
          }
          const bridgePort = bridgeResult.port || ${DEFAULT_BRIDGE_PORT};
          const callbackBody = { providers: available, bridgePort };

          setStatus(
            'Bridge active on port ' + bridgePort + '. Connected ' + available.length +
              ' provider(s): ' + available.join(', '),
            'success',
          );

          btn.style.display = 'none';
          try {
            await report('/callback', callbackBody);
          } catch {
            setStatus('OpenClaw stopped waiting for this tab. Run the login command again.', 'error');
            return;
          }
          setTimeout(() => { setStatus('Done — you can close this tab.', 'success'); }, 1500);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          if (msg === 'User cancelled') {
            setStatus('Cancelled. Click connect to try again.', 'waiting');
          } else {
            setStatus('Error: ' + msg, 'error');
            // OpenClaw shows it too and keeps waiting for a retry here.
            report('/callback', { error: msg }).catch(() => {});
          }
          btn.disabled = false;
          btn.textContent = 'Try again';
        }
      }

      btn.addEventListener('click', runConnect);
    })();
  </script>
</body>
</html>`;
}
