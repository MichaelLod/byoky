import { test, expect } from '../fixtures';

const TEST_PASSWORD = 'MyStr0ng!P@ssw0rd';
const TEST_API_KEY = 'sk-ant-api03-test-key-for-e2e-testing-not-real';

test.describe.serial('Byoky wallet E2E flow', () => {
  test('setup wallet with master password', async ({ extensionPage }) => {
    await extensionPage.waitForSelector('#password', { timeout: 15_000 });
    await extensionPage.fill('#password', TEST_PASSWORD);
    await extensionPage.fill('#confirm', TEST_PASSWORD);
    await extensionPage.click('button:has-text("Create Wallet")');
    // Dashboard should appear with empty credentials
    await expect(extensionPage.locator('text=No API keys or tokens yet')).toBeVisible({ timeout: 30_000 });
  });

  test('add an Anthropic API key', async ({ extensionPage }) => {
    await extensionPage.click('button:has-text("Add credential")');
    await extensionPage.waitForSelector('#provider');
    await extensionPage.selectOption('#provider', 'anthropic');
    await extensionPage.fill('#label', 'E2E Test Key');
    await extensionPage.fill('#apiKey', TEST_API_KEY);
    await extensionPage.click('button:has-text("Save")');
    // Back on dashboard, credential should appear
    await expect(extensionPage.locator('text=E2E Test Key')).toBeVisible({ timeout: 30_000 });
  });

  test('connect from test page and approve', async ({ testPage, extensionPage }) => {
    // Focus test page and click connect
    await testPage.bringToFront();
    await testPage.click('#connect');

    // Switch to extension page — it should navigate to approval screen
    await extensionPage.bringToFront();
    await expect(extensionPage.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
    await extensionPage.click('button:has-text("Approve")');

    // Switch back to test page — verify connection succeeded
    await testPage.bringToFront();
    await testPage.waitForFunction(
      () => (window as unknown as { _testState: { connected: boolean } })._testState?.connected === true,
      { timeout: 15_000 },
    );
    await expect(testPage.locator('#status')).toHaveText('Connected');
  });

  test('proxy an API request through the extension', async ({ testPage }) => {
    await testPage.bringToFront();
    await testPage.click('#send-request');

    await testPage.waitForFunction(
      () => (window as unknown as { _testState: { response: unknown } })._testState?.response != null,
      { timeout: 15_000 },
    );

    const response = await testPage.evaluate(
      () => (window as unknown as { _testState: { response: { content: Array<{ text: string }>; usage: { input_tokens: number; output_tokens: number } } } })._testState.response,
    );
    expect(response.content[0].text).toContain('Mock response');
    expect(response.usage.input_tokens).toBe(15);
    expect(response.usage.output_tokens).toBe(25);
  });

  test('check usage shows the proxied request', async ({ testPage, extensionPage }) => {
    await testPage.bringToFront();
    await testPage.click('#check-usage');

    await testPage.waitForFunction(
      () => (window as unknown as { _testState: { usage: unknown } })._testState?.usage != null,
      { timeout: 10_000 },
    );

    const usage = await testPage.evaluate(
      () => (window as unknown as { _testState: { usage: { requests: number; inputTokens: number; outputTokens: number } } })._testState.usage,
    );
    expect(usage.requests).toBe(1);
    expect(usage.inputTokens).toBe(15);
    expect(usage.outputTokens).toBe(25);

    // Also verify in extension's history
    await extensionPage.bringToFront();
    await extensionPage.reload();
    await extensionPage.waitForLoadState('domcontentloaded');
    await extensionPage.click('button[title="History"]');
    await expect(extensionPage.locator('.log-entry')).toBeVisible({ timeout: 10_000 });
  });

  test('verify connected app shows in extension', async ({ extensionPage }) => {
    await extensionPage.bringToFront();
    await extensionPage.click('button[title="Apps"]');
    await expect(extensionPage.locator('.card-title:has-text("localhost")')).toBeVisible({ timeout: 5_000 });
    await expect(extensionPage.locator('button:has-text("Disconnect")')).toBeVisible();
  });

  test('disconnect from test page updates extension', async ({ testPage, extensionPage }) => {
    await testPage.bringToFront();
    await testPage.click('#disconnect');
    await expect(testPage.locator('#status')).toHaveText('Disconnected');

    // Extension should update — session removed
    await extensionPage.bringToFront();
    await extensionPage.click('button[title="Apps"]');
    await expect(extensionPage.locator('text=No apps connected')).toBeVisible({ timeout: 10_000 });
  });

  test('reconnect and disconnect from extension updates test page', async ({ testPage, extensionPage }) => {
    // Reconnect
    await testPage.bringToFront();
    await testPage.click('#connect');

    await extensionPage.bringToFront();
    await expect(extensionPage.locator('text=wants to connect')).toBeVisible({ timeout: 15_000 });
    await extensionPage.click('button:has-text("Approve")');

    await testPage.bringToFront();
    await testPage.waitForFunction(
      () => (window as unknown as { _testState: { connected: boolean } })._testState?.connected === true,
      { timeout: 15_000 },
    );

    // Disconnect from extension
    await extensionPage.bringToFront();
    await extensionPage.click('button[title="Apps"]');
    await extensionPage.click('button:has-text("Disconnect")');

    // Test page should detect the revocation
    await testPage.bringToFront();
    await testPage.waitForFunction(
      () => (window as unknown as { _testState: { disconnectedByWallet: boolean } })._testState?.disconnectedByWallet === true,
      { timeout: 15_000 },
    );
    await expect(testPage.locator('#status')).toHaveText('Disconnected by wallet');
  });

  test('lock and unlock wallet', async ({ extensionPage }) => {
    await extensionPage.bringToFront();
    await extensionPage.click('button[title="Wallet"]');
    await extensionPage.click('button:has-text("Lock")');
    await expect(extensionPage.locator('#password')).toBeVisible({ timeout: 5_000 });

    await extensionPage.fill('#password', TEST_PASSWORD);
    await extensionPage.click('button:has-text("Unlock")');
    await expect(extensionPage.locator('text=E2E Test Key')).toBeVisible({ timeout: 30_000 });
  });
});
