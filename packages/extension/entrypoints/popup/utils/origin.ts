export interface OriginDescription {
  /** Host with any non-default port ("localhost:3000"), or the raw string if it doesn't parse. */
  label: string;
  /** Plain http to a host that isn't this machine: anyone on the network path can be the page. */
  insecure: boolean;
}

/**
 * How to name an app origin in the wallet. Trust and sessions are per full
 * origin, so the label keeps the port (http://localhost:3000 and :8080 are
 * different apps); URL already drops a scheme's default port.
 */
export function describeOrigin(origin: string): OriginDescription {
  try {
    const url = new URL(origin);
    if (!url.host) return { label: origin, insecure: false };
    return { label: url.host, insecure: url.protocol === 'http:' && !isLoopback(url.hostname) };
  } catch {
    return { label: origin, insecure: false };
  }
}

// Browsers treat these as potentially trustworthy even over http.
function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}
