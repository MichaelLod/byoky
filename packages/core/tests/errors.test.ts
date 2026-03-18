import { describe, it, expect } from 'vitest';
import { ByokyError } from '../src/errors.js';
import { ByokyErrorCode } from '../src/types.js';

describe('ByokyError', () => {
  it('creates an error with code and message', () => {
    const err = new ByokyError(ByokyErrorCode.UNKNOWN, 'Something went wrong');
    expect(err.code).toBe(ByokyErrorCode.UNKNOWN);
    expect(err.message).toBe('Something went wrong');
    expect(err.name).toBe('ByokyError');
    expect(err).toBeInstanceOf(Error);
  });

  it('includes optional details', () => {
    const err = new ByokyError(ByokyErrorCode.RATE_LIMITED, 'Rate limited', {
      retryAfter: 30,
    });
    expect(err.details).toEqual({ retryAfter: 30 });
  });
});

describe('static factory methods', () => {
  it('walletNotInstalled', () => {
    const err = ByokyError.walletNotInstalled();
    expect(err.code).toBe(ByokyErrorCode.WALLET_NOT_INSTALLED);
    expect(err.message).toContain('not installed');
  });

  it('userRejected', () => {
    const err = ByokyError.userRejected();
    expect(err.code).toBe(ByokyErrorCode.USER_REJECTED);
    expect(err.message).toContain('rejected');
  });

  it('providerUnavailable', () => {
    const err = ByokyError.providerUnavailable('anthropic');
    expect(err.code).toBe(ByokyErrorCode.PROVIDER_UNAVAILABLE);
    expect(err.message).toContain('anthropic');
    expect(err.details).toEqual({ providerId: 'anthropic' });
  });

  it('sessionExpired', () => {
    const err = ByokyError.sessionExpired();
    expect(err.code).toBe(ByokyErrorCode.SESSION_EXPIRED);
  });

  it('rateLimited with retryAfter', () => {
    const err = ByokyError.rateLimited(45);
    expect(err.code).toBe(ByokyErrorCode.RATE_LIMITED);
    expect(err.message).toContain('45');
    expect(err.details).toEqual({ retryAfter: 45 });
  });

  it('rateLimited without retryAfter', () => {
    const err = ByokyError.rateLimited();
    expect(err.code).toBe(ByokyErrorCode.RATE_LIMITED);
    expect(err.details).toEqual({ retryAfter: undefined });
  });

  it('quotaExceeded', () => {
    const err = ByokyError.quotaExceeded('openai');
    expect(err.code).toBe(ByokyErrorCode.QUOTA_EXCEEDED);
    expect(err.message).toContain('openai');
    expect(err.details).toEqual({ providerId: 'openai' });
  });

  it('invalidKey', () => {
    const err = ByokyError.invalidKey('gemini');
    expect(err.code).toBe(ByokyErrorCode.INVALID_KEY);
    expect(err.details).toEqual({ providerId: 'gemini' });
  });

  it('tokenExpired', () => {
    const err = ByokyError.tokenExpired('anthropic');
    expect(err.code).toBe(ByokyErrorCode.TOKEN_EXPIRED);
    expect(err.message).toContain('anthropic');
    expect(err.details).toEqual({ providerId: 'anthropic' });
  });
});
