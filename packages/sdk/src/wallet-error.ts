import { ByokyError, ByokyErrorCode, isByokyErrorCode } from '@byoky/core';

/**
 * A ByokyError from an error a wallet sent. A code outside ByokyErrorCode
 * (an older or newer wallet, a mobile-only code) becomes UNKNOWN, with the
 * code as sent kept in details.code, so apps can switch on err.code safely.
 */
export function walletError(
  code: unknown,
  message: unknown,
  details?: Record<string, unknown>,
): ByokyError {
  const text = typeof message === 'string' && message ? message : 'The wallet reported an error';
  if (isByokyErrorCode(code)) return new ByokyError(code, text, details);
  return new ByokyError(ByokyErrorCode.UNKNOWN, text, { ...details, code });
}
