/**
 * Marketing capture spec — drives the Chrome extension popup through every
 * marketing-worthy state and saves PNGs to marketing/raw/popup-frames/.
 *
 * Selectors mirror the ones used by e2e/tests/demo-playground.spec.ts so
 * they stay in sync with the actual UI contract.
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const ROOT = path.resolve(__dirname, '../..');
const EXTENSION_PATH = path.join(ROOT, 'packages/extension/.output/chrome-mv3');
const RAW_DIR = path.join(ROOT, 'marketing/raw/popup-frames');
const ENV_LOCAL = path.join(ROOT, '.env.local');

const POPUP_W = 420;
const POPUP_H = 720;
const PASSWORD = 'MarketingDemo!2026';

fs.mkdirSync(RAW_DIR, { recursive: true });

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(ENV_LOCAL)) return out;
  for (const line of fs.readFileSync(ENV_LOCAL, 'utf-8').split('\n')) {
    const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv();

async function snap(page: Page, name: string) {
  await page.waitForTimeout(350);
  const file = path.join(RAW_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${name}.png`);
}

async function launchPopup(): Promise<{ ctx: BrowserContext; popup: Page; extId: string }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byoky-mkt-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: POPUP_W, height: POPUP_H },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });
  let extId = '';
  const workers = ctx.serviceWorkers();
  if (workers.length) extId = new URL(workers[0].url()).hostname;
  else extId = new URL((await ctx.waitForEvent('serviceworker')).url()).hostname;
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: POPUP_W, height: POPUP_H });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForSelector('.app', { timeout: 8000 });
  return { ctx, popup, extId };
}

async function addCredential(popup: Page, providerId: string, label: string, apiKey: string) {
  await popup.click('button[title="Wallet"]').catch(() => {});
  await popup.click('.fab-button');
  await popup.click('.fab-menu-item:has-text("Add credential")');
  await popup.waitForSelector('#provider', { timeout: 8000 });
  await popup.selectOption('#provider', providerId);
  const isSetupToken = providerId === 'anthropic' && apiKey.startsWith('sk-ant-oat01-');
  if (isSetupToken) {
    await popup.click('.auth-toggle-btn:has-text("Setup Token")').catch(() => {});
  }
  await popup.fill('#label', label);
  await popup.fill('#apiKey', apiKey);
  await popup.click('button:has-text("Save")');
  await expect(popup.locator(`text=${label}`).first()).toBeVisible({ timeout: 15_000 });
}

test('capture extension popup screens for marketing', async () => {
  test.setTimeout(300_000);
  const { ctx, popup } = await launchPopup();

  try {
    // ── 1. Welcome screen ────────────────────────────────────────────────
    await expect(popup.locator('button:has-text("Continue with your API keys")')).toBeVisible({ timeout: 15_000 });
    await snap(popup, '01-welcome');

    // ── 2. Click BYOK path → password screen ─────────────────────────────
    await popup.click('button:has-text("Continue with your API keys")');
    await popup.waitForSelector('#password', { timeout: 15_000 });
    await snap(popup, '02-set-password-empty');

    await popup.fill('#password', PASSWORD);
    await snap(popup, '03-set-password-filled');

    await popup.click('button:has-text("Continue")');
    await popup.waitForSelector('#confirm', { timeout: 10_000 });
    await snap(popup, '04-confirm-password');
    await popup.fill('#confirm', PASSWORD);
    await popup.click('button:has-text("Create wallet")');

    // ── 3. Empty dashboard ───────────────────────────────────────────────
    await expect(popup.locator('text=No API keys, tokens, or gifts yet')).toBeVisible({ timeout: 30_000 });
    await snap(popup, '05-dashboard-empty');

    // ── 4. Add Anthropic credential ──────────────────────────────────────
    if (env.ANTHROPIC_API_KEY) {
      await popup.click('.fab-button');
      await popup.click('.fab-menu-item:has-text("Add credential")');
      await popup.waitForSelector('#provider', { timeout: 8000 });
      await snap(popup, '06-add-credential-form');

      await popup.selectOption('#provider', 'anthropic');
      const isSetupToken = env.ANTHROPIC_API_KEY.startsWith('sk-ant-oat01-');
      if (isSetupToken) {
        await popup.click('.auth-toggle-btn:has-text("Setup Token")').catch(() => {});
      }
      await popup.fill('#label', 'My Anthropic key');
      await popup.fill('#apiKey', env.ANTHROPIC_API_KEY);
      await snap(popup, '07-add-credential-filled');

      await popup.click('button:has-text("Save")');
      await expect(popup.locator('text=My Anthropic key').first()).toBeVisible({ timeout: 15_000 });
      await snap(popup, '08-dashboard-with-anthropic');
    }

    // ── 5. Add OpenAI + Gemini for richer dashboard ──────────────────────
    if (env.OPENAI_API_KEY) {
      await addCredential(popup, 'openai', 'My OpenAI key', env.OPENAI_API_KEY);
    }
    if (env.GEMINI_API_KEY) {
      await addCredential(popup, 'gemini', 'My Gemini key', env.GEMINI_API_KEY);
    }
    await snap(popup, '09-dashboard-multi-provider');

    // ── 6. Gifts page ────────────────────────────────────────────────────
    const giftsNav = popup.locator('button[title="Gifts"]').first();
    if (await giftsNav.count()) {
      await giftsNav.click();
      await popup.waitForTimeout(600);
      await snap(popup, '10-gifts-empty');

      const createGift = popup.locator('button', { hasText: /create.*gift|new gift|send.*gift|mint/i }).first();
      if (await createGift.count()) {
        await createGift.click();
        await popup.waitForTimeout(600);
        await snap(popup, '11-create-gift');

        // Scroll to the bottom of the form so submit button + "List on
        // Marketplace" are visible — the Create Gift form is longer than
        // the popup viewport, and a cut-off form looks bad in composites.
        await popup.evaluate(() => {
          const scroller = document.querySelector('.content') || document.scrollingElement || document.body;
          scroller.scrollTop = scroller.scrollHeight;
        });
        await popup.waitForTimeout(400);
        await snap(popup, '11b-create-gift-submit');
      }
    }

    // ── 7. Apps page ─────────────────────────────────────────────────────
    const appsNav = popup.locator('button[title="Apps"]').first();
    if (await appsNav.count()) {
      await appsNav.click();
      await popup.waitForTimeout(600);
      await snap(popup, '12-apps');
    }

    // ── 8. Activity ──────────────────────────────────────────────────────
    const activityNav = popup.locator('button[title="Activity"]').first();
    if (await activityNav.count()) {
      await activityNav.click();
      await popup.waitForTimeout(600);
      await snap(popup, '13-activity');
    }

    // ── 9. Usage ─────────────────────────────────────────────────────────
    const usageNav = popup.locator('button[title="Usage"]').first();
    if (await usageNav.count()) {
      await usageNav.click();
      await popup.waitForTimeout(600);
      await snap(popup, '14-usage');
    }

    // ── 10. Settings ─────────────────────────────────────────────────────
    const settingsNav = popup.locator('button[title="Settings"]').first();
    if (await settingsNav.count()) {
      await settingsNav.click();
      await popup.waitForTimeout(600);
      await snap(popup, '15-settings');
    }

    // ── 11. Back to dashboard ────────────────────────────────────────────
    await popup.click('button[title="Wallet"]').catch(() => {});
    await popup.waitForTimeout(500);
    await snap(popup, '16-dashboard-final');

    console.log(`\n✓ All popup frames written to ${RAW_DIR}\n`);
  } finally {
    await ctx.close();
  }
});
