import { LIVE, test, expect, type Wallet } from '../fixtures';
import http from 'http';
import { COLOR_PROMPT, RED_PNG_B64 } from '../../packages/core/tests/translate/live/red-image';

/**
 * Interactive demo-playground e2e — desktop only.
 *
 * Drives the real web demo at `BYOKY_DEMO_URL` (defaults to
 * `http://localhost:3000/demo`) through every Playground tab against a
 * live extension wallet loaded with real API keys. Covers:
 *
 *   Leg 0 — walletA setup + import real anthropic/openai/gemini keys.
 *   Leg 1 — connect the demo page to the wallet (popup approval path).
 *   Leg 2 — Chat tab: streaming text across anthropic + openai (SSE
 *           chunks must traverse chrome.runtime.Port intact) and
 *           non-streaming for gemini.
 *   Leg 3 — Chat tab: vision — upload a solid red PNG, assert the model
 *           says it is red, for anthropic + openai + gemini.
 *   Leg 4 — Tool Use tab: full agentic loop with get_weather +
 *           convert_temperature across anthropic + openai.
 *   Leg 5 — Structured Output tab: json_schema (openai strict) and
 *           free-form JSON (anthropic) produce valid JSON with the
 *           expected top-level keys.
 *   Leg 6 — Backend Relay tab: the in-browser ByokyServer handles a
 *           real provider call via the mock WebSocket pair and the
 *           protocol log shows the expected hello→request→chunk→done
 *           sequence.
 *
 * Every check waits for the run it started and reads that run's output:
 * the demo shows a failed call as an "Error: ..." chat bubble or a
 * .demo-error box, and keeps the previous run on screen until the next
 * one replaces it, so "some output is visible" proves nothing.
 *
 * Orchestration: none needed beyond `pnpm -C packages/web dev` in
 * another terminal (or the full-stack wrapper script that boots it).
 * Fails fast with a helpful message if the demo URL isn't reachable.
 * BYOKY_DEMO_GEMINI_MODEL picks the Chat tab's Gemini model (one from its
 * model list) instead of the demo's default, e.g. when the key's free-tier
 * daily cap for the default is used up.
 */

const DEMO_URL = process.env.BYOKY_DEMO_URL ?? 'http://localhost:3000/demo';
const GEMINI_MODEL = process.env.BYOKY_DEMO_GEMINI_MODEL;
const PASSWORD = 'DemoPlayground1234!';

const REPLY_TIMEOUT = 90_000;
// Gemini 3.8 Flash, the demo's default, can take a couple of minutes.
const GEMINI_REPLY_TIMEOUT = 240_000;

const TEST_IMAGE = { name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(RED_PNG_B64, 'base64') };

async function checkDemoReachable(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = http.get(url, (res: { statusCode?: number; resume: () => void }) => {
      res.resume();
      if (res.statusCode && res.statusCode < 500) resolve();
      else reject(new Error(`demo responded ${res.statusCode}`));
    });
    req.on('error', (e: Error) => reject(e));
    req.setTimeout(5_000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function setupWallet(w: Wallet) {
  await w.popup.bringToFront();
  await expect(w.popup.locator('button:has-text("Get Started")')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Get Started")');
  await w.popup.waitForSelector('#password', { timeout: 15_000 });
  await w.popup.fill('#password', PASSWORD);
  await w.popup.click('button:has-text("Continue")');
  await w.popup.waitForSelector('#confirm', { timeout: 10_000 });
  await w.popup.fill('#confirm', PASSWORD);
  await w.popup.click('button:has-text("Create wallet")');
  await expect(w.popup.locator('text=No API keys or tokens yet')).toBeVisible({ timeout: 30_000 });
}

async function addCredential(w: Wallet, providerId: string, label: string, apiKey: string) {
  await w.popup.bringToFront();
  await w.popup.click('button[title="Wallet"]');
  await w.popup.click('button.fab-button');
  await w.popup.waitForSelector('#provider');
  await w.popup.selectOption('#provider', providerId);
  // Anthropic setup tokens (sk-ant-oat01-…) must route through the OAuth
  // auth-method path so the extension adds the required
  // anthropic-dangerous-direct-browser-access header. Without this,
  // browser-origin requests are 401'd by Anthropic.
  const isSetupToken = providerId === 'anthropic' && apiKey.startsWith('sk-ant-oat01-');
  if (isSetupToken) {
    await w.popup.click('.auth-toggle-btn:has-text("Setup Token")');
  }
  await w.popup.fill('#label', label);
  await w.popup.fill('#apiKey', apiKey);
  await w.popup.click('button:has-text("Save")');
  await expect(w.popup.locator(`text=${label}`).first()).toBeVisible({ timeout: 15_000 });
}

async function approveConnectInPopup(w: Wallet) {
  await w.popup.bringToFront();
  await expect(w.popup.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Approve")');
}

/**
 * Demo uses the SDK's built-in ConnectModal (rendered in a shadow DOM
 * overlay inside the page). With the extension installed the modal skips
 * any choice step and goes straight to "Waiting for wallet approval" while
 * the extension popup shows its approve/reject screen. Playwright's text
 * locators pierce shadow DOM by default.
 */
async function clickDemoConnectWallet(w: Wallet) {
  await w.page.click('button:has-text("Connect Wallet")');
  await expect(w.page.getByText('Waiting for wallet approval')).toBeVisible({ timeout: 15_000 });
}

async function selectProvider(w: Wallet, selector: string, providerId: string) {
  // Playground tabs use a named <select class="demo-provider-select"> for all
  // tabs except Chat, which uses `.provider-select select`. Pass the full CSS.
  // Each tab follows the provider select with a model select of the same
  // class, so the provider is the first match.
  await w.page.locator(selector).first().selectOption(providerId);
}

async function selectChatProvider(w: Wallet, providerId: string) {
  await selectProvider(w, '.provider-select select', providerId);
  if (providerId === 'gemini' && GEMINI_MODEL) {
    await w.page.locator('.provider-select select').nth(1).selectOption(GEMINI_MODEL);
  }
}

/**
 * Sends one Chat turn and returns the reply. The reply is the bubble this
 * send adds (the previous turn's stays on screen), read once it has
 * stopped streaming; a failed call shows as an "Error: ..." bubble.
 */
async function sendChat(
  w: Wallet,
  prompt: string,
  opts: { image?: boolean; timeout?: number } = {},
): Promise<string> {
  const bubbles = w.page.locator('.message-assistant');
  const before = await bubbles.count();
  if (opts.image) {
    await w.page.setInputFiles('.chat-input input[type="file"]', TEST_IMAGE);
    await expect(w.page.locator('.chat-attachment-name')).toHaveText(TEST_IMAGE.name, { timeout: 5_000 });
  }
  await w.page.fill('.chat-input input[type="text"]', prompt);
  await w.page.click('.chat-input button[type="submit"]');

  await expect(bubbles).toHaveCount(before + 1, { timeout: 15_000 });
  const reply = bubbles.nth(before);
  await expect(reply).not.toHaveClass(/message-streaming/, { timeout: opts.timeout ?? REPLY_TIMEOUT });
  const text = (await reply.locator('.message-content').innerText()).trim();
  expect(text, 'the call failed').not.toMatch(/^Error:/);
  return text;
}

/**
 * Runs the Tool Use tab once and checks the loop: an example button clears
 * the previous run first, and the run is over when the button reads "Run"
 * again.
 */
async function runToolUse(w: Wallet, prompt: string): Promise<void> {
  const panel = w.page.locator('.demo-panel:has(h3:has-text("Tool Use"))');
  await panel.locator('.demo-sample-btn').first().click();
  await expect(panel.locator('.tool-step')).toHaveCount(0);
  await panel.locator('.demo-textarea').fill(prompt);
  await panel.getByRole('button', { name: 'Run', exact: true }).click();
  // The run's first step is the prompt; it shows with "Running...".
  await expect(panel.locator('.tool-step-user')).toContainText(prompt, { timeout: 15_000 });
  await expect(panel.getByRole('button', { name: 'Run', exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(panel.locator('.demo-error')).toHaveCount(0);

  const toolCalls = await panel.locator('.tool-step-tool_call').allInnerTexts();
  expect(toolCalls.some((c) => c.includes('get_weather')), `tool calls: ${toolCalls.join(' | ')}`).toBe(true);
  await expect(panel.locator('.tool-step-tool_result')).not.toHaveCount(0);
  // The loop ends with the model's answer.
  const last = panel.locator('.tool-step').last();
  await expect(last).toHaveClass(/tool-step-assistant/);
  expect((await last.locator('.tool-step-content').innerText()).trim().length).toBeGreaterThan(0);
}

/** Runs Structured Output's Extract once and returns the parsed JSON. */
async function runExtract(w: Wallet): Promise<Record<string, unknown>> {
  const panel = w.page.locator('.demo-panel:has(h3:has-text("Structured Output"))');
  // A sample button clears the previous result, so the JSON read below is this run's.
  await panel.locator('.demo-sample-btn').first().click();
  await expect(panel.locator('.demo-result')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Extract', exact: true }).click();
  await expect(panel.locator('.demo-result pre').or(panel.locator('.demo-error'))).toBeVisible({ timeout: REPLY_TIMEOUT });
  await expect(panel.locator('.demo-error')).toHaveCount(0);
  return JSON.parse(await panel.locator('.demo-result pre').innerText()) as Record<string, unknown>;
}

test.describe.configure({ mode: 'serial' });

test.describe('Interactive demo playground — desktop full matrix', () => {
  test.skip(!LIVE, 'live only: drives the demo against real models (pnpm test:e2e:live)');

  test.beforeAll(async () => {
    try {
      await checkDemoReachable(DEMO_URL);
    } catch (e) {
      throw new Error(
        `Demo page not reachable at ${DEMO_URL} (${(e as Error).message}). ` +
        `Start it with: pnpm -C packages/web dev  — or override with BYOKY_DEMO_URL.`,
      );
    }
  });

  test('Leg 0: wallet setup + import real keys', async ({ walletA, apiKeys }) => {
    await setupWallet(walletA);
    await addCredential(walletA, 'anthropic', 'Demo Anthropic', apiKeys.anthropic);
    await addCredential(walletA, 'openai', 'Demo OpenAI', apiKeys.openai);
    await addCredential(walletA, 'gemini', 'Demo Gemini', apiKeys.gemini);
  });

  test('Leg 1: demo page connects to wallet via popup approval', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.goto(DEMO_URL);
    await walletA.page.waitForLoadState('domcontentloaded');

    await expect(walletA.page.locator('button:has-text("Connect Wallet")')).toBeVisible({ timeout: 20_000 });
    await clickDemoConnectWallet(walletA);

    await approveConnectInPopup(walletA);

    await walletA.page.bringToFront();
    await expect(walletA.page.locator('.demo-status-bar .connected-text')).toHaveText('Connected', { timeout: 20_000 });
    await expect(walletA.page.locator('.playground-tabs')).toBeVisible({ timeout: 10_000 });
  });

  test('Leg 2a: Chat tab streams anthropic via SSE', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.click('.playground-tab:has-text("Chat")');
    await selectChatProvider(walletA, 'anthropic');
    // The bubble stops streaming once the SSE loop is done: the chunks
    // traversed the port.
    expect(await sendChat(walletA, 'Reply with exactly the word OK.')).toMatch(/\bok\b/i);
  });

  test('Leg 2b: Chat tab streams openai via SSE', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectChatProvider(walletA, 'openai');
    expect(await sendChat(walletA, 'Reply with exactly the word OK.')).toMatch(/\bok\b/i);
  });

  test('Leg 2c: Chat tab completes gemini (non-stream path)', async ({ walletA }) => {
    test.setTimeout(GEMINI_REPLY_TIMEOUT + 60_000);
    await walletA.page.bringToFront();
    await selectChatProvider(walletA, 'gemini');
    expect(await sendChat(walletA, 'Reply with exactly the word OK.', { timeout: GEMINI_REPLY_TIMEOUT })).toMatch(/\bok\b/i);
  });

  test('Leg 3a: Chat tab vision — anthropic names the colour of the png', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectChatProvider(walletA, 'anthropic');
    expect(await sendChat(walletA, COLOR_PROMPT, { image: true })).toMatch(/red/i);
  });

  test('Leg 3b: Chat tab vision — openai', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectChatProvider(walletA, 'openai');
    expect(await sendChat(walletA, COLOR_PROMPT, { image: true })).toMatch(/red/i);
  });

  test('Leg 3c: Chat tab vision — gemini', async ({ walletA }) => {
    test.setTimeout(GEMINI_REPLY_TIMEOUT + 60_000);
    await walletA.page.bringToFront();
    await selectChatProvider(walletA, 'gemini');
    expect(await sendChat(walletA, COLOR_PROMPT, { image: true, timeout: GEMINI_REPLY_TIMEOUT })).toMatch(/red/i);
  });

  test('Leg 4a: Tool Use tab — anthropic agentic loop', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.click('.playground-tab:has-text("Tool Use")');
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Tool Use")) .demo-provider-select', 'anthropic');
    // A prompt that needs both tools forces more than one turn.
    await runToolUse(walletA, 'Look up the weather in London, then convert 20°C to Fahrenheit.');
  });

  test('Leg 4b: Tool Use tab — openai agentic loop', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Tool Use")) .demo-provider-select', 'openai');
    await runToolUse(walletA, 'What\'s the weather like in Tokyo and New York right now?');
  });

  test('Leg 5a: Structured Output — openai json_schema strict', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.click('.playground-tab:has-text("Structured Output")');
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Structured Output")) .demo-provider-select', 'openai');
    const parsed = await runExtract(walletA);
    expect(parsed).toHaveProperty('people');
    expect(parsed).toHaveProperty('amounts');
    expect(parsed).toHaveProperty('dates');
    expect(Array.isArray(parsed.people)).toBe(true);
  });

  test('Leg 5b: Structured Output — anthropic free-form JSON', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Structured Output")) .demo-provider-select', 'anthropic');
    const parsed = await runExtract(walletA);
    expect(parsed).toHaveProperty('people');
    expect(Array.isArray(parsed.people)).toBe(true);
  });

  test('Leg 6: Backend Relay — mock WebSocket pair round-trips a real call', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.click('.playground-tab:has-text("Backend Relay")');
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Backend Relay")) .demo-provider-select', 'anthropic');
    await walletA.page.locator('.demo-panel:has(h3:has-text("Backend Relay")) .demo-textarea').fill(
      'Reply with exactly the word OK.',
    );
    await walletA.page.click('.demo-panel:has(h3:has-text("Backend Relay")) button:has-text("Run Backend Call")');

    // Protocol log should show hello → request → at least one chunk → done.
    await expect(walletA.page.locator('.relay-step .relay-type-hello')).toBeVisible({ timeout: 15_000 });
    await expect(walletA.page.locator('.relay-step .relay-type-request')).toBeVisible({ timeout: 30_000 });
    await expect(walletA.page.locator('.relay-step .relay-type-done')).toBeVisible({ timeout: 90_000 });

    // And the extracted response body should have arrived.
    await expect(walletA.page.locator('.demo-panel:has(h3:has-text("Backend Relay")) .demo-result pre'))
      .toBeVisible({ timeout: 5_000 });
    const body = (await walletA.page.locator('.demo-panel:has(h3:has-text("Backend Relay")) .demo-result pre').innerText()).trim();
    expect(body.length).toBeGreaterThan(0);
    expect(body.toLowerCase()).toContain('ok');
  });
});
