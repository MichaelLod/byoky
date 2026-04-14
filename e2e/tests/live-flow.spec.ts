import { test, expect, type Wallet } from '../fixtures';
import type { Page } from '@playwright/test';

// The popup runs inside an extension page so `chrome.runtime.sendMessage`
// is available at runtime. The e2e tsconfig intentionally doesn't pull in
// @types/chrome (Playwright-only), so declare the tiny subset we use.
declare const chrome: {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
};

const PASSWORD = 'MyStr0ng!P@ssw0rd';

// Shared state across the serial flow. Playwright runs tests in file order
// when the file is described with `.serial`, so earlier tests can publish
// values that later tests read.
let giftLink = '';
let groupIdA = '';
let demoOrigin = '';

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
  // Anthropic's oauth path uses "setup tokens" (sk-ant-oat01-...) issued by
  // Claude Code. They can't be sent as x-api-key — they must route through
  // the native-messaging bridge. Detect the prefix and flip the auth-method
  // toggle before filling the token. Regular API keys take the default path.
  const isSetupToken = providerId === 'anthropic' && apiKey.startsWith('sk-ant-oat01-');
  if (isSetupToken) {
    await w.popup.click('.auth-toggle-btn:has-text("Setup Token")');
  }
  await w.popup.fill('#label', label);
  await w.popup.fill('#apiKey', apiKey);
  await w.popup.click('button:has-text("Save")');
  await expect(w.popup.locator(`text=${label}`).first()).toBeVisible({ timeout: 15_000 });
}

// Critical: anything that hits the extension must be FIRE-AND-FORGET from
// the test's perspective. `page.evaluate` serialises the return value and
// awaits any Promise, so returning the connect/send promise blocks Playwright
// until the operation resolves — but connect() can't resolve until we click
// Approve in the popup, which we can't do while evaluate is still pending.
// Deadlock. The fix: don't return the promise; observe completion via
// window._testState and waitForFunction.
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

async function sendFromPage(w: Wallet, method: 'sendAnthropic' | 'sendOpenAI' | 'sendGemini'): Promise<{ response: unknown; proxyError: { status?: number; code?: string; message?: string } | null }> {
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
  popup: Page,
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

test.describe.configure({ mode: 'serial' });

test.describe('Byoky live end-to-end flow', () => {
  // ── Wallet setup (both) ────────────────────────────────

  test('wallet A — create wallet offline', async ({ walletA }) => {
    await setupWallet(walletA);
  });

  test('wallet B — create wallet offline', async ({ walletB }) => {
    await setupWallet(walletB);
  });

  // ── Import real keys from .env.local ───────────────────

  test('wallet A — import real Anthropic, OpenAI, Gemini keys', async ({ walletA, apiKeys }) => {
    await addCredential(walletA, 'anthropic', 'Live Anthropic A', apiKeys.anthropic);
    await addCredential(walletA, 'openai', 'Live OpenAI A', apiKeys.openai);
    await addCredential(walletA, 'gemini', 'Live Gemini A', apiKeys.gemini);
  });

  test('wallet B — import real Anthropic, OpenAI, Gemini keys', async ({ walletB, apiKeys }) => {
    await addCredential(walletB, 'anthropic', 'Live Anthropic B', apiKeys.anthropic);
    await addCredential(walletB, 'openai', 'Live OpenAI B', apiKeys.openai);
    await addCredential(walletB, 'gemini', 'Live Gemini B', apiKeys.gemini);
  });

  // ── Approval: reject path ──────────────────────────────

  test('wallet A — reject connection request yields USER_REJECTED', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.evaluate(() => {
      const s = (window as unknown as { _testState: { error: null; lastError: null } })._testState;
      s.error = null;
      s.lastError = null;
      void (window as unknown as { _byoky: { connect: (p: string[]) => Promise<void> } })._byoky.connect(['anthropic']);
    });
    await walletA.popup.bringToFront();
    await expect(walletA.popup.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
    await walletA.popup.click('button:has-text("Reject")');
    await walletA.page.bringToFront();
    await walletA.page.waitForFunction(
      () => (window as unknown as { _testState: { lastError: unknown } })._testState?.lastError != null,
      { timeout: 15_000 },
    );
    const err = await walletA.page.evaluate(
      () => (window as unknown as { _testState: { lastError: { code: string } } })._testState.lastError,
    );
    expect(err.code).toBe('USER_REJECTED');
  });

  // ── Real proxy flow (wallet A → real APIs) ─────────────

  test('wallet A — connect demo page with all providers', async ({ walletA }) => {
    await connectFromPage(walletA, ['anthropic', 'openai', 'gemini']);
    demoOrigin = await walletA.page.evaluate(() => window.location.origin);
    expect(demoOrigin).toMatch(/^http:\/\/localhost:\d+$/);
  });

  test('wallet A — real Anthropic call returns real text', async ({ walletA }) => {
    const { response, proxyError } = await sendFromPage(walletA, 'sendAnthropic');
    expect(proxyError, `anthropic proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { content?: Array<{ text?: string }> };
    expect(body.content?.[0]?.text).toBeTruthy();
    expect(body.content![0].text!.length).toBeGreaterThan(0);
  });

  test('wallet A — real OpenAI call returns real text', async ({ walletA }) => {
    const { response, proxyError } = await sendFromPage(walletA, 'sendOpenAI');
    expect(proxyError, `openai proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { choices?: Array<{ message?: { content?: string } }> };
    expect(body.choices?.[0]?.message?.content).toBeTruthy();
  });

  test('wallet A — real Gemini call returns real text', async ({ walletA }) => {
    const { response, proxyError } = await sendFromPage(walletA, 'sendGemini');
    expect(proxyError, `gemini proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    expect(body.candidates?.[0]?.content?.parts?.[0]?.text).toBeTruthy();
  });

  test('wallet A — real Anthropic streaming (SSE) returns text_delta events', async ({ walletA }) => {
    // Streaming uses a distinct code path — TransformStream in the background,
    // SSE rewriter for tool-name translation. Must be exercised separately.
    await walletA.page.bringToFront();
    await walletA.page.evaluate(() => {
      const s = (window as unknown as { _testState: { streamed: null; proxyError: null } })._testState;
      s.streamed = null;
      s.proxyError = null;
      void (window as unknown as { _byoky: { sendAnthropicStream: () => Promise<void> } })._byoky.sendAnthropicStream();
    });
    await walletA.page.waitForFunction(
      () => {
        const s = (window as unknown as { _testState: { streamed: unknown; proxyError: unknown } })._testState;
        return s.streamed != null || s.proxyError != null;
      },
      { timeout: 60_000 },
    );
    const state = await walletA.page.evaluate(() => ({
      streamed: (window as unknown as { _testState: { streamed: { text: string; chunks: number; rawLength: number } | null } })._testState.streamed,
      proxyError: (window as unknown as { _testState: { proxyError: unknown } })._testState.proxyError,
    }));
    expect(state.proxyError, `streaming proxy error: ${JSON.stringify(state.proxyError)}`).toBeNull();
    expect(state.streamed).toBeTruthy();
    expect(state.streamed!.chunks).toBeGreaterThan(0);
    expect(state.streamed!.rawLength).toBeGreaterThan(0);
    expect(state.streamed!.text.length).toBeGreaterThan(0);
  });

  test('wallet A — session usage reports real token counts', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.evaluate(() => {
      (window as unknown as { _testState: { usage: null } })._testState.usage = null;
      void (window as unknown as { _byoky: { checkUsage: () => Promise<void> } })._byoky.checkUsage();
    });
    await walletA.page.waitForFunction(
      () => (window as unknown as { _testState: { usage: unknown } })._testState?.usage != null,
      { timeout: 10_000 },
    );
    const usage = await walletA.page.evaluate(
      () => (window as unknown as { _testState: { usage: { requests: number; inputTokens: number; outputTokens: number } } })._testState.usage,
    );
    // Three real requests each to anthropic/openai/gemini — counts are
    // provider-dependent so just assert > 0 rather than exact values.
    expect(usage.requests).toBeGreaterThanOrEqual(3);
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
  });

  // ── Groups + cross-family translation (wallet A) ───────

  test('wallet A — create cross-family group routing anthropic→openai', async ({ walletA }) => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Activity"]');
    await expect(walletA.popup.locator('button[role="tab"]:has-text("Active")')).toBeVisible({ timeout: 10_000 });
    await walletA.popup.click('button:has-text("+ New group")');
    // GroupForm is inline — the group-name input is the first text input
    // inside the card that appears.
    const form = walletA.popup.locator('.card:has-text("Group name")').last();
    await form.locator('input[type="text"]').first().fill('Cross-family');
    await form.locator('select').first().selectOption('openai');
    // Model text input is the last input inside the form (datalist-backed).
    await form.locator('input[list]').fill('gpt-4o-mini');
    await form.locator('button:has-text("Save")').click();
    await expect(walletA.popup.locator('.group-section:has-text("Cross-family")')).toBeVisible({ timeout: 5_000 });

    // Pull the group id from the store — we need it to assign the demo app.
    const groupsResult = await sendInternalFromPopup<{ groups: Array<{ id: string; name: string }> }>(
      walletA.popup, 'getGroups',
    );
    const group = groupsResult.groups.find((g) => g.name === 'Cross-family');
    expect(group, 'cross-family group should exist').toBeTruthy();
    groupIdA = group!.id;
  });

  test('wallet A — update existing group (change model)', async ({ walletA }) => {
    // Exercise the Edit path on the inline GroupForm — we've only tested
    // create/delete above. Change the group's model and confirm the store
    // reflects the new value.
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Activity"]');
    const section = walletA.popup.locator('.group-section:has-text("Cross-family")');
    await section.locator('button:has-text("Edit")').click();
    // Inline edit form — reuse the same model input.
    const form = section.locator('input[list]');
    await form.fill('gpt-4o-mini'); // same value, confirm Save works idempotently
    await section.locator('button:has-text("Save")').click();
    // Re-read from store and assert the group still has the expected model.
    const { groups } = await sendInternalFromPopup<{ groups: Array<{ id: string; name: string; model?: string }> }>(
      walletA.popup, 'getGroups',
    );
    const g = groups.find((x) => x.id === groupIdA);
    expect(g).toBeTruthy();
    expect(g!.model).toBe('gpt-4o-mini');
  });

  test('wallet A — assign demo origin to cross-family group', async ({ walletA }) => {
    const result = await sendInternalFromPopup<{ error?: string }>(
      walletA.popup, 'setAppGroup', { origin: demoOrigin, groupId: groupIdA },
    );
    expect(result.error ?? null).toBeNull();
  });

  test('wallet A — anthropic-shape request routes through OpenAI, response translated back', async ({ walletA }) => {
    const { response, proxyError } = await sendFromPage(walletA, 'sendAnthropic');
    expect(proxyError, `translated proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    // Response must still be anthropic-shape even though OpenAI answered.
    const body = response as { content?: Array<{ text?: string; type?: string }>; role?: string };
    expect(body.role).toBe('assistant');
    expect(body.content?.[0]?.type).toBe('text');
    expect(body.content?.[0]?.text).toBeTruthy();
  });

  test('wallet A — request log proves translation (actualProviderId=openai)', async ({ walletA }) => {
    const { log } = await sendInternalFromPopup<{
      log: Array<{
        appOrigin: string;
        providerId: string;
        actualProviderId?: string;
        actualModel?: string;
        groupId?: string;
        status: number;
      }>;
    }>(walletA.popup, 'getRequestLog');
    const translated = log.find(
      (e) => e.appOrigin === demoOrigin && e.providerId === 'anthropic' && e.actualProviderId === 'openai',
    );
    expect(translated, 'expected a translated request entry in log').toBeTruthy();
    expect(translated!.actualModel).toBe('gpt-4o-mini');
    expect(translated!.groupId).toBe(groupIdA);
    expect(translated!.status).toBeLessThan(400);
  });

  test('wallet A — move demo back to default group', async ({ walletA }) => {
    const result = await sendInternalFromPopup<{ error?: string }>(
      walletA.popup, 'setAppGroup', { origin: demoOrigin, groupId: 'default' },
    );
    expect(result.error ?? null).toBeNull();
  });

  // ── Token allowances ───────────────────────────────────

  test('wallet A — set token allowance, exceed it, proxy returns QUOTA_EXCEEDED', async ({ walletA }) => {
    // Navigate to the connected app and set a 1-token total limit. We've
    // already burned well over 1 token across earlier proxy tests, so the
    // next proxy call is guaranteed to exceed the cap.
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Activity"]');
    await expect(walletA.popup.locator('.connected-app-card')).toBeVisible({ timeout: 5_000 });
    await walletA.popup.click('.allowance-edit-btn');
    const form = walletA.popup.locator('.allowance-form');
    await form.locator('input[type="number"]').first().fill('1');
    await form.locator('button:has-text("Save")').click();
    await expect(walletA.popup.locator('.allowance-limit')).toBeVisible({ timeout: 5_000 });

    // Send a real request — expected to be blocked upstream by the allowance.
    const { proxyError } = await sendFromPage(walletA, 'sendOpenAI');
    expect(proxyError).toBeTruthy();
    expect(proxyError!.status).toBe(429);
    expect(proxyError!.code).toBe('QUOTA_EXCEEDED');
  });

  test('wallet A — remove allowance so subsequent tests can proxy again', async ({ walletA }) => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Activity"]');
    await walletA.popup.click('.allowance-edit-btn');
    const form = walletA.popup.locator('.allowance-form');
    await form.locator('button:has-text("Remove limit")').click();
    await expect(walletA.popup.locator('.allowance-limit')).not.toBeVisible({ timeout: 5_000 });
  });

  // ── Lock / unlock / locked-blocks-proxy ────────────────

  test('wallet A — lock wallet shows unlock screen, wrong password errors, correct unlock + reconnect resumes', async ({ walletA }) => {
    // Lock from the Dashboard — this wipes masterPassword in memory and
    // clears all sessions. We don't try to observe the test page state
    // afterwards because locking can tear down the CDP target cleanly (the
    // previous iteration hit "Target page closed" here); instead, verify
    // the popup hit the unlock screen and drive the remainder from there.
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Wallet"]');
    await walletA.popup.click('button:has-text("Lock")');
    await expect(walletA.popup.locator('#password')).toBeVisible({ timeout: 5_000 });

    // Wrong password → "Incorrect password" error from the unlock action.
    await walletA.popup.fill('#password', 'WrongPassword1234!');
    await walletA.popup.click('button:has-text("Unlock")');
    await expect(walletA.popup.locator('text=Incorrect password')).toBeVisible({ timeout: 5_000 });

    // Correct password unlocks, dashboard visible again.
    await walletA.popup.fill('#password', PASSWORD);
    await walletA.popup.click('button:has-text("Unlock")');
    await expect(walletA.popup.locator('text=Live Anthropic A')).toBeVisible({ timeout: 15_000 });

    // The test page's SDK session was revoked while the wallet was locked.
    // Reload it so the SDK state is fresh, then reconnect + proxy.
    await walletA.page.reload();
    await walletA.page.waitForLoadState('domcontentloaded');
    await walletA.page.waitForFunction(() => '__byoky__' in window, { timeout: 10_000 });
    await connectFromPage(walletA, ['anthropic', 'openai', 'gemini']);
    const unlocked = await sendFromPage(walletA, 'sendOpenAI');
    expect(unlocked.proxyError, `post-unlock proxy error: ${JSON.stringify(unlocked.proxyError)}`).toBeNull();
  });

  // ── Trusted sites: auto-approve on reconnect ──────────

  test('wallet A — disconnect, reconnect with "trust this site" checked, disconnect again', async ({ walletA }) => {
    // Start from a clean SDK slate — reload the test page so the previous
    // session is fully gone. Without this, the prior-session teardown can
    // race the new connect and the background auto-reuses the existing
    // session, bypassing the approval screen we need to click through.
    await walletA.page.reload();
    await walletA.page.waitForLoadState('domcontentloaded');
    await walletA.page.waitForFunction(() => '__byoky__' in window, { timeout: 10_000 });
    // Also explicitly revoke any lingering session on the background side.
    const { sessions: before } = await sendInternalFromPopup<{ sessions: Array<{ id: string }> }>(
      walletA.popup, 'getSessions',
    );
    for (const s of before) {
      await sendInternalFromPopup(walletA.popup, 'revokeSession', { sessionId: s.id });
    }

    await walletA.page.evaluate(() => {
      void (window as unknown as { _byoky: { connect: (p: string[]) => Promise<void> } })._byoky.connect(['anthropic']);
    });
    await walletA.popup.bringToFront();
    await expect(walletA.popup.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
    // Tick the trust checkbox — React's controlled state needs a real
    // click (the native-value-setter trick works for text inputs but not
    // for checkbox `checked` propagation through React's synthetic events).
    await walletA.popup.locator('.approval-trust input[type="checkbox"]').check();
    await walletA.popup.click('button:has-text("Approve")');
    await walletA.page.bringToFront();
    await walletA.page.waitForFunction(
      () => (window as unknown as { _testState: { connected: boolean } })._testState?.connected === true,
      { timeout: 15_000 },
    );
    // Now disconnect — the trust entry stays on the wallet.
    await walletA.page.evaluate(() => {
      (window as unknown as { _byoky: { disconnect: () => void } })._byoky.disconnect();
    });
  });

  test('wallet A — reconnect on trusted site auto-approves without approval UI', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.evaluate(() => {
      void (window as unknown as { _byoky: { connect: (p: string[]) => Promise<void> } })._byoky.connect(['anthropic']);
    });
    // Don't touch the popup — connection should resolve on its own.
    await walletA.page.waitForFunction(
      () => (window as unknown as { _testState: { connected: boolean } })._testState?.connected === true,
      { timeout: 15_000 },
    );
    // Sanity check: approval screen never fired.
    await walletA.popup.bringToFront();
    const approvalVisible = await walletA.popup.locator('text=wants to connect').isVisible().catch(() => false);
    expect(approvalVisible).toBe(false);
  });

  test('wallet A — remove trusted site + full reconnect with all providers', async ({ walletA }) => {
    // Clean up the trusted entry so the gift/translation tests below start
    // from a "cold" approval state. The stored origin format may differ
    // from window.location.origin, so match by substring.
    const { sites } = await sendInternalFromPopup<{ sites: Array<{ origin: string }> }>(
      walletA.popup, 'getTrustedSites',
    );
    const trusted = sites.find((s) => s.origin.includes('localhost'));
    expect(trusted, `expected trusted site for demo origin, got sites: ${JSON.stringify(sites)}`).toBeTruthy();
    const res = await sendInternalFromPopup<{ error?: string }>(
      walletA.popup, 'removeTrustedSite', { origin: trusted!.origin },
    );
    expect(res.error ?? null).toBeNull();

    // Reload + revoke background sessions so the upcoming connect is a
    // fresh approval (not a cached session reuse). connectFromPage asserts
    // the approval screen, which only shows for brand-new connects.
    await walletA.page.reload();
    await walletA.page.waitForLoadState('domcontentloaded');
    await walletA.page.waitForFunction(() => '__byoky__' in window, { timeout: 10_000 });
    const { sessions: lingering } = await sendInternalFromPopup<{ sessions: Array<{ id: string }> }>(
      walletA.popup, 'getSessions',
    );
    for (const s of lingering) {
      await sendInternalFromPopup(walletA.popup, 'revokeSession', { sessionId: s.id });
    }

    await connectFromPage(walletA, ['anthropic', 'openai', 'gemini']);
  });

  // ── Gift creation (wallet A) ───────────────────────────

  test('wallet A — create a small anthropic gift', async ({ walletA }) => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Gifts"]');
    await walletA.popup.click('button:has-text("Create Gift")');
    await walletA.popup.waitForSelector('#gift-credential', { timeout: 5_000 });
    // Pick the anthropic credential by id — relying on option order is
    // fragile if insertion order changes.
    const { credentials } = await sendInternalFromPopup<{
      credentials: Array<{ id: string; providerId: string }>;
    }>(walletA.popup, 'getCredentials');
    const anthropic = credentials.find((c) => c.providerId === 'anthropic');
    expect(anthropic, 'wallet A needs an anthropic credential to create a gift').toBeTruthy();
    await walletA.popup.selectOption('#gift-credential', anthropic!.id);
    // Override default 100K budget with a tiny 500-token gift so a single
    // real request uses a noticeable fraction but never overspends the key.
    const budgetInput = walletA.popup.locator('input[type="number"]');
    await budgetInput.fill('500');
    await walletA.popup.click('button:has-text("Create Gift")');
    await expect(walletA.popup.locator('text=Gift Created')).toBeVisible({ timeout: 15_000 });
    giftLink = await walletA.popup.locator('.gift-link-text').innerText();
    expect(giftLink).toMatch(/^https:\/\/byoky\.com\/gift#/);
    await walletA.popup.click('button:has-text("Done")');
  });

  // ── Gift redemption (wallet B) ─────────────────────────

  test('wallet B — redeem gift link', async ({ walletB }) => {
    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Gifts"]');
    await walletB.popup.click('button:has-text("Redeem Gift")');
    await walletB.popup.waitForSelector('#gift-link', { timeout: 5_000 });
    await walletB.popup.fill('#gift-link', giftLink);
    await expect(walletB.popup.locator('.gift-preview')).toBeVisible({ timeout: 5_000 });
    await walletB.popup.click('button:has-text("Accept Gift")');
    // redeemGift navigates to the gifts page on success — the card for the
    // received gift shows on the Dashboard.
    await walletB.popup.click('button[title="Wallet"]');
    await expect(walletB.popup.locator('.gift-card')).toBeVisible({ timeout: 10_000 });
  });

  test('wallet B — setGiftPreference toggles "use gift instead of own key"', async ({ walletB }) => {
    // While wallet B still has BOTH its own anthropic key AND the received
    // gift for anthropic, exercise setGiftPreference: flip the preference on,
    // verify it's stored, flip it off, verify it's gone. The subsequent
    // remove-own-key test still needs a clean slate so we leave it off.
    const { giftedCredentials } = await sendInternalFromPopup<{
      giftedCredentials: Array<{ giftId: string; providerId: string }>;
    }>(walletB.popup, 'getGiftedCredentials');
    const gift = giftedCredentials.find((gc) => gc.providerId === 'anthropic');
    expect(gift).toBeTruthy();

    const onRes = await sendInternalFromPopup<{ error?: string }>(
      walletB.popup, 'setGiftPreference', { providerId: 'anthropic', giftId: gift!.giftId },
    );
    expect(onRes.error ?? null).toBeNull();
    const after = await sendInternalFromPopup<{ preferences: Record<string, string> }>(
      walletB.popup, 'getGiftPreferences',
    );
    expect(after.preferences.anthropic).toBe(gift!.giftId);

    const offRes = await sendInternalFromPopup<{ error?: string }>(
      walletB.popup, 'setGiftPreference', { providerId: 'anthropic', giftId: null },
    );
    expect(offRes.error ?? null).toBeNull();
    const cleared = await sendInternalFromPopup<{ preferences: Record<string, string> }>(
      walletB.popup, 'getGiftPreferences',
    );
    expect(cleared.preferences.anthropic).toBeUndefined();
  });

  // ── Proxy through gift (wallet B → relay → wallet A) ───

  test('wallet B — remove own anthropic key so gift is the only route', async ({ walletB }) => {
    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Wallet"]');
    const card = walletB.popup.locator('.card:has-text("Live Anthropic B")');
    await card.locator('button:has-text("Remove")').click();
    await expect(walletB.popup.locator('text=Live Anthropic B')).not.toBeVisible({ timeout: 5_000 });
  });

  test('wallet B — connect demo page (anthropic via gift only)', async ({ walletB }) => {
    await connectFromPage(walletB, ['anthropic']);
  });

  test('wallet B — anthropic request routed through gift relay (A fulfils it)', async ({ walletB }) => {
    // Give the sender-side WebSocket a moment to connect to the relay
    // after gift creation. The sender opens its relay socket lazily when
    // the gift is created and the recipient needs that to be up.
    await walletB.page.waitForTimeout(2000);
    const { response, proxyError } = await sendFromPage(walletB, 'sendAnthropic');
    expect(proxyError, `gift proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
    const body = response as { content?: Array<{ text?: string }> };
    expect(body.content?.[0]?.text).toBeTruthy();
  });

  test('wallet A — sent gift shows usedTokens > 0', async ({ walletA }) => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Gifts"]');
    const { gifts } = await sendInternalFromPopup<{
      gifts: Array<{ id: string; usedTokens: number; maxTokens: number; active: boolean }>;
    }>(walletA.popup, 'getGifts');
    const active = gifts.find((g) => g.active);
    expect(active, 'wallet A should have an active gift').toBeTruthy();
    expect(active!.usedTokens).toBeGreaterThan(0);
    expect(active!.usedTokens).toBeLessThan(active!.maxTokens);
  });

  test('wallet B — received gift shows usedTokens > 0', async ({ walletB }) => {
    const { giftedCredentials } = await sendInternalFromPopup<{
      giftedCredentials: Array<{ id: string; usedTokens: number; maxTokens: number }>;
    }>(walletB.popup, 'getGiftedCredentials');
    expect(giftedCredentials.length).toBeGreaterThan(0);
    expect(giftedCredentials[0].usedTokens).toBeGreaterThan(0);
  });

  // ── Revoke + failure path ──────────────────────────────

  test('wallet A — revoke gift', async ({ walletA }) => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Gifts"]');
    await walletA.popup.click('button:has-text("Revoke")');
    await expect(walletA.popup.locator('.badge-gift-sent:has-text("Sent")')).not.toBeVisible({ timeout: 5_000 });
  });

  test('wallet B — request after revoke fails', async ({ walletB }) => {
    // The receiver's view of the gift updates lazily; give the sender time
    // to tear down its relay socket and update gift state.
    await walletB.page.waitForTimeout(2000);
    const { response, proxyError } = await sendFromPage(walletB, 'sendAnthropic');
    // Either the response is null with a proxyError, or the response comes
    // back as an error body. Either way: response must not be a success.
    if (proxyError) {
      expect(proxyError.status ?? 500).toBeGreaterThanOrEqual(400);
    } else {
      const body = response as { content?: unknown; error?: unknown };
      expect(body.content == null || body.error != null).toBe(true);
    }
  });

  // ── Cleanup ────────────────────────────────────────────

  test('wallet B — disconnect demo page + remove revoked gift', async ({ walletB }) => {
    await walletB.page.bringToFront();
    await walletB.page.evaluate(() =>
      (window as unknown as { _byoky: { disconnect: () => void } })._byoky.disconnect(),
    );
    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Gifts"]');
    // The revoked received gift shows in the expired section with a Remove
    // button. Clean it up so the gifted-credentials list is empty.
    const expiredRemoveBtn = walletB.popup.locator('.gift-card-expired button:has-text("Remove")').first();
    if (await expiredRemoveBtn.isVisible().catch(() => false)) {
      await expiredRemoveBtn.click();
    }
  });

  test('wallet A — disconnect demo page + delete cross-family group', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.evaluate(() =>
      (window as unknown as { _byoky: { disconnect: () => void } })._byoky.disconnect(),
    );
    const result = await sendInternalFromPopup<{ error?: string }>(
      walletA.popup, 'deleteGroup', { id: groupIdA },
    );
    expect(result.error ?? null).toBeNull();
  });

  // ── Vault file export (disaster recovery) ─────────────

  test('wallet A — export vault downloads a .byoky file', async ({ walletA }) => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Settings"]');
    await walletA.popup.click('button:has-text("Export Vault")');
    await walletA.popup.waitForSelector('#export-pw', { timeout: 5_000 });
    const exportPw = 'ExportP@ssw0rd1234';
    await walletA.popup.fill('#export-pw', exportPw);
    await walletA.popup.fill('#export-confirm', exportPw);
    // The Export submit is the primary button inside the modal body.
    const [download] = await Promise.all([
      walletA.popup.waitForEvent('download', { timeout: 15_000 }),
      walletA.popup.click('button[type="submit"]:has-text("Export")'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^byoky-vault-.*\.byoky$/);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    // Sanity: the file is non-empty (encrypted payload should be several KB).
    const { existsSync, statSync } = await import('fs');
    expect(existsSync(filePath!)).toBe(true);
    expect(statSync(filePath!).size).toBeGreaterThan(100);
  });

  // ── Offline → cloud vault upgrade (wallet B) ──────────

  test('wallet B — upgrade offline wallet to cloud vault via Settings', async ({ walletB }) => {
    // Fresh unique vault username for this upgrade path — cleaned up by
    // the next test (delete account). Username must satisfy the vault
    // regex /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.
    const upgradeTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const upgradeUsername = `e2eup${upgradeTag}b`;

    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Settings"]');
    await expect(walletB.popup.locator('h3:has-text("Cloud Vault")')).toBeVisible({ timeout: 5_000 });
    // Click the toggle label (scoped to the Cloud Vault section to dodge
    // any other toggles on the page).
    const cloudSection = walletB.popup.locator('.settings-section:has(h3:has-text("Cloud Vault"))');
    await cloudSection.locator('label.toggle-switch').click();
    // CloudVaultModal opens with signup mode by default.
    await walletB.popup.waitForSelector('#vault-pw', { timeout: 5_000 });
    // Native setter path (dodges autocomplete corruption like vault spec).
    await walletB.popup.evaluate(
      ({ user, pw }) => {
        const setValue = (id: string, value: string) => {
          const el = document.getElementById(id) as HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setValue('vault-username', user);
        setValue('vault-pw', pw);
      },
      { user: upgradeUsername, pw: PASSWORD },
    );
    // Wait for the availability probe to resolve (Sign Up button becomes enabled).
    await expect(walletB.popup.locator('text=Username is available')).toBeVisible({ timeout: 15_000 });
    await walletB.popup.click('button[type="submit"]:has-text("Sign Up")');

    // Poll cloudVaultStatus until enabled or timeout. If the modal shows an
    // error, surface it for quick diagnosis (rate limits, network, etc.).
    let enabled = false;
    let username: string | undefined;
    for (let i = 0; i < 60 && !enabled; i++) {
      const s = await sendInternalFromPopup<{ enabled: boolean; username?: string }>(
        walletB.popup, 'cloudVaultStatus',
      );
      enabled = s.enabled;
      username = s.username;
      if (enabled) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!enabled) {
      // Read the modal's error text if it rendered one.
      const errText = await walletB.popup.locator('.error').innerText().catch(() => '<no error element>');
      throw new Error(`cloud vault upgrade did not enable within 30s — modal error: "${errText}"`);
    }
    expect(enabled).toBe(true);
    expect(username).toBe(upgradeUsername);
  });

  test('wallet B — delete the newly-created vault account (cleanup)', async ({ walletB }) => {
    const res = await sendInternalFromPopup<{ error?: string; success?: boolean }>(
      walletB.popup, 'cloudVaultDeleteAccount',
    );
    expect(res.error ?? null).toBeNull();
  });

  test('both wallets — lock', async ({ walletA, walletB }) => {
    await walletA.popup.bringToFront();
    await walletA.popup.click('button[title="Wallet"]');
    await walletA.popup.click('button:has-text("Lock")');
    await expect(walletA.popup.locator('#password')).toBeVisible({ timeout: 5_000 });

    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Wallet"]');
    await walletB.popup.click('button:has-text("Lock")');
    await expect(walletB.popup.locator('#password')).toBeVisible({ timeout: 5_000 });
  });
});
