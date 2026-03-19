import { describe, it, expect } from 'vitest';
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '../src/password-strength.js';

describe('checkPasswordStrength', () => {
  it('rejects very short passwords as too weak', () => {
    const result = checkPasswordStrength('abc');
    expect(result.score).toBe(0);
    expect(result.label).toBe('Too weak');
  });

  it('rejects common passwords', () => {
    const result = checkPasswordStrength('password12');
    expect(result.score).toBe(0);
    expect(result.label).toBe('Too weak');
  });

  it('gives low score to short single-type passwords', () => {
    const result = checkPasswordStrength('abcdefghij');
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('gives higher score to longer mixed passwords', () => {
    const result = checkPasswordStrength('MyStr0ng!Pass');
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('gives max score to very long complex passwords', () => {
    const result = checkPasswordStrength('Xk9$mP2vL8@nQ4wR!');
    expect(result.score).toBe(4);
    expect(result.label).toBe('Very strong');
  });

  it('penalizes repeated characters', () => {
    const strong = checkPasswordStrength('Abcd1234!xyz');
    const repeated = checkPasswordStrength('Aaaa1234!xyz');
    expect(repeated.score).toBeLessThanOrEqual(strong.score);
  });

  it('provides feedback for weak passwords', () => {
    const result = checkPasswordStrength('short');
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it('exports MIN_PASSWORD_LENGTH as 12', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });
});
