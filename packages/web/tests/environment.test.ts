// No `@vitest-environment` docblock on purpose: vitest.config.ts puts the
// sdk and web tests in the jsdom project. If that mapping breaks, component
// tests here would silently run in Node; this test fails instead.
import { describe, it, expect } from 'vitest';

describe('vitest environment for packages/web/tests', () => {
  it('is jsdom by default', () => {
    expect(typeof window).toBe('object');
    expect(typeof document.createElement).toBe('function');
  });
});
