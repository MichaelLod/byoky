/**
 * Public API for the byoky translation layer.
 *
 * Activated when a group routes a request to a provider in a different family
 * than the SDK called. Translates the request body, response body, and SSE
 * event stream so the calling app sees its native dialect throughout.
 *
 * Supported families: anthropic, openai, gemini, cohere. Adding a new family
 * is a single-file drop-in: implement the FamilyAdapter interface (see
 * adapter.ts) and register it below. No pair-specific code.
 */

import type { ProviderId } from '../types.js';
import type { TranslationContext } from './types.js';
import { getAdapter, hasAdapter } from './adapter.js';
import { familyOf } from './families.js';
import type { IRResponseOrError, IRStreamEvent } from './ir.js';
import { isIRError } from './ir.js';
import { registerAdapter } from './adapter.js';
import { anthropicAdapter } from './adapters/anthropic.js';
import { openaiAdapter } from './adapters/openai.js';
import { geminiAdapter } from './adapters/gemini.js';
import { cohereAdapter } from './adapters/cohere.js';

// ─── Adapter registration ─────────────────────────────────────────────────

registerAdapter(anthropicAdapter);
registerAdapter(openaiAdapter);
registerAdapter(geminiAdapter);
registerAdapter(cohereAdapter);

// ─── Top-level dispatch ───────────────────────────────────────────────────

/**
 * Translate a request body from the source family dialect to the destination
 * family dialect. Pure function over bytes in, bytes out.
 *
 * Throws TranslationError if the destination family can't represent some
 * feature of the source request (e.g. n > 1 → anthropic).
 */
export function translateRequest(ctx: TranslationContext, body: string): string {
  const src = getAdapter(ctx.srcFamily);
  const dst = getAdapter(ctx.dstFamily);
  const ir = src.parseRequest(body);
  // Gemini asks for a stream in the URL (:streamGenerateContent), so its
  // body carries no flag; the caller's context does.
  if (ctx.isStreaming) ir.stream = true;
  return dst.serializeRequest(ctx, ir);
}

/**
 * Point a request at the model a group pins within the app's own family
 * (a model override or same-family swap: nothing is translated). Sets
 * `model` and, for the family's chat endpoint, fits the request to that
 * model's rules, the ones translation applies (e.g. no sampling parameters
 * or forced tool choice on Claude Sonnet 5.5, max_completion_tokens on
 * OpenAI reasoning models). Every other field stays as the app sent it.
 *
 * A body that already names the model, or isn't a JSON object, is returned
 * as it was. Throws TranslationError when the model can't serve the
 * request at all.
 *
 * `url` is the URL the app called; `dstProviderId` the provider the request
 * goes to (the same family as the app's).
 */
export function rewriteRequestModel(
  ctx: { dstProviderId: ProviderId; dstModel: string; url: string },
  body: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
  const request = parsed as Record<string, unknown>;
  if (request.model === ctx.dstModel) return body;
  request.model = ctx.dstModel;
  const family = familyOf(ctx.dstProviderId);
  const adapter = family && hasAdapter(family) ? getAdapter(family) : undefined;
  if (adapter?.shapeRequestForModel && adapter.matchesChatEndpoint(ctx.url)) {
    adapter.shapeRequestForModel(request, { dstModel: ctx.dstModel, dstProviderId: ctx.dstProviderId });
  }
  return JSON.stringify(request);
}

/**
 * Fit a request to the rules of the model it already names, where it would
 * certainly be refused otherwise: what rewriteRequestModel does for a
 * pinned model, for a request nothing reroutes. Byoky uses it for requests
 * from local tools (the bridge), whose request shapes the user can't fix,
 * such as OpenClaw sending a thinking budget to a Claude model that only
 * thinks adaptively.
 *
 * Applies only to a family's chat endpoint and to a model whose rules the
 * family knows for certain (today: Claude ids). Anything else, a request
 * that already fits, a body that isn't a JSON object, or one the model
 * can't serve at all (left for the provider to answer) is returned byte
 * for byte.
 *
 * `providerId` is the provider the request goes to, `url` the URL called.
 */
export function fitRequestToModel(ctx: { providerId: ProviderId; url: string }, body: string): string {
  const family = familyOf(ctx.providerId);
  const adapter = family && hasAdapter(family) ? getAdapter(family) : undefined;
  if (!adapter?.shapeRequestForModel || !adapter.recognizesModel || !adapter.matchesChatEndpoint(ctx.url)) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
  const request = parsed as Record<string, unknown>;
  if (typeof request.model !== 'string' || !adapter.recognizesModel(request.model)) return body;
  const before = JSON.stringify(request);
  try {
    adapter.shapeRequestForModel(request, { dstModel: request.model, dstProviderId: ctx.providerId });
  } catch {
    return body;
  }
  const after = JSON.stringify(request);
  return after === before ? body : after;
}

/**
 * Translate a non-streaming response body from the destination family dialect
 * back to the source family dialect. The response arrives in ctx.dstFamily
 * (the upstream we actually called) and must be returned in ctx.srcFamily
 * (what the SDK expects).
 */
export function translateResponse(ctx: TranslationContext, body: string): string {
  const dst = getAdapter(ctx.dstFamily);
  const src = getAdapter(ctx.srcFamily);
  const ir = dst.parseResponse(body);
  return src.serializeResponse(ctx, ir);
}

/**
 * Translate an upstream error body (a non-2xx response) from the destination
 * dialect into the source dialect, so the app's SDK can read it.
 *
 * Returns null when the body isn't an error the destination adapter
 * recognises (not JSON, an HTML page from a proxy or CDN, or a shape that
 * parses as a success); the caller then passes the raw body through rather
 * than failing the request.
 */
export function translateErrorResponse(ctx: TranslationContext, body: string): string | null {
  const dst = getAdapter(ctx.dstFamily);
  const src = getAdapter(ctx.srcFamily);
  let ir: IRResponseOrError;
  try {
    ir = dst.parseResponse(body);
  } catch {
    return null;
  }
  if (!isIRError(ir)) return null;
  return src.serializeResponse(ctx, ir);
}

/**
 * Build a stateful stream translator that consumes raw upstream SSE bytes in
 * the destination dialect and emits raw SSE bytes in the source dialect.
 *
 * Returns the same { process(chunk), flush() } interface used by proxy-utils'
 * createToolNameSSERewriter, for drop-in use in the bridge and extension
 * proxy paths.
 */
export function createStreamTranslator(
  ctx: TranslationContext,
): { process(chunk: string): string; flush(): string } {
  const dst = getAdapter(ctx.dstFamily);
  const src = getAdapter(ctx.srcFamily);
  const parser = dst.createStreamParser();
  const serializer = src.createStreamSerializer(ctx);
  return {
    process(chunk: string): string {
      const events = parser.process(chunk);
      return serializer.process(events);
    },
    flush(): string {
      const trailing: IRStreamEvent[] = parser.flush();
      let out = serializer.process(trailing);
      out += serializer.flush();
      return out;
    },
  };
}

// ─── Re-exports ───────────────────────────────────────────────────────────

export * from './types.js';
export * from './ir.js';
export * from './families.js';
export { getAdapter, hasAdapter, registeredFamilies } from './adapter.js';
export type { FamilyAdapter, IRStreamParser, IRStreamSerializer } from './adapter.js';
