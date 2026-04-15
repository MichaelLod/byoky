#!/usr/bin/env node

import { WebSocketServer, WebSocket } from "ws";
import { timingSafeEqual, randomBytes } from "node:crypto";

// A room now supports multiple concurrent *senders* (the user's primary
// device + the vault's priority-0 fallback, for instance) and multiple
// concurrent *recipients*. Recipient requests route to the highest-priority
// currently connected sender. When that sender disconnects, the next one
// in the priority-sorted list takes over with zero reconnect gap — which is
// the fix for "gift sender offline" flapping when a mobile app backgrounds
// and the vault fallback is temporarily kicked out.
//
// Recipient request/response pairing: the relay rewrites `requestId` into a
// tagged form `r:<connId>:<origId>` before forwarding to the active sender,
// then reverses the tag on the response so each recipient only receives its
// own replies. Clients don't see the tag.
interface SenderConn {
  ws: WebSocket;
  priority: number;
}

interface Room {
  senders: SenderConn[];           // sorted by priority desc
  recipients: Map<string, WebSocket>;  // connId → recipient ws
  authToken: string;
  lastActivity: number;
}

const PORT = parseInt(process.env.PORT || "8787", 10);
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
// Cap per-room connection counts so a single gift can't DoS the relay.
const MAX_RECIPIENTS_PER_ROOM = 50;
const MAX_SENDERS_PER_ROOM = 4;

const rooms = new Map<string, Room>();
const authAttempts = new Map<string, number[]>();
const AUTH_RATE_LIMIT = 10;
const AUTH_RATE_WINDOW = 60_000;

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function touchRoom(room: Room): void {
  room.lastActivity = Date.now();
}

function activeSender(room: Room): WebSocket | null {
  for (const s of room.senders) {
    if (s.ws.readyState === WebSocket.OPEN) return s.ws;
  }
  return null;
}

function hasLiveSender(room: Room): boolean {
  return activeSender(room) !== null;
}

function cleanupIdleRooms(): void {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (now - room.lastActivity > IDLE_TIMEOUT_MS) {
      for (const s of room.senders) {
        if (s.ws.readyState === WebSocket.OPEN) s.ws.close();
      }
      for (const ws of room.recipients.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      }
      rooms.delete(roomId);
      console.log(`[cleanup] removed idle room ${roomId.slice(0, 8)}...`);
    }
  }
}

const cleanupInterval = setInterval(cleanupIdleRooms, 60_000);

function tagRequestId(connId: string, origId: string): string {
  return `r:${connId}:${origId}`;
}

function parseRequestId(tagged: string): { connId: string; origId: string } | null {
  if (!tagged.startsWith("r:")) return null;
  const rest = tagged.slice(2);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  return { connId: rest.slice(0, sep), origId: rest.slice(sep + 1) };
}

const wss = new WebSocketServer({ port: PORT, maxPayload: 20 * 1024 * 1024 }, () => {
  console.log(`relay listening on port ${PORT}`);
});

wss.on("connection", (ws) => {
  let authedRoomId: string | null = null;
  let authedRole: "sender" | "recipient" | null = null;
  let authedConnId: string | null = null;

  console.log("[connect] new connection");

  ws.on("message", (raw) => {
    let msg: { type: string; roomId?: string; authToken?: string; role?: string; requestId?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!authedRoomId) {
      if (msg.type !== "relay:auth") return;

      const { roomId, authToken, role } = msg;
      // Clamp priority to 0–1: 0 = fallback (vault), 1 = primary (device).
      const priority = typeof msg.priority === "number" ? Math.max(0, Math.min(1, Math.floor(msg.priority))) : 1;
      if (
        typeof roomId !== "string" ||
        typeof authToken !== "string" ||
        (role !== "sender" && role !== "recipient")
      ) {
        console.log(`[auth] rejected: invalid payload from ${role ?? "unknown"}`);
        send(ws, { type: "relay:auth:result", success: false, error: "invalid auth payload" });
        return;
      }

      console.log(`[auth] attempt: ${role} (priority ${priority}) for room ${roomId.slice(0, 8)}...`);

      // Rate limit auth attempts per room+role
      const now = Date.now();
      const rateLimitKey = `${roomId}:${role}`;
      const attempts = (authAttempts.get(rateLimitKey) ?? []).filter((t) => now - t < AUTH_RATE_WINDOW);
      if (attempts.length >= AUTH_RATE_LIMIT) {
        console.log(`[auth] rejected: rate limited for ${role} in room ${roomId.slice(0, 8)}...`);
        send(ws, { type: "relay:auth:result", success: false, error: "too many auth attempts" });
        return;
      }
      attempts.push(now);
      authAttempts.set(rateLimitKey, attempts);

      let room = rooms.get(roomId);

      if (room) {
        // Constant-time comparison — pad to equal length so the length
        // check itself does not leak timing information.
        const expected = Buffer.from(room.authToken);
        const provided = Buffer.from(authToken);
        const maxLen = Math.max(expected.length, provided.length);
        const a = Buffer.alloc(maxLen);
        const b = Buffer.alloc(maxLen);
        expected.copy(a);
        provided.copy(b);
        if (!timingSafeEqual(a, b) || expected.length !== provided.length) {
          // If the room has no active connections, it's stale — delete it
          // so the next connection can create a fresh room with the correct token
          const sendersDead = room.senders.every((s) => s.ws.readyState !== WebSocket.OPEN);
          const recipientsDead = Array.from(room.recipients.values())
            .every((r) => r.readyState !== WebSocket.OPEN);
          const staleMs = Date.now() - room.lastActivity;
          if (sendersDead && recipientsDead && staleMs > IDLE_TIMEOUT_MS) {
            rooms.delete(roomId);
            console.log(`[auth] deleted stale room ${roomId.slice(0, 8)}... (token mismatch, idle ${Math.round(staleMs / 1000)}s, no active peers)`);
            room = { authToken, senders: [], recipients: new Map(), lastActivity: Date.now() };
            rooms.set(roomId, room);
          } else {
            console.log(`[auth] rejected: token mismatch for room ${roomId.slice(0, 8)}...`);
            send(ws, { type: "relay:auth:result", success: false, error: "auth token mismatch" });
            return;
          }
        }

        if (role === "sender") {
          // Coexist senders: the primary (priority 1) and the vault fallback
          // (priority 0) both stay connected. Requests go to whichever is
          // currently highest-priority and live. No more kick — that caused
          // the vault to bounce through a reconnect-backoff window every
          // time the primary device came and went.
          const liveCount = room.senders.filter((s) => s.ws.readyState === WebSocket.OPEN).length;
          if (liveCount >= MAX_SENDERS_PER_ROOM) {
            console.log(`[auth] rejected: sender cap (${MAX_SENDERS_PER_ROOM}) reached in room ${roomId.slice(0, 8)}...`);
            send(ws, { type: "relay:auth:result", success: false, error: "sender cap reached" });
            return;
          }
        } else {
          if (room.recipients.size >= MAX_RECIPIENTS_PER_ROOM) {
            console.log(`[auth] rejected: recipient cap reached in room ${roomId.slice(0, 8)}...`);
            send(ws, { type: "relay:auth:result", success: false, error: "recipient cap reached" });
            return;
          }
        }
      } else {
        room = { authToken, senders: [], recipients: new Map(), lastActivity: Date.now() };
        rooms.set(roomId, room);
      }

      if (role === "sender") {
        // Keep senders sorted priority-desc so activeSender() is O(1) over
        // the short list. Ties broken by insertion order.
        const wasLive = hasLiveSender(room);
        const insertAt = room.senders.findIndex((s) => s.priority < priority);
        const entry: SenderConn = { ws, priority };
        if (insertAt < 0) room.senders.push(entry);
        else room.senders.splice(insertAt, 0, entry);

        touchRoom(room);
        authedRoomId = roomId;
        authedRole = role;

        const peerOnline = room.recipients.size > 0;
        send(ws, { type: "relay:auth:result", success: true, peerOnline });
        console.log(`[auth] sender joined room ${roomId.slice(0, 8)}... (priority ${priority}, senders=${room.senders.length})`);

        // First sender joining flips "online" for recipients.
        if (!wasLive) {
          for (const r of room.recipients.values()) {
            send(r, { type: "relay:peer:status", online: true });
          }
        }
        return;
      }

      // role === "recipient"
      authedConnId = randomBytes(8).toString("hex");
      room.recipients.set(authedConnId, ws);
      touchRoom(room);
      authedRoomId = roomId;
      authedRole = role;

      const peerOnline = hasLiveSender(room);
      send(ws, { type: "relay:auth:result", success: true, peerOnline });
      console.log(`[auth] recipient joined room ${roomId.slice(0, 8)}... (recipients=${room.recipients.size}, peer=${peerOnline ? "online" : "offline"})`);

      // Notify every live sender that a new recipient is here.
      for (const s of room.senders) {
        if (s.ws.readyState === WebSocket.OPEN) send(s.ws, { type: "relay:peer:status", online: true });
      }
      return;
    }

    const room = rooms.get(authedRoomId);
    if (!room) return;

    touchRoom(room);

    if (authedRole === "recipient") {
      if (msg.type === "relay:request" && typeof msg.requestId === "string" && authedConnId) {
        // Tag the requestId with the recipient's connId so responses route
        // back here. Sender sees the tagged id; client never sees it.
        const tagged = tagRequestId(authedConnId, msg.requestId);
        const rewritten = JSON.stringify({ ...msg, requestId: tagged });
        const target = activeSender(room);
        if (target) target.send(rewritten);
        return;
      }
      if (msg.type === "relay:pair:ack") {
        // Pairing flow is 1:1 — forward the ack to the active sender as-is.
        const target = activeSender(room);
        if (target) target.send(String(raw));
        return;
      }
      return;
    }

    if (authedRole === "sender") {
      if (
        msg.type === "relay:response:meta" ||
        msg.type === "relay:response:chunk" ||
        msg.type === "relay:response:done" ||
        msg.type === "relay:response:error"
      ) {
        const tagged = typeof msg.requestId === "string" ? msg.requestId : "";
        const parsed = parseRequestId(tagged);
        if (!parsed) return;
        const target = room.recipients.get(parsed.connId);
        if (!target || target.readyState !== WebSocket.OPEN) return;
        const rewritten = JSON.stringify({ ...msg, requestId: parsed.origId });
        target.send(rewritten);
        return;
      }

      if (msg.type === "relay:usage") {
        // Usage updates apply to the whole gift — broadcast to every
        // recipient so their wallets stay in sync.
        for (const r of room.recipients.values()) {
          if (r.readyState === WebSocket.OPEN) r.send(String(raw));
        }
        return;
      }

      if (
        msg.type === "relay:pair:hello" ||
        msg.type === "relay:vault:offer" ||
        msg.type === "relay:vault:offer:failed"
      ) {
        // Pairing flow — broadcast to every recipient; the pairing
        // initiator will be the only one that cares.
        for (const r of room.recipients.values()) {
          if (r.readyState === WebSocket.OPEN) r.send(String(raw));
        }
        return;
      }
    }
  });

  ws.on("close", () => {
    if (!authedRoomId || !authedRole) {
      console.log("[disconnect] unauthenticated connection closed");
      return;
    }

    console.log(`[disconnect] ${authedRole} left room ${authedRoomId.slice(0, 8)}...`);
    const room = rooms.get(authedRoomId);
    if (!room) return;

    if (authedRole === "sender") {
      room.senders = room.senders.filter((s) => s.ws !== ws);
      // Notify recipients only when the LAST live sender is gone.
      if (!hasLiveSender(room)) {
        for (const r of room.recipients.values()) {
          if (r.readyState === WebSocket.OPEN) {
            send(r, { type: "relay:peer:status", online: false });
          }
        }
      }
    } else if (authedConnId) {
      room.recipients.delete(authedConnId);
      if (room.recipients.size === 0) {
        for (const s of room.senders) {
          if (s.ws.readyState === WebSocket.OPEN) {
            send(s.ws, { type: "relay:peer:status", online: false });
          }
        }
      }
    }

    if (room.senders.length === 0 && room.recipients.size === 0) {
      rooms.delete(authedRoomId);
      console.log(`[cleanup] removed empty room ${authedRoomId.slice(0, 8)}...`);
    }
  });

  ws.on("error", (err) => {
    console.error("[error]", err.message);
  });
});

process.on("SIGINT", () => {
  console.log("shutting down...");
  clearInterval(cleanupInterval);
  wss.close();
  process.exit(0);
});
