// Store screenshots of the extension popup, with fake data.
//
// Renders the built popup (marketing/raw/ext-build/chrome-mv3/popup.html, from
// wxt.marketing.config.ts) in Chromium with a stubbed `browser` API that answers
// the background script's messages from the fixtures below, then screenshots
// each scenario at 3x. Nothing talks to a provider and no real key exists.
//
//   pnpm --filter @byoky/extension exec wxt build -c ../../marketing/scripts/wxt.marketing.config.ts
//   node marketing/scripts/capture-extension-store.mjs [only]
//
// Output: marketing/raw/store-extension/<scenario>.png (360×600 CSS px @3x).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
// The repo root's Playwright has its browser installed (e2e uses it).
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('@playwright/test');

const EXT = path.join(ROOT, 'marketing/raw/ext-build/chrome-mv3');
const OUT = path.join(ROOT, 'marketing/raw/store-extension');
const ONLY = process.argv[2];
const W = 360;
const H = 600;
if (!fs.existsSync(path.join(EXT, 'popup.html'))) {
  console.error(`No popup build at ${EXT}. Build it first (see the header of this file).`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(EXT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(EXT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ── Fixtures (all fake) ──────────────────────────────────────────────────
const now = Date.now();
const min = 60_000;
const day = 86_400_000;
const DEMO = 'https://byoky.com';
const LOCAL = 'http://localhost:3000';

const credentials = [
  { id: 'c1', providerId: 'anthropic', label: 'Anthropic', authMethod: 'api_key', createdAt: now - 12 * day },
  { id: 'c2', providerId: 'openai', label: 'OpenAI', authMethod: 'api_key', createdAt: now - 9 * day },
  { id: 'c3', providerId: 'gemini', label: 'Gemini', authMethod: 'api_key', createdAt: now - 2 * day },
];

const MSG = 'https://api.anthropic.com/v1/messages';
const CHAT = 'https://api.openai.com/v1/chat/completions';
const GEM = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const recent = [
  { origin: DEMO, p: 'anthropic', url: MSG, ago: 2, i: 1840, o: 420, m: 'claude-sonnet-4-5' },
  { origin: LOCAL, p: 'anthropic', url: MSG, ago: 4, i: 1210, o: 296, m: 'claude-sonnet-4-5', translated: true },
  { origin: DEMO, p: 'openai', url: CHAT, ago: 7, i: 980, o: 214, m: 'gpt-4o-mini' },
  { origin: DEMO, p: 'anthropic', url: MSG, ago: 11, i: 2650, o: 604, m: 'claude-sonnet-4-5' },
  { origin: LOCAL, p: 'anthropic', url: MSG, ago: 16, i: 1580, o: 361, m: 'claude-sonnet-4-5', translated: true },
  { origin: DEMO, p: 'gemini', url: GEM, ago: 23, i: 2210, o: 380, m: 'gemini-2.5-flash' },
  { origin: DEMO, p: 'anthropic', url: MSG, ago: 31, i: 1980, o: 455, m: 'claude-sonnet-4-5' },
];
const log = [
  ...recent.map((r, n) => ({
    id: `r${n}`, sessionId: r.origin === DEMO ? 's1' : 's2', appOrigin: r.origin, providerId: r.p, url: r.url,
    method: 'POST', status: 200, timestamp: now - r.ago * min, inputTokens: r.i, outputTokens: r.o, model: r.m,
    ...(r.translated ? { actualProviderId: 'openai', actualModel: 'gpt-4o-mini' } : {}),
  })),
  ...Array.from({ length: 30 }, (_, n) => ({
    id: `x${n}`, sessionId: n % 4 === 1 ? 's2' : 's1', appOrigin: n % 4 === 1 ? LOCAL : DEMO,
    providerId: n % 3 === 2 ? 'openai' : 'anthropic', url: n % 3 === 2 ? CHAT : MSG, method: 'POST', status: 200,
    timestamp: now - (45 + n * 260) * min, inputTokens: 1100 + ((n * 373) % 1900), outputTokens: 240 + ((n * 97) % 420),
    model: n % 3 === 2 ? 'gpt-4o-mini' : 'claude-sonnet-4-5',
  })),
];

const sessions = [
  { id: 's1', sessionKey: 'k1', appOrigin: DEMO, providers: [
    { providerId: 'anthropic', credentialId: 'c1', available: true, authMethod: 'api_key' },
    { providerId: 'openai', credentialId: 'c2', available: true, authMethod: 'api_key' },
  ], requestedProviders: ['anthropic', 'openai'], createdAt: now - 42 * min, expiresAt: now + day },
  { id: 's2', sessionKey: 'k2', appOrigin: LOCAL, providers: [
    { providerId: 'anthropic', credentialId: 'c2', available: true, authMethod: 'api_key', translation: { dstProviderId: 'openai', dstModel: 'gpt-4o-mini' } },
  ], requestedProviders: ['anthropic'], createdAt: now - 3 * 60 * min, expiresAt: now + day },
];

const groups = [
  { id: 'default', name: 'Default', providerId: '', createdAt: now - 30 * day },
  { id: 'g1', name: 'Fast', providerId: 'openai', credentialId: 'c2', model: 'gpt-4o-mini', createdAt: now - 2 * day },
];

const base = {
  initialized: true, unlocked: true, notice: false,
  credentials, log, sessions,
  approvals: [],
  sites: [],
  allowances: [{ origin: DEMO, totalLimit: 100000, providerLimits: { anthropic: 80000 } }],
  usage: { [DEMO]: { anthropic: 46800, openai: 9900 }, [LOCAL]: { anthropic: 12300 } },
  groups, appGroups: { [LOCAL]: 'g1' },
};

const approval = { id: 'a1', appOrigin: DEMO, providers: [
  { id: 'anthropic', required: true }, { id: 'openai', required: false },
], timestamp: now };

const connect = async (p) => { await p.click('nav button[title="Connect"]'); };
const scenarios = {
  'setup-welcome': { state: { ...base, initialized: false, unlocked: false }, mouse: [330, 330] },
  'unlock': { state: { ...base, unlocked: false }, mouse: [340, 330] },
  'unlock-left': { state: { ...base, unlocked: false }, mouse: [20, 330] },
  'dashboard': { state: base },
  'stats-sheet': { state: base, async run(p) { await p.locator('.credential-card').first().click(); } },
  'add-credential': { state: base, async run(p) {
    await p.click('.fab-button');
    await p.click('.fab-menu-item:has-text("Add credential")');
  } },
  'approval': { state: { ...base, approvals: [approval] } },
  'connected-apps': { state: base, run: connect },
  'connected-apps-groups': { state: base, async run(p) {
    await connect(p);
    await p.locator('.group-section').nth(0).scrollIntoViewIfNeeded();
    await p.evaluate(() => {
      const c = document.querySelector('.content');
      const g = document.querySelectorAll('.group-section')[0];
      c.scrollTop = g.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 12;
    });
  } },
  'connected-apps-drag': { state: base, async run(p) {
    await connect(p);
    const dt = await p.evaluateHandle(() => { const d = new DataTransfer(); d.setData('application/x-byoky-app-origin', 'https://byoky.com'); return d; });
    await p.locator('.group-section').nth(1).dispatchEvent('dragover', { dataTransfer: dt });
    await p.evaluate(() => {
      const c = document.querySelector('.content');
      const g = document.querySelectorAll('.group-section')[0];
      c.scrollTop = g.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 12;
    });
  } },
  'connected-apps-allowance': { state: base, async run(p) {
    await connect(p);
    await p.locator('.connected-app-card').first().locator('.allowance-edit-btn').click();
    await p.evaluate(() => {
      const c = document.querySelector('.content');
      const card = document.querySelector('.connected-app-card');
      c.scrollTop = card.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 12;
    });
  } },
  'history': { state: base, async run(p) {
    await connect(p);
    await p.click('button[role="tab"]:has-text("History")');
  } },
  'settings': { state: base, async run(p) { await p.click('nav button[title="Settings"]'); } },
};

function stub(state) {
  const reply = (msg) => {
    const p = msg?.payload ?? {};
    switch (msg?.action) {
      case 'isInitialized': return { initialized: state.initialized };
      case 'isUnlocked': return { unlocked: state.unlocked };
      case 'getRetiredFeaturesNotice': return { show: state.notice };
      case 'unlock': state.unlocked = true; return { success: true };
      case 'setupWallet': state.initialized = true; return {};
      case 'lock': state.unlocked = false; return {};
      case 'getCredentials': return { credentials: state.credentials };
      case 'getSessions': return { sessions: state.sessions };
      case 'getRequestLog': return { log: state.log };
      case 'getPendingApprovals': return { approvals: state.approvals };
      case 'getTrustedSites': return { sites: state.sites };
      case 'getAllowances': return { allowances: state.allowances, usage: state.usage };
      case 'getGroups': return { groups: state.groups, appGroups: state.appGroups };
      case 'checkBridge': return { available: false };
      case 'createGroup': return { group: { id: 'gx', ...p } };
      default: return {};
    }
  };
  const runtime = {
    id: 'byoky-stub',
    sendMessage: async (msg) => {
      await new Promise((r) => setTimeout(r, 5));
      return JSON.parse(JSON.stringify(reply(msg)));
    },
    onMessage: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
    getURL: (p) => p,
  };
  const api = { runtime, storage: { local: { get: async () => ({}), set: async () => {} } } };
  globalThis.chrome = api;
  globalThis.browser = api;
}

const browser = await chromium.launch();
for (const [name, sc] of Object.entries(scenarios)) {
  if (ONLY && !name.includes(ONLY)) continue;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] pageerror:`, e.message));
  await page.addInitScript(stub, JSON.parse(JSON.stringify(sc.state)));
  await page.goto(`${BASE}/popup.html`);
  await page.waitForFunction(() => !document.querySelector('.loading') && document.querySelector('.header'));
  await page.evaluate(() => document.fonts.ready);
  if (sc.mouse) await page.mouse.move(sc.mouse[0], sc.mouse[1]);
  if (sc.run) await sc.run(page);
  await page.waitForTimeout(600);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  ', path.relative(ROOT, file));
  await ctx.close();
}
await browser.close();
server.close();
