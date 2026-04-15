import WebSocket from 'ws';
import {
  validateProxyUrl,
  buildHeaders,
  parseUsage,
  injectStreamUsageOptions,
  injectClaudeCodeSystemPrompt,
} from '@byoky/core';
import { getActiveGifts, incrementGiftUsage, forceUpdateGiftUsage, deleteExpiredGifts, getDb } from './db/index.js';
import { decryptGiftSecret } from './gift-crypto.js';
import { sql } from 'drizzle-orm';

interface GiftRow {
  id: string;
  userId: string;
  providerId: string;
  authMethod: string;
  encryptedApiKey: string;
  encryptedRelayToken: string;
  relayUrl: string;
  maxTokens: number;
  usedTokens: number;
  expiresAt: number;
  active: boolean | null;
  encryptedMarketplaceMgmtToken: string | null;
}

const connections = new Map<string, WebSocket>();
const budgetLocks = new Map<string, Promise<void>>();
const reconnectAttempts = new Map<string, number>();
const RECONNECT_BASE_DELAY = 10_000;
const RECONNECT_MAX_DELAY = 300_000; // 5 minutes
const PING_INTERVAL = 120_000;
const REQUEST_TIMEOUT = 120_000;

// Heartbeat cadence chosen to stay well inside the marketplace's 5-minute
// online threshold so there's slack for one missed tick.
const MARKETPLACE_HEARTBEAT_INTERVAL = 4 * 60 * 1000;
const MARKETPLACE_URL = process.env.MARKETPLACE_URL ?? 'https://marketplace.byoky.com';

let cleanupTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

export function connectGift(gift: GiftRow): void {
  if (connections.has(gift.id)) return;
  if (!gift.active || gift.expiresAt <= Date.now()) return;

  try {
    const parsed = new URL(gift.relayUrl);
    const isSecure = parsed.protocol === 'wss:';
    const isLocalWs = parsed.protocol === 'ws:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
    if (!isSecure && !isLocalWs) return;
  } catch {
    return;
  }

  (async () => {
    let relayToken: string;
    try {
      relayToken = await decryptGiftSecret(gift.encryptedRelayToken);
    } catch {
      console.error(`[gift-relay] failed to decrypt relay token for gift ${gift.id.slice(0, 8)}`);
      return;
    }

    const ws = new WebSocket(gift.relayUrl);
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'relay:auth',
        roomId: gift.id,
        authToken: relayToken,
        role: 'sender',
        priority: 0, // fallback — extension uses default priority 1
      }));

      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'relay:ping', ts: Date.now() }));
        }
      }, PING_INTERVAL);
    });

    ws.on('message', async (raw) => {
      try {
        const data = String(raw);
        if (data.length > 10_485_760) return;
        const msg = JSON.parse(data);

        if (msg.type === 'relay:auth:result') {
          if (!msg.success) {
            ws.close();
            connections.delete(gift.id);
            return;
          }
          reconnectAttempts.delete(gift.id); // reset backoff on success
          console.log(`[gift-relay] connected as fallback sender for gift ${gift.id.slice(0, 8)}`);
        }

        if (msg.type === 'relay:request') {
          await handleRequest(gift, ws, msg);
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on('close', (code) => {
      if (pingInterval) clearInterval(pingInterval);
      connections.delete(gift.id);

      // Don't reconnect if we were kicked by primary sender (code 4001)
      // or if the gift is no longer active/valid
      if (code === 4001) {
        console.log(`[gift-relay] kicked by primary sender for gift ${gift.id.slice(0, 8)}, will retry later`);
      }

      scheduleReconnect(gift);
    });

    ws.on('error', () => {
      // onclose fires after onerror
    });

    connections.set(gift.id, ws);
  })();
}

function scheduleReconnect(gift: GiftRow): void {
  const attempts = reconnectAttempts.get(gift.id) ?? 0;
  reconnectAttempts.set(gift.id, attempts + 1);
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, attempts), RECONNECT_MAX_DELAY);

  setTimeout(async () => {
    if (gift.expiresAt <= Date.now()) {
      reconnectAttempts.delete(gift.id);
      return;
    }
    try {
      const activeGifts = await getActiveGifts();
      const current = activeGifts.find((g) => g.id === gift.id);
      if (current?.active && current.expiresAt > Date.now()) {
        connectGift(current);
      } else {
        reconnectAttempts.delete(gift.id);
      }
    } catch {
      // DB error — backoff will increase on next attempt
      scheduleReconnect(gift);
    }
  }, delay);
}

export function disconnectGift(giftId: string): void {
  const ws = connections.get(giftId);
  if (ws) {
    ws.close();
    connections.delete(giftId);
  }
  reconnectAttempts.delete(giftId);
}

async function handleRequest(
  gift: GiftRow,
  ws: WebSocket,
  msg: { requestId: string; providerId: string; url: string; method: string; headers: Record<string, string>; body?: string },
): Promise<void> {
  const prev = budgetLocks.get(gift.id) ?? Promise.resolve();
  const lock = prev.then(async () => {
    // Re-fetch gift state for budget check
    let currentGifts: GiftRow[];
    try {
      currentGifts = await getActiveGifts();
    } catch {
      sendError(ws, msg.requestId, 'INTERNAL_ERROR', 'Database error');
      return;
    }

    const current = currentGifts.find((g) => g.id === gift.id);
    if (!current || !current.active || current.expiresAt <= Date.now()) {
      sendError(ws, msg.requestId, 'GIFT_EXPIRED', 'Gift has expired or been revoked');
      return;
    }
    if (current.usedTokens >= current.maxTokens) {
      sendError(ws, msg.requestId, 'GIFT_BUDGET_EXHAUSTED', 'Gift token budget exhausted');
      return;
    }

    if (!validateProxyUrl(current.providerId, msg.url)) {
      sendError(ws, msg.requestId, 'INVALID_URL', 'Request URL does not match provider');
      return;
    }

    let apiKey: string;
    try {
      apiKey = await decryptGiftSecret(current.encryptedApiKey);
    } catch {
      sendError(ws, msg.requestId, 'DECRYPT_FAILED', 'Failed to decrypt credential');
      return;
    }

    const realHeaders = buildHeaders(current.providerId, msg.headers, apiKey, current.authMethod);

    try {
      let body = injectStreamUsageOptions(current.providerId, msg.body);
      if (current.providerId === 'anthropic' && current.authMethod === 'oauth') {
        body = injectClaudeCodeSystemPrompt(body);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(msg.url, {
        method: msg.method,
        headers: realHeaders,
        body,
        signal: controller.signal,
      });

      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { respHeaders[k] = v; });
      for (const h of ['server', 'x-request-id', 'x-cloud-trace-context', 'set-cookie', 'set-cookie2', 'alt-svc', 'via']) {
        delete respHeaders[h];
      }

      wsSend(ws, {
        type: 'relay:response:meta',
        requestId: msg.requestId,
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });

      const chunks: string[] = [];
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          chunks.push(text);
          wsSend(ws, {
            type: 'relay:response:chunk',
            requestId: msg.requestId,
            chunk: text,
          });
        }
      }

      clearTimeout(timeout);

      wsSend(ws, {
        type: 'relay:response:done',
        requestId: msg.requestId,
      });

      // Update budget atomically
      const fullBody = chunks.join('');
      const usage = parseUsage(current.providerId, fullBody);
      if (usage) {
        const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        if (totalTokens > 0) {
          // Try atomic increment (respects maxTokens)
          const updated = await incrementGiftUsage(current.id, totalTokens);
          if (!updated) {
            // Over budget — still record the usage so it's not lost
            await forceUpdateGiftUsage(current.id, totalTokens);
          }
          // Re-read to get the authoritative total
          const refreshed = (await getActiveGifts()).find((g) => g.id === current.id);
          if (refreshed) {
            wsSend(ws, {
              type: 'relay:usage',
              giftId: current.id,
              usedTokens: refreshed.usedTokens,
            });
          }
        }
      }
    } catch {
      sendError(ws, msg.requestId, 'PROXY_ERROR', 'Request failed');
    }
  });

  budgetLocks.set(gift.id, lock.catch(() => {}));
  await lock;
}

function wsSend(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendError(ws: WebSocket, requestId: string, code: string, message: string): void {
  wsSend(ws, {
    type: 'relay:response:error',
    requestId,
    error: { code, message },
  });
}

export async function startGiftRelay(): Promise<void> {
  console.log('[gift-relay] starting...');

  // Idempotent column add so old deployments pick up the marketplace
  // heartbeat feature without a separate drizzle-kit push step.
  try {
    await getDb().execute(
      sql`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS encrypted_marketplace_mgmt_token TEXT`,
    );
  } catch (err) {
    console.error('[gift-relay] schema migration error:', err);
  }

  try {
    await deleteExpiredGifts();
    const activeGifts = await getActiveGifts();
    console.log(`[gift-relay] found ${activeGifts.length} active gift(s)`);
    for (const gift of activeGifts) {
      if (gift.expiresAt > Date.now()) {
        connectGift(gift);
      }
    }
  } catch (err) {
    console.error('[gift-relay] startup error:', err);
  }

  // Periodic cleanup
  cleanupTimer = setInterval(async () => {
    try {
      await deleteExpiredGifts();
      // Disconnect connections for gifts that are no longer active
      const active = await getActiveGifts();
      const activeIds = new Set(active.map((g) => g.id));
      for (const [giftId, ws] of connections) {
        if (!activeIds.has(giftId)) {
          ws.close();
          connections.delete(giftId);
          reconnectAttempts.delete(giftId);
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }, 60 * 60 * 1000); // every hour
  cleanupTimer.unref();

  // Marketplace heartbeat worker: for each active gift with a stored
  // management token, POST /gifts/:id/heartbeat so the marketplace badge
  // reflects "online" even when every user device is backgrounded.
  heartbeatTimer = setInterval(() => {
    runMarketplaceHeartbeat().catch((err) => {
      console.error('[gift-relay] marketplace heartbeat error:', err);
    });
  }, MARKETPLACE_HEARTBEAT_INTERVAL);
  heartbeatTimer.unref();
  // Fire once at startup so gifts flip to online without waiting 4 min.
  runMarketplaceHeartbeat().catch((err) => {
    console.error('[gift-relay] marketplace heartbeat error:', err);
  });
}

async function runMarketplaceHeartbeat(): Promise<void> {
  const active = await getActiveGifts();
  const now = Date.now();
  await Promise.all(active.map(async (gift) => {
    if (gift.expiresAt <= now) return;
    if (!gift.encryptedMarketplaceMgmtToken) return;
    let token: string;
    try {
      token = await decryptGiftSecret(gift.encryptedMarketplaceMgmtToken);
    } catch {
      return;
    }
    try {
      await fetch(`${MARKETPLACE_URL}/gifts/${encodeURIComponent(gift.id)}/heartbeat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Network hiccup — retry on the next tick.
    }
  }));
}

export function stopGiftRelay(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  for (const [id, ws] of connections) {
    ws.close();
    connections.delete(id);
  }
}
