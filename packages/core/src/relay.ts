import type { AuthMethod } from './types.js';

// Handlers are checked bivariantly (method-style), so the browser's and the
// `ws` library's WebSocket, whose handlers take their own richer event types,
// stay assignable under strictFunctionTypes.
type EventHandler<E> = { bivarianceHack(event: E): void }['bivarianceHack'];

/** Minimal WebSocket interface — compatible with browser WebSocket and `ws` library. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: EventHandler<unknown> | null;
  onmessage: EventHandler<{ data: unknown }> | null;
  onclose: EventHandler<{ code: number; reason: string }> | null;
  onerror: EventHandler<unknown> | null;
}

export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

// --- Relay message types ---

export interface RelayHello {
  type: 'relay:hello';
  sessionId: string;
  providers: Record<string, { available: boolean; authMethod: AuthMethod }>;
}

export interface RelayRequest {
  type: 'relay:request';
  requestId: string;
  providerId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /**
   * How `body` is encoded, as in the page protocol's BYOKY_PROXY_REQUEST:
   * 'base64' for raw bytes, 'formdata' for a JSON array of
   * SerializedFormDataEntry. Absent means `body` is the text itself.
   */
  bodyEncoding?: 'base64' | 'formdata';
}

export interface RelayResponseMeta {
  type: 'relay:response:meta';
  requestId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface RelayResponseChunk {
  type: 'relay:response:chunk';
  requestId: string;
  chunk: string;
  /** 'base64' when `chunk` is base64 of raw bytes (non-text responses); absent means text. */
  chunkEncoding?: 'base64';
}

export interface RelayResponseDone {
  type: 'relay:response:done';
  requestId: string;
}

export interface RelayResponseError {
  type: 'relay:response:error';
  requestId: string;
  error: { code: string; message: string };
}

/** Server → browser: the backend gave up on a request, so stop it (and its upstream call). */
export interface RelayCancel {
  type: 'relay:cancel';
  requestId: string;
}

export interface RelayPing {
  type: 'relay:ping';
  ts: number;
}

export interface RelayPong {
  type: 'relay:pong';
  ts: number;
}

export type RelayMessage =
  | RelayHello
  | RelayRequest
  | RelayResponseMeta
  | RelayResponseChunk
  | RelayResponseDone
  | RelayResponseError
  | RelayCancel
  | RelayPing
  | RelayPong;

/**
 * Largest serialized relay message (string length) either side accepts.
 * parseRelayMessage drops anything bigger without a reply, so senders must
 * check before sending or the other side never answers.
 */
export const MAX_RELAY_MESSAGE_SIZE = 1_048_576; // 1 MB

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((v) => typeof v === 'string');
}

/** A provider map apps can index and read `.available` from without a TypeError. */
function isProviderMap(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every(isPlainObject);
}

export function parseRelayMessage(data: unknown): RelayMessage | null {
  try {
    if (typeof data === 'string' && data.length > MAX_RELAY_MESSAGE_SIZE) return null;
    const raw = typeof data === 'string' ? JSON.parse(data) : data;
    if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string' || !raw.type.startsWith('relay:')) {
      return null;
    }

    // Validate required fields per message type
    switch (raw.type) {
      case 'relay:hello':
        if (typeof raw.sessionId !== 'string' || !isProviderMap(raw.providers)) return null;
        break;
      case 'relay:request':
        if (typeof raw.requestId !== 'string' || typeof raw.providerId !== 'string' ||
            typeof raw.url !== 'string' || typeof raw.method !== 'string') return null;
        if (raw.body !== undefined && typeof raw.body !== 'string') return null;
        if (raw.bodyEncoding !== undefined && raw.bodyEncoding !== 'base64' && raw.bodyEncoding !== 'formdata') return null;
        break;
      case 'relay:response:meta':
        // The range is left to the server, which builds a Response from it
        // and fails the request at once when that throws.
        if (typeof raw.requestId !== 'string' || !Number.isInteger(raw.status)) return null;
        if (raw.statusText !== undefined && typeof raw.statusText !== 'string') return null;
        if (raw.headers !== undefined && !isStringRecord(raw.headers)) return null;
        break;
      case 'relay:response:chunk':
        if (typeof raw.requestId !== 'string' || typeof raw.chunk !== 'string') return null;
        if (raw.chunkEncoding !== undefined && raw.chunkEncoding !== 'base64') return null;
        break;
      case 'relay:response:done':
      case 'relay:cancel':
        if (typeof raw.requestId !== 'string') return null;
        break;
      case 'relay:response:error':
        if (typeof raw.requestId !== 'string') return null;
        if (!isPlainObject(raw.error) || typeof raw.error.code !== 'string' || typeof raw.error.message !== 'string') return null;
        break;
      case 'relay:ping':
      case 'relay:pong':
        if (typeof raw.ts !== 'number') return null;
        break;
      default:
        return null;
    }

    return raw as RelayMessage;
  } catch {
    return null;
  }
}

export function sendRelayMessage(ws: WebSocketLike, msg: RelayMessage): void {
  if (ws.readyState === WS_READY_STATE.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
