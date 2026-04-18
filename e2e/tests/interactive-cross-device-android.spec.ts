import { test, expect, type Wallet } from '../fixtures';
import type { Page } from '@playwright/test';
import fs from 'fs';

/**
 * Interactive cross-device test: desktop extension ↔ Android emulator.
 *
 * Mirror of interactive-cross-device.spec.ts (iOS) — same legs, same
 * shape, different sentinel paths. Orchestrated by
 * `scripts/run-interactive-cross-device-android.sh`. Stages controlled
 * via BYOKY_STAGE = "A1" (android sender) or "A2" (android recipient).
 *
 *   Stage A1 (Android is sender):
 *     Leg 0 — walletA setup, OpenAI + Gemini real demo calls.
 *     Leg 1 — walletB redeem android gift link from
 *             /tmp/byoky-android-gift-link.txt, real Gemini call via
 *             gift-relay tunnels through the Android emulator.
 *     Leg 2 — cross-family translation: anthropic-shape → gemini via the
 *             gifted credential, response translated back.
 *     Signal — touch /tmp/byoky-android-done.sig to release the device test.
 *
 *   Stage A2 (Android is recipient):
 *     walletA mints a 500-token Anthropic gift, writes link to
 *     /tmp/byoky-desktop-gift-link.txt for the orchestrator to push to
 *     the device. Waits for /tmp/byoky-android-proxy-result.json (written
 *     by the orchestrator parsing logcat). Asserts 200 + walletA sent-gift
 *     usedTokens > 0.
 */

const STAGE = process.env.BYOKY_STAGE ?? 'A1';
const ANDROID_GIFT_LINK_IN = '/tmp/byoky-android-gift-link.txt';
const ANDROID_DONE_SIGNAL = '/tmp/byoky-android-done.sig';
const DESKTOP_GIFT_LINK_OUT = '/tmp/byoky-desktop-gift-link.txt';
const ANDROID_PROXY_RESULT = '/tmp/byoky-android-proxy-result.json';

const PASSWORD = 'CrossDevice1234!';

interface ProxyResult {
  success: boolean;
  status?: number;
  providerId?: string;
  responseBytes?: number;
  response?: string;
  error?: string;
}

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
  // Anthropic setup tokens (sk-ant-oat01-…) can't go out as x-api-key; they
  // must route through the native-messaging bridge. Flip the auth-method
  // toggle before filling so the credential is stored correctly. Same
  // pattern as live-flow.spec.ts:44.
  const isSetupToken = providerId === 'anthropic' && apiKey.startsWith('sk-ant-oat01-');
  if (isSetupToken) {
    await w.popup.click('.auth-toggle-btn:has-text("Setup Token")');
  }
  await w.popup.fill('#label', label);
  await w.popup.fill('#apiKey', apiKey);
  await w.popup.click('button:has-text("Save")');
  await expect(w.popup.locator(`text=${label}`).first()).toBeVisible({ timeout: 15_000 });
}

// Lifted verbatim from live-flow.spec.ts — same fire-and-forget pattern.
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

async function sendFromPageOnce(
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
    proxyError: (window as unknown as {
      _testState: { proxyError: { status?: number; code?: string; message?: string } | null };
    })._testState.proxyError,
  }));
}

// Retry once on transient proxy errors (BRIDGE_ERROR cold start, upstream 5xx).
// A persistent error still surfaces as a failure. Real client bugs stay loud —
// only genuine flakes get absorbed.
async function sendFromPage(
  w: Wallet,
  method: 'sendAnthropic' | 'sendOpenAI' | 'sendGemini',
): Promise<{ response: unknown; proxyError: { status?: number; code?: string; message?: string } | null }> {
  const first = await sendFromPageOnce(w, method);
  if (!first.proxyError) return first;
  const transient = first.proxyError.code === 'BRIDGE_ERROR'
    || (typeof first.proxyError.status === 'number' && first.proxyError.status >= 500);
  if (!transient) return first;
  console.log(`[sendFromPage] retry after transient: ${JSON.stringify(first.proxyError)}`);
  await w.page.waitForTimeout(1500);
  return sendFromPageOnce(w, method);
}

declare const chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } };
async function sendInternalFromPopup<T>(popup: Page, action: string, payload?: Record<string, unknown>): Promise<T> {
  return popup.evaluate(
    async ({ action: a, payload: p }) => {
      return (await chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: a, payload: p })) as T;
    },
    { action, payload },
  );
}

test.describe.configure({ mode: 'serial' });

// ─────────────────────────────────────────────────────────────────────────
// Stage A1: Android as sender, desktop receives
// ─────────────────────────────────────────────────────────────────────────

if (STAGE === 'A1') {
  test.describe('Interactive cross-device — Stage A1 (Android→desktop)', () => {
    let demoOrigin = '';
    let giftLink = '';

    test('Leg 0: walletA setup + import real keys + demo hits OpenAI and Gemini', async ({ walletA, apiKeys }) => {
      await setupWallet(walletA);
      // We import anthropic too (Stage 2 uses it to mint the gift), but the
      // real anthropic demo call is covered end-to-end by Stage A2 (Android
      // redeems + auto-fires through the bridge). No need to double-up
      // here — the Anthropic setup token is more rate-limit-sensitive than
      // raw API keys, so hammering it once per leg causes flakes.
      await addCredential(walletA, 'anthropic', 'Stage1 Anthropic', apiKeys.anthropic);
      await addCredential(walletA, 'openai', 'Stage1 OpenAI', apiKeys.openai);
      await addCredential(walletA, 'gemini', 'Stage1 Gemini', apiKeys.gemini);

      await connectFromPage(walletA, ['openai', 'gemini']);
      demoOrigin = await walletA.page.evaluate(() => window.location.origin);

      const oai = await sendFromPage(walletA, 'sendOpenAI');
      expect(oai.proxyError, `openai: ${JSON.stringify(oai.proxyError)}`).toBeNull();
      const gem = await sendFromPage(walletA, 'sendGemini');
      expect(gem.proxyError, `gemini: ${JSON.stringify(gem.proxyError)}`).toBeNull();

      console.log(`[stage1/leg0] demo origin ${demoOrigin} — openai + gemini real calls ok`);
    });

    test('Leg 1: walletB redeems Android gift', async ({ walletB }) => {
      await setupWallet(walletB);

      if (!fs.existsSync(ANDROID_GIFT_LINK_IN)) {
        throw new Error(
          `No Android gift link at ${ANDROID_GIFT_LINK_IN} — the UI Automator testAndroidSendsGift_Interactive should run alongside this stage`,
        );
      }
      giftLink = fs.readFileSync(ANDROID_GIFT_LINK_IN, 'utf-8').trim();
      expect(giftLink).toMatch(/^(https:\/\/byoky\.com\/gift|byoky:\/\/gift)/);
      console.log(`[stage1/leg1] got Android gift link: ${giftLink.slice(0, 60)}…`);

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

    let demoOriginB = '';

    test('Leg 1: real Gemini call routes through Android via gift-relay', async ({ walletB, apiKeys }) => {
      // walletB has no gemini key of its own — the gift is the only route.
      // Also approve anthropic on the session so Leg 2 can reuse it for
      // the translated anthropic-shape call without re-prompting.
      await connectFromPage(walletB, ['anthropic', 'gemini']);
      demoOriginB = await walletB.page.evaluate(() => window.location.origin);
      // Sender (Android) opens its relay socket lazily; give it a beat.
      await walletB.page.waitForTimeout(3000);

      const { response, proxyError } = await sendFromPage(walletB, 'sendGemini');
      expect(proxyError, `gift proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
      const body = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
      expect(text).toBeTruthy();
      console.log(`[stage1/leg1] Gemini via gift-relay → ${text?.slice(0, 80)}`);
      void apiKeys;
    });

    test('Leg 2: anthropic-shape request translates to gemini, routes through gift-relay', async ({ walletB }) => {
      // Cross-family translation cross-device: walletB creates a group that
      // routes the anthropic family onto gemini, pointed at gemini-2.0-flash.
      // walletB has no gemini credential of its own — the Android gift is the
      // only source — so the resolved call tunnels through the relay.
      // Assert the response still comes back in anthropic shape (the
      // translation engine rewrites the gemini-shape response).
      await walletB.popup.bringToFront();
      await walletB.popup.click('button[title="Activity"]');
      await expect(walletB.popup.locator('button[role="tab"]:has-text("Active")')).toBeVisible({ timeout: 10_000 });
      await walletB.popup.click('button:has-text("+ New group")');
      const form = walletB.popup.locator('.card:has-text("Group name")').last();
      await form.locator('input[type="text"]').first().fill('Cross-family-gift');
      await form.locator('select').first().selectOption('gemini');
      await form.locator('input[list]').fill('gemini-2.0-flash');
      await form.locator('button:has-text("Save")').click();
      await expect(walletB.popup.locator('.group-section:has-text("Cross-family-gift")')).toBeVisible({ timeout: 5_000 });

      const { groups } = await sendInternalFromPopup<{ groups: Array<{ id: string; name: string }> }>(
        walletB.popup, 'getGroups',
      );
      const group = groups.find((g) => g.name === 'Cross-family-gift');
      expect(group, 'Cross-family-gift group should exist').toBeTruthy();

      // Pin the group to the specific gemini gift. Without this pin the
      // resolver's `resolveCrossFamilyGiftRoute` bails (it requires
      // group.giftId to be set) and routing falls through to the
      // "no gemini API key" error path. Setting gift preference alone
      // isn't enough — group.giftId is the flag the cross-family-gift
      // branch keys off.
      const { giftedCredentials } = await sendInternalFromPopup<{
        giftedCredentials: Array<{ giftId: string; providerId: string }>;
      }>(walletB.popup, 'getGiftedCredentials');
      const geminiGift = giftedCredentials.find((gc) => gc.providerId === 'gemini');
      expect(geminiGift, 'walletB should have a redeemed gemini gift').toBeTruthy();
      const pin = await sendInternalFromPopup<{ error?: string }>(
        walletB.popup, 'updateGroup',
        { id: group!.id, patch: { giftId: geminiGift!.giftId } },
      );
      expect(pin.error ?? null).toBeNull();

      // Point the demo origin at the new group so anthropic calls route to gemini.
      const assign = await sendInternalFromPopup<{ error?: string }>(
        walletB.popup, 'setAppGroup', { origin: demoOriginB, groupId: group!.id },
      );
      expect(assign.error ?? null).toBeNull();

      const { response, proxyError } = await sendFromPage(walletB, 'sendAnthropic');
      expect(proxyError, `translated proxy error: ${JSON.stringify(proxyError)}`).toBeNull();
      // Even though gemini served the request, the response must come back
      // in anthropic shape — that's the whole point of translation.
      const body = response as { role?: string; content?: Array<{ type?: string; text?: string }> };
      expect(body.role).toBe('assistant');
      expect(body.content?.[0]?.type).toBe('text');
      expect(body.content?.[0]?.text).toBeTruthy();
      console.log(`[stage1/leg2] anthropic→gemini via gift → ${body.content?.[0]?.text?.slice(0, 80)}`);

      // Confirm the request log shows the translation actually happened
      // (actualProviderId should be gemini for a call the SDK sent as anthropic).
      const { log } = await sendInternalFromPopup<{
        log: Array<{ appOrigin: string; providerId: string; actualProviderId?: string; status: number }>;
      }>(walletB.popup, 'getRequestLog');
      const translated = log.find(
        (e) => e.appOrigin === demoOriginB && e.providerId === 'anthropic' && e.actualProviderId === 'gemini',
      );
      expect(translated, 'expected a translated request entry in log').toBeTruthy();
      expect(translated!.status).toBeLessThan(400);
    });

    test('Leg 2: signal Android sender to exit', async () => {
      fs.writeFileSync(ANDROID_DONE_SIGNAL, 'done');
      console.log(`[stage1/leg2] dropped ${ANDROID_DONE_SIGNAL} — Android sender can exit`);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Stage A2: desktop as sender, Android receives + auto-fires real call
// ─────────────────────────────────────────────────────────────────────────

if (STAGE === 'A2') {
  test.describe('Interactive cross-device — Stage A2 (desktop→Android)', () => {
    test('Leg 2: walletA setup + import anthropic + mint gift for Android', async ({ walletA, apiKeys }) => {
      await setupWallet(walletA);
      await addCredential(walletA, 'anthropic', 'Stage2 Anthropic', apiKeys.anthropic);

      await walletA.popup.bringToFront();
      await walletA.popup.click('button[title="Gifts"]');
      await walletA.popup.click('button:has-text("Create Gift")');
      await walletA.popup.waitForSelector('#gift-credential', { timeout: 5_000 });

      const { credentials } = await sendInternalFromPopup<{
        credentials: Array<{ id: string; providerId: string }>;
      }>(walletA.popup, 'getCredentials');
      const anthropic = credentials.find((c) => c.providerId === 'anthropic');
      expect(anthropic, 'walletA needs anthropic credential').toBeTruthy();
      await walletA.popup.selectOption('#gift-credential', anthropic!.id);

      const budget = walletA.popup.locator('input[type="number"]');
      await budget.fill('500');
      await walletA.popup.click('button:has-text("Create Gift")');
      await expect(walletA.popup.locator('text=Gift Created')).toBeVisible({ timeout: 15_000 });

      const link = await walletA.popup.locator('.gift-link-text').innerText();
      expect(link).toMatch(/^https:\/\/byoky\.com\/gift\//);
      fs.writeFileSync(DESKTOP_GIFT_LINK_OUT, link);
      console.log(`[stage2/leg2] wrote desktop gift link to ${DESKTOP_GIFT_LINK_OUT} (${link.length} chars)`);

      await walletA.popup.click('button:has-text("Done")');
    });

    test('Leg 2: wait for Android auto-fire to complete and assert real response', async ({ walletA }) => {
      console.log(`[stage2/leg2] waiting for Android auto-fire result at ${ANDROID_PROXY_RESULT}…`);
      const start = Date.now();
      const deadline = start + 120_000;
      while (!fs.existsSync(ANDROID_PROXY_RESULT)) {
        if (Date.now() > deadline) {
          throw new Error(
            `Android never dropped ${ANDROID_PROXY_RESULT} within 2min — orchestrator should have logged a PROXY_RESULT from BYOKY_TEST logcat`,
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      const raw = fs.readFileSync(ANDROID_PROXY_RESULT, 'utf-8');
      console.log(`[stage2/leg2] Android proxy result after ${Math.round((Date.now() - start) / 1000)}s:`);
      console.log(raw);

      const result = JSON.parse(raw) as ProxyResult;
      expect(result.success, `Android proxy failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.providerId).toBe('anthropic');
      expect(result.responseBytes).toBeGreaterThan(0);

      // Desktop-side bookkeeping: the sent gift should show non-zero use.
      const { gifts } = await sendInternalFromPopup<{
        gifts: Array<{ id: string; usedTokens: number; active: boolean }>;
      }>(walletA.popup, 'getGifts');
      const active = gifts.find((g) => g.active);
      expect(active, 'walletA should have an active sent gift').toBeTruthy();
      expect(active!.usedTokens).toBeGreaterThan(0);
      console.log(`[stage2/leg2] walletA sent-gift usedTokens=${active!.usedTokens}`);
    });
  });
}
