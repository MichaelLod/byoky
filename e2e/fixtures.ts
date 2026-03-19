import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import http from 'http';
import fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../packages/extension/.output/chrome-mv3');
const TEST_PAGE_DIR = path.resolve(__dirname, 'test-page');

interface TestFixtures {
  context: BrowserContext;
  extensionPage: Page;
  extensionId: string;
  testPage: Page;
}

let sharedContext: BrowserContext | null = null;
let sharedExtensionPage: Page | null = null;
let sharedExtensionId: string | null = null;
let sharedTestPage: Page | null = null;
let server: http.Server | null = null;
let serverPort = 0;

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      // Serve test page
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(TEST_PAGE_DIR, 'index.html'), 'utf-8'));
        return;
      }

      // Serve SDK files from dist
      if (req.url?.startsWith('/sdk/')) {
        const filePath = path.resolve(__dirname, '../packages/sdk/dist', req.url.replace('/sdk/', ''));
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const contentType = ext === '.js' ? 'application/javascript' : 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(fs.readFileSync(filePath));
          return;
        }
      }
      if (req.url?.startsWith('/core/')) {
        const filePath = path.resolve(__dirname, '../packages/core/dist', req.url.replace('/core/', ''));
        if (fs.existsSync(filePath)) {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(fs.readFileSync(filePath));
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(0, () => {
      const addr = server!.address() as { port: number };
      serverPort = addr.port;
      resolve(serverPort);
    });
  });
}

export const test = base.extend<TestFixtures>({
  context: async ({}, use) => {
    if (!sharedContext) {
      const port = await startServer();
      sharedContext = await chromium.launchPersistentContext('', {
        headless: false,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--no-first-run',
          '--disable-default-apps',
        ],
      });

      // Mock Anthropic API
      await sharedContext.route('https://api.anthropic.com/**', async (route) => {
        const request = route.request();
        let body: Record<string, unknown> = {};
        try { body = request.postDataJSON(); } catch {}
        const messages = body.messages as Array<{ content: string }> | undefined;

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'msg_mock_e2e',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: `Mock response to: ${messages?.[0]?.content ?? 'unknown'}` }],
            model: body.model ?? 'claude-sonnet-4-20250514',
            usage: { input_tokens: 15, output_tokens: 25 },
            stop_reason: 'end_turn',
          }),
        });
      });

      // Mock OpenAI API
      await sharedContext.route('https://api.openai.com/**', async (route) => {
        const request = route.request();
        let body: Record<string, unknown> = {};
        try { body = request.postDataJSON(); } catch {}
        const messages = body.messages as Array<{ content: string }> | undefined;

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'chatcmpl-mock-e2e',
            object: 'chat.completion',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: `OpenAI mock: ${messages?.[0]?.content ?? 'unknown'}` },
              finish_reason: 'stop',
            }],
            model: body.model ?? 'gpt-4o',
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          }),
        });
      });

      // Mock Gemini API
      await sharedContext.route('https://generativelanguage.googleapis.com/**', async (route) => {
        const request = route.request();
        let body: Record<string, unknown> = {};
        try { body = request.postDataJSON(); } catch {}
        const contents = body.contents as Array<{ parts: Array<{ text: string }> }> | undefined;
        const inputText = contents?.[0]?.parts?.[0]?.text ?? 'unknown';

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            candidates: [{
              content: { parts: [{ text: `Gemini mock: ${inputText}` }], role: 'model' },
              finishReason: 'STOP',
            }],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 18, totalTokenCount: 30 },
          }),
        });
      });

      // Get extension ID from service worker
      let extensionId = '';
      const workers = sharedContext.serviceWorkers();
      if (workers.length > 0) {
        extensionId = new URL(workers[0].url()).hostname;
      } else {
        const worker = await sharedContext.waitForEvent('serviceworker');
        extensionId = new URL(worker.url()).hostname;
      }
      sharedExtensionId = extensionId;

      // Open extension popup page
      sharedExtensionPage = await sharedContext.newPage();
      await sharedExtensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await sharedExtensionPage.waitForLoadState('domcontentloaded');

      // Open test page
      sharedTestPage = await sharedContext.newPage();
      await sharedTestPage.goto(`http://localhost:${port}/`);
      await sharedTestPage.waitForLoadState('domcontentloaded');
      // Wait for extension content script to inject
      await sharedTestPage.waitForFunction(() => '__byoky__' in window, { timeout: 10_000 });
    }

    await use(sharedContext);
  },

  extensionPage: async ({ context }, use) => {
    await use(sharedExtensionPage!);
  },

  extensionId: async ({ context }, use) => {
    await use(sharedExtensionId!);
  },

  testPage: async ({ context }, use) => {
    await use(sharedTestPage!);
  },
});

export { expect } from '@playwright/test';

// Cleanup after all tests
test.afterAll(async () => {
  if (sharedContext) {
    await sharedContext.close();
    sharedContext = null;
    sharedExtensionPage = null;
    sharedExtensionId = null;
    sharedTestPage = null;
  }
  if (server) {
    server.close();
    server = null;
  }
});
