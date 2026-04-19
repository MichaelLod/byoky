import { test, expect } from '@playwright/test';
import { launchWallet, loadApiKeys, startServer, type Wallet, type ApiKeys } from '../fixtures';

declare const chrome: {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
};

// Multi-device vault sync spec — one vault account, two devices.
// Exercises the pull-on-login and pull-on-unlock paths added when the
// vault flipped from upload-only backup to real bidirectional sync.
// Runs against the live https://vault.byoky.com so schema + endpoint
// changes shake out here before reaching real users.

const PASSWORD = 'MyStr0ng!P@ssw0rd';

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sharedUsername = `e2esync${runTag}`;

let walletA: Wallet;
let walletB: Wallet;
let apiKeys: ApiKeys;

async function sendInternalFromPopup<T>(popup: Wallet['popup'], action: string, payload?: unknown): Promise<T> {
  return popup.evaluate(
    async ({ action: a, payload: p }) => {
      return (await chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: a, payload: p })) as T;
    },
    { action, payload },
  );
}

async function setInputValue(popup: Wallet['popup'], selector: string, value: string) {
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
  await expect(w.popup.locator('button:has-text("Get Started")')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Get Started")');
  await w.popup.waitForSelector('#vault-username', { timeout: 10_000 });
  await setInputValue(w.popup, '#vault-username', username);
  await expect(w.popup.locator('text=Available').first()).toBeVisible({ timeout: 15_000 });
  await setInputValue(w.popup, '#password', PASSWORD);
  await w.popup.click('button:has-text("Continue")');
  await w.popup.waitForSelector('#confirm', { timeout: 10_000 });
  await setInputValue(w.popup, '#confirm', PASSWORD);
  await w.popup.click('button:has-text("Create account")');
  await expect(w.popup.locator('text=No API keys, tokens, or gifts yet')).toBeVisible({ timeout: 30_000 });
}

// Fresh wallet → "Sign in" tab on the Credentials step → same vault account.
// This is the real multi-device path: a user installs the extension on a
// second machine and joins an existing vault.
async function vaultLogin(w: Wallet, username: string) {
  await w.popup.bringToFront();
  await expect(w.popup.locator('button:has-text("Get Started")')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Get Started")');
  await w.popup.waitForSelector('#vault-username', { timeout: 10_000 });
  // Switch to the Sign in tab.
  await w.popup.click('button:has-text("Sign in")');
  await setInputValue(w.popup, '#vault-username', username);
  await setInputValue(w.popup, '#password', PASSWORD);
  await w.popup.click('button:has-text("Sign in")');
  // On successful login + pull, the dashboard renders. If the account has
  // synced credentials, they show up; otherwise the empty-state hint does.
  await w.popup.waitForSelector('text=/Wallet|No API keys/', { timeout: 30_000 });
}

async function addCredentialUI(w: Wallet, providerId: string, label: string, apiKey: string) {
  await w.popup.bringToFront();
  await w.popup.click('button[title="Wallet"]');
  await w.popup.click('button.fab-button');
  await w.popup.click('.fab-menu button:has-text("Add credential")');
  await w.popup.waitForSelector('#provider');
  await w.popup.selectOption('#provider', providerId);
  await w.popup.fill('#label', label);
  await w.popup.fill('#apiKey', apiKey);
  await w.popup.click('button:has-text("Save")');
  await expect(w.popup.locator(`text=${label}`).first()).toBeVisible({ timeout: 15_000 });
}

// Force a pull on a wallet that's already logged in without going through
// the UI. Locking and unlocking takes the quickest documented path — the
// unlock handler calls pullFromVault when a vault session is active.
async function relockAndPullFromVault(w: Wallet) {
  await w.popup.bringToFront();
  await sendInternalFromPopup(w.popup, 'lock');
  // Unlock via the UI so the store hydrates normally; the internal
  // `unlock` action runs pullFromVault in an enqueueVaultSync task.
  await w.popup.reload();
  await w.popup.waitForSelector('#unlock-password', { timeout: 10_000 });
  await setInputValue(w.popup, '#unlock-password', PASSWORD);
  await w.popup.click('button:has-text("Unlock")');
  await w.popup.waitForSelector('text=/Wallet|No API keys/', { timeout: 15_000 });
  // Give the background's async pull task a moment to complete before
  // the caller asserts on credentials.
  await w.popup.waitForTimeout(2000);
}

async function getLocalCredentials(w: Wallet): Promise<Array<{ id: string; providerId: string; label: string }>> {
  const res = await sendInternalFromPopup<{ credentials: Array<{ id: string; providerId: string; label: string }> }>(
    w.popup, 'getCredentials',
  );
  return res.credentials;
}

async function removeCredentialByLabel(w: Wallet, label: string) {
  const creds = await getLocalCredentials(w);
  const match = creds.find((c) => c.label === label);
  if (!match) throw new Error(`removeCredentialByLabel: no credential named ${label}`);
  await sendInternalFromPopup(w.popup, 'removeCredential', { id: match.id });
  // Let the vault soft-delete roundtrip settle.
  await w.popup.waitForTimeout(1500);
}

// ── Setup / teardown ───────────────────────────────────────

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  apiKeys = loadApiKeys();
  const port = await startServer();
  walletA = await launchWallet('SA', port);
  walletB = await launchWallet('SB', port);
});

test.afterAll(async () => {
  for (const w of [walletA, walletB].filter(Boolean) as Wallet[]) {
    try {
      await sendInternalFromPopup(w.popup, 'cloudVaultDeleteAccount');
    } catch { /* best effort */ }
    try { await w.ctx.close(); } catch { /* ignore */ }
  }
});

// ── Tests ──────────────────────────────────────────────────

test.describe('Byoky vault multi-device sync', () => {
  test('A — signup + add K1 (openai)', async () => {
    await vaultSignup(walletA, sharedUsername);
    await addCredentialUI(walletA, 'openai', 'Shared OpenAI', apiKeys.openai);

    const credsA = await getLocalCredentials(walletA);
    expect(credsA.find((c) => c.label === 'Shared OpenAI')).toBeTruthy();
  });

  test('B — fresh wallet logs into same vault → K1 pulled', async () => {
    await vaultLogin(walletB, sharedUsername);

    // After login, pullFromVault fills credentials from the server. Give
    // the background a beat to finish the async pull before asserting.
    await walletB.popup.waitForTimeout(2000);

    const credsB = await getLocalCredentials(walletB);
    expect(
      credsB.find((c) => c.label === 'Shared OpenAI' && c.providerId === 'openai'),
      `B should see K1 after login pull — got ${JSON.stringify(credsB)}`,
    ).toBeTruthy();
  });

  test('B — adds K2 (anthropic), syncs up', async () => {
    await addCredentialUI(walletB, 'anthropic', 'Shared Anthropic', apiKeys.anthropic);
    // Push is synchronous enough for the POST, but allow the meta write
    // to persist before we flip to A.
    await walletB.popup.waitForTimeout(1000);
  });

  test('A — relock + unlock triggers pull → K2 appears on A', async () => {
    await relockAndPullFromVault(walletA);

    const credsA = await getLocalCredentials(walletA);
    expect(
      credsA.find((c) => c.label === 'Shared Anthropic' && c.providerId === 'anthropic'),
      `A should see K2 after unlock pull — got ${JSON.stringify(credsA)}`,
    ).toBeTruthy();
    // K1 should still be there.
    expect(credsA.find((c) => c.label === 'Shared OpenAI')).toBeTruthy();
  });

  test('A — deletes K1, vault records tombstone', async () => {
    await removeCredentialByLabel(walletA, 'Shared OpenAI');
    const credsA = await getLocalCredentials(walletA);
    expect(credsA.find((c) => c.label === 'Shared OpenAI')).toBeFalsy();
  });

  test('B — relock + unlock → K1 tombstone applied locally', async () => {
    await relockAndPullFromVault(walletB);

    const credsB = await getLocalCredentials(walletB);
    expect(
      credsB.find((c) => c.label === 'Shared OpenAI'),
      `B should no longer have K1 after tombstone pull — got ${JSON.stringify(credsB)}`,
    ).toBeFalsy();
    // K2 is still there.
    expect(credsB.find((c) => c.label === 'Shared Anthropic')).toBeTruthy();
  });

  test('cleanup — delete vault account from A', async () => {
    const result = await sendInternalFromPopup<{ success?: boolean; error?: string }>(
      walletA.popup, 'cloudVaultDeleteAccount',
    );
    expect(result.error, `cloudVaultDeleteAccount error: ${result.error}`).toBeFalsy();
  });
});
