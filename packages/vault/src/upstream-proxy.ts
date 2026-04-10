import { ProxyAgent } from 'undici';

let agent: ProxyAgent | undefined;

/**
 * Initialise the residential proxy agent from PROXY_URL.
 *
 * Format: http://customer-USERNAME:PASSWORD@pr.oxylabs.io:7777
 *
 * When unset, upstream requests go direct (no proxy).
 */
export function initUpstreamProxy(): void {
  const url = process.env.PROXY_URL;
  if (!url) return;
  agent = new ProxyAgent(url);
  console.log('Upstream proxy configured');
}

/**
 * Returns fetch options that route through the residential proxy.
 * When no proxy is configured, returns an empty object.
 */
export function proxyDispatcher(): { dispatcher?: ProxyAgent } {
  return agent ? { dispatcher: agent } : {};
}
