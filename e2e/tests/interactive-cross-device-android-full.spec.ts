import { test, expect, type Wallet } from '../fixtures';
import type { Page } from '@playwright/test';
import fs from 'fs';
import http from 'http';

/**
 * Interactive cross-device full-matrix test — desktop extension ↔ Android.
 *
 * Mirror of interactive-cross-device-full.spec.ts (iOS). Same stages,
 * same handoff contract — different sentinel paths because Android uses
 * /data/local/tmp + logcat where iOS uses /tmp direct-write files.
 *
 * Orchestrated by `scripts/run-interactive-full-stack.sh`. Each stage is
 * a separate Playwright invocation; the orchestrator pushes a new
 * byoky-test-config.json (with firePayload=stream|vision|tools|structured)
 * to /data/local/tmp between stages, rewrites the launch Intent, and
 * parses PROXY_RESULT= out of logcat into HOST_ANDROID_PROXY_RESULT.
 *
 * Stages (selected via BYOKY_STAGE):
 *   AFS  — desktop gifts anthropic; Android auto-fires firePayload=stream;
 *          desktop asserts modeNote=sse-framed.
 *   AFV  — desktop gifts anthropic; Android auto-fires firePayload=vision.
 *   AFT  — desktop gifts anthropic; Android auto-fires firePayload=tools;
 *          desktop asserts modeNote=tool-call-present.
 *   AFO  — desktop gifts openai; Android auto-fires firePayload=structured;
 *          desktop asserts modeNote=json-key-present.
 *   AFDP — Android gifts gemini; desktop walletB redeems, drives real
 *          /demo Chat tab through the Android relay.
 */

const STAGE = process.env.BYOKY_STAGE ?? 'AFS';
const ANDROID_GIFT_LINK_IN = '/tmp/byoky-android-gift-link.txt';
const ANDROID_DONE_SIGNAL = '/tmp/byoky-android-done.sig';
const DESKTOP_GIFT_LINK_OUT = '/tmp/byoky-desktop-gift-link.txt';
const ANDROID_PROXY_RESULT = '/tmp/byoky-android-proxy-result.json';

const PASSWORD = 'CrossDeviceFull1234!';
const DEMO_URL = process.env.BYOKY_DEMO_URL ?? 'http://localhost:3000/demo';

interface ProxyResult {
  success: boolean;
  status?: number;
  providerId?: string;
  responseBytes?: number;
  response?: string;
  error?: string;
  mode?: string;
  modeNote?: string;
}

async function setupWallet(w: Wallet) {
  await w.popup.bringToFront();
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

declare const chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } };
async function sendInternalFromPopup<T>(popup: Page, action: string, payload?: Record<string, unknown>): Promise<T> {
  return popup.evaluate(
    async ({ action: a, payload: p }) => {
      return (await chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: a, payload: p })) as T;
    },
    { action, payload },
  );
}

async function mintGiftForProvider(walletA: Wallet, providerId: string, maxTokens = 500): Promise<string> {
  await walletA.popup.bringToFront();
  await walletA.popup.click('button[title="Gifts"]');
  await walletA.popup.click('button:has-text("Create Gift")');
  await walletA.popup.waitForSelector('#gift-credential', { timeout: 5_000 });

  const { credentials } = await sendInternalFromPopup<{ credentials: Array<{ id: string; providerId: string }> }>(
    walletA.popup, 'getCredentials',
  );
  const target = credentials.find((c) => c.providerId === providerId);
  expect(target, `walletA needs ${providerId} credential`).toBeTruthy();
  await walletA.popup.selectOption('#gift-credential', target!.id);

  const budget = walletA.popup.locator('input[type="number"]');
  await budget.fill(String(maxTokens));
  await walletA.popup.click('button:has-text("Create Gift")');
  await expect(walletA.popup.locator('text=Gift Created')).toBeVisible({ timeout: 15_000 });

  const link = await walletA.popup.locator('.gift-link-text').innerText();
  expect(link).toMatch(/^https:\/\/byoky\.com\/gift#/);
  fs.writeFileSync(DESKTOP_GIFT_LINK_OUT, link);
  await walletA.popup.click('button:has-text("Done")');
  return link;
}

async function waitForAndroidProxyResult(timeoutMs = 180_000): Promise<ProxyResult> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(ANDROID_PROXY_RESULT)) {
    if (Date.now() > deadline) {
      throw new Error(`Android never dropped ${ANDROID_PROXY_RESULT} within ${Math.round(timeoutMs / 1000)}s`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const raw = fs.readFileSync(ANDROID_PROXY_RESULT, 'utf-8');
  console.log(`[${STAGE}] Android proxy result:\n${raw}`);
  return JSON.parse(raw) as ProxyResult;
}

function clearProxyResult(): void {
  try { fs.unlinkSync(ANDROID_PROXY_RESULT); } catch { /* fine */ }
}

async function checkDemoReachable(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = http.get(url, (res: { statusCode?: number; resume: () => void }) => {
      res.resume();
      if (res.statusCode && res.statusCode < 500) resolve();
      else reject(new Error(`demo responded ${res.statusCode}`));
    });
    req.on('error', (e: Error) => reject(e));
    req.setTimeout(5_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

test.describe.configure({ mode: 'serial' });

// ─── AFS: streaming through Android gift relay ───────────────────
if (STAGE === 'AFS') {
  test.describe('Android full — AFS (streaming)', () => {
    test('desktop mints anthropic gift, Android auto-fires stream', async ({ walletA, apiKeys }) => {
      clearProxyResult();
      await setupWallet(walletA);
      await addCredential(walletA, 'anthropic', 'AFS Anthropic', apiKeys.anthropic);
      await mintGiftForProvider(walletA, 'anthropic');

      const result = await waitForAndroidProxyResult();
      expect(result.success, `Android fire failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('stream');
      expect(result.modeNote).toBe('sse-framed');
      expect((result.responseBytes ?? 0)).toBeGreaterThan(0);

      const { gifts } = await sendInternalFromPopup<{ gifts: Array<{ usedTokens: number; active: boolean }> }>(
        walletA.popup, 'getGifts',
      );
      const active = gifts.find((g) => g.active);
      expect(active?.usedTokens ?? 0).toBeGreaterThan(0);
    });
  });
}

// ─── AFV: vision ─────────────────────────────────────────────────
if (STAGE === 'AFV') {
  test.describe('Android full — AFV (vision)', () => {
    test('desktop mints anthropic gift, Android auto-fires vision', async ({ walletA, apiKeys }) => {
      clearProxyResult();
      await setupWallet(walletA);
      await addCredential(walletA, 'anthropic', 'AFV Anthropic', apiKeys.anthropic);
      await mintGiftForProvider(walletA, 'anthropic');

      const result = await waitForAndroidProxyResult();
      expect(result.success, `Android vision fire failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('vision');
      expect((result.responseBytes ?? 0)).toBeGreaterThan(10);
    });
  });
}

// ─── AFT: tools ──────────────────────────────────────────────────
if (STAGE === 'AFT') {
  test.describe('Android full — AFT (tool-use)', () => {
    test('desktop mints anthropic gift, Android auto-fires tools', async ({ walletA, apiKeys }) => {
      clearProxyResult();
      await setupWallet(walletA);
      await addCredential(walletA, 'anthropic', 'AFT Anthropic', apiKeys.anthropic);
      await mintGiftForProvider(walletA, 'anthropic');

      const result = await waitForAndroidProxyResult();
      expect(result.success, `Android tools fire failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('tools');
      expect(result.modeNote).toBe('tool-call-present');
    });
  });
}

// ─── AFO: structured ─────────────────────────────────────────────
if (STAGE === 'AFO') {
  test.describe('Android full — AFO (structured)', () => {
    test('desktop mints openai gift, Android auto-fires structured', async ({ walletA, apiKeys }) => {
      clearProxyResult();
      await setupWallet(walletA);
      await addCredential(walletA, 'openai', 'AFO OpenAI', apiKeys.openai);
      await mintGiftForProvider(walletA, 'openai');

      const result = await waitForAndroidProxyResult();
      expect(result.success, `Android structured fire failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('structured');
      expect(result.modeNote).toBe('json-key-present');
    });
  });
}

// ─── AFDP: Android sender → desktop drives /demo via gift ────────
if (STAGE === 'AFDP') {
  test.describe('Android full — AFDP (Android sender → desktop /demo)', () => {
    test('desktop redeems Android gemini gift, streams Chat tab through relay', async ({ walletB, apiKeys }) => {
      try {
        await checkDemoReachable(DEMO_URL);
      } catch (e) {
        throw new Error(`Demo page not reachable at ${DEMO_URL} (${(e as Error).message}). Start: pnpm -C packages/web dev`);
      }

      await setupWallet(walletB);

      if (!fs.existsSync(ANDROID_GIFT_LINK_IN)) {
        throw new Error(`No Android gift link at ${ANDROID_GIFT_LINK_IN}`);
      }
      const link = fs.readFileSync(ANDROID_GIFT_LINK_IN, 'utf-8').trim();
      expect(link).toMatch(/^(https:\/\/byoky\.com\/gift|byoky:\/\/gift)/);

      // Redeem the Android gift in walletB.
      await walletB.popup.bringToFront();
      await walletB.popup.click('button[title="Gifts"]');
      await walletB.popup.click('button:has-text("Redeem Gift")');
      await walletB.popup.waitForSelector('#gift-link', { timeout: 5_000 });
      await walletB.popup.fill('#gift-link', link);
      await expect(walletB.popup.locator('.gift-preview')).toBeVisible({ timeout: 5_000 });
      await walletB.popup.click('button:has-text("Accept Gift")');
      await walletB.popup.click('button[title="Wallet"]');
      await expect(walletB.popup.locator('.gift-card')).toBeVisible({ timeout: 10_000 });

      // Drive the real /demo page.
      await walletB.page.bringToFront();
      await walletB.page.goto(DEMO_URL);
      await walletB.page.waitForLoadState('domcontentloaded');
      await expect(walletB.page.locator('button:has-text("Connect Wallet")')).toBeVisible({ timeout: 20_000 });
      await walletB.page.click('button:has-text("Connect Wallet")');
      // Demo uses ConnectModal in shadow DOM — pick "Connect with Extension"
      // before the popup approval appears.
      await walletB.page.getByText('Connect with Extension', { exact: true }).click({ timeout: 15_000 });
      await walletB.popup.bringToFront();
      await expect(walletB.popup.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
      await walletB.popup.click('button:has-text("Approve")');
      await walletB.page.bringToFront();
      await expect(walletB.page.locator('.demo-status-bar .connected-text')).toHaveText('Connected', { timeout: 20_000 });

      // Sender (Android) opens its relay socket lazily; give it a beat.
      await walletB.page.waitForTimeout(3_000);

      await walletB.page.click('.playground-tab:has-text("Chat")');
      await walletB.page.locator('.provider-select select').selectOption('gemini');
      await walletB.page.fill('.chat-input input[type="text"]', 'Reply with exactly the word OK.');
      await walletB.page.click('.chat-input button[type="submit"]');

      const assistant = walletB.page.locator('.message-assistant').last();
      await expect(async () => {
        const text = (await assistant.locator('.message-content').innerText()).trim();
        expect(text.length).toBeGreaterThan(0);
      }).toPass({ timeout: 90_000 });
      const body = (await assistant.locator('.message-content').innerText()).trim();
      expect(body.toLowerCase()).toContain('ok');

      fs.writeFileSync(ANDROID_DONE_SIGNAL, 'done');
      console.log(`[AFDP] dropped ${ANDROID_DONE_SIGNAL}`);

      void apiKeys;
    });
  });
}
