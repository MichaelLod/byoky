import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../src/policy.js';

describe('evaluatePolicy', () => {
  it('allows by default', () => {
    expect(evaluatePolicy([], { model: 'gpt-5.5' }).decision).toBe('allow');
  });

  it('blocks a denied model', () => {
    const v = evaluatePolicy([{ modelDeny: ['claude-opus-4-7'] }], { model: 'claude-opus-4-7' });
    expect(v.decision).toBe('block');
    expect(v.reason).toMatch(/denied/);
  });

  it('blocks a model not in the allowlist ("no frontier models")', () => {
    const v = evaluatePolicy([{ modelAllow: ['gpt-5.4-mini', 'claude-haiku-4-5'] }], { model: 'claude-opus-4-7' });
    expect(v.decision).toBe('block');
    expect(v.reason).toMatch(/allowlist/);
  });

  it('allows a model in the allowlist', () => {
    expect(evaluatePolicy([{ modelAllow: ['gpt-5.5'] }], { model: 'gpt-5.5' }).decision).toBe('allow');
  });

  it('normalizes dated model ids against allow/deny entries', () => {
    const v = evaluatePolicy([{ modelDeny: ['claude-haiku-4-5'] }], { model: 'claude-haiku-4-5-20251001' });
    expect(v.decision).toBe('block');
  });

  it('auto-stops on a spend-rate spike', () => {
    const v = evaluatePolicy([{ autoStop: { maxSpendRateUsdPerMin: 5 } }], { model: 'x', spendRateUsdPerMin: 48.7 });
    expect(v.decision).toBe('block');
    expect(v.reason).toMatch(/auto-stop/);
  });

  it('does not auto-stop below the rate cap', () => {
    expect(evaluatePolicy([{ autoStop: { maxSpendRateUsdPerMin: 5 } }], { spendRateUsdPerMin: 2 }).decision).toBe('allow');
  });

  it('blocks a detected loop', () => {
    const v = evaluatePolicy([{ loopDetect: { max: 20 } }], { loopCount: 25 });
    expect(v.decision).toBe('block');
    expect(v.reason).toMatch(/loop/);
  });

  it('merges multiple scoped policies (any block wins)', () => {
    const v = evaluatePolicy(
      [{ modelAllow: ['gpt-5.5'] }, { modelDeny: ['gpt-5.5'] }],
      { model: 'gpt-5.5' },
    );
    expect(v.decision).toBe('block');
  });
});
