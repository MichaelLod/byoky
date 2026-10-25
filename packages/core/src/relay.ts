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
  | RelayPing
  | RelayPong;

/**
 * Largest serialized relay message (string length) either side accepts.
 * parseRelayMessage drops anything bigger without a reply, so senders must
 * check before sending or the other side never answers.
 */
export const MAX_RELAY_MESSAGE_SIZE = 1_048_576; // 1 MB

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
        if (typeof raw.sessionId !== 'string') return null;
        break;
      case 'relay:request':
        if (typeof raw.requestId !== 'string' || typeof raw.providerId !== 'string' ||
            typeof raw.url !== 'string' || typeof raw.method !== 'string') return null;
        break;
      case 'relay:response:meta':
        if (typeof raw.requestId !== 'string' || typeof raw.status !== 'number') return null;
        break;
      case 'relay:response:chunk':
        if (typeof raw.requestId !== 'string' || typeof raw.chunk !== 'string') return null;
        break;
      case 'relay:response:done':
        if (typeof raw.requestId !== 'string') return null;
        break;
      case 'relay:response:error':
        if (typeof raw.requestId !== 'string') return null;
        if (raw.error && (typeof raw.error !== 'object' || typeof raw.error.code !== 'string' || typeof raw.error.message !== 'string')) return null;
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
