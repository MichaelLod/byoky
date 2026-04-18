import { test, expect } from '@playwright/test';
import { launchWallet, loadApiKeys, startServer, type Wallet } from '../fixtures';
import { execSync } from 'node:child_process';
import { spawn as spawnPty, type IPty } from '@lydell/node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Full-stack e2e: real extension + real @byoky/bridge (native messaging) + real
// OpenClaw CLI + real @byoky/openclaw-plugin + real api.anthropic.com. Drops an
// sk-ant-oat setup token into the wallet, runs `openclaw models auth login`,
// approves the connection in the popup, then asks OpenClaw's agent to reply —
// the request traverses OpenClaw → HTTP :19280 → byoky-bridge → native messaging
// → extension background → api.anthropic.com, then back.
//
// Prereqs already satisfied by the host dev env:
//   - @byoky/bridge globally installed (fixtures.ts:installBridgeManifest)
//   - openclaw globally installed
//   - ANTHROPIC_API_KEY in .env.local starting with sk-ant-oat01-

const PASSWORD = 'MyStr0ng!P@ssw0rd';

let wallet: Wallet;
let walletB: Wallet | null = null;
let openclawHome = '';
let authProc: IPty | null = null;
let port = 0;
let giftLink = '';

declare const chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } };

async function setupWallet(w: Wallet) {
  await w.popup.bringToFront();
  // Welcome → BYOK link → password → confirm → Create wallet.
  await expect(w.popup.locator('button:has-text("Continue with your API keys")')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Continue with your API keys")');
  await w.popup.waitForSelector('#password', { timeout: 15_000 });
  await w.popup.fill('#password', PASSWORD);
  await w.popup.click('button:has-text("Continue")');
  await w.popup.waitForSelector('#confirm', { timeout: 10_000 });
  await w.popup.fill('#confirm', PASSWORD);
  await w.popup.click('button:has-text("Create wallet")');
  await expect(w.popup.locator('text=No API keys, tokens, or gifts yet')).toBeVisible({ timeout: 30_000 });
}

async function addCredential(w: Wallet, providerId: string, label: string, apiKey: string) {
  await w.popup.bringToFront();
  await w.popup.click('button[title="Wallet"]');
  await w.popup.click('button:has-text("Add credential")');
  await w.popup.waitForSelector('#provider');
  await w.popup.selectOption('#provider', providerId);
  const isSetupToken = providerId === 'anthropic' && apiKey.startsWith('sk-ant-oat01-');
  if (isSetupToken) {
    await w.popup.click('.auth-toggle-btn:has-text("Setup Token")');
  }
  await w.popup.fill('#label', label);
  await w.popup.fill('#apiKey', apiKey);
  await w.popup.click('button:has-text("Save")');
  await expect(w.popup.locator(`text=${label}`).first()).toBeVisible({ timeout: 15_000 });
}

function openclawEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: openclawHome,
    // VITEST=1 makes openclaw's browser-open module short-circuit (so the
    // plugin's `ctx.openUrl` becomes a no-op instead of spawning macOS's
    // real `open` into a user-facing browser). We find the plugin's
    // callback port ourselves via lsof and drive Playwright to it.
    VITEST: '1',
  };
}

function allLocalListeningPorts(): Set<number> {
  const set = new Set<number>();
  try {
    // -iTCP: TCP sockets. -sTCP:LISTEN: only listening. -P: numeric ports.
    // -n: numeric hosts. -Fn: machine-readable, one field per line.
    const out = execSync(`lsof -iTCP -sTCP:LISTEN -P -n -Fn`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n')) {
      const m = /^n(?:127\.0\.0\.1|\[::1\]|\*):(\d+)$/.exec(line);
      if (m) set.add(Number(m[1]));
    }
  } catch { /* ignore */ }
  return set;
}

function openclawSync(args: string[]): string {
  return execSync(['openclaw', ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' '), {
    env: openclawEnv(),
    encoding: 'utf-8',
  });
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${filePath}`);
}

async function waitForBridgeFree(timeoutMs = 10_000): Promise<void> {
  // Closing a wallet ctx terminates the extension's native messaging port,
  // which kills the bridge subprocess bound to :19280. But the port free-up
  // takes a moment. Poll /health — ECONNREFUSED means the port is free.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:19280/health', { signal: AbortSignal.timeout(500) });
      void res.text().catch(() => {});
    } catch {
      return; // connection refused — port is free
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(':19280 never freed — old bridge still bound');
}

/**
 * Runs the PTY-based `openclaw models auth login --provider byoky-anthropic`
 * flow against the given wallet. Returns when OpenClaw has persisted its
 * config and killed its interactive prompter. Matches the logic in the
 * original auth test (kept identical so both callers behave the same).
 */
async function runOpenclawAuthFlow(w: Wallet): Promise<void> {
  const portsBefore = allLocalListeningPorts();

  authProc = spawnPty(
    'openclaw',
    ['models', 'auth', 'login', '--provider', 'byoky-anthropic'],
    { name: 'xterm-color', cols: 120, rows: 30, cwd: openclawHome, env: openclawEnv() as unknown as { [key: string]: string } },
  );
  let ptyBuffer = '';
  authProc.onData((d: string) => {
    ptyBuffer += d;
    process.stdout.write(`[auth pty] ${d}`);
  });

  let authUrl = '';
  for (let i = 0; i < 80; i++) {
    const now = allLocalListeningPorts();
    const candidates = [...now].filter((p) => !portsBefore.has(p));
    for (const p of candidates) {
      try {
        const res = await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(500) });
        if (!res.ok) continue;
        const html = await res.text();
        if (html.includes('Byoky') && html.includes('BYOKY_CONNECT_REQUEST')) {
          authUrl = `http://127.0.0.1:${p}`;
          break;
        }
      } catch { /* probe failed */ }
    }
    if (authUrl) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!authUrl) {
    process.stderr.write(`[diag] pty tail:\n${ptyBuffer.slice(-2000)}\n`);
    throw new Error('plugin callback server never bound a new port');
  }
  process.stdout.write(`[diag] found plugin auth url: ${authUrl}\n`);

  w.page.on('console', (msg) => process.stdout.write(`[auth page console] ${msg.type()}: ${msg.text()}\n`));
  w.page.on('pageerror', (err) => process.stderr.write(`[auth page err] ${err.message}\n`));
  await w.page.goto(authUrl);
  await w.page.waitForLoadState('domcontentloaded');
  await new Promise((r) => setTimeout(r, 2000));

  await w.popup.bringToFront();
  await expect(w.popup.locator('text=wants to connect')).toBeVisible({ timeout: 20_000 });
  await w.popup.click('button:has-text("Approve")');

  const configPath = path.join(openclawHome, '.openclaw', 'openclaw.json');
  const prodInterval = setInterval(() => {
    try { authProc?.write('\r'); } catch { /* already exited */ }
  }, 500);
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(configPath)) {
        const text = fs.readFileSync(configPath, 'utf-8');
        if (text.includes('byoky-anthropic') && text.includes('19280')) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!fs.existsSync(configPath) || !fs.readFileSync(configPath, 'utf-8').includes('byoky-anthropic')) {
      process.stderr.write(`[diag] pty tail:\n${ptyBuffer.slice(-2000)}\n`);
      throw new Error('openclaw never persisted the byoky-anthropic provider config');
    }
  } finally {
    clearInterval(prodInterval);
  }
  authProc.kill();
  authProc = null;
}

async function waitForBridgeHealthy(timeoutMs = 10_000): Promise<{ providers?: string[] }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:19280/health');
      if (res.ok) return (await res.json()) as { providers?: string[] };
    } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('byoky-bridge /health never responded on :19280');
}

test.describe.configure({ mode: 'serial' });

test.describe('OpenClaw + byoky extension + bridge full flow', () => {
  test.beforeAll(async () => {
    // Isolated HOME so `openclaw plugins install` and the per-agent state
    // don't touch the dev's real ~/.openclaw.
    openclawHome = fs.mkdtempSync(path.join(os.tmpdir(), 'byoky-openclaw-e2e-'));
    fs.mkdirSync(path.join(openclawHome, '.openclaw'), { recursive: true });
    fs.mkdirSync(path.join(openclawHome, 'ws'), { recursive: true });

    // Install @byoky/openclaw-plugin into the isolated openclaw config.
    // --force makes the step idempotent across reruns.
    execSync('openclaw plugins install @byoky/openclaw-plugin --force', {
      env: openclawEnv(),
      stdio: 'inherit',
    });

    port = await startServer();
    wallet = await launchWallet('OC', port);
  });

  test.afterAll(async () => {
    if (authProc) {
      try { authProc.kill(); } catch { /* already exited */ }
      authProc = null;
    }
    // walletA may already be closed by the gift-handoff leg.
    try { await wallet?.ctx.close(); } catch { /* ignore */ }
    try { await walletB?.ctx.close(); } catch { /* ignore */ }
  });

  test('set up offline wallet', async () => {
    await setupWallet(wallet);
  });

  test('add anthropic setup token credential', async () => {
    const keys = loadApiKeys();
    expect(keys.anthropic.startsWith('sk-ant-oat01-')).toBe(true);
    await addCredential(wallet, 'anthropic', 'OC Anthropic', keys.anthropic);
  });

  test('openclaw models auth login + approve in popup', async () => {
    // Snapshot already-listening localhost ports so we can find ones that
    // appear after spawning openclaw.
    const portsBefore = allLocalListeningPorts();

    // `openclaw models auth login` has a hard `process.stdin.isTTY` check,
    // so we spawn it inside a real pseudo-terminal.
    authProc = spawnPty(
      'openclaw',
      ['models', 'auth', 'login', '--provider', 'byoky-anthropic'],
      {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: openclawHome,
        env: openclawEnv() as unknown as { [key: string]: string },
      },
    );
    let ptyBuffer = '';
    authProc.onData((d: string) => {
      ptyBuffer += d;
      process.stdout.write(`[auth pty] ${d}`);
    });

    // VITEST=1 makes openclaw's browser-open a no-op. Find the plugin's
    // callback server by polling for new localhost listeners and probing
    // them with GET / — the one that returns the byoky auth page wins.
    let authUrl = '';
    for (let i = 0; i < 80; i++) {
      const now = allLocalListeningPorts();
      const candidates = [...now].filter((p) => !portsBefore.has(p));
      for (const p of candidates) {
        try {
          const res = await fetch(`http://127.0.0.1:${p}/`, {
            signal: AbortSignal.timeout(500),
          });
          if (!res.ok) continue;
          const html = await res.text();
          if (html.includes('Byoky') && html.includes('BYOKY_CONNECT_REQUEST')) {
            authUrl = `http://127.0.0.1:${p}`;
            break;
          }
        } catch { /* probe failed */ }
      }
      if (authUrl) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!authUrl) {
      process.stderr.write(`[diag] pty tail:\n${ptyBuffer.slice(-2000)}\n`);
      throw new Error('plugin callback server never bound a new port');
    }
    process.stdout.write(`[diag] found plugin auth url: ${authUrl}\n`);

    // Drive Playwright to the plugin's auth page. The page's inline script
    // postMessages BYOKY_CONNECT_REQUEST — the extension content script
    // relays it to the background, which pops "wants to connect" UI.
    wallet.page.on('console', (msg) => process.stdout.write(`[auth page console] ${msg.type()}: ${msg.text()}\n`));
    wallet.page.on('pageerror', (err) => process.stderr.write(`[auth page err] ${err.message}\n`));
    await wallet.page.goto(authUrl);
    await wallet.page.waitForLoadState('domcontentloaded');
    // Give the extension content script + background a beat to process
    await new Promise((r) => setTimeout(r, 2000));

    await wallet.popup.bringToFront();
    await expect(wallet.popup.locator('text=wants to connect')).toBeVisible({ timeout: 20_000 });
    await wallet.popup.click('button:has-text("Approve")');

    // After approval the auth page fires a second postMessage
    // (startBridgeProxy) which triggers chrome.runtime.connectNative →
    // byoky-bridge spawns on :19280. The plugin's callback server then
    // receives the final POST and openclaw persists the config to
    // ~/.openclaw/openclaw.json. We watch the config for the provider
    // entry and then kill openclaw — it gets stuck on the final
    // `prompter.note("Provider notes")` waiting for a keypress otherwise.
    const configPath = path.join(openclawHome, '.openclaw', 'openclaw.json');
    const prodInterval = setInterval(() => {
      try { authProc?.write('\r'); } catch { /* already exited */ }
    }, 500);
    try {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(configPath)) {
          const text = fs.readFileSync(configPath, 'utf-8');
          if (text.includes('byoky-anthropic') && text.includes('19280')) break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!fs.existsSync(configPath) || !fs.readFileSync(configPath, 'utf-8').includes('byoky-anthropic')) {
        process.stderr.write(`[diag] pty tail:\n${ptyBuffer.slice(-2000)}\n`);
        throw new Error('openclaw never persisted the byoky-anthropic provider config');
      }
    } finally {
      clearInterval(prodInterval);
    }
    // Auth succeeded — tear down openclaw without waiting on prompter.note.
    authProc.kill();
    authProc = null;
  });

  test('byoky bridge is listening on :19280', async () => {
    // The extension should have spawned byoky-bridge host → proxy server via
    // native messaging during the approval step. Give it a moment to bind.
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:19280/health');
        if (res.ok) {
          const body = await res.json() as { status?: string; providers?: string[] };
          expect(body.status).toBe('ok');
          expect(body.providers).toContain('anthropic');
          return;
        }
      } catch { /* keep trying */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('byoky-bridge /health did not respond on :19280 within 5s');
  });

  test('create an openclaw agent bound to byoky-anthropic', async () => {
    openclawSync([
      'agents', 'add', 'byoky-test',
      '--workspace', path.join(openclawHome, 'ws'),
      '--model', 'byoky-anthropic/claude-haiku-4-5-20251001',
      '--non-interactive',
    ]);
  });

  test('openclaw agent → real extension → real bridge → api.anthropic.com', async () => {
    const out = openclawSync([
      'agent',
      '--agent', 'byoky-test',
      '--message', 'Reply with a single word: ready',
      '--local',
      '--timeout', '90',
    ]);
    // An upstream rejection surfaces as "HTTP 4xx"/"HTTP 5xx" in OpenClaw's
    // output — if we see that, the full pipeline isn't actually working.
    expect(out).not.toMatch(/HTTP 4\d{2}|HTTP 5\d{2}/);
    expect(out.length).toBeGreaterThan(0);
    process.stdout.write(`[agent output]\n${out}\n`);
  });

  // ─── Gift hand-off leg ───────────────────────────────────────────
  // Proves OpenClaw + the bridge can consume a *gifted* anthropic
  // credential held by a second wallet. The flow:
  //   walletA mints an anthropic gift → walletA closes (freeing :19280)
  //   → walletB launches, redeems gift → openclaw re-auths against
  //   walletB → bridge binds fresh → real call routes through walletB's
  //   gifted credential to api.anthropic.com.

  test('walletA mints anthropic gift for hand-off to walletB', async () => {
    await wallet.popup.bringToFront();
    await wallet.popup.click('button[title="Gifts"]');
    await wallet.popup.click('button:has-text("Create Gift")');
    await wallet.popup.waitForSelector('#gift-credential', { timeout: 5_000 });

    // getCredentials is how the existing cross-device specs pick the right
    // credential id — the dropdown options aren't identifiable by text.
    const { credentials } = await wallet.popup.evaluate(async () => {
      return (await chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'getCredentials' })) as {
        credentials: Array<{ id: string; providerId: string }>;
      };
    });
    const anthropic = credentials.find((c) => c.providerId === 'anthropic');
    expect(anthropic, 'walletA needs the anthropic credential from the earlier leg').toBeTruthy();
    await wallet.popup.selectOption('#gift-credential', anthropic!.id);

    await wallet.popup.locator('input[type="number"]').fill('2000');
    await wallet.popup.click('button:has-text("Create Gift")');
    await expect(wallet.popup.locator('text=Gift Created')).toBeVisible({ timeout: 15_000 });

    giftLink = await wallet.popup.locator('.gift-link-text').innerText();
    expect(giftLink).toMatch(/^https:\/\/byoky\.com\/gift\//);
    await wallet.popup.click('button:has-text("Done")');
  });

  test('tear down walletA, free :19280 bridge', async () => {
    await wallet.ctx.close();
    await waitForBridgeFree();
  });

  test('launch walletB and redeem the gift', async () => {
    walletB = await launchWallet('OCB', port);
    await setupWallet(walletB);
    // walletB has zero own credentials — the gift is the only anthropic
    // route. Redeem it via the popup flow.
    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Gifts"]');
    await walletB.popup.click('button:has-text("Redeem Gift")');
    await walletB.popup.waitForSelector('#gift-link', { timeout: 5_000 });
    await walletB.popup.fill('#gift-link', giftLink);
    await expect(walletB.popup.locator('.gift-preview')).toBeVisible({ timeout: 5_000 });
    await walletB.popup.click('button:has-text("Accept Gift")');
    await walletB.popup.click('button[title="Wallet"]');
    await expect(walletB.popup.locator('.gift-card')).toBeVisible({ timeout: 10_000 });
  });

  test('openclaw re-authenticates against walletB', async () => {
    // Same PTY dance as the original auth test — the helper handles the
    // callback-port discovery + popup approval + config-write wait.
    await runOpenclawAuthFlow(walletB!);
  });

  test('bridge is listening on :19280 (walletB instance) and reports anthropic', async () => {
    const body = await waitForBridgeHealthy();
    expect(body.providers).toContain('anthropic');
  });

  test('openclaw agent via walletB gifted credential → real anthropic.com call', async () => {
    const out = openclawSync([
      'agent',
      '--agent', 'byoky-test',
      '--message', 'Reply with a single word: ready',
      '--local',
      '--timeout', '90',
    ]);
    process.stdout.write(`[agent raw output via walletB gift]\n--BEGIN--\n${out}\n--END--\n`);
    // Tightened from the original `HTTP \d{3}` — bridge errors come back
    // as bare `502 {...}` without the `HTTP ` prefix, so the old regex
    // let this case slip through during the first-pass investigation.
    expect(out).not.toMatch(/\b[45]\d{2}\s*\{/);
    expect(out).not.toMatch(/HTTP [45]\d{2}/);
    expect(out).not.toMatch(/No API keys in your wallet/);
    expect(out.length).toBeGreaterThan(0);
  });
});
