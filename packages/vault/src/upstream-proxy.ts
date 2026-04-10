import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

let agent: HttpsProxyAgent<string> | undefined;

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
  agent = new HttpsProxyAgent(url);
  console.log('Upstream proxy configured');
}

/**
 * Fetch through the residential proxy when configured, otherwise use
 * the global fetch directly.
 */
export async function upstreamFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (agent) {
    const res = await nodeFetch(url, { ...init, agent } as Parameters<typeof nodeFetch>[1]);
    // node-fetch Response is compatible but not the same type — bridge it
    return res as unknown as Response;
  }
  return fetch(url, init);
}
