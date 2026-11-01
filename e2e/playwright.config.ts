import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Live runs make real API calls and spawn the bridge — give each test
  // enough headroom that a slow cold-start doesn't flake.
  timeout: process.env.BYOKY_E2E_LIVE === '1' ? 180_000 : 60_000,
  expect: { timeout: 15_000 },
  use: {
    // The wallet is a persistent context launched in fixtures.ts, which
    // decides headless (default) vs headed (BYOKY_E2E_HEADED=1).
    viewport: { width: 1280, height: 720 },
  },
});
