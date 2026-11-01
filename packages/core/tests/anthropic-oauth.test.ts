/**
 * Anthropic auth headers for setup tokens (OAuth) and API keys.
 *
 * The same requests against the real API are in
 * tests/live/anthropic-oauth.live.test.ts (`pnpm test:live`).
 */
import { describe, it, expect } from 'vitest';
import { buildHeaders } from '../src/proxy-utils.js';

describe('buildHeaders — Anthropic OAuth (unit)', () => {
  it('produces correct OAuth headers', () => {
    const h = buildHeaders('anthropic', {}, 'sk-ant-oat01-test', 'oauth');
    expect(h['authorization']).toBe('Bearer sk-ant-oat01-test');
    expect(h['x-api-key']).toBeUndefined();
    expect(h['user-agent']).toMatch(/^claude-cli\//);
    expect(h['x-app']).toBe('cli');
    expect(h['anthropic-beta']).toContain('oauth-2025-04-20');
    expect(h['anthropic-beta']).toContain('claude-code-20250219');
  });

  it('produces correct API Key headers', () => {
    const h = buildHeaders('anthropic', {}, 'sk-ant-api-test', 'api_key');
    expect(h['x-api-key']).toBe('sk-ant-api-test');
    expect(h['authorization']).toBeUndefined();
    expect(h['user-agent']).toBeUndefined();
  });
});
