export function createProxyFetch(
  providerId: string,
  sessionKey: string,
): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const method = init?.method ?? 'GET';
    const headers = init?.headers
      ? Object.fromEntries(new Headers(init.headers).entries())
      : {};
    const body = init?.body ? await readBody(init.body) : undefined;

    const requestId = crypto.randomUUID();

    return new Promise<Response>((resolve, reject) => {
      const { readable, writable } = new TransformStream<Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      let resolved = false;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Proxy request timed out'));
      }, 120_000);

      function handleEvent(event: Event) {
        const data = (event as CustomEvent).detail ?? (event as MessageEvent).data;
        if (data?.requestId !== requestId) return;

        switch (data.type) {
          case 'BYOKY_PROXY_RESPONSE_META':
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(
                new Response(readable, {
                  status: data.status,
                  statusText: data.statusText,
                  headers: new Headers(data.headers),
                }),
              );
            }
            break;

          case 'BYOKY_PROXY_RESPONSE_CHUNK':
            writer.write(encoder.encode(data.chunk)).catch(() => {});
            break;

          case 'BYOKY_PROXY_RESPONSE_DONE':
            writer.close().catch(() => {});
            cleanup();
            break;

          case 'BYOKY_PROXY_RESPONSE_ERROR': {
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
            }
            writer.close().catch(() => {});
            cleanup();
            break;
          }
        }
      }

      function cleanup() {
        clearTimeout(timeout);
        document.removeEventListener('byoky-message', handleEvent);
      }

      document.addEventListener('byoky-message', handleEvent);

      window.postMessage(
        {
          type: 'BYOKY_PROXY_REQUEST',
          requestId,
          sessionKey,
          providerId,
          url,
          method,
          headers,
          body,
        },
        window.location.origin,
      );
    });
  };
}

async function readBody(body: BodyInit): Promise<string | undefined> {
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (body instanceof Blob) return body.text();
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ReadableStream) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(combined);
  }
  return undefined;
}
