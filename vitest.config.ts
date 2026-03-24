import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    env: loadEnv(mode ?? 'test', process.cwd(), ''),
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
}));
