/**
 * Canonical intermediate representation (IR) for chat requests, responses,
 * and stream events.
 *
 * The translation layer normalizes every family (anthropic, openai, gemini,
 * cohere) through this IR. Each family has one adapter that parses its own
 * dialect into IR and serializes IR back into its own dialect. Cross-family
 * translation composes one adapter's parser with another adapter's
 * serializer — never pair-specific code.
 *
 * Design principles:
 *  - The IR keeps the richest representation each family needs (e.g.
 *    structured tool_result content, thinking blocks). Flattening happens
 *    only at serialize time, when the destination can't represent the
 *    structure.
 *  - Unrepresentable features (e.g. n > 1 → anthropic) are detected at
 *    serialize time and raise TranslationError('UNSUPPORTED_FEATURE', ...).
 *  - Every adapter must satisfy round-trip: serialize(parse(body)) produces
 *    a body semantically equivalent to the input. Unit tests enforce this
 *    per-adapter.
 */

// ─── Request IR ──────────────────────────────────────────────────────────

export interface IRRequest {
  /** Model the source request asked for. Echoed back in responses; the actual
   *  destination model lives on TranslationContext.dstModel. */
  model?: string;

  /** System-level instructions. Multiple parts get joined at serialize time
   *  for families that only accept a single string. */
  system: IRTextPart[];

  messages: IRMessage[];

  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  stream?: boolean;
  /** Opaque end-user id for provider analytics. */
  userId?: string;
  /** Number of completions to generate. Serializers refuse n > 1 when the
   *  target family can't represent it (e.g. anthropic). */
  n?: number;

  tools?: IRTool[];
  toolChoice?: IRToolChoice;
  responseFormat?: IRResponseFormat;
  thinking?: IRThinkingConfig;
}

export interface IRTextPart {
  text: string;
}

export interface IRMessage {
  role: 'user' | 'assistant';
  content: IRContentBlock[];
}

export type IRContentBlock =
  | IRTextBlock
  | IRImageBlock
  | IRToolUseBlock
  | IRToolResultBlock
  | IRThinkingBlock;

export interface IRTextBlock {
  type: 'text';
  text: string;
}

export interface IRImageBlock {
  type: 'image';
  source: IRImageSource;
}

export type IRImageSource =
  | { kind: 'base64'; mediaType: string; data: string }
  | { kind: 'url'; url: string };

export interface IRToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface IRToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: IRToolResultContent;
  isError?: boolean;
}

/**
 * Tool result content is structured because anthropic supports rich content
 * (text + images) inside tool results. Flat families (openai, cohere, gemini)
 * flatten to a string at serialize time.
 */
export type IRToolResultContent =
  | { kind: 'text'; text: string }
  | { kind: 'blocks'; blocks: IRContentBlock[] };

export interface IRThinkingBlock {
  type: 'thinking';
  text: string;
  /** Anthropic extended-thinking signature (opaque encrypted summary). */
  signature?: string;
  /** When true, this block represents cohere's tool_plan (pre-tool reasoning)
   *  rather than general extended thinking. */
  toolPlanning?: boolean;
}

export interface IRTool {
  name: string;
  description?: string;
  /** JSON Schema describing the tool inputs. OpenAPI 3.0 subset preferred
   *  for cross-family compatibility. */
  parameters: unknown;
}

export type IRToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

export type IRResponseFormat =
  | { type: 'json' }
  | { type: 'json_schema'; schema: unknown };

export interface IRThinkingConfig {
  enabled: true;
  /** Budget for thinking tokens. Anthropic and gemini honor this; other
   *  families ignore it. */
  budgetTokens?: number;
}

// ─── Response IR (non-streaming) ──────────────────────────────────────────

export interface IRResponse {
  id?: string;
  model?: string;
  /** Response-side content blocks: only text, tool_use, and thinking are
   *  valid here (never user-side blocks like image or tool_result). */
  content: IRResponseBlock[];
  stopReason: IRStopReason;
  stopSequence?: string | null;
  usage: IRUsage;
}

export type IRResponseBlock = IRTextBlock | IRToolUseBlock | IRThinkingBlock;

export type IRStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'refusal'
  | 'error'
  | 'other';

export interface IRUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface IRError {
  type: string;
  message: string;
  code?: string;
}

/** Parsed response is either a success envelope or an error envelope. */
export type IRResponseOrError = IRResponse | { error: IRError };

export function isIRError(x: IRResponseOrError): x is { error: IRError } {
  return (x as { error?: unknown }).error != null;
}

// ─── Stream IR ────────────────────────────────────────────────────────────

/**
 * Canonical stream events. Modeled on anthropic's fine-grained event shape
 * because it's the most expressive: explicit block boundaries, separate
 * text/tool-input/thinking deltas, explicit message lifecycle.
 *
 * Families with "flat" stream shapes (openai, gemini) synthesize the start/
 * stop events from inference during parse, and drop the scaffolding during
 * serialize.
 */
export type IRStreamEvent =
  | IRMessageStartEvent
  | IRContentBlockStartEvent
  | IRTextDeltaEvent
  | IRToolInputDeltaEvent
  | IRThinkingDeltaEvent
  | IRContentBlockStopEvent
  | IRMessageDeltaEvent
  | IRMessageStopEvent
  | IRErrorEvent;

export interface IRMessageStartEvent {
  type: 'message_start';
  id: string;
  model?: string;
  usage: Partial<IRUsage>;
}

export interface IRContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  block: IRContentBlockStart;
}

export type IRContentBlockStart =
  | { type: 'text' }
  | { type: 'tool_use'; id: string; name: string }
  | { type: 'thinking'; toolPlanning?: boolean };

export interface IRTextDeltaEvent {
  type: 'text_delta';
  index: number;
  text: string;
}

export interface IRToolInputDeltaEvent {
  type: 'tool_input_delta';
  index: number;
  partialJson: string;
}

export interface IRThinkingDeltaEvent {
  type: 'thinking_delta';
  index: number;
  text: string;
}

export interface IRContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface IRMessageDeltaEvent {
  type: 'message_delta';
  stopReason?: IRStopReason;
  usage?: Partial<IRUsage>;
}

export interface IRMessageStopEvent {
  type: 'message_stop';
}

export interface IRErrorEvent {
  type: 'error';
  error: IRError;
}
