import type { SerializedFormDataEntry } from '@byoky/core';
import { ByokyError, ByokyErrorCode, isTextContentType } from '@byoky/core';

// Request bodies as the wallet protocols carry them: a string, plus
// bodyEncoding 'base64' for raw bytes or 'formdata' for multipart forms.
// Shared by createFetch (page → wallet) and the backend relay
// (server → browser → wallet), so a body survives either path intact.

export interface EncodedBody {
  body: string;
  bodyEncoding?: 'base64' | 'formdata';
  /** The Content-Type fetch would send for this body when the caller set none. */
  contentType?: string;
}

/** A fetch call's arguments, with a Request input taken apart the way fetch reads it. */
export interface FetchParts {
  url: string;
  method: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  signal?: AbortSignal;
  /** init.body, or the bytes of a Request input's body. */
  body?: BodyInit;
}

function isRequestLike(input: unknown): input is Request {
  return typeof input === 'object' && input !== null && !(input instanceof URL) &&
    typeof (input as Request).url === 'string' &&
    typeof (input as Request).method === 'string' &&
    typeof (input as Request).arrayBuffer === 'function';
}

function isStream(body: unknown): body is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && body instanceof ReadableStream;
}

function headersToRecord(init?: HeadersInit): Record<string, string> {
  return init ? Object.fromEntries(new Headers(init).entries()) : {};
}

/**
 * Reads method, headers, body and signal from a Request input as fetch
 * does; anything set in init wins. SDKs such as Mistral's call fetch with a
 * bare Request, which used to go out as a GET with no body.
 */
export async function fetchParts(input: RequestInfo | URL, init?: RequestInit): Promise<FetchParts> {
  if (isRequestLike(input)) {
    let body: BodyInit | undefined = init?.body ?? undefined;
    if (body === undefined && input.body) {
      body = new Uint8Array(await input.arrayBuffer());
    }
    return {
      url: input.url,
      method: init?.method ?? input.method,
      headers: headersToRecord(init?.headers ?? input.headers),
      signal: init && 'signal' in init ? init.signal ?? undefined : input.signal ?? undefined,
      body,
    };
  }
  return {
    url: typeof input === 'string' ? input : input.toString(),
    method: init?.method ?? 'GET',
    headers: headersToRecord(init?.headers),
    signal: init?.signal ?? undefined,
    body: init?.body ?? undefined,
  };
}

/**
 * The same call with a body that can be sent twice: a stream, or the body
 * of a Request input, is read into bytes once. For a retry.
 */
export async function replayableArgs(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<[RequestInfo | URL, RequestInit | undefined]> {
  if (!isRequestLike(input) && !isStream(init?.body)) return [input, init];
  const parts = await fetchParts(input, init);
  const body = isStream(parts.body) ? await readStream(parts.body) : parts.body;
  return [parts.url, { ...init, method: parts.method, headers: parts.headers, signal: parts.signal ?? null, body }];
}

export async function encodeBody(body: BodyInit, contentType?: string): Promise<EncodedBody> {
  if (typeof body === 'string') return { body };
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return { body: body.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return { body: await serializeFormData(body), bodyEncoding: 'formdata' };
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const blobType = body.type || undefined;
    return { ...encodeBytes(new Uint8Array(await body.arrayBuffer()), contentType ?? blobType), contentType: blobType };
  }
  if (body instanceof ArrayBuffer) return encodeBytes(new Uint8Array(body), contentType);
  if (ArrayBuffer.isView(body)) {
    return encodeBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), contentType);
  }
  if (isStream(body)) return encodeBytes(await readStream(body), contentType);
  throw new ByokyError(ByokyErrorCode.PROXY_ERROR, 'Unsupported request body type');
}

/**
 * Bytes go as text only when the content type is text and they are valid
 * UTF-8, so the round trip is exact; anything else goes as base64.
 */
function encodeBytes(bytes: Uint8Array, contentType?: string): EncodedBody {
  if (isTextContentType(contentType)) {
    try {
      return { body: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
    } catch {
      // Not valid UTF-8: send the bytes as they are.
    }
  }
  return { body: bytesToBase64(bytes), bodyEncoding: 'base64' };
}

/** The other way: a relayed body back into something fetch takes. */
export function decodeBody(body: string | undefined, bodyEncoding?: 'base64' | 'formdata'): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (bodyEncoding === 'base64') return base64ToBytes(body);
  if (bodyEncoding === 'formdata') {
    const formData = new FormData();
    for (const entry of JSON.parse(body) as SerializedFormDataEntry[]) {
      if (entry.type === 'file') {
        const blob = new Blob([base64ToBytes(entry.value)], { type: entry.contentType || 'application/octet-stream' });
        formData.append(entry.name, blob, entry.filename);
      } else {
        formData.append(entry.name, entry.value);
      }
    }
    return formData;
  }
  return body;
}

async function serializeFormData(formData: FormData): Promise<string> {
  const entries: SerializedFormDataEntry[] = [];
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string') {
      entries.push({ name, value, type: 'text' });
    } else {
      const buffer = await value.arrayBuffer();
      entries.push({
        name,
        value: bytesToBase64(new Uint8Array(buffer)),
        type: 'file',
        // A File has a name, a plain Blob doesn't (File isn't a global before Node 20).
        filename: typeof (value as Partial<File>).name === 'string' ? (value as File).name : undefined,
        contentType: value.type || 'application/octet-stream',
      });
    }
  }
  return JSON.stringify(entries);
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
