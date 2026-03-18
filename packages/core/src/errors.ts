import { ByokyErrorCode } from './types.js';

export class ByokyError extends Error {
  constructor(
    public readonly code: ByokyErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ByokyError';
  }

  static walletNotInstalled() {
    return new ByokyError(
      ByokyErrorCode.WALLET_NOT_INSTALLED,
      'byoky wallet extension is not installed',
    );
  }

  static userRejected() {
    return new ByokyError(
      ByokyErrorCode.USER_REJECTED,
      'User rejected the connection request',
    );
  }

  static providerUnavailable(providerId: string) {
    return new ByokyError(
      ByokyErrorCode.PROVIDER_UNAVAILABLE,
      `Provider "${providerId}" is not available`,
      { providerId },
    );
  }

  static sessionExpired() {
    return new ByokyError(
      ByokyErrorCode.SESSION_EXPIRED,
      'Session has expired — please reconnect',
    );
  }

  static rateLimited(retryAfter?: number) {
    return new ByokyError(
      ByokyErrorCode.RATE_LIMITED,
      `Rate limit exceeded${retryAfter ? ` — retry after ${retryAfter}s` : ''}`,
      { retryAfter },
    );
  }

  static quotaExceeded(providerId: string) {
    return new ByokyError(
      ByokyErrorCode.QUOTA_EXCEEDED,
      `Quota exceeded for ${providerId} — check your billing`,
      { providerId },
    );
  }

  static invalidKey(providerId: string) {
    return new ByokyError(
      ByokyErrorCode.INVALID_KEY,
      `Invalid API key for ${providerId}`,
      { providerId },
    );
  }

  static tokenExpired(providerId: string) {
    return new ByokyError(
      ByokyErrorCode.TOKEN_EXPIRED,
      `OAuth token expired for ${providerId} — re-authentication required`,
      { providerId },
    );
  }
}
