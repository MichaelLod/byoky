import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests that need a DOM. Everything else runs in Node; a file can still pick
// its own with a `// @vitest-environment` docblock.
const DOM_TESTS = ['packages/sdk/tests/**/*.test.{ts,tsx}', 'packages/web/tests/**/*.test.{ts,tsx}'];

export default defineConfig({
  // packages/web's tsconfig keeps JSX as is ("preserve", for Next). Compile
  // it the way the extension's already is, or the coverage remapper can't
  // parse the site's .tsx files and leaves them out.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    // Tests run against core's source, so they don't need a fresh core build
    // and the extension's background harness can import what it imports.
    alias: [
      { find: /^@byoky\/core$/, replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    globals: true,
    // Live integration tests hit real provider APIs and cost real money.
    // They opt in via `pnpm test:live`, which uses vitest.config.live.ts.
    // The default run reads no .env file, so no secret reaches a test.
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**/live/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/tests/**/*.test.{ts,tsx}'],
          exclude: DOM_TESTS,
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: DOM_TESTS,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Every TypeScript package, so the untested ones show up at 0% instead
      // of hiding (iOS and Android have their own toolchains). The extension
      // and the web site keep their code outside src/.
      include: [
        'packages/*/src/**',
        'packages/extension/entrypoints/**/*.{ts,tsx}',
        'packages/extension/lib/**',
        'packages/web/app/**/*.{ts,tsx}',
        'packages/web/middleware.ts',
      ],
      // Only the pure re-export barrels; other index.ts files hold real code.
      exclude: ['packages/core/src/index.ts', 'packages/sdk/src/index.ts', '**/*.d.ts'],
    },
  },
});
