import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Real API calls + cross-wallet gift relay roundtrips — give each test
  // enough headroom that a slow cold-start doesn't flake.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    headless: false,
    viewport: { width: 1280, height: 720 },
  },
});
