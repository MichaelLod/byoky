/**
 * Captures hero shots of byoky.com pages (landing, /demo, /chat, /marketplace,
 * /apps, /docs) at 1920×1080 (desktop hero) and 1280×800 (Chrome store).
 *
 * Defaults to BYOKY_WEB_URL=http://localhost:3000 — start the dev server
 * with: pnpm -C packages/web dev
 */
import { test, chromium, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '../..');
const RAW = path.join(ROOT, 'marketing/raw/web');
const URL = process.env.BYOKY_WEB_URL || 'http://localhost:3000';

fs.mkdirSync(RAW, { recursive: true });

const PAGES: { route: string; name: string; waitFor?: string }[] = [
  { route: '/', name: 'landing' },
  { route: '/demo', name: 'demo' },
  { route: '/chat', name: 'chat' },
  { route: '/marketplace', name: 'marketplace' },
  { route: '/apps', name: 'apps' },
  { route: '/docs', name: 'docs' },
  { route: '/openclaw', name: 'openclaw' },
];

const SIZES = [
  { w: 1920, h: 1080, suffix: 'hero' },
  { w: 1280, h: 800, suffix: 'store' },
];

async function snap(page: Page, name: string, w: number, h: number, suffix: string) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(RAW, `${name}-${w}x${h}-${suffix}.png`),
    fullPage: false,
  });
  console.log(`  📸 ${name}-${w}x${h}-${suffix}.png`);
}

test('capture web pages for marketing', async () => {
  test.setTimeout(180_000);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  for (const p of PAGES) {
    try {
      await page.goto(`${URL}${p.route}`, { waitUntil: 'domcontentloaded' });
      // Soft-wait for hero content
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      for (const size of SIZES) {
        await snap(page, p.name, size.w, size.h, size.suffix);
      }
    } catch (err) {
      console.warn(`  ⚠ skipped ${p.route}: ${(err as Error).message}`);
    }
  }

  // Also a full-page version of the landing for the Product Hunt cover
  await page.goto(`${URL}/`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: path.join(RAW, 'landing-fullpage.png'), fullPage: true });
  console.log('  📸 landing-fullpage.png');

  await ctx.close();
  await browser.close();
});
