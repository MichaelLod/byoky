/**
 * Mobile bundle entry point.
 *
 * This file is the entry for the IIFE bundle shipped to iOS / Android. It
 * wraps the translate layer's pure functions in a string-in / string-out
 * interface and assigns it to globalThis.BYOKY_TRANSLATE so the host JS
 * engine (JavaScriptCore on iOS, Hermes on Android) can call them across the
 * native bridge.
 *
 * The wrapper:
 *   - takes JSON-encoded TranslationContext + body strings (no native object
 *     marshaling — just strings, which both bridges handle trivially);
 *   - holds a small handle table for the stateful stream translator, since
 *     native code can't keep references to JS objects across bridge calls;
 *   - surfaces JS errors as thrown exceptions which both engines convert to
 *     native errors (NSError on iOS, RuntimeException on Android).
 *
 * Anything beyond translation stays native: HTTP, credentials, UI, vault.
 */

import {
  translateRequest as _translateRequest,
  translateResponse as _translateResponse,
  createStreamTranslator as _createStreamTranslator,
} from './index.js';
import {
  familyOf,
  shouldTranslate as _shouldTranslate,
  sameFamily as _sameFamily,
  rewriteProxyUrl as _rewriteProxyUrl,
} from './families.js';
import { modelsForProvider, getModel } from '../models.js';
import type { TranslationContext } from './types.js';

interface StreamHandle {
  process(chunk: string): string;
  flush(): string;
}

const streams = new Map<number, StreamHandle>();
let nextHandle = 1;

interface MobileBridge {
  /** Translate a request body. Throws on unrepresentable features. */
  translateRequest(ctxJson: string, body: string): string;
  /** Translate a non-streaming response body. */
  translateResponse(ctxJson: string, body: string): string;
  /** Open a stateful stream translator. Returns an integer handle. */
  createStreamTranslator(ctxJson: string): number;
  /** Process one upstream SSE chunk through a stream translator handle. */
  processStreamChunk(handle: number, chunk: string): string;
  /** Flush remaining buffered output and release the handle. */
  flushStreamTranslator(handle: number): string;
  /** Release a handle without flushing (e.g. on cancellation or error). */
  releaseStreamTranslator(handle: number): void;

  // ── Routing helpers exposed for native ProxyService routing decisions ──
  // These avoid duplicating the family→providers mapping in Swift + Kotlin.
  // The mapping changes when a new family is added, and we want one place
  // to update it (here in core), not three.

  /**
   * True iff a request from `srcProviderId` should be translated to
   * `dstProviderId`. False for same-family pairs and unknown providers.
   */
  shouldTranslate(srcProviderId: string, dstProviderId: string): boolean;

  /**
   * True iff both providers belong to the same known family — i.e. a
   * same-family swap is possible. Used by the routing resolver to decide
   * between the translation path and the (simpler) swap path.
   */
  sameFamily(srcProviderId: string, dstProviderId: string): boolean;

  /**
   * Build a JSON-encoded TranslationContext for use with translateRequest /
   * translateResponse / createStreamTranslator. Throws if either provider is
   * outside a known family — caller is expected to gate on shouldTranslate
   * first. This keeps the native side from having to know the context shape.
   *
   * `isStreaming` controls how the response/stream paths synthesize ids.
   * `requestId` is byoky's per-request id used by adapters that need to
   * generate destination-dialect ids (e.g. anthropic message ids).
   */
  buildTranslationContext(
    srcProviderId: string,
    dstProviderId: string,
    srcModel: string,
    dstModel: string,
    isStreaming: boolean,
    requestId: string,
  ): string;

  /**
   * Rewrite the upstream URL when routing cross-family. The SDK built the
   * source URL against the source provider's base + path; we replace it with
   * the destination provider's canonical chat endpoint, which may have a
   * different shape (e.g. gemini puts the model in the path).
   *
   * Returns the new URL string, or null when the destination provider isn't
   * registered or has no adapter.
   */
  rewriteProxyUrl(dstProviderId: string, model: string, stream: boolean): string | null;

  /**
   * Return JSON-encoded model entries for a provider, or "[]" if the
   * registry has no entries for it. Used by the routing editor to suggest
   * destination models. Each entry: `{id, displayName, contextWindow,
   * maxOutput, capabilities}`.
   */
  getModelsForProvider(providerId: string): string;

  /**
   * Return a JSON-encoded summary for a single model id, or null if the
   * model isn't in the registry. Used by the routing editor to show a
   * capability footer beneath the destination model field.
   */
  describeModel(modelId: string): string | null;

  /** Bundle version, for native side to assert against expected core version. */
  readonly version: string;
}

const bridge: MobileBridge = {
  translateRequest(ctxJson, body) {
    const ctx = JSON.parse(ctxJson) as TranslationContext;
    return _translateRequest(ctx, body);
  },
  translateResponse(ctxJson, body) {
    const ctx = JSON.parse(ctxJson) as TranslationContext;
    return _translateResponse(ctx, body);
  },
  createStreamTranslator(ctxJson) {
    const ctx = JSON.parse(ctxJson) as TranslationContext;
    const handle = nextHandle++;
    streams.set(handle, _createStreamTranslator(ctx));
    return handle;
  },
  processStreamChunk(handle, chunk) {
    const s = streams.get(handle);
    if (!s) throw new Error(`byoky: unknown stream handle ${handle}`);
    return s.process(chunk);
  },
  flushStreamTranslator(handle) {
    const s = streams.get(handle);
    if (!s) throw new Error(`byoky: unknown stream handle ${handle}`);
    const out = s.flush();
    streams.delete(handle);
    return out;
  },
  releaseStreamTranslator(handle) {
    streams.delete(handle);
  },
  shouldTranslate(srcProviderId, dstProviderId) {
    return _shouldTranslate(srcProviderId, dstProviderId);
  },
  sameFamily(srcProviderId, dstProviderId) {
    return _sameFamily(srcProviderId, dstProviderId);
  },
  buildTranslationContext(srcProviderId, dstProviderId, srcModel, dstModel, isStreaming, requestId) {
    const srcFamily = familyOf(srcProviderId);
    const dstFamily = familyOf(dstProviderId);
    if (!srcFamily) throw new Error(`byoky: unknown source family for provider "${srcProviderId}"`);
    if (!dstFamily) throw new Error(`byoky: unknown destination family for provider "${dstProviderId}"`);
    const ctx: TranslationContext = {
      srcFamily,
      dstFamily,
      srcModel,
      dstModel,
      isStreaming,
      requestId,
    };
    return JSON.stringify(ctx);
  },
  rewriteProxyUrl(dstProviderId, model, stream) {
    return _rewriteProxyUrl(dstProviderId, model, stream);
  },
  getModelsForProvider(providerId) {
    const list = modelsForProvider(providerId).map((m) => ({
      id: m.id,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      maxOutput: m.maxOutput,
      capabilities: m.capabilities,
    }));
    return JSON.stringify(list);
  },
  describeModel(modelId) {
    const m = getModel(modelId);
    if (!m) return null;
    return JSON.stringify({
      id: m.id,
      providerId: m.providerId,
      family: m.family,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      maxOutput: m.maxOutput,
      capabilities: m.capabilities,
    });
  },
  version: '0.5.1',
};

(globalThis as Record<string, unknown>).BYOKY_TRANSLATE = bridge;
