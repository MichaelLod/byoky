/**
 * Normalize an origin string for equality comparison.
 *
 * Browsers emit canonical origins (lowercased scheme + host, no trailing
 * slash, no path) per RFC 6454. Node-side SDK consumers may pass less
 * disciplined values via `appOrigin` (mixed case, trailing slash, etc.).
 * Both sides of any equality check go through this so casing or trailing
 * slashes don't sporadically reject otherwise-matching origins.
 *
 * Falls back to a trim+lowercase if URL parsing fails — that handles the
 * "browser sent a literal lowercase string the URL parser doesn't like"
 * edge case without throwing.
 */
export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    // URL.origin is already RFC-canonical (lowercased scheme+host, default
    // port stripped). It never includes a trailing slash or path.
    return parsed.origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}
