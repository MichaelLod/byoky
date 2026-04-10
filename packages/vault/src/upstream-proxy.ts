import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import { Readable } from 'node:stream';

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
 *
 * node-fetch returns its own Response type whose body is a Node.js
 * Readable, not a Web ReadableStream.  The vault's streaming code
 * (Hono stream()) calls response.body.getReader(), which only exists
 * on Web ReadableStream.  We bridge the two by converting the
 * node-fetch body into a Web ReadableStream so the rest of the vault
 * code works identically regardless of proxy on/off.
 */
export async function upstreamFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!agent) {
    return fetch(url, init);
  }

  const res = await nodeFetch(url, { ...init, agent } as Parameters<typeof nodeFetch>[1]);

  // Convert node-fetch body (Node.js Readable) → Web ReadableStream
  let webBody: ReadableStream<Uint8Array> | null = null;
  if (res.body) {
    const nodeStream = res.body as unknown as Readable;
    webBody = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });
  }

  // Build a standard Web Response with the converted body
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => { headers[key] = value; });

  return new Response(webBody, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
