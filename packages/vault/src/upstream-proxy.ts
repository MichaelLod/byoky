import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import { Readable } from 'node:stream';

let agent: HttpsProxyAgent<string> | undefined;
// Hostnames pulled out of PROXY_URL, kept separately so we can scrub error
// messages that surface them. Set on initUpstreamProxy() and never written
// elsewhere — read-only after init.
let proxyHost: string | undefined;
let proxyUser: string | undefined;
let proxyPass: string | undefined;

/**
 * Initialise the residential proxy agent from PROXY_URL.
 *
 * Format: http://customer-USERNAME:PASSWORD@pr.oxylabs.io:7777
 *
 * When unset, upstream requests go direct (no proxy).
 *
 * The credentials portion (`username:password@`) is parsed out and reused
 * elsewhere only for the agent constructor; we never log the raw URL because
 * undici/node-fetch errors echo the proxy URL and leak the basic-auth pair.
 */
export function initUpstreamProxy(): void {
  const url = process.env.PROXY_URL;
  if (!url) return;
  try {
    const parsed = new URL(url);
    proxyHost = parsed.host;
    proxyUser = parsed.username || undefined;
    proxyPass = parsed.password || undefined;
  } catch {
    // Don't log the URL — it might already contain credentials. Just refuse
    // to configure the proxy, so callers fall back to direct fetch.
    console.error('PROXY_URL is malformed; falling back to direct fetch');
    return;
  }
  agent = new HttpsProxyAgent(url);
  // Log only the host — never the full URL (which embeds credentials).
  console.log(`Upstream proxy configured (${proxyHost})`);
}

/**
 * Scrub a string of any proxy credentials/host fragments so it's safe to log
 * or surface to clients. Used by the central error logger and the /proxy
 * 502 fallback message — error messages from undici / node-fetch frequently
 * include the full proxy URL when DNS or TLS fails.
 */
export function scrubProxyDetails(text: string): string {
  let scrubbed = text;
  if (proxyUser) scrubbed = scrubbed.split(proxyUser).join('[REDACTED]');
  if (proxyPass) scrubbed = scrubbed.split(proxyPass).join('[REDACTED]');
  if (proxyHost) scrubbed = scrubbed.split(proxyHost).join('[proxy]');
  return scrubbed;
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
 *
 * The init.signal (AbortSignal) is propagated into the underlying socket
 * so that a client disconnect (or our own abort) tears down the upstream
 * request — otherwise the residential-proxy path keeps streaming tokens
 * we'll never deliver and that the user is still being charged for.
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
        // Backpressure: pause the node stream when the controller queue is
        // full and resume when the consumer drains it. Without this, a fast
        // upstream + slow client would buffer the whole response in V8 heap.
        const pumpIfBackpressured = () => {
          if ((controller.desiredSize ?? 0) <= 0) {
            nodeStream.pause();
          }
        };
        nodeStream.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
          pumpIfBackpressured();
        });
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err) => controller.error(err));
        // Resume hook: when the stream gets consumed and desiredSize goes
        // positive, the consumer call to read() doesn't directly notify us,
        // but periodic resume on 'drain'-like events is good enough — the
        // node stream is paused while the queue is full and naturally stays
        // paused until our pull() callback would resume it. We resume here
        // any time the node stream signals it's ready for more.
        nodeStream.on('readable', () => {
          if ((controller.desiredSize ?? 0) > 0) {
            nodeStream.resume();
          }
        });

        // Wire AbortSignal → tear down the node socket. Without this the
        // node-fetch path keeps reading even after the consumer aborted.
        const signal = init.signal as AbortSignal | undefined;
        if (signal) {
          if (signal.aborted) {
            nodeStream.destroy();
          } else {
            signal.addEventListener('abort', () => nodeStream.destroy(), { once: true });
          }
        }
      },
      pull() {
        // ReadableStream calls pull() when the consumer wants more bytes.
        // Resume the node stream so 'data' events flow again.
        const node = res.body as unknown as Readable | null;
        if (node && node.isPaused()) node.resume();
      },
      cancel() {
        const node = res.body as unknown as Readable | null;
        if (node) node.destroy();
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
