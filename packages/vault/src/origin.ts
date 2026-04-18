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
// Permissive scheme grammar (RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )).
// Used by the fallback path so we don't accept identity-confusing strings
// like "null" (sandboxed iframes) or random non-URL noise as a valid origin.
const SCHEME_RE = /^[a-z][a-z0-9+.\-]*:\/\//i;

export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    // URL.origin is already RFC-canonical (lowercased scheme+host, default
    // port stripped). It never includes a trailing slash or path.
    return parsed.origin.toLowerCase();
  } catch {
    // Reject strings that don't even look like an origin. Browsers send
    // literal "null" for sandboxed iframes / opaque origins, and treating
    // those as a single canonical identity collapses unrelated sandboxes
    // into one. Better to reject and let the caller decide.
    if (!SCHEME_RE.test(trimmed)) return '';
    return trimmed.toLowerCase();
  }
}
