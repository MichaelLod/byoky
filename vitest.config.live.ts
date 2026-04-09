import { defineConfig } from 'vitest/config';

/**
 * Vitest config for live integration tests.
 *
 * These tests hit real provider APIs (Anthropic, OpenAI) and cost real money.
 * They are excluded from the default `pnpm test` run via the main vitest
 * config and only execute when invoked with `pnpm test:live`.
 *
 * Tests skip cleanly when API keys are not set in env, so running this with
 * no keys produces a skip-only result instead of a failure.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/tests/**/live/**/*.live.test.ts'],
    // Long timeout because live API calls can be slow.
    testTimeout: 30_000,
    // Loads `.env.local` at repo root into process.env so tests can read
    // OPENAI_API_KEY / ANTHROPIC_API_KEY without requiring shell exports.
    setupFiles: ['./vitest.setup.env.ts'],
  },
});
