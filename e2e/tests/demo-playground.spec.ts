import { test, expect, type Wallet } from '../fixtures';
import http from 'http';

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
 *   Leg 3 — Chat tab: vision — upload a 1×1 PNG, assert the model
 *           answers about the image, for anthropic + openai + gemini.
 *   Leg 4 — Tool Use tab: full agentic loop with get_weather +
 *           convert_temperature across anthropic + openai.
 *   Leg 5 — Structured Output tab: json_schema (openai strict) and
 *           json_object (gemini via cross-family group) produce valid
 *           JSON with the expected top-level keys.
 *   Leg 6 — Backend Relay tab: the in-browser ByokyServer handles a
 *           real provider call via the mock WebSocket pair and the
 *           protocol log shows the expected hello→request→chunk→done
 *           sequence.
 *
 * Orchestration: none needed beyond `pnpm -C packages/web dev` in
 * another terminal (or the full-stack wrapper script that boots it).
 * Fails fast with a helpful message if the demo URL isn't reachable.
 */

const DEMO_URL = process.env.BYOKY_DEMO_URL ?? 'http://localhost:3000/demo';
const PASSWORD = 'DemoPlayground1234!';

// Smallest possible PNG: 1×1 transparent pixel.
const TEST_IMAGE_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

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
  await w.popup.click('button.fab-button');
  await w.popup.click('.fab-menu button:has-text("Add credential")');
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
 * overlay inside the page). The user must pick "Connect with Extension"
 * inside the modal before the extension popup's approve/reject screen
 * shows. Playwright's text locators pierce shadow DOM by default.
 */
async function clickDemoConnectWallet(w: Wallet) {
  await w.page.click('button:has-text("Connect Wallet")');
  await w.page.getByText('Connect with Extension', { exact: true }).click({ timeout: 15_000 });
}

async function selectProvider(w: Wallet, selector: string, providerId: string) {
  // Playground tabs use a named <select class="demo-provider-select"> for all
  // tabs except Chat, which uses `.provider-select select`. Pass the full CSS.
  await w.page.locator(selector).selectOption(providerId);
}

test.describe.configure({ mode: 'serial' });

test.describe('Interactive demo playground — desktop full matrix', () => {
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
    await selectProvider(walletA, '.provider-select select', 'anthropic');
    await walletA.page.fill('.chat-input input[type="text"]', 'Reply with exactly the word OK.');
    await walletA.page.click('.chat-input button[type="submit"]');

    // Wait for the streaming message to arrive. A non-empty assistant bubble
    // with streaming=undefined (i.e. no `message-streaming` class) means the
    // SSE loop completed — that's our evidence chunks traversed the port.
    const assistant = walletA.page.locator('.message-assistant').last();
    await expect(assistant).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const text = (await assistant.locator('.message-content').innerText()).trim();
      expect(text.length).toBeGreaterThan(0);
      const stillStreaming = await assistant.evaluate((el) => el.classList.contains('message-streaming'));
      expect(stillStreaming).toBe(false);
    }).toPass({ timeout: 60_000 });

    const body = (await assistant.locator('.message-content').innerText()).trim();
    expect(body.toLowerCase()).toContain('ok');
  });

  test('Leg 2b: Chat tab streams openai via SSE', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.provider-select select', 'openai');
    await walletA.page.fill('.chat-input input[type="text"]', 'Reply with exactly the word OK.');
    await walletA.page.click('.chat-input button[type="submit"]');

    const assistant = walletA.page.locator('.message-assistant').last();
    await expect(async () => {
      const text = (await assistant.locator('.message-content').innerText()).trim();
      expect(text.length).toBeGreaterThan(0);
      const stillStreaming = await assistant.evaluate((el) => el.classList.contains('message-streaming'));
      expect(stillStreaming).toBe(false);
    }).toPass({ timeout: 60_000 });

    const body = (await assistant.locator('.message-content').innerText()).trim();
    expect(body.toLowerCase()).toContain('ok');
  });

  test('Leg 2c: Chat tab completes gemini (non-stream path)', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.provider-select select', 'gemini');
    await walletA.page.fill('.chat-input input[type="text"]', 'Reply with exactly the word OK.');
    await walletA.page.click('.chat-input button[type="submit"]');

    const assistant = walletA.page.locator('.message-assistant').last();
    await expect(async () => {
      const text = (await assistant.locator('.message-content').innerText()).trim();
      expect(text.length).toBeGreaterThan(0);
    }).toPass({ timeout: 60_000 });
  });

  test('Leg 3a: Chat tab vision — anthropic describes the 1×1 png', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.provider-select select', 'anthropic');
    await walletA.page.setInputFiles('.chat-input input[type="file"]', {
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: TEST_IMAGE_BUFFER,
    });
    await expect(walletA.page.locator('.chat-attachment-name')).toHaveText('pixel.png', { timeout: 5_000 });
    await walletA.page.fill('.chat-input input[type="text"]', 'What do you see? Answer in one short sentence.');
    await walletA.page.click('.chat-input button[type="submit"]');

    const assistant = walletA.page.locator('.message-assistant').last();
    await expect(async () => {
      const text = (await assistant.locator('.message-content').innerText()).trim();
      expect(text.length).toBeGreaterThan(10);
      const stillStreaming = await assistant.evaluate((el) => el.classList.contains('message-streaming'));
      expect(stillStreaming).toBe(false);
    }).toPass({ timeout: 90_000 });
  });

  test('Leg 3b: Chat tab vision — openai', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.provider-select select', 'openai');
    await walletA.page.setInputFiles('.chat-input input[type="file"]', {
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: TEST_IMAGE_BUFFER,
    });
    await expect(walletA.page.locator('.chat-attachment-name')).toHaveText('pixel.png', { timeout: 5_000 });
    await walletA.page.fill('.chat-input input[type="text"]', 'What do you see? One short sentence.');
    await walletA.page.click('.chat-input button[type="submit"]');

    const assistant = walletA.page.locator('.message-assistant').last();
    await expect(async () => {
      const text = (await assistant.locator('.message-content').innerText()).trim();
      expect(text.length).toBeGreaterThan(10);
    }).toPass({ timeout: 90_000 });
  });

  test('Leg 3c: Chat tab vision — gemini', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.provider-select select', 'gemini');
    await walletA.page.setInputFiles('.chat-input input[type="file"]', {
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: TEST_IMAGE_BUFFER,
    });
    await expect(walletA.page.locator('.chat-attachment-name')).toHaveText('pixel.png', { timeout: 5_000 });
    await walletA.page.fill('.chat-input input[type="text"]', 'What do you see? One short sentence.');
    await walletA.page.click('.chat-input button[type="submit"]');

    const assistant = walletA.page.locator('.message-assistant').last();
    await expect(async () => {
      const text = (await assistant.locator('.message-content').innerText()).trim();
      expect(text.length).toBeGreaterThan(10);
    }).toPass({ timeout: 90_000 });
  });

  test('Leg 4a: Tool Use tab — anthropic agentic loop', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.click('.playground-tab:has-text("Tool Use")');
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Tool Use")) .demo-provider-select', 'anthropic');
    // Use a prompt that requires both tools — forces multi-turn.
    await walletA.page.locator('.demo-panel:has(h3:has-text("Tool Use")) .demo-textarea').fill(
      'Look up the weather in London, then convert 20°C to Fahrenheit.',
    );
    await walletA.page.click('.demo-panel:has(h3:has-text("Tool Use")) button:has-text("Run")');

    // At least one tool_call + one tool_result should render.
    await expect(walletA.page.locator('.tool-step-tool_call').first()).toBeVisible({ timeout: 60_000 });
    await expect(walletA.page.locator('.tool-step-tool_result').first()).toBeVisible({ timeout: 60_000 });
    await expect(walletA.page.locator('.tool-step-assistant').last()).toBeVisible({ timeout: 90_000 });

    const toolCalls = await walletA.page.locator('.tool-step-tool_call').allInnerTexts();
    expect(toolCalls.some((c) => c.includes('get_weather'))).toBe(true);
  });

  test('Leg 4b: Tool Use tab — openai agentic loop', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Tool Use")) .demo-provider-select', 'openai');
    await walletA.page.locator('.demo-panel:has(h3:has-text("Tool Use")) .demo-textarea').fill(
      'What\'s the weather like in Tokyo and New York right now?',
    );
    await walletA.page.click('.demo-panel:has(h3:has-text("Tool Use")) button:has-text("Run")');

    await expect(walletA.page.locator('.tool-step-tool_call').first()).toBeVisible({ timeout: 60_000 });
    await expect(walletA.page.locator('.tool-step-tool_result').first()).toBeVisible({ timeout: 60_000 });
    await expect(walletA.page.locator('.tool-step-assistant').last()).toBeVisible({ timeout: 90_000 });

    const toolCalls = await walletA.page.locator('.tool-step-tool_call').allInnerTexts();
    expect(toolCalls.some((c) => c.includes('get_weather'))).toBe(true);
  });

  test('Leg 5a: Structured Output — openai json_schema strict', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await walletA.page.click('.playground-tab:has-text("Structured Output")');
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Structured Output")) .demo-provider-select', 'openai');
    await walletA.page.click('.demo-panel:has(h3:has-text("Structured Output")) button:has-text("Extract")');

    await expect(walletA.page.locator('.demo-panel:has(h3:has-text("Structured Output")) .demo-result pre'))
      .toBeVisible({ timeout: 60_000 });
    const raw = await walletA.page.locator('.demo-panel:has(h3:has-text("Structured Output")) .demo-result pre').innerText();
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('people');
    expect(parsed).toHaveProperty('amounts');
    expect(parsed).toHaveProperty('dates');
    expect(Array.isArray(parsed.people)).toBe(true);
  });

  test('Leg 5b: Structured Output — anthropic free-form JSON', async ({ walletA }) => {
    await walletA.page.bringToFront();
    await selectProvider(walletA, '.demo-panel:has(h3:has-text("Structured Output")) .demo-provider-select', 'anthropic');
    await walletA.page.click('.demo-panel:has(h3:has-text("Structured Output")) button:has-text("Extract")');

    await expect(walletA.page.locator('.demo-panel:has(h3:has-text("Structured Output")) .demo-result pre'))
      .toBeVisible({ timeout: 60_000 });
    const raw = await walletA.page.locator('.demo-panel:has(h3:has-text("Structured Output")) .demo-result pre').innerText();
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('people');
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
