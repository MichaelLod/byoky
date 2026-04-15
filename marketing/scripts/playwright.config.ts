import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/capture-*.spec.ts',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: false,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
