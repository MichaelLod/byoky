import { validateProxyUrl } from '@byoky/core';

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

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

    if (!validateProxyUrl(providerId, url)) {
      throw new Error(`Request URL does not match provider ${providerId} — request blocked`);
    }

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
          case 'relay:response:meta': {
            if (resolved) break;
            if (typeof data.status !== 'number' || data.status < 100 || data.status > 599) break;
            const statusText = typeof data.statusText === 'string' ? data.statusText : '';
            if (!data.headers || typeof data.headers !== 'object' || Array.isArray(data.headers)) break;
            const safeHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(data.headers as Record<string, unknown>)) {
              if (typeof k === 'string' && typeof v === 'string') safeHeaders[k] = v;
            }
            resolved = true;
            clearTimeout(timeout);
            resolve(
              new Response(readable, {
                status: data.status,
                statusText,
                headers: new Headers(safeHeaders),
              }),
            );
            break;
          }

          case 'relay:response:chunk':
            if (typeof data.chunk !== 'string') break;
            writer.write(encoder.encode(data.chunk)).catch(() => {});
            break;

          case 'relay:response:done':
            writer.close().catch(() => {});
            cleanup();
            break;

          case 'relay:response:error': {
            const errResponse = new Response(
              JSON.stringify({ error: { message: 'Relay proxy error', code: 'RELAY_ERROR' } }),
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

      function handleClose() {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error('Relay WebSocket closed before response completed'));
        }
        writer.close().catch(() => {});
        cleanup();
      }

      function cleanup() {
        clearTimeout(timeout);
        ws.removeEventListener('message', handleMessage);
        ws.removeEventListener('close', handleClose);
      }

      ws.addEventListener('message', handleMessage);
      ws.addEventListener('close', handleClose);

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
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
    return body;
  }
  if (body instanceof ArrayBuffer) {
    if (body.byteLength > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
    return new TextDecoder().decode(body);
  }
  if (body instanceof Blob) {
    if (body.size > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
    return body.text();
  }
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ReadableStream) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
      chunks.push(value);
    }
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(combined);
  }
  return undefined;
}
