import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { hashPassword } from '../../packages/core/dist/index.js';

/**
 * F001: Chrome stops an MV3 service worker 30 s after its last extension
 * event, and an open port doesn't count as one. A proxied request whose
 * upstream took longer died with the worker (the page got "Extension
 * disconnected", nothing was logged or charged), and so did a connect the
 * user hadn't answered within 30 s.
 *
 * Playwright's own contexts attach DevTools to the worker, which keeps it
 * alive. So this spec starts Chrome itself, uses DevTools only to set the
 * wallet up, and detaches before the measured window: nothing but the
 * browser's own rules decides the worker's lifetime.
 */

// An extension page has chrome.runtime; the e2e tsconfig has no @types/chrome.
declare const chrome: {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
};

const EXTENSION_PATH = path.resolve(__dirname, '../../packages/extension/.output/chrome-mv3');
const SDK_DIST = path.resolve(__dirname, '../../packages/sdk/dist');
const CORE_DIST = path.resolve(__dirname, '../../packages/core/dist');
const PASSWORD = 'correct horse battery staple 42';
// Well past the 30 s an idle worker gets.
const UPSTREAM_DELAY_S = 45;

interface Report { role: string; event: string; status?: number; code?: string; body?: string }

const PAGE = `<!DOCTYPE html>
<html><head><title>worker lifetime</title>
<script type="importmap">{ "imports": { "@byoky/core": "/core/index.js", "@byoky/sdk": "/sdk/index.js" } }</script>
</head><body><script type="module">
  import { Byoky } from '@byoky/sdk';
  const params = new URLSearchParams(location.search);
  const role = params.get('role');
  const report = (event, data = {}) => fetch('/report', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, event, ...data }),
  });
  const byoky = new Byoky({ timeout: 170000 });
  async function waitGo() {
    for (;;) {
      if ((await fetch('/go').then((r) => r.json())).go) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  (async () => {
    if (role === 'fetch') {
      const session = await byoky.connect({ providers: [{ id: 'ollama' }] });
      await report('connected');
      await waitGo();
      try {
        const f = session.createFetch('ollama');
        const resp = await f(params.get('upstream') + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
        });
        await report('fetch-done', { status: resp.status, body: (await resp.text()).slice(0, 200) });
      } catch (e) {
        await report('fetch-error', { code: e?.code, body: String(e?.message ?? e) });
      }
    } else {
      await waitGo();
      await report('connect-start');
      try {
        await byoky.connect({ providers: [{ id: 'ollama' }] });
        await report('connect-ok');
      } catch (e) {
        await report('connect-error', { code: e?.code, body: String(e?.message ?? e) });
      }
    }
  })();
</script></body></html>`;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

async function devToolsPort(profile: string): Promise<number> {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(file)) {
      const port = Number(fs.readFileSync(file, 'utf-8').split('\n')[0]);
      if (port > 0) return port;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome did not open its DevTools port');
}

/** The extension's id, from its service worker's DevTools target. */
async function extensionId(port: number): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; url: string }>;
    const worker = targets.find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'));
    if (worker) return new URL(worker.url).hostname;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the extension\'s service worker did not start');
}

/** A popup page of the wallet, and a way to send it BYOKY_INTERNAL actions. */
async function walletPage(browser: Browser, id: string) {
  const page: Page = await browser.contexts()[0].newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  const send = (action: string, payload?: unknown) => page.evaluate(
    ([a, p]) => chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: a, payload: p }),
    [action, payload] as const,
  ) as Promise<any>;
  return { page, send };
}

test.describe('the extension background outlives a long request and a pending connect (F001)', () => {
  test.setTimeout(150_000);

  test('a request slower than 30 s completes and is counted, and a connect left 45 s can still be approved', async () => {
    test.skip(!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json')), 'build the extension first (pnpm build:e2e)');

    const reports: Report[] = [];
    let go = false;
    let upstreamClosedEarly = false;

    const app = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/page.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PAGE);
        return;
      }
      for (const [prefix, dir] of [['/sdk/', SDK_DIST], ['/core/', CORE_DIST]] as const) {
        const file = path.join(dir, url.pathname.slice(prefix.length));
        if (url.pathname.startsWith(prefix) && file.startsWith(dir) && fs.existsSync(file)) {
          res.writeHead(200, { 'content-type': 'application/javascript' });
          res.end(fs.readFileSync(file));
          return;
        }
      }
      if (url.pathname === '/go') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ go }));
        return;
      }
      if (url.pathname === '/report') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          reports.push(JSON.parse(body));
          res.writeHead(204);
          res.end();
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    // A local Ollama that takes UPSTREAM_DELAY_S to answer.
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        let answered = false;
        res.on('close', () => { if (!answered) upstreamClosedEarly = true; });
        setTimeout(() => {
          answered = true;
          if (res.destroyed) return;
          res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify({
            id: 'x', object: 'chat.completion', model: 'llama3',
            choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
          }));
        }, UPSTREAM_DELAY_S * 1000);
      });
    });

    const appPort = await listen(app);
    const upstreamPort = await listen(upstream);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'byoky-e2e-worker-'));
    const chrome: ChildProcess = spawn(chromium.executablePath(), [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run', '--no-default-browser-check', '--disable-default-apps',
      // Never touch the macOS login keychain (it would prompt the user).
      '--use-mock-keychain', '--password-store=basic',
      'about:blank',
    ], { stdio: 'ignore' });

    try {
      const cdpPort = await devToolsPort(profile);
      const id = await extensionId(cdpPort);

      // Set up through DevTools: a wallet with a local Ollama, and an app
      // with a session.
      const setup = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      const wallet = await walletPage(setup, id);
      expect(await wallet.send('setupWallet', { passwordHash: await hashPassword(PASSWORD) })).toEqual({ success: true });
      expect(await wallet.send('unlock', { password: PASSWORD })).toEqual({ success: true });
      expect(await wallet.send('addCredential', {
        providerId: 'ollama', label: 'local', value: '', authMethod: 'api_key', baseUrl: `http://localhost:${upstreamPort}`,
      })).toEqual({ success: true });

      const ctx = setup.contexts()[0];
      const fetchPage = await ctx.newPage();
      await fetchPage.goto(`http://localhost:${appPort}/page.html?role=fetch&upstream=http://localhost:${upstreamPort}`);
      await expect.poll(async () => (await wallet.send('getPendingApprovals')).approvals.length).toBe(1);
      const [first] = (await wallet.send('getPendingApprovals')).approvals;
      expect(await wallet.send('approveConnect', { approvalId: first.id, trust: false })).toEqual({ success: true });
      await expect.poll(() => reports.some((r) => r.role === 'fetch' && r.event === 'connected')).toBe(true);

      const connectPage = await ctx.newPage();
      await connectPage.goto(`http://127.0.0.1:${appPort}/page.html?role=connect`);

      // Nothing may keep the worker alive from here on but the extension
      // itself: close the wallet page and detach DevTools.
      await wallet.page.close();
      await setup.close();
      go = true;
      await new Promise((r) => setTimeout(r, (UPSTREAM_DELAY_S + 5) * 1000));

      const fetchResult = reports.find((r) => r.role === 'fetch' && (r.event === 'fetch-done' || r.event === 'fetch-error'));
      expect(upstreamClosedEarly).toBe(false);
      expect(fetchResult).toMatchObject({ event: 'fetch-done', status: 200 });
      // The connect is still waiting for the user.
      expect(reports.filter((r) => r.role === 'connect').map((r) => r.event)).toEqual(['connect-start']);

      const after = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      const wallet2 = await walletPage(after, id);
      const log = (await wallet2.send('getRequestLog')).log as Array<{ status: number; inputTokens?: number; outputTokens?: number }>;
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ status: 200, inputTokens: 3, outputTokens: 1 });
      const pending = (await wallet2.send('getPendingApprovals')).approvals;
      expect(pending).toHaveLength(1);
      expect(await wallet2.send('approveConnect', { approvalId: pending[0].id, trust: false })).toEqual({ success: true });
      await expect.poll(() => reports.some((r) => r.role === 'connect' && r.event === 'connect-ok')).toBe(true);
      await after.close();
    } finally {
      chrome.kill('SIGKILL');
      app.close();
      upstream.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
});
