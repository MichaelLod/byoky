import { validateProxyUrl, type SerializedFormDataEntry } from '@byoky/core';

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

interface ReadBodyResult {
  body: string;
  bodyEncoding?: 'base64' | 'formdata';
}

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
    const bodyResult = init?.body ? await readBody(init.body, headers['content-type']) : undefined;

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
            // Forward the wallet's actual error code + message into the
            // response body so app-level error handlers can render
            // something useful (instead of "Relay proxy error 500").
            // The wallet always sends `{ error: { code, message } }` —
            // see RelayPairService on iOS / Android. We also pick a
            // status code that matches the failure mode so SDKs that
            // branch on response.status behave sensibly.
            const errObj = (data.error && typeof data.error === 'object' && !Array.isArray(data.error))
              ? data.error as { code?: string; message?: string }
              : {};
            const code = typeof errObj.code === 'string' ? errObj.code : 'RELAY_ERROR';
            const message = typeof errObj.message === 'string' && errObj.message
              ? errObj.message
              : 'Relay proxy error';
            const status = relayErrorCodeToHttpStatus(code);
            const errResponse = new Response(
              JSON.stringify({ error: { message, code, type: code } }),
              { status, headers: { 'content-type': 'application/json' } },
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
        body: bodyResult?.body,
        bodyEncoding: bodyResult?.bodyEncoding,
      }));
    });
  };
}

/**
 * Map a wallet-side error code to a sensible HTTP status. The wallet sends
 * a small set of well-known codes via `relay:response:error`; we surface
 * each as the status code an SDK would expect for that failure mode.
 * Anything unknown defaults to 500.
 */
function relayErrorCodeToHttpStatus(code: string): number {
  switch (code) {
    case 'NO_CREDENTIAL':
    case 'PROVIDER_UNAVAILABLE':
      return 403;
    case 'INVALID_URL':
    case 'TRANSLATION_NOT_SUPPORTED':
      return 400;
    case 'QUOTA_EXCEEDED':
      return 429;
    case 'TRANSLATION_FAILED':
    case 'SWAP_FAILED':
    case 'INVALID_RESPONSE':
    case 'PROXY_ERROR':
      return 502;
    default:
      return 500;
  }
}

function isTextContentType(contentType?: string): boolean {
  if (!contentType) return true;
  const lower = contentType.toLowerCase();
  return lower.startsWith('text/') ||
    lower.includes('json') ||
    lower.includes('xml') ||
    lower.includes('urlencoded') ||
    lower.includes('javascript');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function serializeFormData(formData: FormData): Promise<ReadBodyResult> {
  const entries: SerializedFormDataEntry[] = [];
  let totalSize = 0;
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string') {
      totalSize += value.length;
      if (totalSize > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
      entries.push({ name, value, type: 'text' });
    } else {
      totalSize += value.size;
      if (totalSize > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
      const buffer = await value.arrayBuffer();
      entries.push({
        name,
        value: uint8ToBase64(new Uint8Array(buffer)),
        type: 'file',
        filename: value instanceof File ? value.name : undefined,
        contentType: value.type || 'application/octet-stream',
      });
    }
  }
  return { body: JSON.stringify(entries), bodyEncoding: 'formdata' };
}

async function readBody(body: BodyInit, contentType?: string): Promise<ReadBodyResult | undefined> {
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
    return { body };
  }
  if (body instanceof URLSearchParams) return { body: body.toString() };

  if (body instanceof FormData) {
    return serializeFormData(body);
  }

  if (body instanceof ArrayBuffer) {
    if (body.byteLength > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
    if (isTextContentType(contentType)) {
      return { body: new TextDecoder().decode(body) };
    }
    return { body: uint8ToBase64(new Uint8Array(body)), bodyEncoding: 'base64' };
  }

  if (body instanceof Blob) {
    if (body.size > MAX_BODY_SIZE) throw new Error('Request body exceeds maximum size');
    if (isTextContentType(contentType)) {
      return { body: await body.text() };
    }
    const buffer = await body.arrayBuffer();
    return { body: uint8ToBase64(new Uint8Array(buffer)), bodyEncoding: 'base64' };
  }

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
    if (isTextContentType(contentType)) {
      return { body: new TextDecoder().decode(combined) };
    }
    return { body: uint8ToBase64(combined), bodyEncoding: 'base64' };
  }

  return undefined;
}
