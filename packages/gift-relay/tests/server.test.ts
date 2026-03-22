import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';

// We spin up the relay server in-process for testing
// by importing the server module's logic directly.
// Since server.ts auto-starts, we'll start our own WSS instead.

const TEST_PORT = 19876;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}`;

// --- Minimal relay server reimplementation for testing ---
// (We can't import server.ts directly because it auto-binds on import)

interface Room {
  sender?: WebSocket;
  recipient?: WebSocket;
  authToken: string;
  lastActivity: number;
}

let wss: WebSocketServer;
let rooms: Map<string, Room>;

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    rooms = new Map();
    wss = new WebSocketServer({ port: TEST_PORT }, () => resolve());

    wss.on('connection', (ws) => {
      let authedGiftId: string | null = null;
      let authedRole: 'sender' | 'recipient' | null = null;

      ws.on('message', (raw) => {
        let msg: any;
        try { msg = JSON.parse(String(raw)); } catch { return; }

        if (!authedGiftId) {
          if (msg.type !== 'gift:auth') return;
          const { giftId, authToken, role } = msg;
          if (typeof giftId !== 'string' || typeof authToken !== 'string' ||
              (role !== 'sender' && role !== 'recipient')) {
            send(ws, { type: 'gift:auth:result', success: false, error: 'invalid auth payload' });
            return;
          }

          let room = rooms.get(giftId);
          if (room) {
            if (room.authToken !== authToken) {
              send(ws, { type: 'gift:auth:result', success: false, error: 'auth token mismatch' });
              return;
            }
            if (room[role] && room[role]!.readyState === WebSocket.OPEN) {
              send(ws, { type: 'gift:auth:result', success: false, error: `${role} already connected` });
              return;
            }
          } else {
            room = { authToken, lastActivity: Date.now() };
            rooms.set(giftId, room);
          }

          room[role] = ws;
          room.lastActivity = Date.now();
          authedGiftId = giftId;
          authedRole = role;

          const peer = role === 'sender' ? room.recipient : room.sender;
          const peerOnline = !!peer && peer.readyState === WebSocket.OPEN;
          send(ws, { type: 'gift:auth:result', success: true, peerOnline });

          if (peerOnline) {
            send(peer!, { type: 'gift:peer:status', online: true });
          }
          return;
        }

        const room = rooms.get(authedGiftId);
        if (!room) return;
        room.lastActivity = Date.now();

        if (authedRole === 'recipient' && msg.type === 'relay:request') {
          if (room.sender?.readyState === WebSocket.OPEN) {
            room.sender.send(String(raw));
          }
          return;
        }

        if (authedRole === 'sender') {
          if (['relay:response:meta', 'relay:response:chunk',
               'relay:response:done', 'relay:response:error',
               'gift:usage'].includes(msg.type)) {
            if (room.recipient?.readyState === WebSocket.OPEN) {
              room.recipient.send(String(raw));
            }
            return;
          }
        }
      });

      ws.on('close', () => {
        if (!authedGiftId || !authedRole) return;
        const room = rooms.get(authedGiftId);
        if (!room) return;
        room[authedRole] = undefined;
        const peer = authedRole === 'sender' ? room.recipient : room.sender;
        if (peer?.readyState === WebSocket.OPEN) {
          send(peer, { type: 'gift:peer:status', online: false });
        }
        if (!room.sender && !room.recipient) {
          rooms.delete(authedGiftId);
        }
      });
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close(() => resolve());
  });
}

// --- Helpers ---

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
  });
}

function authenticate(ws: WebSocket, giftId: string, authToken: string, role: 'sender' | 'recipient'): Promise<any> {
  ws.send(JSON.stringify({ type: 'gift:auth', giftId, authToken, role }));
  return waitForMessage(ws);
}

function waitForClose(ws: WebSocket, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeoutMs);
    ws.on('close', () => { clearTimeout(timer); resolve(); });
  });
}

// --- Tests ---

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(() => {
  // Clean up rooms between tests
  rooms.clear();
});

describe('Authentication', () => {
  it('sender can authenticate and create a room', async () => {
    const ws = await connect();
    const result = await authenticate(ws, 'gift_1', 'token_abc', 'sender');
    expect(result).toEqual({ type: 'gift:auth:result', success: true, peerOnline: false });
    ws.close();
  });

  it('recipient can authenticate and create a room', async () => {
    const ws = await connect();
    const result = await authenticate(ws, 'gift_2', 'token_def', 'recipient');
    expect(result).toEqual({ type: 'gift:auth:result', success: true, peerOnline: false });
    ws.close();
  });

  it('rejects invalid auth payload (missing role)', async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: 'gift:auth', giftId: 'gift_3', authToken: 'tok' }));
    const result = await waitForMessage(ws);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid auth payload');
    ws.close();
  });

  it('rejects auth token mismatch', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_4', 'correct_token', 'sender');

    const recipient = await connect();
    const result = await authenticate(recipient, 'gift_4', 'wrong_token', 'recipient');
    expect(result.success).toBe(false);
    expect(result.error).toContain('auth token mismatch');

    sender.close();
    recipient.close();
  });

  it('rejects duplicate sender for same gift', async () => {
    const sender1 = await connect();
    await authenticate(sender1, 'gift_5', 'token_5', 'sender');

    const sender2 = await connect();
    const result = await authenticate(sender2, 'gift_5', 'token_5', 'sender');
    expect(result.success).toBe(false);
    expect(result.error).toContain('sender already connected');

    sender1.close();
    sender2.close();
  });

  it('rejects duplicate recipient for same gift', async () => {
    const recipient1 = await connect();
    await authenticate(recipient1, 'gift_6', 'token_6', 'recipient');

    const recipient2 = await connect();
    const result = await authenticate(recipient2, 'gift_6', 'token_6', 'recipient');
    expect(result.success).toBe(false);
    expect(result.error).toContain('recipient already connected');

    recipient1.close();
    recipient2.close();
  });

  it('ignores non-auth messages before authentication', async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: 'relay:request', data: 'hello' }));
    // Should not receive any response — wait briefly and verify
    const gotMessage = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 500);
      ws.once('message', () => { clearTimeout(timer); resolve(true); });
    });
    expect(gotMessage).toBe(false);
    ws.close();
  });
});

describe('Peer Status', () => {
  it('sender sees peerOnline:true when recipient is already connected', async () => {
    const recipient = await connect();
    await authenticate(recipient, 'gift_10', 'token_10', 'recipient');

    const sender = await connect();
    const senderResult = await authenticate(sender, 'gift_10', 'token_10', 'sender');
    expect(senderResult.peerOnline).toBe(true);

    // Recipient should also get peer:status online
    const peerStatus = await waitForMessage(recipient);
    expect(peerStatus).toEqual({ type: 'gift:peer:status', online: true });

    sender.close();
    recipient.close();
  });

  it('recipient gets peer:status offline when sender disconnects', async () => {
    // Recipient connects first this time
    const recipient = await connect();
    await authenticate(recipient, 'gift_11', 'token_11', 'recipient');

    const sender = await connect();
    const senderAuth = await authenticate(sender, 'gift_11', 'token_11', 'sender');
    expect(senderAuth.peerOnline).toBe(true);

    // Recipient gets peer:status online notification
    const online = await waitForMessage(recipient);
    expect(online).toEqual({ type: 'gift:peer:status', online: true });

    sender.close();
    const offline = await waitForMessage(recipient);
    expect(offline).toEqual({ type: 'gift:peer:status', online: false });

    recipient.close();
  });

  it('sender gets peer:status offline when recipient disconnects', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_12', 'token_12', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_12', 'token_12', 'recipient');
    // Consume the peer:status online message from sender side
    await waitForMessage(sender);

    recipient.close();
    const offline = await waitForMessage(sender);
    expect(offline).toEqual({ type: 'gift:peer:status', online: false });

    sender.close();
  });
});

describe('Request/Response Relay', () => {
  it('relays request from recipient to sender', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_20', 'token_20', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_20', 'token_20', 'recipient');
    // Consume peer status messages
    await waitForMessage(sender);

    const request = {
      type: 'relay:request',
      id: 'req_1',
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"claude-sonnet-4-20250514"}',
    };
    recipient.send(JSON.stringify(request));

    const received = await waitForMessage(sender);
    expect(received.type).toBe('relay:request');
    expect(received.id).toBe('req_1');
    expect(received.url).toBe('https://api.anthropic.com/v1/messages');

    sender.close();
    recipient.close();
  });

  it('relays response meta from sender to recipient', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_21', 'token_21', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_21', 'token_21', 'recipient');
    await waitForMessage(sender); // peer status

    const meta = {
      type: 'relay:response:meta',
      id: 'req_1',
      status: 200,
      headers: { 'content-type': 'application/json' },
    };
    sender.send(JSON.stringify(meta));

    const received = await waitForMessage(recipient);
    expect(received.type).toBe('relay:response:meta');
    expect(received.status).toBe(200);

    sender.close();
    recipient.close();
  });

  it('relays response chunks from sender to recipient', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_22', 'token_22', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_22', 'token_22', 'recipient');
    await waitForMessage(sender); // peer online

    // Collect all messages on recipient side
    const messages: any[] = [];
    const allReceived = new Promise<void>((resolve) => {
      recipient.on('message', (data) => {
        messages.push(JSON.parse(String(data)));
        if (messages.length >= 3) resolve();
      });
    });

    sender.send(JSON.stringify({ type: 'relay:response:chunk', id: 'req_1', data: 'Hello ' }));
    sender.send(JSON.stringify({ type: 'relay:response:chunk', id: 'req_1', data: 'World' }));
    sender.send(JSON.stringify({ type: 'relay:response:done', id: 'req_1' }));

    await allReceived;

    expect(messages[0].type).toBe('relay:response:chunk');
    expect(messages[0].data).toBe('Hello ');
    expect(messages[1].type).toBe('relay:response:chunk');
    expect(messages[1].data).toBe('World');
    expect(messages[2].type).toBe('relay:response:done');

    sender.close();
    recipient.close();
  });

  it('relays response error from sender to recipient', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_23', 'token_23', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_23', 'token_23', 'recipient');
    await waitForMessage(sender);

    const error = { type: 'relay:response:error', id: 'req_1', error: 'rate limited' };
    sender.send(JSON.stringify(error));

    const received = await waitForMessage(recipient);
    expect(received.type).toBe('relay:response:error');
    expect(received.error).toBe('rate limited');

    sender.close();
    recipient.close();
  });

  it('relays usage updates from sender to recipient', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_24', 'token_24', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_24', 'token_24', 'recipient');
    await waitForMessage(sender);

    const usage = { type: 'gift:usage', giftId: 'gift_24', usedTokens: 5000 };
    sender.send(JSON.stringify(usage));

    const received = await waitForMessage(recipient);
    expect(received.type).toBe('gift:usage');
    expect(received.usedTokens).toBe(5000);

    sender.close();
    recipient.close();
  });

  it('does NOT relay recipient messages other than relay:request to sender', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_25', 'token_25', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_25', 'token_25', 'recipient');
    await waitForMessage(sender); // peer online

    // Recipient tries to send a non-request message
    recipient.send(JSON.stringify({ type: 'gift:usage', giftId: 'gift_25', usedTokens: 999 }));

    const gotMessage = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 500);
      sender.once('message', () => { clearTimeout(timer); resolve(true); });
    });
    expect(gotMessage).toBe(false);

    sender.close();
    recipient.close();
  });

  it('does NOT relay sender messages with unknown types to recipient', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_26', 'token_26', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_26', 'token_26', 'recipient');
    await waitForMessage(sender); // peer online

    sender.send(JSON.stringify({ type: 'unknown:message', data: 'sneaky' }));

    const gotMessage = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 500);
      recipient.once('message', () => { clearTimeout(timer); resolve(true); });
    });
    expect(gotMessage).toBe(false);

    sender.close();
    recipient.close();
  });
});

describe('Room Cleanup', () => {
  it('removes room when both sender and recipient disconnect', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_30', 'token_30', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_30', 'token_30', 'recipient');
    await waitForMessage(sender);

    sender.close();
    await waitForMessage(recipient); // peer offline

    recipient.close();
    // Wait a tick for cleanup
    await new Promise((r) => setTimeout(r, 100));

    expect(rooms.has('gift_30')).toBe(false);
  });

  it('keeps room alive when only one peer disconnects', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_31', 'token_31', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_31', 'token_31', 'recipient');
    await waitForMessage(sender);

    recipient.close();
    await waitForMessage(sender); // peer offline
    await new Promise((r) => setTimeout(r, 100));

    expect(rooms.has('gift_31')).toBe(true);

    sender.close();
  });

  it('allows reconnection after peer disconnect', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_32', 'token_32', 'sender');

    const recipient1 = await connect();
    await authenticate(recipient1, 'gift_32', 'token_32', 'recipient');
    await waitForMessage(sender);

    recipient1.close();
    await waitForMessage(sender); // peer offline

    // New recipient connects
    const recipient2 = await connect();
    const result = await authenticate(recipient2, 'gift_32', 'token_32', 'recipient');
    expect(result.success).toBe(true);
    expect(result.peerOnline).toBe(true);

    // Sender should get peer online again
    const online = await waitForMessage(sender);
    expect(online).toEqual({ type: 'gift:peer:status', online: true });

    sender.close();
    recipient2.close();
  });
});

describe('Full Relay Flow', () => {
  it('completes a full request-response cycle through the relay', async () => {
    const sender = await connect();
    await authenticate(sender, 'gift_40', 'token_40', 'sender');

    const recipient = await connect();
    await authenticate(recipient, 'gift_40', 'token_40', 'recipient');
    await waitForMessage(sender); // peer online

    // 1. Recipient sends a request
    recipient.send(JSON.stringify({
      type: 'relay:request',
      id: 'req_full_1',
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hi"}]}',
    }));

    // 2. Sender receives the request
    const request = await waitForMessage(sender);
    expect(request.type).toBe('relay:request');
    expect(request.id).toBe('req_full_1');

    // Collect all messages on recipient
    const recipientMessages: any[] = [];
    const allReceived = new Promise<void>((resolve) => {
      recipient.on('message', (data) => {
        recipientMessages.push(JSON.parse(String(data)));
        if (recipientMessages.length >= 5) resolve();
      });
    });

    // 3. Sender sends response meta
    sender.send(JSON.stringify({
      type: 'relay:response:meta',
      id: 'req_full_1',
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    // 4. Sender streams response chunks
    sender.send(JSON.stringify({
      type: 'relay:response:chunk',
      id: 'req_full_1',
      data: 'data: {"type":"content_block_delta"}\n\n',
    }));

    sender.send(JSON.stringify({
      type: 'relay:response:chunk',
      id: 'req_full_1',
      data: 'data: {"type":"message_stop"}\n\n',
    }));

    // 5. Sender signals done
    sender.send(JSON.stringify({
      type: 'relay:response:done',
      id: 'req_full_1',
    }));

    // 6. Sender reports usage
    sender.send(JSON.stringify({
      type: 'gift:usage',
      giftId: 'gift_40',
      usedTokens: 150,
    }));

    // 7. Recipient receives everything in order
    await allReceived;

    expect(recipientMessages[0].type).toBe('relay:response:meta');
    expect(recipientMessages[0].status).toBe(200);
    expect(recipientMessages[1].type).toBe('relay:response:chunk');
    expect(recipientMessages[2].type).toBe('relay:response:chunk');
    expect(recipientMessages[3].type).toBe('relay:response:done');
    expect(recipientMessages[4].type).toBe('gift:usage');
    expect(recipientMessages[4].usedTokens).toBe(150);

    sender.close();
    recipient.close();
  });
});
