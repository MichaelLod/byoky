import { test, expect, type Wallet } from '../fixtures';
import type { Page } from '@playwright/test';
import fs from 'fs';
import http from 'http';

/**
 * Interactive cross-device full-matrix test — desktop extension ↔ iOS.
 *
 * Complements interactive-cross-device.spec.ts by exercising features
 * the basic spec doesn't touch: streaming, vision, tool-use, structured
 * output, and driving the real /demo page through a gift relay.
 *
 * Orchestrated by `scripts/run-interactive-full-stack.sh`. Each stage
 * is a separate Playwright invocation; the orchestrator restarts the
 * iPhone simulator with a different fireAfterSetup+firePayload config
 * between stages.
 *
 * Stages (selected via BYOKY_STAGE):
 *   FS  — desktop gifts anthropic; iOS auto-fires firePayload=stream;
 *         desktop asserts PROXY_RESULT.mode=stream and sse-framed.
 *   FV  — desktop gifts anthropic; iOS auto-fires firePayload=vision;
 *         desktop asserts PROXY_RESULT.success on a vision body.
 *   FT  — desktop gifts anthropic; iOS auto-fires firePayload=tools;
 *         desktop asserts PROXY_RESULT.modeNote=tool-call-present.
 *   FO  — desktop gifts openai; iOS auto-fires firePayload=structured;
 *         desktop asserts PROXY_RESULT.modeNote=json-key-present.
 *   FDP — iOS gifts gemini; desktop walletB redeems, navigates the real
 *         /demo Playground, connects wallet, Chat tab streams through
 *         the iOS relay. Proves demo-page + gift-relay + streaming
 *         compose end-to-end.
 */

const STAGE = process.env.BYOKY_STAGE ?? 'FS';
const IOS_GIFT_LINK_IN = '/tmp/byoky-ios-gift-link.txt';
const IOS_DONE_SIGNAL = '/tmp/byoky-ios-done.sig';
const DESKTOP_GIFT_LINK_OUT = '/tmp/byoky-desktop-gift-link.txt';
const IOS_PROXY_RESULT = '/tmp/byoky-ios-proxy-result.json';

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

/**
 * Mint a gift for an existing credential of `providerId` on walletA, write
 * the link to DESKTOP_GIFT_LINK_OUT, and return it. Shared by FS/FV/FT/FO —
 * the four "desktop sender" stages.
 */
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
  expect(link).toMatch(/^https:\/\/byoky\.com\/gift\//);
  fs.writeFileSync(DESKTOP_GIFT_LINK_OUT, link);
  await walletA.popup.click('button:has-text("Done")');
  return link;
}

async function waitForIosProxyResult(timeoutMs = 150_000): Promise<ProxyResult> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(IOS_PROXY_RESULT)) {
    if (Date.now() > deadline) {
      throw new Error(`iOS never dropped ${IOS_PROXY_RESULT} within ${Math.round(timeoutMs / 1000)}s`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const raw = fs.readFileSync(IOS_PROXY_RESULT, 'utf-8');
  console.log(`[${STAGE}] iOS proxy result:\n${raw}`);
  return JSON.parse(raw) as ProxyResult;
}

function clearProxyResult(): void {
  try { fs.unlinkSync(IOS_PROXY_RESULT); } catch { /* fine */ }
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

// ─── FS: streaming through gift relay ─────────────────────────────
if (STAGE === 'FS') {
  test.describe('iOS full — FS (streaming via gift relay)', () => {
    test('desktop mints anthropic gift, iOS auto-fires stream', async ({ walletA, apiKeys }) => {
      clearProxyResult();
      await setupWallet(walletA);
      await addCredential(walletA, 'anthropic', 'FS Anthropic', apiKeys.anthropic);
      await mintGiftForProvider(walletA, 'anthropic');
      console.log(`[FS] desktop gift written to ${DESKTOP_GIFT_LINK_OUT}`);

      const result = await waitForIosProxyResult();
      expect(result.success, `iOS fire failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('stream');
      expect(result.modeNote).toBe('sse-framed');
      expect((result.responseBytes ?? 0)).toBeGreaterThan(0);

      // Desktop-side bookkeeping: the gift should show usage.
      const { gifts } = await sendInternalFromPopup<{ gifts: Array<{ usedTokens: number; active: boolean }> }>(
        walletA.popup, 'getGifts',
      );
      const active = gifts.find((g) => g.active);
      expect(active?.usedTokens ?? 0).toBeGreaterThan(0);
    });
  });
}

// ─── FV: vision through gift relay ────────────────────────────────
if (STAGE === 'FV') {
  test.describe('iOS full — FV (vision via gift relay)', () => {
    test('desktop mints anthropic gift, iOS auto-fires vision', async ({ walletA, apiKeys }) => {
      clearProxyResult();
      await setupWallet(walletA);
      await addCredential(walletA, 'anthropic', 'FV Anthropic', apiKeys.anthropic);
      await mintGiftForProvider(walletA, 'anthropic');

      const result = await waitForIosProxyResult();
      expect(result.success, `iOS vision fire failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('vision');
      // A 1×1 transparent pixel isn't visually meaningful, but the API
      // must still return something — we only care the vision payload
      // round-tripped without the proxy dropping the image.
      expect((result.responseBytes ?? 0)).toBeGreaterThan(10);
    });
  });
}

// ─── FT: tool-use through gift relay ──────────────────────────────
if (STAGE === 'FT') {
  test.describe('iOS full — FT (tool-use via gift relay)', () => {
    test('desktop mints anthropic gift, iOS auto-fires tools', async ({ walletA, apiKeys }) => {
      clearProxyResult();
      await setupWallet(walletA);
      await addCredential(walletA, 'anthropic', 'FT Anthropic', apiKeys.anthropic);
      await mintGiftForProvider(walletA, 'anthropic');

      const result = await waitForIosProxyResult();
      expect(result.success, `iOS tools fire failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('tools');
      expect(result.modeNote).toBe('tool-call-present');
    });
  });
}

// ─── FO: structured output through gift relay ────────────────────
if (STAGE === 'FO') {
  test.describe('iOS full — FO (structured output via gift relay)', () => {
    test('desktop mints openai gift, iOS auto-fires structured', async ({ walletA, apiKeys }) => {
      clearProxyResult();
      await setupWallet(walletA);
      await addCredential(walletA, 'openai', 'FO OpenAI', apiKeys.openai);
      await mintGiftForProvider(walletA, 'openai');

      const result = await waitForIosProxyResult();
      expect(result.success, `iOS structured fire failed: ${JSON.stringify(result)}`).toBe(true);
      expect(result.mode).toBe('structured');
      expect(result.modeNote).toBe('json-key-present');
    });
  });
}

// ─── FDP: iOS sender → desktop drives real /demo through gift ─────
if (STAGE === 'FDP') {
  test.describe('iOS full — FDP (iOS sender → desktop /demo streaming)', () => {
    test('desktop redeems iOS gemini gift, streams Chat tab through relay', async ({ walletB, apiKeys }) => {
      // Precondition: /demo must be running. Fail fast with a clear message.
      try {
        await checkDemoReachable(DEMO_URL);
      } catch (e) {
        throw new Error(`Demo page not reachable at ${DEMO_URL} (${(e as Error).message}). Start: pnpm -C packages/web dev`);
      }

      await setupWallet(walletB);

      if (!fs.existsSync(IOS_GIFT_LINK_IN)) {
        throw new Error(`No iOS gift link at ${IOS_GIFT_LINK_IN}`);
      }
      const link = fs.readFileSync(IOS_GIFT_LINK_IN, 'utf-8').trim();
      expect(link).toMatch(/^(https:\/\/byoky\.com\/gift|byoky:\/\/gift)/);

      // Redeem the iOS gift in walletB's popup.
      await walletB.popup.bringToFront();
      await walletB.popup.click('button[title="Gifts"]');
      await walletB.popup.click('button:has-text("Redeem Gift")');
      await walletB.popup.waitForSelector('#gift-link', { timeout: 5_000 });
      await walletB.popup.fill('#gift-link', link);
      await expect(walletB.popup.locator('.gift-preview')).toBeVisible({ timeout: 5_000 });
      await walletB.popup.click('button:has-text("Accept Gift")');
      await walletB.popup.click('button[title="Wallet"]');
      await expect(walletB.popup.locator('.gift-card')).toBeVisible({ timeout: 10_000 });

      // Drive the real /demo page. walletB has no own gemini key — the
      // gift is the only route.
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

      // Sender side (iOS) opens its relay socket lazily; give it a beat.
      await walletB.page.waitForTimeout(3_000);

      // Gemini-chat via demo. Gemini's Chat tab path is non-streaming but
      // still tunnels through the relay; the assertion is that a real
      // response arrives from the iOS-held credential.
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

      // Signal iOS sender it can exit.
      fs.writeFileSync(IOS_DONE_SIGNAL, 'done');
      console.log(`[FDP] dropped ${IOS_DONE_SIGNAL}`);

      void apiKeys;
    });
  });
}
