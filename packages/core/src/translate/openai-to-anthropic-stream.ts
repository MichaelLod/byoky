import type { TranslationContext } from './types.js';

/**
 * Stateful translator for an OpenAI Chat Completion SSE stream → Anthropic
 * Messages SSE stream.
 *
 * This is the harder direction: OpenAI emits bare data chunks with no event
 * framing, while Anthropic emits a strict ordered sequence of named events
 * (message_start → content_block_start → content_block_delta* →
 * content_block_stop → ... → message_delta → message_stop). We have to
 * synthesize all of that scaffolding from inference over the OpenAI stream.
 *
 * Same interface as the a→o translator: process(chunk) → string, flush() → string.
 *
 * Spec reference: phase 2 translation spec, section 5.3 / 8b.
 */
export function createOpenAIToAnthropicStreamRewriter(
  ctx: TranslationContext,
): { process(chunk: string): string; flush(): string } {
  const state: O2AState = {
    buffer: '',
    started: false,
    messageId: `msg_${ctx.requestId}`,
    inputTokens: 0,
    outputTokens: 0,
    nextBlockIndex: 0,
    textBlockIndex: null,
    textBlockOpen: false,
    toolCalls: new Map(),
    pendingFinish: null,
    done: false,
  };

  return {
    process(chunk: string): string {
      state.buffer += chunk;
      let out = '';
      let idx: number;
      while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
        const frame = state.buffer.slice(0, idx);
        state.buffer = state.buffer.slice(idx + 2);
        out += processOpenAIFrame(frame, state, ctx);
      }
      return out;
    },
    flush(): string {
      if (state.done) return '';
      // Source stream ended without us reaching the terminator. Close any
      // open blocks and emit a synthetic message_stop so the consuming
      // Anthropic SDK doesn't hang.
      let out = '';
      out += closeAllOpenBlocks(state);
      if (state.started) {
        out += emitMessageDelta(state, state.pendingFinish ?? 'end_turn');
        out += emitMessageStop();
      }
      state.done = true;
      return out;
    },
  };
}

interface O2AState {
  buffer: string;
  started: boolean;
  messageId: string;
  inputTokens: number;
  outputTokens: number;
  /** Next free Anthropic content_block index. */
  nextBlockIndex: number;
  /** The Anthropic block index of the (single) text block, if one was opened. */
  textBlockIndex: number | null;
  /** Is the text block currently open (i.e. content_block_start emitted, no stop yet)? */
  textBlockOpen: boolean;
  /**
   * OpenAI tool_calls[].index → tool-call state.
   * OpenAI streams tool calls under stable indices and only includes `name`
   * + `id` on the first chunk for each index. We have to remember them so
   * we can emit them on the Anthropic content_block_start.
   */
  toolCalls: Map<number, ToolCallState>;
  /** Buffered finish reason — emitted at message_stop time. */
  pendingFinish: AnthropicStop | null;
  done: boolean;
}

type AnthropicStop = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'refusal';

interface ToolCallState {
  /** The Anthropic content_block index assigned to this tool call. */
  blockIndex: number;
  /** Is this block currently open (start emitted, stop not yet)? */
  open: boolean;
  /** Have we received the function name yet? */
  started: boolean;
  /** OpenAI's tool_call id, used as Anthropic's tool_use id. */
  id: string;
  /** Function name, captured from the first chunk that includes it. */
  name: string;
}

interface OpenAIChunkData {
  id?: string;
  choices?: OpenAIStreamChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

interface OpenAIStreamChoice {
  index?: number;
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: OpenAIDeltaToolCall[];
    refusal?: string | null;
  };
  finish_reason?: string | null;
}

interface OpenAIDeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Process one complete OpenAI SSE frame and return zero or more Anthropic
 * SSE frames.
 */
function processOpenAIFrame(frame: string, state: O2AState, ctx: TranslationContext): string {
  // OpenAI frames are just `data: <json>` lines (sometimes multiple lines per
  // frame, but in practice the chat-completions stream uses one).
  const dataLine = extractDataLine(frame);
  if (dataLine == null) return '';

  // Stream terminator.
  if (dataLine === '[DONE]') {
    if (state.done) return '';
    let out = '';
    out += closeAllOpenBlocks(state);
    if (state.started) {
      out += emitMessageDelta(state, state.pendingFinish ?? 'end_turn');
      out += emitMessageStop();
    }
    state.done = true;
    return out;
  }

  let data: OpenAIChunkData;
  try {
    data = JSON.parse(dataLine) as OpenAIChunkData;
  } catch {
    return '';
  }

  // Error chunk: forward as Anthropic-shaped error event and terminate.
  if (data.error) {
    state.done = true;
    return emitErrorEvent(data.error.type ?? 'api_error', data.error.message ?? 'OpenAI stream error');
  }

  let out = '';

  // First non-error chunk → emit message_start. We may not know input_tokens
  // yet (OpenAI puts usage in the final chunk under stream_options); the
  // value emitted here is whatever we have, and the actual count flows into
  // message_delta at the end where Anthropic SDKs read it from.
  if (!state.started) {
    state.started = true;
    out += emitMessageStart(state, ctx);
  }

  const choice = data.choices?.[0];

  // Final chunk that carries usage. OpenAI's stream_options.include_usage
  // emits a chunk with `choices: []` and a top-level `usage`.
  if (data.usage) {
    if (typeof data.usage.prompt_tokens === 'number') state.inputTokens = data.usage.prompt_tokens;
    if (typeof data.usage.completion_tokens === 'number') state.outputTokens = data.usage.completion_tokens;
  }

  if (!choice) return out;

  // Handle delta content / tool_calls.
  const delta = choice.delta;
  if (delta) {
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      out += handleTextDelta(state, delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        out += handleToolCallDelta(state, tc);
      }
    }
  }

  // Finish reason. We don't emit message_delta/message_stop *yet* — there
  // may still be a usage chunk coming. We'll do it at [DONE] (or in flush).
  if (choice.finish_reason) {
    state.pendingFinish = mapOpenAIFinish(choice.finish_reason);
  }

  return out;
}

/**
 * Extract the JSON portion of a single-data-line SSE frame. OpenAI sometimes
 * sends comments (lines starting with `:`) as keepalives — those return null.
 */
function extractDataLine(frame: string): string | null {
  const lines = frame.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) return line.slice(6);
    if (line.startsWith('data:')) return line.slice(5).trimStart();
  }
  return null;
}

// ─── Emitters ─────────────────────────────────────────────────────────────

function emitFrame(eventType: string, data: object): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function emitMessageStart(state: O2AState, ctx: TranslationContext): string {
  return emitFrame('message_start', {
    type: 'message_start',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: ctx.srcModel ?? ctx.dstModel,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: state.inputTokens, output_tokens: 0 },
    },
  });
}

function emitTextBlockStart(index: number): string {
  return emitFrame('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  });
}

function emitTextDelta(index: number, text: string): string {
  return emitFrame('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  });
}

function emitToolUseBlockStart(index: number, id: string, name: string): string {
  return emitFrame('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name, input: {} },
  });
}

function emitToolUseDelta(index: number, partialJson: string): string {
  return emitFrame('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  });
}

function emitBlockStop(index: number): string {
  return emitFrame('content_block_stop', {
    type: 'content_block_stop',
    index,
  });
}

function emitMessageDelta(state: O2AState, stopReason: AnthropicStop): string {
  return emitFrame('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { input_tokens: state.inputTokens, output_tokens: state.outputTokens },
  });
}

function emitMessageStop(): string {
  return emitFrame('message_stop', { type: 'message_stop' });
}

function emitErrorEvent(type: string, message: string): string {
  return emitFrame('error', {
    type: 'error',
    error: { type, message },
  });
}

// ─── State helpers ────────────────────────────────────────────────────────

function handleTextDelta(state: O2AState, text: string): string {
  let out = '';
  if (!state.textBlockOpen) {
    // First text content for this message — open a text block.
    // If this happens after a tool block is open, that tool block needs to
    // close first to maintain Anthropic's "one block at a time" invariant.
    out += closeAllOpenBlocks(state);
    state.textBlockIndex = state.nextBlockIndex++;
    state.textBlockOpen = true;
    out += emitTextBlockStart(state.textBlockIndex);
  }
  out += emitTextDelta(state.textBlockIndex!, text);
  return out;
}

function handleToolCallDelta(state: O2AState, tc: OpenAIDeltaToolCall): string {
  if (!tc || typeof tc.index !== 'number') return '';
  let out = '';

  let entry = state.toolCalls.get(tc.index);

  // Capture name + id on the first chunk that supplies them.
  if (!entry) {
    entry = {
      blockIndex: -1, // assigned when we actually start the block
      open: false,
      started: false,
      id: tc.id ?? '',
      name: tc.function?.name ?? '',
    };
    state.toolCalls.set(tc.index, entry);
  } else {
    if (tc.id && !entry.id) entry.id = tc.id;
    if (tc.function?.name && !entry.name) entry.name = tc.function.name;
  }

  // We can only start the Anthropic block once we have both id and name.
  // OpenAI gives them on the first chunk for the index in practice, but
  // tolerate them arriving across two chunks.
  if (!entry.started && entry.id && entry.name) {
    // Close any other open block first (text or another tool call).
    out += closeAllOpenBlocksExcept(state, tc.index);
    entry.blockIndex = state.nextBlockIndex++;
    entry.started = true;
    entry.open = true;
    out += emitToolUseBlockStart(entry.blockIndex, entry.id, entry.name);
  }

  // Forward argument deltas as input_json_delta. Only valid once the block
  // is open — if not yet started, drop the partial (extremely rare).
  const args = tc.function?.arguments;
  if (typeof args === 'string' && args.length > 0 && entry.open) {
    out += emitToolUseDelta(entry.blockIndex, args);
  }

  return out;
}

/**
 * Close every currently-open block (text + all tool calls). Used when
 * transitioning the stream from one block to another, and at message end.
 */
function closeAllOpenBlocks(state: O2AState): string {
  let out = '';
  if (state.textBlockOpen && state.textBlockIndex != null) {
    out += emitBlockStop(state.textBlockIndex);
    state.textBlockOpen = false;
  }
  for (const entry of state.toolCalls.values()) {
    if (entry.open) {
      out += emitBlockStop(entry.blockIndex);
      entry.open = false;
    }
  }
  return out;
}

/**
 * Close every currently-open block except the tool call at the given OpenAI
 * tool_call index. Used when a new tool call's first chunk arrives — the
 * prior block (text or other tool) needs to close before the new one opens.
 */
function closeAllOpenBlocksExcept(state: O2AState, openaiIndex: number): string {
  let out = '';
  if (state.textBlockOpen && state.textBlockIndex != null) {
    out += emitBlockStop(state.textBlockIndex);
    state.textBlockOpen = false;
  }
  for (const [idx, entry] of state.toolCalls.entries()) {
    if (idx === openaiIndex) continue;
    if (entry.open) {
      out += emitBlockStop(entry.blockIndex);
      entry.open = false;
    }
  }
  return out;
}

function mapOpenAIFinish(finish: string): AnthropicStop {
  switch (finish) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}
