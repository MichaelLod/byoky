/**
 * Creates a fetch-like function that routes requests through a WebSocket relay
 * to a mobile wallet app, instead of through a browser extension.
 */
export function createRelayFetch(
  ws: WebSocket,
  providerId: string,
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
        reject(new Error('Relay proxy request timed out'));
      }, 120_000);

      function handleMessage(event: MessageEvent) {
        let data: { type: string; requestId?: string; [k: string]: unknown };
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.requestId !== requestId) return;

        switch (data.type) {
          case 'relay:response:meta':
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(
                new Response(readable, {
                  status: data.status as number,
                  statusText: (data.statusText as string) ?? '',
                  headers: new Headers(data.headers as Record<string, string>),
                }),
              );
            }
            break;

          case 'relay:response:chunk':
            writer.write(encoder.encode(data.chunk as string)).catch(() => {});
            break;

          case 'relay:response:done':
            writer.close().catch(() => {});
            cleanup();
            break;

          case 'relay:response:error': {
            const err = data.error as { code: string; message: string } | undefined;
            const errResponse = new Response(
              JSON.stringify({ error: err?.message ?? 'Relay proxy error' }),
              { status: 500, headers: { 'content-type': 'application/json' } },
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
        ws.removeEventListener('message', handleMessage);
      }

      ws.addEventListener('message', handleMessage);

      ws.send(JSON.stringify({
        type: 'relay:request',
        requestId,
        providerId,
        url,
        method,
        headers,
        body,
      }));
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
