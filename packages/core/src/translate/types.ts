import type { ModelFamily } from '../models.js';

/**
 * Per-request translation context.
 *
 * Constructed once at the proxy entry when `shouldTranslate(src, dst)` returns
 * true, and threaded through every step of the request → response → stream
 * pipeline. The state object is per-direction scratch space owned by the
 * translator implementations — callers should treat it as opaque.
 */
export interface TranslationContext {
  /** Family of the provider the SDK targeted. */
  srcFamily: ModelFamily;
  /** Family of the provider we're actually forwarding to. */
  dstFamily: ModelFamily;
  /** Model the SDK requested (echoed back to the app in responses). */
  srcModel?: string;
  /** Model we substitute into the outbound request. */
  dstModel: string;
  /** Whether the SDK asked for a streaming response. */
  isStreaming: boolean;
  /** byoky's per-request id, used to synthesize ids in the destination dialect. */
  requestId: string;
  /** Per-translator scratch space; mutated by createSSETranslator implementations. */
  state: Record<string, unknown>;
}

/**
 * Errors raised inside the translation pipeline. Caught at the proxy boundary
 * and turned into a 502 response in the source dialect with code
 * TRANSLATION_FAILED.
 */
export class TranslationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
  }
}
