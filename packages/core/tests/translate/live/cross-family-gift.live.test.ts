import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createGiftLink,
  decodeGiftLink,
  validateGiftLink,
  type Gift,
  type GiftedCredential,
} from '../../../src/gift.js';
import { resolveCrossFamilyGiftRoute } from '../../../src/routing.js';
import type { Group } from '../../../src/types.js';
import {
  createStreamTranslator,
  rewriteProxyUrl,
  translateRequest,
  translateResponse,
} from '../../../src/translate/index.js';
import type { TranslationContext } from '../../../src/translate/types.js';
import {
  buildHeaders,
  injectClaudeCodeSystemPrompt,
  rewriteToolNamesForClaudeCode,
} from '../../../src/proxy-utils.js';
import { isBridgeAvailable, runBridgeProxy } from './bridge-client.js';

/**
 * Full-flow live test for cross-family gifting.
 *
 * Walks the entire gifting lifecycle against real provider APIs, end-to-end:
 *
 *  1. Sender creates a Gift bound to their own provider key and turns it into
 *     a shareable GiftLink via createGiftLink.
 *  2. The encoded link is handed to the recipient (simulating an out-of-band
 *     share — QR code, chat message, etc.).
 *  3. Recipient decodes + validates the link and constructs a
 *     GiftedCredential, mirroring the extension's `redeemGift` handler in
 *     background.ts.
 *  4. Recipient creates a Group that pins the gift and binds to a provider
 *     in a different translation family with a destination model — this is
 *     the "cross-family gift" configuration.
 *  5. resolveCrossFamilyGiftRoute picks up the pin and returns the translation
 *     context the recipient's proxy path would use.
 *  6. Recipient pre-translates the request (src→dst) via translateRequest,
 *     rewrites the URL via rewriteProxyUrl, and emits a `relay:request`
 *     through the in-process relay.
 *  7. An in-process relay (mirroring packages/relay/src/server.ts's protocol)
 *     forwards the request to the sender peer.
 *  8. The sender handles `relay:request` by calling the real provider API
 *     with its own key and streaming `relay:response:meta` + chunks + `done`
 *     back over the relay — matching the background.ts `handleGiftProxyRequest`
 *     shape.
 *  9. Recipient collects the response and translates dst→src — single-shot
 *     for non-streaming, via createStreamTranslator for SSE — so the
 *     calling app sees its native dialect throughout.
 * 10. Assertions verify the response is a well-formed src-dialect payload
 *     that parses with the SDK-native shape.
 *
 * Runs once for openai→anthropic and once for anthropic→openai, both in
 * non-streaming and streaming modes. Each combination exercises the entire
 * pipeline: gift creation, link encode/decode, claim, group routing, request
 * translation, relay transport, real API fetch, response translation.
 *
 * Skipped when OPENAI_API_KEY or ANTHROPIC_API_KEY is missing. The test
 * deliberately uses api-key-auth Anthropic tokens only: if ANTHROPIC_API_KEY
 * is an oauth setup token (sk-ant-oat01-…) the anthropic-destination cases
 * are skipped, because oauth routes through the native-messaging bridge
 * which we can't spawn from this test harness.
 */

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_IS_OAUTH = ANTHROPIC_KEY?.startsWith('sk-ant-oat01-') ?? false;

// Cache the bridge availability check across the whole file so we don't
// re-spawn a subprocess per test. Only matters when ANTHROPIC_API_KEY is an
// oauth setup token — for api-key tokens the bridge is unused.
let bridgeUpCache: Promise<boolean> | null = null;
function bridgeAvailable(): Promise<boolean> {
  if (!bridgeUpCache) bridgeUpCache = isBridgeAvailable();
  return bridgeUpCache;
}

/** Skip helper: when we need the bridge for this run but it isn't installed. */
async function skipIfOAuthBridgeMissing(t: { skip(reason?: string): void }): Promise<boolean> {
  if (!ANTHROPIC_IS_OAUTH) return false;
  if (await bridgeAvailable()) return false;
  t.skip('Anthropic oauth setup token requires byoky-bridge on PATH (npm install -g @byoky/bridge)');
  return true;
}

const OPENAI_SRC_MODEL = 'gpt-5.4-nano';
const ANTHROPIC_DST_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_SRC_MODEL = 'claude-haiku-4-5-20251001';
const OPENAI_DST_MODEL = 'gpt-5.4-nano';

// ─── Relay server (in-process, mirrors the production protocol) ──────────

const RELAY_PORT = 19877;
const RELAY_URL = `ws://127.0.0.1:${RELAY_PORT}`;

interface Room {
  sender?: WebSocket;
  recipient?: WebSocket;
  authToken: string;
}

let wss: WebSocketServer;
const rooms = new Map<string, Room>();

function relaySend(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function startRelay(): Promise<void> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: RELAY_PORT, maxPayload: 20 * 1024 * 1024 }, () => resolve());
    wss.on('connection', (ws) => {
      let authedRoomId: string | null = null;
      let authedRole: 'sender' | 'recipient' | null = null;

      ws.on('message', (raw) => {
        let msg: { type: string; roomId?: string; authToken?: string; role?: string; [k: string]: unknown };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (!authedRoomId) {
          if (msg.type !== 'relay:auth') return;
          const { roomId, authToken, role } = msg;
          if (
            typeof roomId !== 'string' ||
            typeof authToken !== 'string' ||
            (role !== 'sender' && role !== 'recipient')
          ) {
            relaySend(ws, { type: 'relay:auth:result', success: false, error: 'invalid auth payload' });
            return;
          }
          let room = rooms.get(roomId);
          if (room) {
            if (room.authToken !== authToken) {
              relaySend(ws, { type: 'relay:auth:result', success: false, error: 'auth token mismatch' });
              return;
            }
            if (room[role] && room[role]!.readyState === WebSocket.OPEN) {
              relaySend(ws, { type: 'relay:auth:result', success: false, error: `${role} already connected` });
              return;
            }
          } else {
            room = { authToken };
            rooms.set(roomId, room);
          }
          room[role] = ws;
          authedRoomId = roomId;
          authedRole = role;
          const peer = role === 'sender' ? room.recipient : room.sender;
          const peerOnline = !!peer && peer.readyState === WebSocket.OPEN;
          relaySend(ws, { type: 'relay:auth:result', success: true, peerOnline });
          if (peerOnline) relaySend(peer!, { type: 'relay:peer:status', online: true });
          return;
        }

        const room = rooms.get(authedRoomId);
        if (!room) return;

        if (authedRole === 'recipient' && msg.type === 'relay:request') {
          if (room.sender?.readyState === WebSocket.OPEN) room.sender.send(String(raw));
          return;
        }
        if (authedRole === 'sender') {
          if (
            msg.type === 'relay:response:meta' ||
            msg.type === 'relay:response:chunk' ||
            msg.type === 'relay:response:done' ||
            msg.type === 'relay:response:error' ||
            msg.type === 'relay:usage'
          ) {
            if (room.recipient?.readyState === WebSocket.OPEN) room.recipient.send(String(raw));
          }
        }
      });

      ws.on('close', () => {
        if (!authedRoomId || !authedRole) return;
        const room = rooms.get(authedRoomId);
        if (!room) return;
        room[authedRole] = undefined;
        if (!room.sender && !room.recipient) rooms.delete(authedRoomId);
      });
    });
  });
}

function stopRelay(): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => resolve());
  });
}

// ─── Sender (fake wallet peer that holds the real provider key) ─────────

interface SenderHandle {
  ws: WebSocket;
  close(): void;
  authed: Promise<void>;
}

/**
 * Connect a sender peer to the relay and teach it to answer relay:request
 * messages by calling the real provider API with its own key. Mirrors the
 * shape of background.ts handleGiftProxyRequest for api-key credentials
 * (non-streaming and streaming both route through the same fetch + ReadableStream path).
 */
async function connectSender(
  gift: { id: string; authToken: string; relayUrl: string; providerId: string },
  apiKey: string,
): Promise<SenderHandle> {
  const ws = new WebSocket(gift.relayUrl);
  let authResolved = false;
  const authed = new Promise<void>((resolve, reject) => {
    ws.once('error', (err) => {
      if (!authResolved) reject(err);
    });
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'relay:auth',
          roomId: gift.id,
          authToken: gift.authToken,
          role: 'sender',
          priority: 1,
        }),
      );
    });
    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'relay:auth:result') {
        if (msg.success) {
          authResolved = true;
          resolve();
        } else {
          reject(new Error(`auth failed: ${msg.error as string}`));
        }
        return;
      }
      if (msg.type === 'relay:request') {
        await handleRelayRequest(ws, msg as never, gift.providerId, apiKey);
      }
    });
  });
  return {
    ws,
    authed,
    close: () => ws.close(),
  };
}

async function handleRelayRequest(
  ws: WebSocket,
  req: { requestId: string; url: string; method: string; headers: Record<string, string>; body?: string },
  providerId: string,
  apiKey: string,
): Promise<void> {
  try {
    // OAuth path: Anthropic setup tokens can't use x-api-key — route through
    // the byoky-bridge subprocess, just like background.ts does in
    // handleGiftProxyRequest for authMethod === 'oauth'. Requires the
    // Claude Code system prompt injection + tool-name rewrite.
    const isOAuthAnthropic = providerId === 'anthropic' && apiKey.startsWith('sk-ant-oat01-');
    if (isOAuthAnthropic) {
      const oauthHeaders = buildHeaders(
        'anthropic',
        { 'content-type': 'application/json' },
        apiKey,
        'oauth',
      );
      const withSystem = injectClaudeCodeSystemPrompt(req.body, { relocateExisting: true });
      const { body: rewrittenBody, toolNameMap } = rewriteToolNamesForClaudeCode(withSystem);
      // The bridge's child-process fetch() can transient-fail against the
      // upstream API (connection reset, DNS blip). These are generic
      // 'Fetch request failed' errors with no distinguishing signal.
      // Retry once after a short delay before surfacing the error to the
      // recipient — mirrors the resilience a real sender wallet would
      // want. Two attempts is enough to eliminate the flake without
      // masking real failures.
      let attempt = 0;
      let bridgeResult: Awaited<ReturnType<typeof runBridgeProxy>> | undefined;
      let bridgeErr: Error | undefined;
      while (attempt < 2 && !bridgeResult) {
        attempt += 1;
        try {
          bridgeResult = await runBridgeProxy({
            url: req.url,
            method: req.method,
            headers: oauthHeaders,
            body: rewrittenBody,
            toolNameMap,
          });
        } catch (e) {
          bridgeErr = e as Error;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!bridgeResult) throw bridgeErr ?? new Error('bridge proxy failed');
      const { status, headers: respHeaders, body } = bridgeResult;
      ws.send(
        JSON.stringify({
          type: 'relay:response:meta',
          requestId: req.requestId,
          status,
          statusText: status === 200 ? 'OK' : 'Error',
          headers: respHeaders,
        }),
      );
      // Bridge buffers the entire response — emit it as a single chunk so
      // the recipient sees the same sequence it would from a direct fetch.
      ws.send(
        JSON.stringify({
          type: 'relay:response:chunk',
          requestId: req.requestId,
          chunk: body,
        }),
      );
      ws.send(JSON.stringify({ type: 'relay:response:done', requestId: req.requestId }));
      return;
    }

    const headers: Record<string, string> = { ...(req.headers ?? {}), 'content-type': 'application/json' };
    if (providerId === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (providerId === 'openai') {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.body,
    });

    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    ws.send(
      JSON.stringify({
        type: 'relay:response:meta',
        requestId: req.requestId,
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      }),
    );

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        ws.send(
          JSON.stringify({
            type: 'relay:response:chunk',
            requestId: req.requestId,
            chunk: text,
          }),
        );
      }
    }

    ws.send(JSON.stringify({ type: 'relay:response:done', requestId: req.requestId }));
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: 'relay:response:error',
        requestId: req.requestId,
        error: { code: 'PROXY_ERROR', message: err instanceof Error ? err.message : 'proxy failed' },
      }),
    );
  }
}

// ─── Recipient (mirrors proxyViaGiftRelay + translation wrapping) ───────

interface RecipientResult {
  status: number;
  translatedBody: string;
}

/**
 * Drive a single cross-family gift request from the recipient side.
 * Mirrors the production flow in background.ts:
 *  - Pre-translate request body src→dst via translateRequest.
 *  - Pre-rewrite URL to the destination provider's chat endpoint.
 *  - Auth with relay as recipient, send relay:request.
 *  - Collect relay:response:meta/chunk/done.
 *  - For streaming responses, route chunks through createStreamTranslator
 *    (dst→src). For non-streaming, buffer and call translateResponse once
 *    after done.
 */
async function runRecipientRequest(
  gc: GiftedCredential,
  translation: { srcProviderId: string; dstProviderId: string; dstModel: string },
  srcRequestBody: string,
  isStreaming: boolean,
): Promise<RecipientResult> {
  const ctx: TranslationContext = {
    srcFamily: translation.srcProviderId as never,
    dstFamily: translation.dstProviderId as never,
    srcModel: JSON.parse(srcRequestBody).model,
    dstModel: translation.dstModel,
    isStreaming,
    requestId: 'live-xfam-gift',
  };

  const translatedBody = translateRequest(ctx, srcRequestBody);
  const translatedUrl = rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming);
  if (!translatedUrl) throw new Error('rewriteProxyUrl returned null');

  const ws = new WebSocket(gc.relayUrl);
  const rawChunks: string[] = [];
  const srcStreamOut: string[] = [];
  const streamTranslator = isStreaming ? createStreamTranslator(ctx) : undefined;
  let status = 0;

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('recipient request timed out')), 60_000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'relay:auth',
          roomId: gc.giftId,
          authToken: gc.authToken,
          role: 'recipient',
        }),
      );
    });

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'relay:auth:result') {
        if (!msg.success) {
          clearTimeout(timer);
          reject(new Error(`recipient auth failed: ${msg.error as string}`));
          return;
        }
        // Either sender is already online (peerOnline) or we wait briefly.
        if (msg.peerOnline) sendRequest();
      }

      if (msg.type === 'relay:peer:status' && msg.online) sendRequest();

      if (msg.type === 'relay:response:meta') {
        status = msg.status as number;
      }

      if (msg.type === 'relay:response:chunk') {
        const chunk = msg.chunk as string;
        rawChunks.push(chunk);
        if (streamTranslator) {
          srcStreamOut.push(streamTranslator.process(chunk));
        }
      }

      if (msg.type === 'relay:response:done') {
        if (streamTranslator) {
          srcStreamOut.push(streamTranslator.flush());
        }
        clearTimeout(timer);
        ws.close();
        resolve();
      }

      if (msg.type === 'relay:response:error') {
        clearTimeout(timer);
        ws.close();
        const err = msg.error as { message?: string } | undefined;
        reject(new Error(`relay error: ${err?.message ?? 'unknown'}`));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    let requestSent = false;
    function sendRequest() {
      if (requestSent) return;
      requestSent = true;
      ws.send(
        JSON.stringify({
          type: 'relay:request',
          requestId: 'live-xfam-gift',
          providerId: translation.dstProviderId,
          url: translatedUrl,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: translatedBody,
        }),
      );
    }
  });

  await done;

  const translatedResponse = streamTranslator
    ? srcStreamOut.join('')
    : translateResponse(ctx, rawChunks.join(''));

  return { status, translatedBody: translatedResponse };
}

// ─── Gift fabrication helper ─────────────────────────────────────────────

function fabricateGift(providerId: string): {
  gift: Gift;
  encoded: string;
} {
  const gift: Gift = {
    id: `gift_live_${providerId}_${Math.random().toString(36).slice(2, 10)}`,
    credentialId: 'cred_local',
    providerId,
    label: 'live test gift',
    authToken: `tok_live_${Math.random().toString(36).slice(2, 14)}`,
    maxTokens: 10_000,
    usedTokens: 0,
    expiresAt: Date.now() + 60 * 60 * 1000,
    createdAt: Date.now(),
    active: true,
    relayUrl: RELAY_URL,
  };
  const { encoded } = createGiftLink(gift);
  return { gift, encoded };
}

/**
 * Recipient-side claim: mirrors the extension's `redeemGift` handler shape.
 * Given a raw encoded link (what the sender shared), returns a GiftedCredential
 * identical to the one background.ts would persist under giftedCredentials.
 */
function recipientClaimsGift(encoded: string): GiftedCredential {
  const link = decodeGiftLink(encoded);
  if (!link) throw new Error('decodeGiftLink failed — invalid link');
  const check = validateGiftLink(link);
  if (!check.valid) throw new Error(`validateGiftLink failed: ${check.reason}`);
  return {
    id: `rc_${Math.random().toString(36).slice(2, 10)}`,
    giftId: link.id,
    providerId: link.p,
    providerName: link.n,
    senderLabel: link.s,
    authToken: link.t,
    maxTokens: link.m,
    usedTokens: 0,
    expiresAt: link.e,
    relayUrl: link.r,
    createdAt: Date.now(),
  };
}

function groupWithGiftPin(
  providerId: string,
  model: string,
  giftId: string,
): Group {
  return {
    id: 'g_live_xfam',
    name: 'Live cross-family via gift',
    providerId,
    giftId,
    model,
    createdAt: Date.now(),
  };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await startRelay();
});

afterAll(async () => {
  await stopRelay();
});

// ─── Tests ───────────────────────────────────────────────────────────────

describe.skipIf(!OPENAI_KEY || !ANTHROPIC_KEY)(
  'live cross-family gift — openai → anthropic (gift holds an anthropic key)',
  () => {
    it(
      'runs the full claim → group → route → translate → relay → fetch → translate back round-trip (non-streaming)',
      async (t) => {
        if (await skipIfOAuthBridgeMissing(t)) return;
        // 1. Sender fabricates a gift bound to their anthropic key.
        const { gift, encoded } = fabricateGift('anthropic');

        // 2. Sender peer comes online — holds the real anthropic key.
        const sender = await connectSender(gift, ANTHROPIC_KEY!);
        try {
          await sender.authed;

          // 3. Recipient claims the gift exactly as background.ts redeemGift
          //    would: decode, validate, construct GiftedCredential.
          const gc = recipientClaimsGift(encoded);
          expect(gc.giftId).toBe(gift.id);
          expect(gc.providerId).toBe('anthropic');
          expect(gc.authToken).toBe(gift.authToken);
          expect(gc.relayUrl).toBe(RELAY_URL);

          // 4. Recipient creates a group that pins the gift cross-family.
          //    The app calls openai; the group routes through the gift's
          //    anthropic provider with an anthropic destination model.
          const group = groupWithGiftPin('anthropic', ANTHROPIC_DST_MODEL, gc.giftId);

          // 5. Cross-family gift route resolver picks up the pin.
          const route = resolveCrossFamilyGiftRoute(group, 'openai', [gc]);
          expect(route).toBeDefined();
          expect(route!.gc.id).toBe(gc.id);
          expect(route!.translation).toEqual({
            srcProviderId: 'openai',
            dstProviderId: 'anthropic',
            dstModel: ANTHROPIC_DST_MODEL,
          });

          // 6-10. Recipient drives the request through the relay, the fake
          //    sender fetches Anthropic, recipient translates back to OpenAI.
          const srcRequest = JSON.stringify({
            model: OPENAI_SRC_MODEL,
            messages: [{ role: 'user', content: 'Reply with exactly the word "ok" and nothing else.' }],
            max_tokens: 10,
          });
          const { status, translatedBody } = await runRecipientRequest(
            gc,
            route!.translation,
            srcRequest,
            false,
          );
          expect(status).toBe(200);

          const parsed = JSON.parse(translatedBody) as {
            object: string;
            model: string;
            choices: Array<{
              message: { role: string; content: string | null };
              finish_reason: string;
            }>;
            usage: { prompt_tokens: number; completion_tokens: number };
          };

          // Recipient sees native OpenAI shape (src dialect) even though the
          // bytes on the wire were Anthropic (dst dialect).
          expect(parsed.object).toBe('chat.completion');
          expect(parsed.model).toBe(OPENAI_SRC_MODEL);
          expect(parsed.choices).toHaveLength(1);
          expect(parsed.choices[0].message.role).toBe('assistant');
          expect((parsed.choices[0].message.content ?? '').length).toBeGreaterThan(0);
          expect(['stop', 'length', 'tool_calls']).toContain(parsed.choices[0].finish_reason);
          expect(parsed.usage.prompt_tokens).toBeGreaterThan(0);
          expect(parsed.usage.completion_tokens).toBeGreaterThan(0);
        } finally {
          sender.close();
        }
      },
      60_000,
    );

    it(
      'runs the full round-trip with a streaming SSE response',
      async (t) => {
        // The bridge's node-ipc frame protocol buffers the whole response
        // and emits it as a single chunk — oauth anthropic sends can't
        // exercise the SSE-chunked path from this test harness. Skip for
        // oauth tokens; api-key tokens run the real streaming fetch.
        if (ANTHROPIC_IS_OAUTH) {
          t.skip('Streaming through the bridge is not supported from the live test harness');
          return;
        }
        const { gift, encoded } = fabricateGift('anthropic');
        const sender = await connectSender(gift, ANTHROPIC_KEY!);
        try {
          await sender.authed;

          const gc = recipientClaimsGift(encoded);
          const group = groupWithGiftPin('anthropic', ANTHROPIC_DST_MODEL, gc.giftId);
          const route = resolveCrossFamilyGiftRoute(group, 'openai', [gc]);
          expect(route).toBeDefined();

          const srcRequest = JSON.stringify({
            model: OPENAI_SRC_MODEL,
            messages: [{ role: 'user', content: 'Count to three. One word per response.' }],
            max_tokens: 30,
            stream: true,
          });

          const { status, translatedBody } = await runRecipientRequest(
            gc,
            route!.translation,
            srcRequest,
            true,
          );
          expect(status).toBe(200);

          // The translated SSE output must be parseable as OpenAI stream frames.
          const dataLines = translatedBody.split('\n').filter((l) => l.startsWith('data: '));
          expect(dataLines.length).toBeGreaterThan(2);
          const frames = dataLines
            .map((l) => l.slice(6))
            .filter((p) => p !== '[DONE]')
            .map((p) => JSON.parse(p) as Record<string, unknown>);
          expect(frames[0].object).toBe('chat.completion.chunk');
          expect(frames[0].model).toBe(OPENAI_SRC_MODEL);

          const text = frames
            .map((f) => {
              const choices = f.choices as Array<{ delta?: { content?: string } }> | undefined;
              return choices?.[0]?.delta?.content;
            })
            .filter((t): t is string => typeof t === 'string')
            .join('');
          expect(text.length).toBeGreaterThan(0);

          expect(dataLines[dataLines.length - 1]).toBe('data: [DONE]');
        } finally {
          sender.close();
        }
      },
      60_000,
    );
  },
);

describe.skipIf(!OPENAI_KEY || !ANTHROPIC_KEY)(
  'live cross-family gift — anthropic → openai (gift holds an openai key)',
  () => {
    it(
      'runs the full claim → group → route → translate → relay → fetch → translate back round-trip (non-streaming)',
      async () => {
        const { gift, encoded } = fabricateGift('openai');
        const sender = await connectSender(gift, OPENAI_KEY!);
        try {
          await sender.authed;

          const gc = recipientClaimsGift(encoded);
          expect(gc.providerId).toBe('openai');

          const group = groupWithGiftPin('openai', OPENAI_DST_MODEL, gc.giftId);
          const route = resolveCrossFamilyGiftRoute(group, 'anthropic', [gc]);
          expect(route).toBeDefined();
          expect(route!.translation).toEqual({
            srcProviderId: 'anthropic',
            dstProviderId: 'openai',
            dstModel: OPENAI_DST_MODEL,
          });

          const srcRequest = JSON.stringify({
            model: ANTHROPIC_SRC_MODEL,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Reply with exactly the word "ok" and nothing else.' }],
          });

          const { status, translatedBody } = await runRecipientRequest(
            gc,
            route!.translation,
            srcRequest,
            false,
          );
          expect(status).toBe(200);

          const parsed = JSON.parse(translatedBody) as {
            type: string;
            role: string;
            model: string;
            content: Array<{ type: string; text?: string }>;
            stop_reason: string;
            usage: { input_tokens: number; output_tokens: number };
          };

          // Recipient sees native Anthropic shape despite upstream being OpenAI.
          expect(parsed.type).toBe('message');
          expect(parsed.role).toBe('assistant');
          expect(parsed.model).toBe(ANTHROPIC_SRC_MODEL);
          const textBlock = parsed.content.find((b) => b.type === 'text');
          expect(textBlock).toBeDefined();
          expect((textBlock!.text ?? '').length).toBeGreaterThan(0);
          expect(['end_turn', 'max_tokens', 'tool_use']).toContain(parsed.stop_reason);
          expect(parsed.usage.input_tokens).toBeGreaterThan(0);
          expect(parsed.usage.output_tokens).toBeGreaterThan(0);
        } finally {
          sender.close();
        }
      },
      60_000,
    );

    it(
      'runs the full round-trip with a streaming SSE response',
      async () => {
        const { gift, encoded } = fabricateGift('openai');
        const sender = await connectSender(gift, OPENAI_KEY!);
        try {
          await sender.authed;

          const gc = recipientClaimsGift(encoded);
          const group = groupWithGiftPin('openai', OPENAI_DST_MODEL, gc.giftId);
          const route = resolveCrossFamilyGiftRoute(group, 'anthropic', [gc]);
          expect(route).toBeDefined();

          const srcRequest = JSON.stringify({
            model: ANTHROPIC_SRC_MODEL,
            max_tokens: 30,
            messages: [{ role: 'user', content: 'Count to three. One word per token.' }],
            stream: true,
          });

          const { status, translatedBody } = await runRecipientRequest(
            gc,
            route!.translation,
            srcRequest,
            true,
          );
          expect(status).toBe(200);

          // Parse Anthropic-style SSE frames emitted by the stream translator.
          const frames = translatedBody.split('\n\n').filter((f) => f.length > 0);
          interface Event {
            event: string;
            data: Record<string, unknown>;
          }
          const events: Event[] = [];
          for (const frame of frames) {
            let eventType: string | null = null;
            let dataLine: string | null = null;
            for (const line of frame.split('\n')) {
              if (line.startsWith('event: ')) eventType = line.slice(7);
              else if (line.startsWith('data: ')) dataLine = line.slice(6);
            }
            if (eventType && dataLine) {
              events.push({ event: eventType, data: JSON.parse(dataLine) as Record<string, unknown> });
            }
          }
          expect(events.length).toBeGreaterThan(3);
          expect(events[0].event).toBe('message_start');
          expect(events[events.length - 1].event).toBe('message_stop');

          const textDeltas = events
            .filter((e) => e.event === 'content_block_delta')
            .map((e) => {
              const d = (e.data as { delta?: { type?: string; text?: string } }).delta;
              return d?.type === 'text_delta' ? d.text : undefined;
            })
            .filter((t): t is string => typeof t === 'string' && t.length > 0);
          expect(textDeltas.length).toBeGreaterThan(0);
        } finally {
          sender.close();
        }
      },
      60_000,
    );
  },
);

// When both keys are missing we can still at least smoke-test the gift
// lifecycle — claim, route resolution, relay handshake — without ever
// touching a real provider. This makes the test file produce useful
// coverage even on CI runners with no API keys configured.
describe('cross-family gift lifecycle (no real API call)', () => {
  it('sender creates a gift, recipient decodes it, and resolveCrossFamilyGiftRoute picks it up', () => {
    const { gift, encoded } = fabricateGift('anthropic');
    expect(encoded.length).toBeGreaterThan(0);

    const gc = recipientClaimsGift(encoded);
    expect(gc.giftId).toBe(gift.id);
    expect(gc.providerId).toBe('anthropic');

    const group = groupWithGiftPin('anthropic', ANTHROPIC_DST_MODEL, gc.giftId);
    const route = resolveCrossFamilyGiftRoute(group, 'openai', [gc]);
    expect(route).toBeDefined();
    expect(route!.gc.id).toBe(gc.id);
    expect(route!.translation.dstModel).toBe(ANTHROPIC_DST_MODEL);
  });

  it('refuses to route when the recipient has not claimed the pinned gift', () => {
    const { gift } = fabricateGift('anthropic');
    // Recipient wallet has no gifted credentials for this pin.
    const group = groupWithGiftPin('anthropic', ANTHROPIC_DST_MODEL, gift.id);
    const route = resolveCrossFamilyGiftRoute(group, 'openai', []);
    expect(route).toBeUndefined();
  });

  it('routes via relay handshake with no real provider fetch', async () => {
    const { gift, encoded } = fabricateGift('anthropic');

    // Stub sender: auth then reply with a fake relay:response:meta + chunk +
    // done so we exercise the recipient's relay-loop without hitting the
    // internet. Uses Anthropic-shaped bytes because dst is anthropic.
    const fakeAnthropicBody = JSON.stringify({
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: ANTHROPIC_DST_MODEL,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1 },
    });

    const fakeSender = new WebSocket(RELAY_URL);
    await new Promise<void>((resolve, reject) => {
      fakeSender.on('open', () => {
        fakeSender.send(
          JSON.stringify({
            type: 'relay:auth',
            roomId: gift.id,
            authToken: gift.authToken,
            role: 'sender',
            priority: 1,
          }),
        );
      });
      fakeSender.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'relay:auth:result' && msg.success) resolve();
        if (msg.type === 'relay:auth:result' && !msg.success) reject(new Error(msg.error));
        if (msg.type === 'relay:request') {
          fakeSender.send(
            JSON.stringify({
              type: 'relay:response:meta',
              requestId: msg.requestId,
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'application/json' },
            }),
          );
          fakeSender.send(
            JSON.stringify({
              type: 'relay:response:chunk',
              requestId: msg.requestId,
              chunk: fakeAnthropicBody,
            }),
          );
          fakeSender.send(
            JSON.stringify({ type: 'relay:response:done', requestId: msg.requestId }),
          );
        }
      });
      fakeSender.on('error', reject);
    });

    try {
      const gc = recipientClaimsGift(encoded);
      const group = groupWithGiftPin('anthropic', ANTHROPIC_DST_MODEL, gc.giftId);
      const route = resolveCrossFamilyGiftRoute(group, 'openai', [gc]);
      expect(route).toBeDefined();

      const srcRequest = JSON.stringify({
        model: OPENAI_SRC_MODEL,
        messages: [{ role: 'user', content: 'Reply with exactly the word "ok" and nothing else.' }],
        max_tokens: 10,
      });

      const { status, translatedBody } = await runRecipientRequest(
        gc,
        route!.translation,
        srcRequest,
        false,
      );
      expect(status).toBe(200);

      const parsed = JSON.parse(translatedBody) as {
        object: string;
        model: string;
        choices: Array<{ message: { content: string | null }; finish_reason: string }>;
      };
      expect(parsed.object).toBe('chat.completion');
      expect(parsed.model).toBe(OPENAI_SRC_MODEL);
      expect(parsed.choices[0].message.content).toContain('ok');
    } finally {
      fakeSender.close();
    }
  }, 10_000);
});
