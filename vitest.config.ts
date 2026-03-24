import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/tests/**/*.test.ts'],
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
