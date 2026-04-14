import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { launchWallet, loadApiKeys, startServer, type Wallet, type ApiKeys } from '../fixtures';

declare const chrome: {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
};

// Live vault spec — hits https://vault.byoky.com and wss://relay.byoky.com.
// Each run signs up two fresh vault accounts (unique usernames), exercises
// every major feature with cloud vault enabled, tests gift fallback when the
// sender goes offline, and deletes both accounts at the end.

const PASSWORD = 'MyStr0ng!P@ssw0rd';

// Unique vault usernames per run — timestamp + random suffix keeps test
// accounts from colliding, and the regex `/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/`
// is satisfied by the `e2e…a`/`e2e…b` shape (18–22 chars, lowercase).
const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const usernameA = `e2etest${runTag}a`;
const usernameB = `e2etest${runTag}b`;

let walletA: Wallet;
let walletB: Wallet;
let apiKeys: ApiKeys;
let serverPort = 0;
let giftLink = '';
let groupIdA = '';
let demoOrigin = '';
// User data dir for wallet A so we can close + relaunch it to simulate
// "sender offline → vault takes over as fallback" without losing state.
let uddA = '';

// ── Helpers (mostly mirrors of live-flow.spec.ts) ──────────

async function connectFromPage(w: Wallet, providers: string[]) {
  await w.page.bringToFront();
  await w.page.evaluate((p) => {
    void (window as unknown as { _byoky: { connect: (p: string[]) => Promise<void> } })._byoky.connect(p);
  }, providers);
  await w.popup.bringToFront();
  await expect(w.popup.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Approve")');
  await w.page.bringToFront();
  await w.page.waitForFunction(
    () => {
      const s = (window as unknown as { _testState: { connected: boolean; error: string | null } })._testState;
      return s?.connected === true || s?.error != null;
    },
    { timeout: 20_000 },
  );
  const state = await w.page.evaluate(
    () => (window as unknown as { _testState: { connected: boolean; error: string | null } })._testState,
  );
  if (!state.connected) throw new Error(`connect failed: ${state.error}`);
}

async function sendFromPage(
  w: Wallet,
  method: 'sendAnthropic' | 'sendOpenAI' | 'sendGemini',
): Promise<{ response: unknown; proxyError: { status?: number; code?: string; message?: string } | null }> {
  await w.page.bringToFront();
  await w.page.evaluate((m) => {
    const s = (window as unknown as { _testState: { response: null; proxyError: null } })._testState;
    s.response = null;
    s.proxyError = null;
    void (window as unknown as { _byoky: Record<string, () => Promise<void>> })._byoky[m]();
  }, method);
  await w.page.waitForFunction(
    () => {
      const s = (window as unknown as { _testState: { response: unknown; proxyError: unknown } })._testState;
      return s.response != null || s.proxyError != null;
    },
    { timeout: 60_000 },
  );
  return w.page.evaluate(() => ({
    response: (window as unknown as { _testState: { response: unknown } })._testState.response,
    proxyError: (window as unknown as { _testState: { proxyError: unknown } })._testState.proxyError as { status?: number; code?: string; message?: string } | null,
  }));
}

async function sendInternalFromPopup<T = Record<string, unknown>>(
  popup: Wallet['popup'],
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return popup.evaluate(
    async ({ action: a, payload: p }) => {
      return (await chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: a, payload: p })) as T;
    },
    { action, payload },
  );
}

async function setInputValue(popup: Wallet['popup'], selector: string, value: string) {
  // page.fill() on Chromium can get corrupted by autofill/autocomplete
  // layering (we saw walletB's vault-username get "the" appended from
  // Chromium's form autofill after walletA's prior submission). Set the
  // value via the native React-compatible setter + a synthetic input
  // event — this dodges the browser's suggestion layer entirely.
  await popup.evaluate(
    ({ selector: s, value: v }) => {
      const el = document.querySelector(s) as HTMLInputElement | null;
      if (!el) throw new Error(`setInputValue: ${s} not found`);
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) throw new Error(`setInputValue: no value setter on ${s}`);
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { selector, value },
  );
}

async function vaultSignup(w: Wallet, username: string) {
  await w.popup.bringToFront();
  // Welcome → Get Started → vault form with signup tab pre-selected.
  await expect(w.popup.locator('button:has-text("Get Started")')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Get Started")');
  await w.popup.waitForSelector('#vault-username', { timeout: 10_000 });
  await setInputValue(w.popup, '#vault-username', username);
  // Wait for the async availability probe. The status hint confirms the
  // vault said this username is free.
  await expect(w.popup.locator('text=Available').first()).toBeVisible({ timeout: 15_000 });
  // Sanity check: confirm the input still holds exactly what we set. If
  // something (autofill, autocomplete) mutated it, fail loudly rather
  // than sending a corrupted username to the vault.
  const actualUsername = await w.popup.inputValue('#vault-username');
  expect(actualUsername, 'vault-username input value was mutated after fill').toBe(username);
  await setInputValue(w.popup, '#password', PASSWORD);
  await w.popup.click('button:has-text("Continue")');
  // Step 2: confirm password
  await w.popup.waitForSelector('#confirm', { timeout: 10_000 });
  await setInputValue(w.popup, '#confirm', PASSWORD);
  await w.popup.click('button:has-text("Create account")');
  // Dashboard shows the empty-state hint when signup lands successfully.
  await expect(w.popup.locator('text=No API keys, tokens, or gifts yet')).toBeVisible({ timeout: 30_000 });
  // Verify cloud vault actually came online (banner + state).
  const status = await sendInternalFromPopup<{ enabled: boolean; username?: string }>(
    w.popup, 'cloudVaultStatus',
  );
  expect(status.enabled, `vault signup for ${username} should leave cloudVaultEnabled=true`).toBe(true);
  expect(status.username).toBe(username);
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

// ── Setup / teardown ───────────────────────────────────────

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  apiKeys = loadApiKeys();
  serverPort = await startServer();
  walletA = await launchWallet('VA', serverPort);
  walletB = await launchWallet('VB', serverPort);
  // Capture A's user-data-dir so we can relaunch it later to test the
  // vault fallback path (close A, let vault fulfil, reopen A, verify).
  // launchWallet doesn't export the path directly, so peek at the
  // process args via Chromium's CDP... simpler: we know launchWallet
  // creates the dir via mkdtempSync under os.tmpdir() with prefix
  // `byoky-e2e-<label>-`. Find the most recent match.
  const candidates = fs.readdirSync(os.tmpdir())
    .filter((d) => d.startsWith('byoky-e2e-VA-'))
    .map((d) => ({ name: d, path: path.join(os.tmpdir(), d), mtime: fs.statSync(path.join(os.tmpdir(), d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) throw new Error('could not locate wallet A user-data-dir');
  uddA = candidates[0].path;
});

test.afterAll(async () => {
  // Best-effort vault account cleanup in case the test bailed partway.
  // The dedicated cleanup test (last test in the flow) does the real
  // delete; this catches the exceptional paths.
  for (const w of [walletA, walletB].filter(Boolean) as Wallet[]) {
    try {
      await sendInternalFromPopup(w.popup, 'cloudVaultDeleteAccount');
    } catch { /* popup may be closed or wallet locked — best effort */ }
    try { await w.ctx.close(); } catch { /* ignore */ }
  }
});

// ── Tests ──────────────────────────────────────────────────

test.describe('Byoky vault end-to-end flow', () => {
  test('wallet A — signup via VaultAuth against live vault', async () => {
    await vaultSignup(walletA, usernameA);
  });

  test('wallet B — signup via VaultAuth against live vault', async () => {
    await vaultSignup(walletB, usernameB);
  });

  test('wallet A — import real keys (synced to vault)', async () => {
    await addCredential(walletA, 'anthropic', 'Vault Anthropic A', apiKeys.anthropic);
    await addCredential(walletA, 'openai', 'Vault OpenAI A', apiKeys.openai);
    await addCredential(walletA, 'gemini', 'Vault Gemini A', apiKeys.gemini);
  });

  test('wallet B — import real keys (synced to vault)', async () => {
    await addCredential(walletB, 'anthropic', 'Vault Anthropic B', apiKeys.anthropic);
    await addCredential(walletB, 'openai', 'Vault OpenAI B', apiKeys.openai);
    await addCredential(walletB, 'gemini', 'Vault Gemini B', apiKeys.gemini);
  });

  test('wallet A — connect demo page with all providers', async () => {
    await connectFromPage(walletA, ['anthropic', 'openai', 'gemini']);
    demoOrigin = await walletA.page.evaluate(() => window.location.origin);
  });

  test('wallet A — real Anthropic call via bridge still works over vault', async () => {
    const { response, proxyError } = await sendFromPage(walletA, 'sendAnthropic');
    expect(proxyError, `anthropic proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { content?: Array<{ text?: string }> };
    expect(body.content?.[0]?.text).toBeTruthy();
  });

  test('wallet A — real OpenAI call over vault', async () => {
    const { response, proxyError } = await sendFromPage(walletA, 'sendOpenAI');
    expect(proxyError, `openai proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { choices?: Array<{ message?: { content?: string } }> };
    expect(body.choices?.[0]?.message?.content).toBeTruthy();
  });

  test('wallet A — real Gemini call over vault', async () => {
    const { response, proxyError } = await sendFromPage(walletA, 'sendGemini');
    expect(proxyError, `gemini proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    expect(body.candidates?.[0]?.content?.parts?.[0]?.text).toBeTruthy();
  });

  test('wallet A — create cross-family group routing anthropic→openai', async () => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Activity"]');
    await expect(walletA.popup.locator('button[role="tab"]:has-text("Active")')).toBeVisible({ timeout: 10_000 });
    await walletA.popup.click('button:has-text("+ New group")');
    const form = walletA.popup.locator('.card:has-text("Group name")').last();
    await form.locator('input[type="text"]').first().fill('Cross-family');
    await form.locator('select').first().selectOption('openai');
    await form.locator('input[list]').fill('gpt-4o-mini');
    await form.locator('button:has-text("Save")').click();
    await expect(walletA.popup.locator('.group-section:has-text("Cross-family")')).toBeVisible({ timeout: 5_000 });

    const groupsResult = await sendInternalFromPopup<{ groups: Array<{ id: string; name: string }> }>(
      walletA.popup, 'getGroups',
    );
    const group = groupsResult.groups.find((g) => g.name === 'Cross-family');
    expect(group).toBeTruthy();
    groupIdA = group!.id;
  });

  test('wallet A — assign demo origin to cross-family group', async () => {
    const result = await sendInternalFromPopup<{ error?: string }>(
      walletA.popup, 'setAppGroup', { origin: demoOrigin, groupId: groupIdA },
    );
    expect(result.error ?? null).toBeNull();
  });

  test('wallet A — translated request over vault-backed OpenAI credential', async () => {
    const { response, proxyError } = await sendFromPage(walletA, 'sendAnthropic');
    expect(proxyError, `translated proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { content?: Array<{ text?: string; type?: string }>; role?: string };
    expect(body.role).toBe('assistant');
    expect(body.content?.[0]?.type).toBe('text');
  });

  test('wallet A — request log confirms translation with actualProviderId=openai', async () => {
    const { log } = await sendInternalFromPopup<{
      log: Array<{ appOrigin: string; providerId: string; actualProviderId?: string; actualModel?: string; groupId?: string; status: number }>;
    }>(walletA.popup, 'getRequestLog');
    const translated = log.find(
      (e) => e.appOrigin === demoOrigin && e.providerId === 'anthropic' && e.actualProviderId === 'openai',
    );
    expect(translated, 'expected a translated request entry in log').toBeTruthy();
    expect(translated!.actualModel).toBe('gpt-4o-mini');
    expect(translated!.groupId).toBe(groupIdA);
    expect(translated!.status).toBeLessThan(400);
  });

  test('wallet A — move demo back to default group', async () => {
    const result = await sendInternalFromPopup<{ error?: string }>(
      walletA.popup, 'setAppGroup', { origin: demoOrigin, groupId: 'default' },
    );
    expect(result.error ?? null).toBeNull();
  });

  test('wallet A — create openai gift (registered with vault as fallback)', async () => {
    // Use OpenAI as the gift provider: OpenAI has a plain api_key, which
    // means the vault can fulfil fallback requests without needing the
    // bridge. Anthropic setup tokens can't go through vault fallback at
    // all since they require the local Claude Code CLI.
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Gifts"]');
    await walletA.popup.click('button:has-text("Create Gift")');
    await walletA.popup.waitForSelector('#gift-credential', { timeout: 5_000 });
    const { credentials } = await sendInternalFromPopup<{
      credentials: Array<{ id: string; providerId: string }>;
    }>(walletA.popup, 'getCredentials');
    const openai = credentials.find((c) => c.providerId === 'openai');
    expect(openai).toBeTruthy();
    await walletA.popup.selectOption('#gift-credential', openai!.id);
    await walletA.popup.locator('input[type="number"]').fill('500');
    await walletA.popup.click('button:has-text("Create Gift")');
    await expect(walletA.popup.locator('text=Gift Created')).toBeVisible({ timeout: 15_000 });
    giftLink = await walletA.popup.locator('.gift-link-text').innerText();
    expect(giftLink).toMatch(/^https:\/\/byoky\.com\/gift#/);
    await walletA.popup.click('button:has-text("Done")');
    // Give the background a moment to POST /gifts to the vault — the
    // registration runs inside enqueueVaultSync so it's async w.r.t. the
    // UI action.
    await walletA.popup.waitForTimeout(1500);
  });

  test('wallet B — redeem gift link', async () => {
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

  test('wallet B — remove own openai key so gift is the only route', async () => {
    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Wallet"]');
    const card = walletB.popup.locator('.card:has-text("Vault OpenAI B")');
    await card.locator('button:has-text("Remove")').click();
    await expect(walletB.popup.locator('text=Vault OpenAI B')).not.toBeVisible({ timeout: 5_000 });
  });

  test('wallet B — connect demo page (openai via gift)', async () => {
    await connectFromPage(walletB, ['openai']);
  });

  test('wallet B — gift proxy with sender online (normal relay path)', async () => {
    await walletB.page.waitForTimeout(2000);
    const { response, proxyError } = await sendFromPage(walletB, 'sendOpenAI');
    expect(proxyError, `gift proxy (online) error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { choices?: Array<{ message?: { content?: string } }> };
    expect(body.choices?.[0]?.message?.content).toBeTruthy();
  });

  // ── Vault fallback: sender goes offline, vault fulfils ───

  test('wallet A — close context (simulate sender offline)', async () => {
    await walletA.ctx.close();
    // Give the relay a moment to notice the sender socket dropped so the
    // next request actually routes through the vault fallback rather than
    // the still-cached primary connection.
    await new Promise((r) => setTimeout(r, 3000));
  });

  test('wallet B — gift proxy succeeds via VAULT FALLBACK while A is offline', async () => {
    const { response, proxyError } = await sendFromPage(walletB, 'sendOpenAI');
    expect(proxyError, `vault fallback proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { choices?: Array<{ message?: { content?: string } }> };
    expect(body.choices?.[0]?.message?.content).toBeTruthy();
  });

  // ── Reopen A, verify usage synced from vault, clean up ───

  test('wallet A — relaunch and unlock, verify gift usage synced from vault', async () => {
    // Reuse the original user-data-dir so vault session, stored creds,
    // and the gift registration all survive the relaunch. The bridge
    // manifest we wrote into <uddA>/NativeMessagingHosts/ is still there
    // from the first launch — Chromium reads it fresh on connectNative.
    const ctx = await chromium.launchPersistentContext(uddA, {
      headless: false,
      args: [
        `--disable-extensions-except=${path.resolve(__dirname, '../../packages/extension/.output/chrome-mv3')}`,
        `--load-extension=${path.resolve(__dirname, '../../packages/extension/.output/chrome-mv3')}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    const workers = ctx.serviceWorkers();
    const extensionId = workers.length > 0
      ? new URL(workers[0].url()).hostname
      : new URL((await ctx.waitForEvent('serviceworker')).url()).hostname;
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Wallet is locked after relaunch — unlock with the same password.
    await expect(popup.locator('#password')).toBeVisible({ timeout: 10_000 });
    await popup.fill('#password', PASSWORD);
    await popup.click('button:has-text("Unlock")');
    await expect(popup.locator('text=Vault OpenAI A')).toBeVisible({ timeout: 15_000 });

    // Confirm vault-reported gift usage picked up the request wallet B
    // made while A was offline.
    const { gifts } = await sendInternalFromPopup<{
      gifts: Array<{ id: string; usedTokens: number; active: boolean }>;
    }>(popup, 'getGifts');
    const active = gifts.find((g) => g.active);
    expect(active, 'active gift should still exist after relaunch').toBeTruthy();
    expect(active!.usedTokens).toBeGreaterThan(0);

    // Rebind walletA to the new context so the final cleanup tests can
    // delete the vault account from this (unlocked) popup.
    walletA = { ctx, popup, page: popup, extensionId };
  });

  test('wallet A — revoke gift + delete vault account', async () => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Gifts"]');
    const revoke = walletA.popup.locator('button:has-text("Revoke")').first();
    if (await revoke.isVisible().catch(() => false)) {
      await revoke.click();
    }
    // Delete account straight via the internal message — Settings has a
    // confirm() dialog we'd have to intercept otherwise.
    const res = await sendInternalFromPopup<{ error?: string; success?: boolean }>(
      walletA.popup, 'cloudVaultDeleteAccount',
    );
    expect(res.error ?? null).toBeNull();
  });

  test('wallet B — disconnect demo page + delete vault account', async () => {
    await walletB.page.bringToFront();
    await walletB.page.evaluate(() =>
      (window as unknown as { _byoky: { disconnect: () => void } })._byoky.disconnect(),
    );
    const res = await sendInternalFromPopup<{ error?: string; success?: boolean }>(
      walletB.popup, 'cloudVaultDeleteAccount',
    );
    expect(res.error ?? null).toBeNull();
  });
});
