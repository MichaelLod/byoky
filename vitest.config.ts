import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/tests/**/*.test.ts'],
    // Live integration tests hit real provider APIs and cost real money.
    // They opt in via `pnpm test:live` which uses a separate config.
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**/live/**'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**', 'packages/sdk/src/**'],
      exclude: ['**/index.ts'],
    },
    environmentMatchGlobs: [
      ['packages/sdk/tests/**', 'jsdom'],
      ['packages/web/tests/**', 'jsdom'],
    ],
  },
});
