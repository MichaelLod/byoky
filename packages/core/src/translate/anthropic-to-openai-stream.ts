import type { TranslationContext } from './types.js';

/**
 * Stateful translator for an Anthropic Messages SSE stream → OpenAI Chat
 * Completion SSE stream.
 *
 * Same interface as `createToolNameSSERewriter` in proxy-utils.ts:
 *  - process(chunk): consume bytes, return any complete output frames
 *  - flush():        called after the source stream ends; emit the terminator
 *
 * Buffer rules: Anthropic SSE frames end at `\n\n`. We accumulate bytes until
 * we see a frame boundary, then process one complete frame at a time.
 *
 * Output rules: each Anthropic event maps to ≤1 OpenAI chunk, except:
 *  - `message_stop` expands to two chunks (final delta + usage chunk) plus the
 *    `data: [DONE]` terminator.
 *  - `ping` produces no output.
 *
 * Spec reference: phase 2 translation spec, section 5.2 / 8a.
 */
export function createAnthropicToOpenAIStreamRewriter(
  ctx: TranslationContext,
): { process(chunk: string): string; flush(): string } {
  const state: A2OState = {
    buffer: '',
    messageId: undefined,
    created: Math.floor(Date.now() / 1000),
    inputTokens: 0,
    outputTokens: 0,
    finishReason: null,
    blockTypes: new Map(),
    toolCallIndices: new Map(),
    nextToolCallIndex: 0,
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
        out += processAnthropicFrame(frame, state, ctx);
      }
      return out;
    },
    flush(): string {
      if (state.done) return '';
      // Source stream ended without a clean message_stop. Emit a synthetic
      // finish so the consuming SDK doesn't hang.
      let out = '';
      if (state.messageId) {
        out += emitOpenAIFinishChunk(state, ctx, 'stop');
        out += emitOpenAIUsageChunk(state, ctx);
      }
      out += 'data: [DONE]\n\n';
      state.done = true;
      return out;
    },
  };
}

interface A2OState {
  buffer: string;
  messageId: string | undefined;
  created: number;
  inputTokens: number;
  outputTokens: number;
  finishReason: 'stop' | 'length' | 'tool_calls' | null;
  /** Anthropic content_block index → block type ('text' | 'tool_use' | 'thinking' | ...). */
  blockTypes: Map<number, string>;
  /** Anthropic content_block index → OpenAI tool_calls[] index, only for tool_use blocks. */
  toolCallIndices: Map<number, number>;
  nextToolCallIndex: number;
  done: boolean;
}

interface AnthropicFrameData {
  type?: string;
  index?: number;
  message?: {
    id?: string;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

/**
 * Process one complete Anthropic SSE frame and return zero or more OpenAI
 * chunks (each terminated with `\n\n`).
 */
function processAnthropicFrame(frame: string, state: A2OState, ctx: TranslationContext): string {
  const data = parseAnthropicDataLine(frame);
  if (!data) return '';

  switch (data.type) {
    case 'message_start': {
      state.messageId = data.message?.id ?? `chatcmpl-${ctx.requestId}`;
      const u = data.message?.usage;
      if (u?.input_tokens != null) state.inputTokens = u.input_tokens;
      if (u?.output_tokens != null) state.outputTokens = u.output_tokens;
      // Emit the role-establishing chunk.
      return emitOpenAIChunk(state, ctx, { role: 'assistant', content: '' }, null);
    }

    case 'content_block_start': {
      const idx = data.index;
      const blockType = data.content_block?.type;
      if (typeof idx !== 'number' || !blockType) return '';
      state.blockTypes.set(idx, blockType);
      if (blockType === 'tool_use') {
        const toolIndex = state.nextToolCallIndex++;
        state.toolCallIndices.set(idx, toolIndex);
        return emitOpenAIChunk(
          state,
          ctx,
          {
            tool_calls: [
              {
                index: toolIndex,
                id: data.content_block?.id ?? '',
                type: 'function',
                function: {
                  name: data.content_block?.name ?? '',
                  arguments: '',
                },
              },
            ],
          },
          null,
        );
      }
      // text / thinking / unknown — start emits nothing
      return '';
    }

    case 'content_block_delta': {
      const idx = data.index;
      if (typeof idx !== 'number') return '';
      const blockType = state.blockTypes.get(idx);
      const deltaType = data.delta?.type;
      if (deltaType === 'text_delta' && blockType === 'text') {
        if (typeof data.delta?.text !== 'string') return '';
        return emitOpenAIChunk(state, ctx, { content: data.delta.text }, null);
      }
      if (deltaType === 'input_json_delta' && blockType === 'tool_use') {
        const toolIndex = state.toolCallIndices.get(idx);
        if (toolIndex == null) return '';
        if (typeof data.delta?.partial_json !== 'string') return '';
        return emitOpenAIChunk(
          state,
          ctx,
          {
            tool_calls: [
              {
                index: toolIndex,
                function: { arguments: data.delta.partial_json },
              },
            ],
          },
          null,
        );
      }
      // thinking_delta and other novel delta types — drop.
      return '';
    }

    case 'content_block_stop': {
      // No-op: OpenAI doesn't have explicit block boundaries.
      return '';
    }

    case 'message_delta': {
      // Capture stop_reason and updated output_tokens. Emit nothing yet —
      // the actual finish chunk goes out at message_stop.
      const stop = data.delta?.stop_reason;
      if (stop) state.finishReason = mapAnthropicStop(stop);
      if (data.usage?.output_tokens != null) state.outputTokens = data.usage.output_tokens;
      if (data.usage?.input_tokens != null) state.inputTokens = data.usage.input_tokens;
      return '';
    }

    case 'message_stop': {
      // Emit final delta with finish_reason, then a usage-only chunk, then [DONE].
      let out = '';
      out += emitOpenAIFinishChunk(state, ctx, state.finishReason ?? 'stop');
      out += emitOpenAIUsageChunk(state, ctx);
      out += 'data: [DONE]\n\n';
      state.done = true;
      return out;
    }

    case 'ping': {
      return '';
    }

    case 'error': {
      // Forward as an OpenAI-shaped error chunk, then terminate.
      const errChunk = {
        error: {
          message: data.error?.message ?? 'Anthropic stream error',
          type: data.error?.type ?? 'api_error',
          code: null as string | null,
        },
      };
      state.done = true;
      return `data: ${JSON.stringify(errChunk)}\n\ndata: [DONE]\n\n`;
    }

    default:
      // Unknown event type — drop without crashing.
      return '';
  }
}

/**
 * Extract the JSON payload from an SSE frame's `data:` line. Returns
 * undefined for frames that aren't JSON (e.g. malformed) or have no data line.
 */
function parseAnthropicDataLine(frame: string): AnthropicFrameData | undefined {
  // Anthropic frames look like: "event: <type>\ndata: <json>"
  // We only need the data line — `event:` is informational, `data.type`
  // is the source of truth.
  const lines = frame.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const json = line.slice(6);
      try {
        return JSON.parse(json) as AnthropicFrameData;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

interface OpenAIDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: OpenAIDeltaToolCall[];
}

interface OpenAIDeltaToolCall {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

type OpenAIDeltaFinish = 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;

/**
 * Build and serialize one OpenAI streaming chunk. The model field always
 * echoes what the app *requested*, never the actual destination model.
 */
function emitOpenAIChunk(
  state: A2OState,
  ctx: TranslationContext,
  delta: OpenAIDelta,
  finishReason: OpenAIDeltaFinish,
): string {
  const chunk = {
    id: state.messageId ?? `chatcmpl-${ctx.requestId}`,
    object: 'chat.completion.chunk',
    created: state.created,
    model: ctx.srcModel ?? ctx.dstModel,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Final delta chunk: empty delta + finish_reason. Mirrors the shape OpenAI
 * sends as the second-to-last chunk in a streaming response.
 */
function emitOpenAIFinishChunk(
  state: A2OState,
  ctx: TranslationContext,
  finish: 'stop' | 'length' | 'tool_calls',
): string {
  return emitOpenAIChunk(state, ctx, {}, finish);
}

/**
 * Usage chunk: empty choices array (per OpenAI's stream_options.include_usage
 * spec, the final usage chunk has `choices: []` and a top-level `usage`).
 */
function emitOpenAIUsageChunk(state: A2OState, ctx: TranslationContext): string {
  const chunk = {
    id: state.messageId ?? `chatcmpl-${ctx.requestId}`,
    object: 'chat.completion.chunk',
    created: state.created,
    model: ctx.srcModel ?? ctx.dstModel,
    choices: [],
    usage: {
      prompt_tokens: state.inputTokens,
      completion_tokens: state.outputTokens,
      total_tokens: state.inputTokens + state.outputTokens,
    },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function mapAnthropicStop(stop: string): 'stop' | 'length' | 'tool_calls' {
  switch (stop) {
    case 'end_turn':
      return 'stop';
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'pause_turn':
      return 'stop';
    case 'refusal':
      return 'stop';
    default:
      return 'stop';
  }
}
