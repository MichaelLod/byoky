// Inline WebSocketLike interface and readyState constants to avoid @byoky/core dependency
interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

const WS_READY_STATE = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } as const;

export interface MockWebSocketPair {
  client: WebSocketLike;
  server: WebSocketLike;
}

export function createMockWebSocketPair(
  onMessage?: (from: 'client' | 'server', data: string) => void,
): MockWebSocketPair {
  let clientState = WS_READY_STATE.CONNECTING;
  let serverState = WS_READY_STATE.CONNECTING;

  const client: WebSocketLike = {
    get readyState() { return clientState; },
    send(data: string) {
      if (clientState !== WS_READY_STATE.OPEN) return;
      onMessage?.('client', data);
      setTimeout(() => server.onmessage?.({ data }), 0);
    },
    close(code = 1000, reason = '') {
      clientState = WS_READY_STATE.CLOSED;
      serverState = WS_READY_STATE.CLOSED;
      setTimeout(() => server.onclose?.({ code, reason }), 0);
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  const server: WebSocketLike = {
    get readyState() { return serverState; },
    send(data: string) {
      if (serverState !== WS_READY_STATE.OPEN) return;
      onMessage?.('server', data);
      setTimeout(() => client.onmessage?.({ data }), 0);
    },
    close(code = 1000, reason = '') {
      serverState = WS_READY_STATE.CLOSED;
      clientState = WS_READY_STATE.CLOSED;
      setTimeout(() => client.onclose?.({ code, reason }), 0);
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  // Open both sides after a microtask
  setTimeout(() => {
    clientState = WS_READY_STATE.OPEN;
    serverState = WS_READY_STATE.OPEN;
    client.onopen?.(null);
    server.onopen?.(null);
  }, 0);

  return { client, server };
}
