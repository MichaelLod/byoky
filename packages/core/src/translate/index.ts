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

import type { TranslationContext } from './types.js';
import { getAdapter } from './adapter.js';
import type { IRStreamEvent } from './ir.js';
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
  return dst.serializeRequest(ctx, ir);
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
