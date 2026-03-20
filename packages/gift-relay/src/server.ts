#!/usr/bin/env node

import { WebSocketServer, WebSocket } from "ws";

interface Room {
  sender?: WebSocket;
  recipient?: WebSocket;
  authToken: string;
  lastActivity: number;
}

const PORT = parseInt(process.env.PORT || "8787", 10);
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const rooms = new Map<string, Room>();

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
  for (const [giftId, room] of rooms) {
    if (now - room.lastActivity > IDLE_TIMEOUT_MS) {
      if (room.sender?.readyState === WebSocket.OPEN) room.sender.close();
      if (room.recipient?.readyState === WebSocket.OPEN) room.recipient.close();
      rooms.delete(giftId);
      console.log(`[cleanup] removed idle room ${giftId}`);
    }
  }
}

const cleanupInterval = setInterval(cleanupIdleRooms, 60_000);

const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`gift-relay listening on port ${PORT}`);
});

wss.on("connection", (ws) => {
  let authedGiftId: string | null = null;
  let authedRole: "sender" | "recipient" | null = null;

  console.log("[connect] new connection");

  ws.on("message", (raw) => {
    let msg: { type: string; giftId?: string; authToken?: string; role?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!authedGiftId) {
      if (msg.type !== "gift:auth") return;

      const { giftId, authToken, role } = msg;
      if (
        typeof giftId !== "string" ||
        typeof authToken !== "string" ||
        (role !== "sender" && role !== "recipient")
      ) {
        send(ws, { type: "gift:auth:result", success: false, error: "invalid auth payload" });
        return;
      }

      let room = rooms.get(giftId);

      if (room) {
        if (room.authToken !== authToken) {
          send(ws, { type: "gift:auth:result", success: false, error: "auth token mismatch" });
          return;
        }
        if (room[role] && room[role]!.readyState === WebSocket.OPEN) {
          send(ws, { type: "gift:auth:result", success: false, error: `${role} already connected` });
          return;
        }
      } else {
        room = { authToken, lastActivity: Date.now() };
        rooms.set(giftId, room);
      }

      room[role] = ws;
      touchRoom(room);
      authedGiftId = giftId;
      authedRole = role;

      const peer = role === "sender" ? room.recipient : room.sender;
      const peerOnline = !!peer && peer.readyState === WebSocket.OPEN;

      send(ws, { type: "gift:auth:result", success: true, peerOnline });
      console.log(`[auth] ${role} joined room ${giftId} (peer ${peerOnline ? "online" : "offline"})`);

      if (peerOnline) {
        send(peer!, { type: "gift:peer:status", online: true });
      }

      return;
    }

    const room = rooms.get(authedGiftId);
    if (!room) return;

    touchRoom(room);

    if (authedRole === "recipient" && msg.type === "relay:request") {
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
        msg.type === "gift:usage"
      ) {
        if (room.recipient && room.recipient.readyState === WebSocket.OPEN) {
          room.recipient.send(String(raw));
        }
        return;
      }
    }
  });

  ws.on("close", () => {
    if (!authedGiftId || !authedRole) {
      console.log("[disconnect] unauthenticated connection closed");
      return;
    }

    console.log(`[disconnect] ${authedRole} left room ${authedGiftId}`);
    const room = rooms.get(authedGiftId);
    if (!room) return;

    room[authedRole] = undefined;

    const peer = authedRole === "sender" ? room.recipient : room.sender;
    if (peer && peer.readyState === WebSocket.OPEN) {
      send(peer, { type: "gift:peer:status", online: false });
    }

    if (!room.sender && !room.recipient) {
      rooms.delete(authedGiftId);
      console.log(`[cleanup] removed empty room ${authedGiftId}`);
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
