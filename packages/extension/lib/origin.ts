/**
 * Whether an app origin loads over plain http from a host that isn't this
 * machine: anyone on the network path (a café Wi-Fi, a captive portal, a
 * spoofed DNS answer) can serve a page as it. The wallet still lets such an
 * app connect after an approval, but never trusts it to connect without one.
 */
export function isInsecureOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && !!url.host && !isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/** Hosts browsers treat as potentially trustworthy even over http. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}
