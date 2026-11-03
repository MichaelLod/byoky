import { test, expect, type Page } from '@playwright/test';
import { cleanupWallet, launchWallet, loadApiKeys, startServer, type Wallet } from '../fixtures';

// F022: Firefox opens its sidebar 216 px wide (the legacy sidebar's 18em),
// and the wallet's body had min-width 320px, so the nav, Lock, Remove and
// most of Approve were off-screen. The same app in sidepanel.html must fit
// that width on every screen: nothing scrolls sideways and every control is
// inside the viewport. Chromium stands in for Firefox here: the layout is
// the same CSS.

const PASSWORD = 'MyStr0ng!P@ssw0rd';
const WIDTH = 216;

let wallet: Wallet;
let side: Page;

/** What sticks out past the viewport: the page itself, or a visible control. */
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > width) {
      out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${width}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('button, a, input, select, textarea, h1, h2, .status-strip-state, .pending-pill, .status-pill')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > width + 0.5 || r.left < -0.5) {
        const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 30) || el.tagName;
        out.push(`${el.tagName.toLowerCase()} "${name}" spans ${Math.round(r.left)}-${Math.round(r.right)}`);
      }
    }
    return out;
  });
}

async function expectFits(page: Page, screen: string) {
  // Let the page-enter animation settle.
  await page.waitForTimeout(400);
  expect.soft(await overflow(page), screen).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const port = await startServer();
  wallet = await launchWallet('narrow', port);
  side = await wallet.ctx.newPage();
  await side.setViewportSize({ width: WIDTH, height: 800 });
  await side.goto(`chrome-extension://${wallet.extensionId}/sidepanel.html`);
});

test.afterAll(async () => {
  // Closes the browser and deletes its profile (CI fails on a leftover one).
  await cleanupWallet(wallet);
});

test('first run and setup fit the sidebar', async () => {
  await expect(side.locator('button:has-text("Get Started")')).toBeVisible({ timeout: 15_000 });
  await expectFits(side, 'welcome');
  await side.click('button:has-text("Get Started")');
  await side.fill('#password', PASSWORD);
  await expectFits(side, 'set a password');
  await side.click('button:has-text("Continue")');
  await side.fill('#confirm', 'not the same password');
  await side.click('button:has-text("Create wallet")');
  await expect(side.getByRole('alert')).toHaveText('Passwords do not match');
  await expectFits(side, 'confirm, with an error');
  await side.fill('#confirm', PASSWORD);
  await side.click('button:has-text("Create wallet")');
  await expect(side.locator('text=No API keys or tokens yet')).toBeVisible({ timeout: 30_000 });
});

test('the dashboard, with a key, fits', async () => {
  await expectFits(side, 'empty dashboard');
  await side.click('button.fab-button');
  await expectFits(side, 'add credential sheet');
  await side.selectOption('#provider', 'openai');
  await side.fill('#label', 'A rather long work key label');
  await side.fill('#apiKey', loadApiKeys().openai);
  await side.click('button:has-text("Save")');
  await expect(side.locator('.credential-card')).toBeVisible({ timeout: 15_000 });
  await expectFits(side, 'dashboard with a key');
  await side.click('.credential-card button:has-text("Remove")');
  await expectFits(side, 'dashboard, removing a key');
  await side.click('.credential-card button:has-text("Cancel")');
});

test('the approval screen fits', async () => {
  await wallet.page.evaluate(() => {
    void (window as unknown as { _byoky: { connect: (p: string[]) => Promise<void> } })._byoky.connect(['openai', 'anthropic']);
  });
  await expect(side.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
  await expectFits(side, 'approval');
  await side.click('button:has-text("Approve")');
  await wallet.page.waitForFunction(
    () => (window as unknown as { _testState: { connected: boolean } })._testState?.connected === true,
    undefined,
    { timeout: 20_000 },
  );
});

test('connected apps, groups and limits fit', async () => {
  await side.click('button[title="Connect"]');
  await expect(side.locator('.connected-app-card')).toBeVisible({ timeout: 10_000 });
  await expectFits(side, 'connected apps');
  await side.click('.allowance-edit-btn');
  await side.locator('.allowance-form').scrollIntoViewIfNeeded();
  await expectFits(side, 'spending limit form');
  await side.click('.allowance-form button:has-text("Cancel")');
  await side.click('button:has-text("+ New group")');
  await expectFits(side, 'new group form');
  await side.click('.form-group ~ div button:has-text("Cancel")');
  await side.click('button:has-text("History")');
  await expectFits(side, 'request history');
  await side.click('button[title="Settings"]');
  await expectFits(side, 'settings');
});

test('the unlock screen fits', async () => {
  await side.click('button[title="Wallet"]');
  await side.click('button:has-text("Lock")');
  await expect(side.locator('#password')).toBeVisible({ timeout: 10_000 });
  await side.fill('#password', 'wrong password');
  await side.click('button:has-text("Unlock")');
  await expect(side.getByRole('alert')).toBeVisible();
  await expectFits(side, 'unlock, with an error');
  await side.click('button:has-text("Forgot password?")');
  await expectFits(side, 'reset wallet?');
});
