// The byoky.com/demo connect screen, used as the page behind the extension
// popup in the Mac slides. Serve packages/web first (`pnpm --filter web build`
// then `npx next start -p 3917` in packages/web), then:
//   node marketing/scripts/capture-web-store.mjs [baseUrl]
// The nav (it names other products) and the subtitle (it names providers) are
// hidden: store images can't show other brands outside the app's own UI.
// Output: marketing/raw/store-web/demo-connect.png (1440×530 CSS px @2x).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('@playwright/test');
const BASE = process.argv[2] ?? 'http://localhost:3917';
const OUT = path.join(ROOT, 'marketing/raw/store-web');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.addStyleTag({ content: 'nav, .navbar { visibility: hidden !important; }' });
await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((e) => /connect your byoky wallet/i.test(e.textContent ?? ''));
  const sub = h?.nextElementSibling;
  if (sub && sub.tagName === 'P') sub.style.visibility = 'hidden';
});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'demo-connect.png'), clip: { x: 0, y: 140, width: 1440, height: 530 } });
console.log('   marketing/raw/store-web/demo-connect.png');
await browser.close();
