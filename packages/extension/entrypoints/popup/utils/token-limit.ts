/**
 * The largest limit kept: a usage count stops growing there
 * (MAX_TOKEN_COUNT in lib/routing-state.ts), so anything above it is the same.
 */
const MAX_TOKEN_LIMIT = Number.MAX_SAFE_INTEGER;

/** Digits in groups of three, one separator throughout: "100,000", "1.000.000", "50 000". */
const GROUPED = /^\d{1,3}([,.'_\s  ])\d{3}(?:\1\d{3})*$/;

/**
 * What a token limit field holds: null when it is empty (no limit), a whole
 * number of tokens (0 blocks the app), or 'invalid'. The digits may be
 * grouped by a thousands separator. Anything else, a sign, a fraction or an
 * exponent ("1e6"), is invalid rather than read as some other number, since
 * a misread limit fails open or blocks the app.
 */
export function parseTokenLimit(raw: string): number | null | 'invalid' {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^\d+$/.test(text) && !GROUPED.test(text)) return 'invalid';
  return Math.min(Number(text.replace(/\D/g, '')), MAX_TOKEN_LIMIT);
}
