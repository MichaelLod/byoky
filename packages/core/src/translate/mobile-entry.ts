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
  version: '0.5.0',
};

(globalThis as Record<string, unknown>).BYOKY_TRANSLATE = bridge;
