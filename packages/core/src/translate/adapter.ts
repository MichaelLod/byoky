import type { ModelFamily } from '../models.js';
import type { ModelShapingContext, TranslationContext } from './types.js';
import type {
  IRRequest,
  IRResponseOrError,
  IRStreamEvent,
} from './ir.js';

/**
 * A family adapter translates between one API dialect and the canonical IR.
 *
 * Each supported family (anthropic, openai, gemini, cohere) registers exactly
 * one adapter. The top-level dispatch functions in index.ts compose a source
 * adapter's parser with a destination adapter's serializer:
 *
 *   dstFamily.serializeRequest(ctx, srcFamily.parseRequest(body))
 *
 * Round-trip invariant: every adapter must satisfy
 *   serialize(parse(body)) is semantically equivalent to body
 * for its own dialect. Unit tests enforce this per-adapter, and live tests
 * verify cross-family composition against real APIs.
 */
export interface FamilyAdapter {
  readonly family: ModelFamily;

  /**
   * Canonical chat endpoint path fragment for matching (e.g. '/v1/messages').
   * Used only by matchesChatEndpoint; URL construction goes through
   * buildChatUrl because some families (gemini) put the model in the path.
   */
  readonly chatEndpoint: string;

  /** True if the given URL targets this family's chat endpoint. */
  matchesChatEndpoint(url: string): boolean;

  /**
   * Build the full chat URL for a provider base URL, destination model, and
   * streaming flag. Most families ignore model/stream and just append
   * chatEndpoint; gemini uses all three (model in path, generateContent vs
   * streamGenerateContent method switch, ?alt=sse for streaming).
   */
  buildChatUrl(providerBaseUrl: string, model: string, stream: boolean): string;

  // ─── Request ────────────────────────────────────────────────────────────

  /** Parse a family-native request body into canonical IR. */
  parseRequest(body: string): IRRequest;

  /** Serialize canonical IR into a family-native request body. */
  serializeRequest(ctx: TranslationContext, ir: IRRequest): string;

  /**
   * Fit a parsed chat request in this family's own dialect, written for
   * another model of the family, to `ctx.dstModel`: the per-model request
   * rules serializeRequest follows, applied in place, so every field they
   * don't cover stays as the app sent it. Throws TranslationError when the
   * model can't serve the request at all. Absent for families whose models
   * share one request shape.
   */
  shapeRequestForModel?(body: Record<string, unknown>, ctx: ModelShapingContext): void;

  /**
   * For a family that names the model in the URL path rather than the body
   * (Gemini: /v1beta/models/{model}:generateContent), `url` naming `model`
   * instead, or null when `url` names no model this way. Absent for
   * families that name it in the body.
   */
  rewriteUrlModel?(url: string, model: string): string | null;

  /**
   * True when this family knows `model`'s request rules for certain (not
   * by a guess for an id it can't read), so shapeRequestForModel changes
   * only what that model would reject. Absent: never.
   */
  recognizesModel?(model: string): boolean;

  // ─── Response (non-streaming) ───────────────────────────────────────────

  /** Parse a family-native response body (success or error) into IR. */
  parseResponse(body: string): IRResponseOrError;

  /** Serialize IR into a family-native response body. */
  serializeResponse(ctx: TranslationContext, ir: IRResponseOrError): string;

  // ─── Streaming ──────────────────────────────────────────────────────────

  /** Create a stateful parser that consumes raw stream bytes and emits IR events. */
  createStreamParser(): IRStreamParser;

  /** Create a stateful serializer that consumes IR events and emits raw stream bytes. */
  createStreamSerializer(ctx: TranslationContext): IRStreamSerializer;
}

export interface IRStreamParser {
  /** Consume raw input bytes, return any complete events parsed so far. */
  process(chunk: string): IRStreamEvent[];
  /** Called after the source stream ends — emit any trailing events. */
  flush(): IRStreamEvent[];
}

export interface IRStreamSerializer {
  /** Consume IR events and return raw output bytes. */
  process(events: IRStreamEvent[]): string;
  /** Called after the last event — emit any trailing bytes (e.g. [DONE]). */
  flush(): string;
}

// ─── Registry ─────────────────────────────────────────────────────────────

const ADAPTERS = new Map<ModelFamily, FamilyAdapter>();

export function registerAdapter(adapter: FamilyAdapter): void {
  ADAPTERS.set(adapter.family, adapter);
}

export function getAdapter(family: ModelFamily): FamilyAdapter {
  const adapter = ADAPTERS.get(family);
  if (!adapter) {
    throw new Error(`No translation adapter registered for family: ${family}`);
  }
  return adapter;
}

export function hasAdapter(family: ModelFamily): boolean {
  return ADAPTERS.has(family);
}

export function registeredFamilies(): ModelFamily[] {
  return Array.from(ADAPTERS.keys());
}
