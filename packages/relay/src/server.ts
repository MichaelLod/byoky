#!/usr/bin/env node

import { WebSocketServer, WebSocket } from "ws";
import { timingSafeEqual } from "node:crypto";

interface Room {
  sender?: WebSocket;
  recipient?: WebSocket;
  authToken: string;
  lastActivity: number;
}

const PORT = parseInt(process.env.PORT || "8787", 10);
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const rooms = new Map<string, Room>();
const authAttempts = new Map<string, number[]>();
const AUTH_RATE_LIMIT = 5;
const AUTH_RATE_WINDOW = 60_000;

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function touchRoom(room: Room): void {
  room.lastActivity = Date.now();
}

function cleanupIdleRooms(): void {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (now - room.lastActivity > IDLE_TIMEOUT_MS) {
      if (room.sender?.readyState === WebSocket.OPEN) room.sender.close();
      if (room.recipient?.readyState === WebSocket.OPEN) room.recipient.close();
      rooms.delete(roomId);
      console.log(`[cleanup] removed idle room ${roomId.slice(0, 8)}...`);
    }
  }
}

const cleanupInterval = setInterval(cleanupIdleRooms, 60_000);

const wss = new WebSocketServer({ port: PORT, maxPayload: 1 * 1024 * 1024 }, () => {
  console.log(`relay listening on port ${PORT}`);
});

wss.on("connection", (ws) => {
  let authedRoomId: string | null = null;
  let authedRole: "sender" | "recipient" | null = null;

  console.log("[connect] new connection");

  ws.on("message", (raw) => {
    let msg: { type: string; roomId?: string; authToken?: string; role?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!authedRoomId) {
      if (msg.type !== "relay:auth") return;

      const { roomId, authToken, role } = msg;
      if (
        typeof roomId !== "string" ||
        typeof authToken !== "string" ||
        (role !== "sender" && role !== "recipient")
      ) {
        console.log(`[auth] rejected: invalid payload from ${role ?? "unknown"}`);
        send(ws, { type: "relay:auth:result", success: false, error: "invalid auth payload" });
        return;
      }

      console.log(`[auth] attempt: ${role} for room ${roomId.slice(0, 8)}...`);

      // Rate limit auth attempts per room
      const now = Date.now();
      const attempts = (authAttempts.get(roomId) ?? []).filter((t) => now - t < AUTH_RATE_WINDOW);
      if (attempts.length >= AUTH_RATE_LIMIT) {
        console.log(`[auth] rejected: rate limited for room ${roomId.slice(0, 8)}...`);
        send(ws, { type: "relay:auth:result", success: false, error: "too many auth attempts" });
        return;
      }
      attempts.push(now);
      authAttempts.set(roomId, attempts);

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
          const senderDead = !room.sender || room.sender.readyState !== WebSocket.OPEN;
          const recipientDead = !room.recipient || room.recipient.readyState !== WebSocket.OPEN;
          const staleMs = Date.now() - room.lastActivity;
          if (senderDead && recipientDead && staleMs > IDLE_TIMEOUT_MS) {
            rooms.delete(roomId);
            console.log(`[auth] deleted stale room ${roomId.slice(0, 8)}... (token mismatch, idle ${Math.round(staleMs / 1000)}s, no active peers)`);
            // Create fresh room with the new token
            room = { authToken, lastActivity: Date.now() };
            rooms.set(roomId, room);
          } else {
            console.log(`[auth] rejected: token mismatch for room ${roomId.slice(0, 8)}...`);
            send(ws, { type: "relay:auth:result", success: false, error: "auth token mismatch" });
            return;
          }
        }
        if (room[role] && room[role]!.readyState === WebSocket.OPEN) {
          console.log(`[auth] rejected: ${role} already connected in room ${roomId.slice(0, 8)}...`);
          send(ws, { type: "relay:auth:result", success: false, error: `${role} already connected` });
          return;
        }
      } else {
        room = { authToken, lastActivity: Date.now() };
        rooms.set(roomId, room);
      }

      room[role] = ws;
      touchRoom(room);
      authedRoomId = roomId;
      authedRole = role;

      const peer = role === "sender" ? room.recipient : room.sender;
      const peerOnline = !!peer && peer.readyState === WebSocket.OPEN;

      send(ws, { type: "relay:auth:result", success: true, peerOnline });
      console.log(`[auth] ${role} joined room ${roomId.slice(0, 8)}... (peer ${peerOnline ? "online" : "offline"})`);

      if (peerOnline) {
        send(peer!, { type: "relay:peer:status", online: true });
      }

      return;
    }

    const room = rooms.get(authedRoomId);
    if (!room) return;

    touchRoom(room);

    if (authedRole === "recipient" && (msg.type === "relay:request" || msg.type === "relay:pair:ack")) {
      if (room.sender && room.sender.readyState === WebSocket.OPEN) {
        room.sender.send(String(raw));
      }
      return;
    }

    if (authedRole === "sender") {
      if (
        msg.type === "relay:response:meta" ||
        msg.type === "relay:response:chunk" ||
        msg.type === "relay:response:done" ||
        msg.type === "relay:response:error" ||
        msg.type === "relay:usage" ||
        msg.type === "relay:pair:hello"
      ) {
        if (room.recipient && room.recipient.readyState === WebSocket.OPEN) {
          room.recipient.send(String(raw));
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

    room[authedRole] = undefined;

    const peer = authedRole === "sender" ? room.recipient : room.sender;
    if (peer && peer.readyState === WebSocket.OPEN) {
      send(peer, { type: "relay:peer:status", online: false });
    }

    if (!room.sender && !room.recipient) {
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
