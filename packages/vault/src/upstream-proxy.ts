import { ProxyAgent, fetch as undiciFetch } from 'undici';

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
 * Fetch through the residential proxy when configured, otherwise use
 * the global fetch directly.
 */
export function upstreamFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (agent) {
    // undici's RequestInit and global RequestInit have minor type mismatches
    // (Blob stream signatures) — the runtime shapes are compatible.
    return undiciFetch(url, { ...(init as Record<string, unknown>), dispatcher: agent } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
  }
  return fetch(url, init);
}
