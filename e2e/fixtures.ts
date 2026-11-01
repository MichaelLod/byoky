import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import http from 'http';
import fs from 'fs';
import os from 'os';
import { installFakeProviders, type FakeProviders } from './fake-providers';

const EXTENSION_PATH = path.resolve(__dirname, '../packages/extension/.output/chrome-mv3');
const TEST_PAGE_DIR = path.resolve(__dirname, 'test-page');
const ENV_LOCAL_PATH = path.resolve(__dirname, '../.env.local');
const BRIDGE_DIR = path.resolve(__dirname, '../packages/bridge');

/**
 * Two modes:
 * - default: every provider is faked (fake-providers.ts) and every other
 *   host is blackholed, so the run needs no keys, costs nothing and is safe
 *   in CI. `pnpm test:e2e`.
 * - BYOKY_E2E_LIVE=1: the real keys from .env.local against the real
 *   providers, plus the specs that need them (OpenClaw, demo playground).
 *   `pnpm test:e2e:live`.
 * Both run headless; BYOKY_E2E_HEADED=1 shows the windows.
 */
export const LIVE = process.env.BYOKY_E2E_LIVE === '1';
const HEADED = process.env.BYOKY_E2E_HEADED === '1';

// Shaped like real keys; only the fakes ever see them.
const FAKE_KEYS: ApiKeys = {
  anthropic: 'sk-ant-api03-e2e-fake-anthropic-key',
  openai: 'sk-proj-e2e-fake-openai-key',
  gemini: 'AIza-e2e-fake-gemini-key',
};

export interface Wallet {
  ctx: BrowserContext;
  popup: Page;
  page: Page;
  extensionId: string;
  /** The fake providers' request log; null in live mode. */
  fakes: FakeProviders | null;
}

export interface ApiKeys {
  anthropic: string;
  openai: string;
  gemini: string;
}

interface TestFixtures {
  walletA: Wallet;
  apiKeys: ApiKeys;
}

let sharedA: Wallet | null = null;
let sharedApiKeys: ApiKeys | null = null;
let server: http.Server | null = null;
let serverPort = 0;

// Exported so a spec (openclaw-flow.spec.ts) can stand up its own fresh
// wallet without touching the shared fixture state.
export { launchWallet, loadApiKeys, startServer, bridgeBin };

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Live mode: the real keys from .env.local. Default mode: fake keys. */
function loadApiKeys(): ApiKeys {
  if (!LIVE) return FAKE_KEYS;
  const env = parseEnvFile(ENV_LOCAL_PATH);
  const anthropic = env.ANTHROPIC_API_KEY;
  const openai = env.OPENAI_API_KEY;
  const gemini = env.GEMINI_API_KEY;
  if (!anthropic || !openai || !gemini) {
    throw new Error(
      'Missing API keys in .env.local — need ANTHROPIC_API_KEY, OPENAI_API_KEY, and GEMINI_API_KEY for live e2e (see .env.local.example)',
    );
  }
  return { anthropic, openai, gemini };
}

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(TEST_PAGE_DIR, 'index.html'), 'utf-8'));
        return;
      }
      if (req.url?.startsWith('/sdk/')) {
        const filePath = path.resolve(__dirname, '../packages/sdk/dist', req.url.replace('/sdk/', ''));
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const contentType = ext === '.js' ? 'application/javascript' : 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(fs.readFileSync(filePath));
          return;
        }
      }
      if (req.url?.startsWith('/core/')) {
        const filePath = path.resolve(__dirname, '../packages/core/dist', req.url.replace('/core/', ''));
        if (fs.existsSync(filePath)) {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(fs.readFileSync(filePath));
          return;
        }
      }
      res.writeHead(404);
      res.end('Not found');
    });
    server.listen(0, () => {
      const addr = server!.address() as { port: number };
      serverPort = addr.port;
      resolve(serverPort);
    });
  });
}

/**
 * The bridge CLI under test: the workspace build, so a run checks the
 * bridge that ships with this extension, not whatever is installed
 * globally. BYOKY_E2E_BRIDGE points at another byoky-bridge.js.
 */
function bridgeBin(): string {
  const override = process.env.BYOKY_E2E_BRIDGE;
  if (override) {
    if (!fs.existsSync(override)) throw new Error(`BYOKY_E2E_BRIDGE=${override} does not exist`);
    return path.resolve(override);
  }
  if (!fs.existsSync(path.join(BRIDGE_DIR, 'dist', 'host.js'))) {
    throw new Error('packages/bridge is not built — run: pnpm --filter @byoky/bridge build (pnpm test:e2e does)');
  }
  return path.join(BRIDGE_DIR, 'bin', 'byoky-bridge.js');
}

/**
 * Write a native-messaging manifest into <user_data_dir>/NativeMessagingHosts/
 * so the extension can spawn the Byoky Bridge. Playwright's bundled Chromium
 * does NOT pick up the system-wide manifest at
 * ~/Library/Application Support/Chromium/NativeMessagingHosts/ when launched
 * with a custom user-data-dir, so we install a per-profile copy that points
 * at the workspace byoky-bridge CLI via a shell wrapper (Chrome spawns
 * native hosts with a minimal PATH, which is why we need the wrapper to set
 * PATH and call node with an absolute path).
 */
function installBridgeManifest(userDataDir: string, extensionId: string): void {
  const bin = bridgeBin();
  const nodeBin = process.execPath;
  const nodeDir = path.dirname(nodeBin);

  const hostsDir = path.join(userDataDir, 'NativeMessagingHosts');
  fs.mkdirSync(hostsDir, { recursive: true });

  const wrapperPath = path.join(hostsDir, 'byoky-bridge-host');
  const wrapper = [
    '#!/bin/bash',
    `export PATH='${nodeDir}:/usr/local/bin:/usr/bin:/bin'`,
    `exec '${nodeBin}' '${bin}' host "$@"`,
    '',
  ].join('\n');
  fs.writeFileSync(wrapperPath, wrapper);
  fs.chmodSync(wrapperPath, 0o755);

  const manifest = {
    name: 'com.byoky.bridge',
    description: 'Byoky Bridge (e2e test)',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  fs.writeFileSync(
    path.join(hostsDir, 'com.byoky.bridge.json'),
    JSON.stringify(manifest, null, 2),
  );
}

// Known-good id for the unpacked byoky extension at the build output path.
// Chromium derives extension IDs deterministically from the extension's
// absolute file path, so this is stable across runs. We pre-install the
// bridge manifest with this ID before launching; if the path ever changes,
// the first-run launch below would surface a mismatch.
const EXPECTED_EXTENSION_ID = 'ahhecmfcclkjdgjnmackoacldnmgmipl';

async function launchWallet(label: string, port: number): Promise<Wallet> {
  // Create a named user-data-dir so we can drop a NativeMessagingHosts
  // manifest into it BEFORE launch — Chromium doesn't re-scan after start,
  // but it does read the manifest fresh on each connectNative() call.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `byoky-e2e-${label}-`));
  installBridgeManifest(userDataDir, EXPECTED_EXTENSION_ID);

  // Headless uses Chromium's new headless mode (channel 'chromium'), which
  // still loads extensions and needs no display. The config's `headless`
  // and `--headed` don't apply to a persistent context launched here.
  const headless = !HEADED;
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless,
    ...(headless ? { channel: 'chromium' } : {}),
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
      // Never touch the macOS login keychain (it would prompt the user).
      '--use-mock-keychain',
      '--password-store=basic',
      // Default mode: nothing leaves the machine. The fakes answer the
      // provider hosts before DNS; anything they don't cover fails here.
      ...(LIVE ? [] : ['--host-resolver-rules=MAP * 127.0.0.1:9, EXCLUDE localhost']),
    ],
  });
  const fakes = LIVE ? null : await installFakeProviders(ctx, FAKE_KEYS);

  let extensionId = '';
  const workers = ctx.serviceWorkers();
  if (workers.length > 0) {
    extensionId = new URL(workers[0].url()).hostname;
  } else {
    const worker = await ctx.waitForEvent('serviceworker');
    extensionId = new URL(worker.url()).hostname;
  }
  if (extensionId !== EXPECTED_EXTENSION_ID) {
    // Rewrite the manifest with the real id — still works because Chromium
    // reads it lazily on connectNative().
    installBridgeManifest(userDataDir, extensionId);
  }
  // eslint-disable-next-line no-console
  console.log(`[${label}] extension id: ${extensionId}`);

  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForLoadState('domcontentloaded');

  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => '__byoky__' in window, { timeout: 10_000 });

  // Tag each window so console logs can be told apart if you tail them
  await popup.evaluate((l) => { document.title = `[${l}] popup`; }, label);
  await page.evaluate((l) => { document.title = `[${l}] page`; }, label);

  return { ctx, popup, page, extensionId, fakes };
}

async function ensureWallet() {
  if (sharedA) return;
  sharedApiKeys = loadApiKeys();
  const port = await startServer();
  sharedA = await launchWallet('A', port);
}

export const test = base.extend<TestFixtures>({
  walletA: async ({}, use) => {
    await ensureWallet();
    await use(sharedA!);
  },
  apiKeys: async ({}, use) => {
    await ensureWallet();
    await use(sharedApiKeys!);
  },
});

export { expect } from '@playwright/test';

test.afterAll(async () => {
  if (sharedA) { await sharedA.ctx.close(); sharedA = null; }
  if (server) { server.close(); server = null; }
  sharedApiKeys = null;
});
