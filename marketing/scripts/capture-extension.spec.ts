/**
 * Marketing capture spec — drives the Chrome extension popup through every
 * marketing-worthy state and saves PNGs to marketing/raw/popup-frames/.
 *
 * Story it walks (the frame names are a contract with compose.ts and
 * build-landing-demos.ts, so rename both sides together):
 *
 *   01-welcome                  Setup → "Get Started"
 *   02-set-password-empty       Setup → password
 *   03-set-password-filled
 *   04-confirm-password
 *   05-dashboard-empty          Wallet with no credentials
 *   06-add-credential-form      Add credential modal (provider picker)
 *   07-add-credential-filled    (needs ANTHROPIC_API_KEY)
 *   08-dashboard-with-anthropic (needs ANTHROPIC_API_KEY)
 *   09-dashboard-multi-provider every key from .env.local
 *   10-approval-request         a local app asks to connect
 *   11-connected-apps           Connect → Sessions
 *   12-token-cap                per-app token limit set
 *   13-group-form               "+ New group" pinned to OpenAI / gpt-4o-mini
 *   14-groups-routing           app moved into the GPT group (Claude → GPT)
 *   15-request-history          Connect → History
 *   16-settings                 keys stay local; .byoky export/import
 *   17-export-backup            encrypted .byoky export (needs ≥1 credential)
 *   18-dashboard-final          wallet with per-provider usage
 *
 * Selectors mirror the ones used by e2e/tests/live-flow.spec.ts and
 * e2e/tests/demo-playground.spec.ts so they stay in sync with the actual UI
 * contract. The connecting "app" is the e2e test page (e2e/test-page), served
 * the same way e2e/fixtures.ts serves it, so `pnpm build:core build:sdk
 * build:extension` must have run first (pnpm marketing:capture:extension
 * does that).
 *
 * Keys come from .env.local (ANTHROPIC_API_KEY / OPENAI_API_KEY /
 * GEMINI_API_KEY). Every key is optional; with keys present the spec makes
 * one tiny "Reply with OK" call per provider so the request log, usage and
 * token-cap frames have real numbers in them.
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

// Extension pages expose chrome.runtime; the marketing tsconfig doesn't pull
// in @types/chrome, so declare the one call we make (same as live-flow).
declare const chrome: {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
};

const ROOT = path.resolve(__dirname, '../..');
const EXTENSION_PATH = path.join(ROOT, 'packages/extension/.output/chrome-mv3');
const TEST_PAGE_DIR = path.join(ROOT, 'e2e/test-page');
const RAW_DIR = path.join(ROOT, 'marketing/raw/popup-frames');
const ENV_LOCAL = path.join(ROOT, '.env.local');

const POPUP_W = 420;
const POPUP_H = 720;
const PASSWORD = 'MarketingDemo!2026';

type ProviderId = 'anthropic' | 'openai' | 'gemini';
type SendMethod = 'sendAnthropic' | 'sendOpenAI' | 'sendGemini';

interface TestState {
  connected: boolean;
  error: string | null;
  response: unknown;
  proxyError: unknown;
}
interface TestPageWindow {
  _testState: TestState;
  _byoky: Record<string, (...args: unknown[]) => Promise<void>>;
}

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

const KEYS: { id: ProviderId; label: string; key?: string; send: SendMethod }[] = [
  { id: 'anthropic', label: 'My Anthropic key', key: env.ANTHROPIC_API_KEY, send: 'sendAnthropic' },
  { id: 'openai', label: 'My OpenAI key', key: env.OPENAI_API_KEY, send: 'sendOpenAI' },
  { id: 'gemini', label: 'My Gemini key', key: env.GEMINI_API_KEY, send: 'sendGemini' },
];

async function snap(page: Page, name: string) {
  await page.bringToFront();
  await page.waitForTimeout(350);
  const file = path.join(RAW_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${name}.png`);
}

/** Same static server as e2e/fixtures.ts startServer(): the test page plus
 * the built SDK + core bundles it imports through its import map. */
function startTestPageServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(TEST_PAGE_DIR, 'index.html'), 'utf-8'));
        return;
      }
      for (const [prefix, dist] of [
        ['/sdk/', path.join(ROOT, 'packages/sdk/dist')],
        ['/core/', path.join(ROOT, 'packages/core/dist')],
      ] as const) {
        if (!url.startsWith(prefix)) continue;
        const filePath = path.resolve(dist, url.slice(prefix.length));
        if (filePath.startsWith(dist) && fs.existsSync(filePath)) {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(fs.readFileSync(filePath));
          return;
        }
      }
      res.writeHead(404);
      res.end('Not found');
    });
    server.listen(0, () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
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

async function openAddCredential(popup: Page) {
  await popup.click('button[title="Wallet"]').catch(() => {});
  await popup.click('.fab-button');
  await popup.click('.fab-menu-item:has-text("Add credential")');
  await popup.waitForSelector('#provider', { timeout: 8000 });
}

async function fillCredential(popup: Page, providerId: ProviderId, label: string, apiKey: string) {
  await popup.selectOption('#provider', providerId);
  // Anthropic setup tokens (sk-ant-oat01-…) go through the Setup Token toggle.
  if (providerId === 'anthropic' && apiKey.startsWith('sk-ant-oat01-')) {
    await popup.click('.auth-toggle-btn:has-text("Setup Token")').catch(() => {});
  }
  await popup.fill('#label', label);
  await popup.fill('#apiKey', apiKey);
}

async function saveCredential(popup: Page, label: string) {
  await popup.click('.modal-sheet button:has-text("Save")');
  await expect(popup.locator(`text=${label}`).first()).toBeVisible({ timeout: 15_000 });
}

async function sendInternal<T = Record<string, unknown>>(popup: Page, action: string, payload?: Record<string, unknown>): Promise<T> {
  return popup.evaluate(
    async ({ action: a, payload: p }) =>
      (await chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: a, payload: p })) as T,
    { action, payload },
  );
}

/** Fire-and-forget from the page, then poll _testState. Returning the
 * promise from page.evaluate would deadlock on the approval (see live-flow). */
async function sendFromApp(app: Page, method: SendMethod): Promise<void> {
  await app.bringToFront();
  await app.evaluate((m) => {
    const w = window as unknown as TestPageWindow;
    w._testState.response = null;
    w._testState.proxyError = null;
    void w._byoky[m]();
  }, method);
  await app
    .waitForFunction(
      () => {
        const s = (window as unknown as TestPageWindow)._testState;
        return s.response != null || s.proxyError != null;
      },
      null,
      { timeout: 60_000 },
    )
    .catch(() => console.warn(`  ⚠ ${method} timed out`));
  const err = await app.evaluate(() => (window as unknown as TestPageWindow)._testState.proxyError);
  if (err) console.warn(`  ⚠ ${method} failed: ${JSON.stringify(err)}`);
}

async function openConnectTab(popup: Page, tab: 'Sessions' | 'History') {
  await popup.click('button[title="Connect"]');
  await popup.click(`button[role="tab"]:has-text("${tab}")`);
  await popup.waitForTimeout(600);
}

async function createGroup(popup: Page, opts: { name: string; providerId: ProviderId; model?: string; snapAs?: string }) {
  await popup.click('button:has-text("+ New group")');
  // GroupForm renders inline inside a card (same lookup as live-flow).
  const form = popup.locator('.card:has-text("Group name")').last();
  await form.locator('input[type="text"]').first().fill(opts.name);
  await form.locator('select').first().selectOption(opts.providerId);
  if (opts.model) await form.locator('input[list]').fill(opts.model);
  if (opts.snapAs) {
    await form.scrollIntoViewIfNeeded();
    await snap(popup, opts.snapAs);
  }
  await form.locator('button:has-text("Save")').click();
  await expect(popup.locator(`.group-section:has-text("${opts.name}")`).first()).toBeVisible({ timeout: 5_000 });
}

test('capture extension popup screens for marketing', async () => {
  test.setTimeout(420_000);
  fs.mkdirSync(RAW_DIR, { recursive: true });
  // Clear frames from earlier runs so a renamed/removed screen can never leak
  // into the composites.
  for (const f of fs.readdirSync(RAW_DIR)) if (f.endsWith('.png')) fs.rmSync(path.join(RAW_DIR, f));

  const withKeys = KEYS.filter((k) => k.key);
  if (withKeys.length === 0) console.warn('  ⚠ no API keys in .env.local; usage/history frames will be empty');

  const { ctx, popup } = await launchPopup();
  const { server, port } = await startTestPageServer();

  try {
    // ── 1. Setup: welcome → password → confirm ───────────────────────────
    await expect(popup.locator('button:has-text("Get Started")')).toBeVisible({ timeout: 15_000 });
    await snap(popup, '01-welcome');

    await popup.click('button:has-text("Get Started")');
    await popup.waitForSelector('#password', { timeout: 15_000 });
    await snap(popup, '02-set-password-empty');

    await popup.fill('#password', PASSWORD);
    await snap(popup, '03-set-password-filled');

    await popup.click('button:has-text("Continue")');
    await popup.waitForSelector('#confirm', { timeout: 10_000 });
    await popup.fill('#confirm', PASSWORD);
    await snap(popup, '04-confirm-password');
    await popup.click('button:has-text("Create wallet")');

    // ── 2. Empty wallet ──────────────────────────────────────────────────
    await expect(popup.locator('text=No API keys or tokens yet')).toBeVisible({ timeout: 30_000 });
    await snap(popup, '05-dashboard-empty');

    // ── 3. Add credential (form is always captured; filled only with a key)
    await openAddCredential(popup);
    await snap(popup, '06-add-credential-form');
    const anthropic = KEYS[0];
    if (anthropic.key) {
      await fillCredential(popup, anthropic.id, anthropic.label, anthropic.key);
      await snap(popup, '07-add-credential-filled');
      await saveCredential(popup, anthropic.label);
      await snap(popup, '08-dashboard-with-anthropic');
    } else {
      await popup.click('.modal-sheet button:has-text("Cancel")');
    }

    // ── 4. Every other provider → multi-provider wallet ──────────────────
    for (const k of KEYS.slice(1)) {
      if (!k.key) continue;
      await openAddCredential(popup);
      await fillCredential(popup, k.id, k.label, k.key);
      await saveCredential(popup, k.label);
    }
    await snap(popup, '09-dashboard-multi-provider');

    // ── 5. An app asks to connect → approval ─────────────────────────────
    const app = await ctx.newPage();
    await app.goto(`http://localhost:${port}/`);
    await app.waitForLoadState('domcontentloaded');
    await app.waitForFunction(() => '__byoky__' in window, null, { timeout: 10_000 });
    const requested = (withKeys.length ? withKeys : KEYS).map((k) => k.id);
    await app.evaluate((p) => {
      void (window as unknown as TestPageWindow)._byoky.connect(p);
    }, requested);

    await popup.bringToFront();
    await expect(popup.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
    await snap(popup, '10-approval-request');
    await popup.click('button:has-text("Approve")');
    await app.waitForFunction(
      () => {
        const s = (window as unknown as TestPageWindow)._testState;
        return s?.connected === true || s?.error != null;
      },
      null,
      { timeout: 20_000 },
    );
    const appOrigin = await app.evaluate(() => window.location.origin);

    // One tiny request per provider so usage + history have real rows.
    for (const k of withKeys) await sendFromApp(app, k.send);

    // ── 6. Connected apps + a token cap ──────────────────────────────────
    await popup.bringToFront();
    await openConnectTab(popup, 'Sessions');
    await expect(popup.locator('.connected-app-card').first()).toBeVisible({ timeout: 10_000 });
    await snap(popup, '11-connected-apps');

    await popup.locator('.allowance-edit-btn').first().click();
    await popup.locator('.allowance-form input[type="number"]').first().fill('50000');
    await popup.locator('.allowance-form button:has-text("Save")').click();
    await expect(popup.locator('.allowance-bar').first()).toBeVisible({ timeout: 5_000 });
    await snap(popup, '12-token-cap');

    // ── 7. Groups: Claude + GPT, then move the app Claude → GPT ──────────
    await createGroup(popup, { name: 'Claude', providerId: 'anthropic' });
    await createGroup(popup, { name: 'GPT', providerId: 'openai', model: 'gpt-4o-mini', snapAs: '13-group-form' });

    // Dragging is HTML5 DnD in the popup; assigning through the same internal
    // message the drop handler ends in is deterministic.
    const { groups } = await sendInternal<{ groups: { id: string; name: string }[] }>(popup, 'getGroups');
    const gpt = groups.find((g) => g.name === 'GPT');
    if (gpt) {
      await sendInternal(popup, 'setAppGroup', { origin: appOrigin, groupId: gpt.id });
      // An Anthropic-shaped call now gets translated to OpenAI by the wallet.
      if (anthropic.key && env.OPENAI_API_KEY) await sendFromApp(app, 'sendAnthropic');
    } else {
      console.warn('  ⚠ GPT group not found; routing frame shows the default group');
    }
    // Reload so the popup store picks up the new assignment.
    await popup.bringToFront();
    await popup.reload();
    await popup.waitForSelector('.app', { timeout: 8000 });
    await openConnectTab(popup, 'Sessions');
    await popup.locator('.group-section:has-text("GPT")').first().scrollIntoViewIfNeeded().catch(() => {});
    await snap(popup, '14-groups-routing');

    // ── 8. Request history ───────────────────────────────────────────────
    await openConnectTab(popup, 'History');
    await snap(popup, '15-request-history');

    // ── 9. Settings: encrypted .byoky export ─────────────────────────────
    await popup.click('button[title="Settings"]');
    await popup.waitForTimeout(600);
    await snap(popup, '16-settings');

    const exportBtn = popup.locator('button:has-text("Export backup")');
    if (await exportBtn.isEnabled()) {
      await exportBtn.click();
      await popup.waitForSelector('#export-pw', { timeout: 5_000 });
      await snap(popup, '17-export-backup');
      await popup.click('button:has-text("Cancel")');
    }

    // ── 10. Back to the wallet, now with usage ───────────────────────────
    await popup.click('button[title="Wallet"]').catch(() => {});
    await popup.waitForTimeout(500);
    await snap(popup, '18-dashboard-final');

    console.log(`\n✓ All popup frames written to ${RAW_DIR}\n`);
  } finally {
    server.close();
    await ctx.close();
  }
});
