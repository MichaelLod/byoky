import { ByokyError, ByokyErrorCode } from '@byoky/core';
import { base64ToBytes, encodeBody, fetchParts } from './body.js';
import { resolveMessageTarget } from './detect.js';
import { randomId } from './id.js';
import { walletError } from './wallet-error.js';

// Statuses whose Response must have a null body; new Response() throws on
// a stream body for them.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** Default for ProxyFetchOptions.timeout: 10 minutes, as in the official OpenAI and Anthropic SDKs. */
export const DEFAULT_REQUEST_TIMEOUT = 600_000;

export interface ProxyFetchOptions {
  /**
   * How long to wait for the response headers, in ms; 0 waits forever. A
   * non-streaming response sends its headers only once generation is
   * done, so this has to outlast the longest generation. The caller's
   * AbortSignal still cancels at any time. Default: DEFAULT_REQUEST_TIMEOUT.
   */
  timeout?: number;
}

export function createProxyFetch(
  providerId: string,
  sessionKeyRef: { current: string },
  options: ProxyFetchOptions = {},
): typeof fetch {
  const timeoutMs = options.timeout ?? DEFAULT_REQUEST_TIMEOUT;
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const { url, method, headers, signal, body } = await fetchParts(input, init);
    if (signal?.aborted) throw abortReason(signal);

    const bodyResult = body ? await encodeBody(body, headers['content-type']) : undefined;
    if (bodyResult?.contentType && !headers['content-type']) headers['content-type'] = bodyResult.contentType;
    if (signal?.aborted) throw abortReason(signal);

    const requestId = randomId();

    return new Promise<Response>((resolve, reject) => {
      const { readable, writable } = new TransformStream<Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      let resolved = false;
      // The request is over: done, failed, or given up on.
      let finished = false;

      // The app cancelled the body (reader.cancel(), leaving a for-await
      // loop over it early), which errors the writable side. As with fetch,
      // that stops the request; the wallet would otherwise generate (and
      // bill) the rest. Our own close and aborts set `finished` first.
      writer.closed.catch(() => {
        if (finished) return;
        finished = true;
        cleanup();
        cancel();
      });

      // A backstop for a wallet that never answers. It used to be a fixed
      // 120 s, which cut off slow non-streaming generations; the official
      // SDKs then retried, so one call was sent and billed three times.
      const timeout = timeoutMs > 0 ? setTimeout(() => {
        fail(new ByokyError(
          ByokyErrorCode.PROXY_ERROR,
          `Proxy request timed out: no response from the wallet within ${Math.round(timeoutMs / 1000)}s. If Byoky was just updated, reload the page.`,
          { timeout: timeoutMs },
        ));
      }, timeoutMs) : undefined;

      // Use MessageChannel for secure response delivery — page scripts
      // cannot intercept or spoof messages on a transferred port.
      const channel = new MessageChannel();

      channel.port1.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (data?.requestId !== requestId) return;

        switch (data.type) {
          case 'BYOKY_PROXY_RESPONSE_META': {
            if (resolved) break;
            let response: Response;
            try {
              response = new Response(NULL_BODY_STATUSES.has(data.status) ? null : readable, {
                status: data.status,
                statusText: data.statusText,
                headers: new Headers(data.headers),
              });
            } catch {
              fail(new ByokyError(ByokyErrorCode.PROXY_ERROR, 'Invalid response from the wallet'));
              break;
            }
            resolved = true;
            clearTimeout(timeout);
            resolve(response);
            break;
          }

          case 'BYOKY_PROXY_RESPONSE_CHUNK': {
            // A non-text response (audio, for one) arrives as base64 bytes;
            // a text decoder would turn every byte that isn't UTF-8 into U+FFFD.
            let bytes: Uint8Array;
            try {
              bytes = data.chunkEncoding === 'base64' ? base64ToBytes(data.chunk) : encoder.encode(data.chunk);
            } catch {
              fail(new ByokyError(ByokyErrorCode.PROXY_ERROR, 'Invalid response chunk from the wallet'));
              break;
            }
            writer.write(bytes).catch(() => {});
            break;
          }

          case 'BYOKY_PROXY_RESPONSE_DONE':
            finished = true;
            writer.close().catch(() => {});
            cleanup();
            break;

          case 'BYOKY_PROXY_RESPONSE_ERROR': {
            finished = true;
            const errResponse = new Response(
              JSON.stringify({ error: data.error }),
              {
                status: data.status || 500,
                headers: { 'content-type': 'application/json' },
              },
            );
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(errResponse);
            } else {
              // The status line already went out, so error the body: a
              // closed stream would pass for a complete response.
              writer.abort(walletError(
                data.error?.code ?? ByokyErrorCode.PROXY_ERROR,
                data.error?.message ?? 'Proxy request failed',
              )).catch(() => {});
            }
            cleanup();
            break;
          }
        }
      };

      // Stops the request, wallet side included. Like fetch: rejects while
      // waiting for headers, errors the body after.
      function fail(reason: unknown) {
        if (finished) return;
        finished = true;
        cleanup();
        cancel();
        if (resolved) {
          writer.abort(reason).catch(() => {});
        } else {
          resolved = true;
          reject(reason);
        }
      }

      const onAbort = () => fail(abortReason(signal!));
      signal?.addEventListener('abort', onAbort);

      function cleanup() {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        channel.port1.close();
      }

      // The content script drops the request's port, and the wallet then
      // aborts the upstream call.
      function cancel() {
        void resolveMessageTarget().then(({ target, origin }) => {
          target.postMessage({ type: 'BYOKY_PROXY_CANCEL', requestId }, origin);
        });
      }

      // This message carries the session key and the full request body, so
      // it only ever goes to this window (see resolveMessageTarget).
      void resolveMessageTarget().then(({ target, origin }) => {
        target.postMessage(
          {
            type: 'BYOKY_PROXY_REQUEST',
            requestId,
            sessionKey: sessionKeyRef.current,
            providerId,
            url,
            method,
            headers,
            body: bodyResult?.body,
            bodyEncoding: bodyResult?.bodyEncoding,
          },
          origin,
          [channel.port2],
        );
      });
    });
  };
}

/** What fetch rejects with on abort: the signal's reason, an AbortError by default. */
export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
