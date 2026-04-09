import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/tests/**/*.test.ts'],
    // Live integration tests hit real provider APIs and cost real money.
    // They opt in via `pnpm test:live` which uses a separate config.
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**/live/**'],
    // Loads `.env.local` at repo root into process.env so the vault
    // integration test (and any other test that wants config via env) can
    // read DATABASE_URL etc. without requiring shell exports. Same loader
    // used by the live test config.
    setupFiles: ['./vitest.setup.env.ts'],
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
