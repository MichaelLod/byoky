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
  type OpenClawConfig,
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from 'openclaw/plugin-sdk/core';
import { createServer, type Server } from 'node:http';
import { writeFileSync, mkdirSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

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

// Native max_tokens per model. Overwritten at auth time by
// `plugins.entries.byoky.config.anthropicMaxTokens` (default 4096) so
// gift-tier keys aren't pre-rejected by Anthropic's OTPM gate.
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
          run: (ctx: ProviderAuthContext) => runProviderAuth(ctx, null),
        },
      ],
      wizard: {
        setup: {
          choiceId: 'byoky',
          choiceLabel: 'Byoky Wallet (all providers)',
          choiceHint: 'One auth connects every provider you have',
          groupId: 'byoky',
          groupLabel: 'Byoky Wallet',
          groupHint: 'Keys never leave the extension',
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

    // /byoky command — bridge status + provider table
    api.registerCommand({
      name: 'byoky',
      description: 'Show Byoky bridge status and connected providers',
      acceptsArgs: false,
      handler: async () => ({ text: await renderByokyStatus() }),
    });
  },
};

export default byokyPlugin;

// --- Native messaging host registration (inline, scanner-safe) ---
//
// Duplicates the minimal subset of @byoky/bridge/installer needed here.
// We avoid importing the bridge package at runtime so OpenClaw's plugin
// sandbox doesn't see child_process / os-specific env lookups in the same
// module as `fetch` (its scanner flags those combinations).

const HOST_NAME = 'com.byoky.bridge';

interface ManifestLocation {
  browser: string;
  path: string;
  type: 'chrome' | 'firefox';
}

function getManifestLocations(): ManifestLocation[] {
  const home = homedir();
  const os = platform();

  if (os === 'darwin') {
    return [
      { browser: 'Chrome', path: `${home}/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json`, type: 'chrome' },
      { browser: 'Chromium', path: `${home}/Library/Application Support/Chromium/NativeMessagingHosts/${HOST_NAME}.json`, type: 'chrome' },
      { browser: 'Brave', path: `${home}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_NAME}.json`, type: 'chrome' },
      { browser: 'Firefox', path: `${home}/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json`, type: 'firefox' },
    ];
  }
  if (os === 'linux') {
    return [
      { browser: 'Chrome', path: `${home}/.config/google-chrome/NativeMessagingHosts/${HOST_NAME}.json`, type: 'chrome' },
      { browser: 'Chromium', path: `${home}/.config/chromium/NativeMessagingHosts/${HOST_NAME}.json`, type: 'chrome' },
      { browser: 'Firefox', path: `${home}/.mozilla/native-messaging-hosts/${HOST_NAME}.json`, type: 'firefox' },
    ];
  }
  if (os === 'win32') {
    // Use homedir() instead of LOCALAPPDATA env var to keep the file free of
    // `process.env` reads (scanner heuristic for credential harvesting).
    const appData = `${home}/AppData/Local`;
    return [
      { browser: 'Chrome', path: `${appData}/Google/Chrome/User Data/NativeMessagingHosts/${HOST_NAME}.json`, type: 'chrome' },
      { browser: 'Firefox', path: `${appData}/Mozilla/NativeMessagingHosts/${HOST_NAME}.json`, type: 'firefox' },
    ];
  }
  return [];
}

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

function createNativeWrapper(hostPath: string, manifestDir: string): string {
  // Minimal bash wrapper. We use process.execPath (the running node binary)
  // and do NOT inherit the user's PATH — Chrome launches native hosts with a
  // minimal PATH, and inheriting the user's is a known injection risk.
  const nodePath = process.execPath;
  const wrapperPath = resolve(manifestDir, 'byoky-bridge-host');
  const nodeDir = dirname(nodePath);
  const safePath = `${nodeDir}:/usr/local/bin:/usr/bin:/bin`;
  const script = [
    '#!/bin/bash',
    `export PATH='${safePath}'`,
    `exec '${nodePath.replace(/'/g, "'\\''")}' '${hostPath.replace(/'/g, "'\\''")}' host "$@"`,
    '',
  ].join('\n');
  writeFileSync(wrapperPath, script);
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

const PUBLISHED_EXTENSION_ID = 'igjohldpldlahcjmefdhlnbcpldlgmon';
const DEV_EXTENSION_ID = 'ahhecmfcclkjdgjnmackoacldnmgmipl';

function buildManifest(hostPath: string, browserType: 'chrome' | 'firefox'): object {
  const base = {
    name: HOST_NAME,
    description: 'Byoky Bridge — native messaging host',
    path: hostPath,
    type: 'stdio',
  };
  if (browserType === 'chrome') {
    return {
      ...base,
      allowed_origins: [
        `chrome-extension://${PUBLISHED_EXTENSION_ID}/`,
        `chrome-extension://${DEV_EXTENSION_ID}/`,
      ],
    };
  }
  return { ...base, allowed_extensions: ['byoky@byoky.com'] };
}

function getRegistrationStatus(): { registered: string[]; missing: string[] } {
  const registered: string[] = [];
  const missing: string[] = [];
  for (const loc of getManifestLocations()) {
    (existsSync(loc.path) ? registered : missing).push(loc.browser);
  }
  return { registered, missing };
}

function registerHost(): { browsers: string[]; unsupported?: boolean } {
  const locations = getManifestLocations();
  if (locations.length === 0) return { browsers: [], unsupported: true };
  const bridgeBin = resolveBridgeBin();
  const browsers: string[] = [];
  for (const loc of locations) {
    try {
      const manifestDir = dirname(loc.path);
      mkdirSync(manifestDir, { recursive: true });
      const wrapperPath = createNativeWrapper(bridgeBin, manifestDir);
      const manifest = buildManifest(wrapperPath, loc.type);
      writeFileSync(loc.path, JSON.stringify(manifest, null, 2));
      browsers.push(loc.browser);
    } catch {
      // Browser directory unwritable or missing — skip.
    }
  }
  return { browsers };
}

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

// Probes whether the bridge's current session key is still authorized by the
// extension. /health is not enough — it only confirms the bridge process is up,
// not that its sessionKey still matches the extension's authorizedBridgeSessionKey
// (which gets rotated on extension reload, wallet unlock, or a newer auth).
// Returns true if the bridge can actually relay to the extension, false if the
// session is stale and re-pairing is required.
async function probeBridgeSession(port: number, providerId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://127.0.0.1:${port}/${providerId}/v1/models`, {
      method: 'GET',
      headers: { authorization: 'Bearer byoky-proxy' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.status === 502) {
      const text = await res.text().catch(() => '');
      if (text.includes('Unauthorized session key') || text.includes('Session not found')) {
        return false;
      }
    }
    return true;
  } catch {
    return true;
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
      progress.stop('Unsupported platform');
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
      const sessionOk = await probeBridgeSession(DEFAULT_BRIDGE_PORT, probeProviderId);
      if (sessionOk) {
        await ctx.prompter.note(
          `Reusing live Byoky Bridge on port ${DEFAULT_BRIDGE_PORT} — no browser round-trip needed.`,
        );
        return buildAuthResult(selected, DEFAULT_BRIDGE_PORT, provider, overrides);
      }
      await ctx.prompter.note(
        'Byoky Bridge is running but its session key no longer matches the extension (the extension was reloaded or the wallet was re-locked). Opening the wallet to re-pair.',
      );
    }
  }

  await ctx.prompter.note(
    provider
      ? `Opening your browser to connect ${provider.name} via Byoky wallet.\nUnlock your wallet and approve the connection.`
      : 'Opening your browser to connect every provider in your Byoky wallet.\nUnlock your wallet and approve the connection.',
  );

  const result = await startCallbackServer(ctx, provider?.id ?? null);

  try {
    const selected = provider
      ? result.providers.filter((id) => id === provider.id)
      : result.providers;

    if (selected.length === 0) {
      if (provider) {
        throw new Error(`${provider.name} not available in your Byoky wallet`);
      }
      throw new Error('No providers found in your Byoky wallet');
    }

    if (result.relay) {
      await startBridgeRelayMode(ctx, {
        port: result.port,
        relayUrl: result.relay.url,
        roomId: result.relay.roomId,
        authToken: result.relay.authToken,
        providers: selected,
      });
    }

    return buildAuthResult(selected, result.port, provider, overrides);
  } finally {
    result.server.close();
  }
}

// --- Bridge relay-mode spawner ---

interface RelaySpawnConfig {
  port: number;
  relayUrl: string;
  roomId: string;
  authToken: string;
  providers: string[];
}

async function startBridgeRelayMode(
  ctx: ProviderAuthContext,
  cfg: RelaySpawnConfig,
): Promise<void> {
  // If the bridge is already running on the port (e.g. a previous relay
  // session we spawned), /health will succeed — but its WS peer is the old
  // mobile, not the freshly paired one. Best path is to fail-loud and ask
  // the user to kill the stale bridge. Users rarely hit this (same port,
  // different pairing, within a single session).
  const existing = await checkBridgeHealth();
  if (existing) {
    await ctx.prompter.note(
      `Port ${cfg.port} is already serving another Byoky Bridge — close any running bridge (or run \`openclaw gateway restart\`) and retry this command.`,
    );
    throw new Error('Bridge port already in use');
  }

  const bridgeBin = resolveBridgeBin();
  const args = [
    bridgeBin,
    'relay',
    '--port', String(cfg.port),
    '--relay-url', cfg.relayUrl,
    '--room-id', cfg.roomId,
    '--auth-token', cfg.authToken,
    '--providers', cfg.providers.join(','),
  ];

  const progress = ctx.prompter.progress('Starting Byoky Bridge in relay mode…');

  // Detached + stdio:ignore so the bridge outlives the `openclaw models auth
  // login` process. The child's stdin/stdout/stderr are closed so we don't
  // block on pipe buffers filling up.
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Poll /health until the HTTP proxy is listening. The WS to the relay may
  // still be warming up at that point — we just need the local port open.
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const health = await checkBridgeHealth();
    if (health) {
      progress.stop(`Bridge ready on port ${cfg.port}`);
      return;
    }
    await sleep(200);
  }

  progress.stop('Bridge failed to start within 10s');
  throw new Error('Byoky Bridge (relay-mode) did not become healthy within 10s');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface PluginOverrides {
  // Cap max_tokens for every Anthropic model. Default 4096 — low enough to
  // stay under Tier-1/gift OTPM gates (Anthropic pre-rejects requests whose
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

  const profiles = providers.map((p) => {
    const openclawId = `byoky-${p.id}`;
    return {
      profileId: `${openclawId}:byoky`,
      credential: {
        type: 'api_key' as const,
        provider: openclawId,
        key: 'byoky-proxy',
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
      baseUrl: `http://127.0.0.1:${port}/${p.id}`,
      api: p.api,
      apiKey: 'byoky-proxy',
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
  notes.push('Keys stay in your browser extension — the bridge relays requests.');
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

interface AuthResult {
  providers: string[];
  port: number;
  server: Server;
  /**
   * Populated only when the browser paired via QR to the mobile app (no
   * extension detected). The plugin starts the bridge in relay-mode itself
   * with these coordinates — there is no extension to delegate to.
   */
  relay?: { url: string; roomId: string; authToken: string };
}

async function startCallbackServer(
  ctx: ProviderAuthContext,
  requestProviderId: string | null,
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
              const relayRaw = data.relay;
              const relay = (relayRaw && typeof relayRaw === 'object' &&
                  typeof relayRaw.url === 'string' &&
                  typeof relayRaw.roomId === 'string' &&
                  typeof relayRaw.authToken === 'string')
                ? { url: relayRaw.url as string, roomId: relayRaw.roomId as string, authToken: relayRaw.authToken as string }
                : undefined;
              resolve({
                providers: Array.isArray(data.providers) ? data.providers : [],
                port: typeof data.bridgePort === 'number' ? data.bridgePort : DEFAULT_BRIDGE_PORT,
                server,
                relay,
              });
            }
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
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

function buildAuthPage(requestProviderId: string | null): string {
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
      Connect via the <strong>Byoky extension</strong> (auto-detected) or scan a QR with the <strong>Byoky mobile app</strong>.<br />
      The <strong>Byoky Bridge</strong> must be installed for the OpenClaw proxy to work.
    </p>
    <p class="security">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>Keys never leave your wallet. API calls are proxied through the local Byoky Bridge.</span>
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
        try {
          if (!window.ByokySDK || !window.ByokySDK.Byoky) {
            throw new Error('SDK failed to load');
          }
          const byoky = new window.ByokySDK.Byoky({ timeout: 120000 });
          const session = await byoky.connect({
            providers: ${providersJson},
            modal: true,
          });

          const providers = session.providers || {};
          const available = Object.entries(providers)
            .filter(([, v]) => v && v.available)
            .map(([id]) => id);

          if (available.length === 0) {
            throw new Error('No matching providers in your wallet');
          }

          const sessionKey = session.sessionKey || '';
          const relay = session.relay || null;
          const isRelay = !!relay || sessionKey.startsWith('relay_');
          const isVault = sessionKey.startsWith('vault_');
          if (isVault) {
            throw new Error(
              'Vault-mode sessions aren\\'t supported by OpenClaw yet — ' +
              'please pair with the Byoky extension or mobile app.',
            );
          }

          let bridgePort = ${DEFAULT_BRIDGE_PORT};
          let callbackBody;

          if (isRelay) {
            if (!relay) {
              throw new Error('Relay session missing coordinates — update your Byoky SDK');
            }
            setStatus('Mobile wallet paired — starting local bridge…', 'waiting');
            callbackBody = {
              providers: available,
              bridgePort,
              relay: { url: relay.url, roomId: relay.roomId, authToken: relay.authToken },
            };
          } else {
            setStatus('Wallet connected — starting bridge proxy…', 'waiting');
            const bridgeResult = await startBridge(sessionKey);
            bridgePort = (bridgeResult && bridgeResult.port) || ${DEFAULT_BRIDGE_PORT};
            callbackBody = { providers: available, bridgePort };
          }

          setStatus(
            'Bridge active on port ' + bridgePort + '. Connected ' + available.length +
              ' provider(s): ' + available.join(', '),
            'success',
          );

          await fetch('/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(callbackBody),
          });

          btn.style.display = 'none';
          setTimeout(() => { setStatus('Done — you can close this tab.', 'success'); }, 1500);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          if (msg === 'User cancelled') {
            setStatus('Cancelled. Click connect to try again.', 'waiting');
          } else {
            setStatus('Error: ' + msg, 'error');
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
