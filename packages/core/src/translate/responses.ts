import type { TranslationContext } from './types.js';
import { TranslationError } from './types.js';

/**
 * Non-streaming response body translation.
 *
 * For streaming responses, see the SSE translators in
 * anthropic-to-openai-stream.ts and openai-to-anthropic-stream.ts. These
 * mappers run only when the destination provider returned a single JSON
 * payload (i.e. the request had `stream: false`).
 *
 * Spec reference: phase 2 translation spec, section 4.
 */

// ─── Anthropic Messages response → OpenAI Chat Completion response ──────

interface AnthropicResponse {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: AnthropicResponseBlock[];
  stop_reason?: AnthropicStopReason;
  stop_sequence?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  // Present only on error responses (`type: 'error'`).
  error?: { type?: string; message?: string };
}

type AnthropicResponseBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

type AnthropicStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal';

interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAIChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: OpenAIFinishReason;
}

type OpenAIFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * Translate a non-streaming Anthropic Messages response to an OpenAI Chat
 * Completion response.
 *
 * The `model` field in the output echoes what the app *requested*
 * (`ctx.srcModel`), not what we actually called. The wallet logs both — see
 * spec section 10.
 */
export function anthropicToOpenAIResponse(
  ctx: TranslationContext,
  body: string,
): string {
  let parsed: AnthropicResponse;
  try {
    parsed = JSON.parse(body) as AnthropicResponse;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `Anthropic response body is not valid JSON: ${(err as Error).message}`,
    );
  }

  // Anthropic error responses have shape { type: 'error', error: { ... } } —
  // pass them through as OpenAI-shaped errors so the app's error handler works.
  if (parsed.type === 'error') {
    return JSON.stringify(translateAnthropicErrorBody(parsed));
  }

  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  if (Array.isArray(parsed.content)) {
    for (const block of parsed.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        textParts.push((block as { text: string }).text);
      } else if (block.type === 'tool_use') {
        const tu = block as Extract<AnthropicResponseBlock, { type: 'tool_use' }>;
        toolCalls.push({
          id: tu.id,
          type: 'function',
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input ?? {}),
          },
        });
      }
      // thinking blocks are dropped; their information is internal-only and
      // OpenAI has no equivalent surface.
    }
  }

  const inputTokens = parsed.usage?.input_tokens ?? 0;
  const outputTokens = parsed.usage?.output_tokens ?? 0;

  const out: OpenAIResponse = {
    id: parsed.id ?? `chatcmpl-${ctx.requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: ctx.srcModel ?? parsed.model ?? ctx.dstModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('') : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: anthropicStopToOpenAIFinish(parsed.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };

  return JSON.stringify(out);
}

function translateAnthropicErrorBody(parsed: { error?: { type?: string; message?: string } }) {
  return {
    error: {
      message: parsed.error?.message ?? 'Anthropic API error',
      type: parsed.error?.type ?? 'api_error',
      code: null as string | null,
    },
  };
}

function anthropicStopToOpenAIFinish(stop: AnthropicStopReason | undefined): OpenAIFinishReason {
  switch (stop) {
    case 'end_turn':
      return 'stop';
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    case 'pause_turn':
      return 'stop';
    default:
      return 'stop';
  }
}

// ─── OpenAI Chat Completion response → Anthropic Messages response ──────

interface OpenAIChoiceIn {
  index?: number;
  message?: {
    role?: string;
    content?: string | null | OpenAIContentPart[];
    tool_calls?: OpenAIToolCall[];
    refusal?: string | null;
  };
  finish_reason?: OpenAIFinishReason | null;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: unknown };

interface OpenAIResponseIn {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAIChoiceIn[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
}

interface AnthropicResponseOut {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicResponseBlockOut[];
  stop_reason: AnthropicStopReason;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

type AnthropicResponseBlockOut =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

/**
 * Translate a non-streaming OpenAI Chat Completion response to an Anthropic
 * Messages response.
 *
 * Always uses the FIRST choice. OpenAI can return multiple choices when n > 1
 * but the openai-to-anthropic request mapper rejects n > 1 upstream, so this
 * should always be a single-choice response in practice.
 */
export function openAIToAnthropicResponse(
  ctx: TranslationContext,
  body: string,
): string {
  let parsed: OpenAIResponseIn;
  try {
    parsed = JSON.parse(body) as OpenAIResponseIn;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `OpenAI response body is not valid JSON: ${(err as Error).message}`,
    );
  }

  // OpenAI error responses have shape { error: { ... } } — pass them through
  // as Anthropic-shaped errors.
  if (parsed.error) {
    return JSON.stringify(translateOpenAIErrorBody(parsed));
  }

  const choice = parsed.choices?.[0];
  const message = choice?.message;
  const blocks: AnthropicResponseBlockOut[] = [];

  // Text content first.
  const text = stringifyOpenAIResponseContent(message?.content);
  if (text) blocks.push({ type: 'text', text });

  // Then tool calls.
  if (Array.isArray(message?.tool_calls)) {
    for (const tc of message.tool_calls) {
      if (!tc || tc.type !== 'function' || !tc.function) continue;
      let input: unknown;
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        input = { _raw: tc.function.arguments };
      }
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // Anthropic requires at least one content block; if everything was empty
  // (refusal with no message, etc.), emit an empty text block.
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: '' });
  }

  const inputTokens = parsed.usage?.prompt_tokens ?? 0;
  const outputTokens = parsed.usage?.completion_tokens ?? 0;

  const out: AnthropicResponseOut = {
    id: parsed.id ?? `msg_${ctx.requestId}`,
    type: 'message',
    role: 'assistant',
    model: ctx.srcModel ?? parsed.model ?? ctx.dstModel,
    content: blocks,
    stop_reason: openAIFinishToAnthropicStop(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };

  return JSON.stringify(out);
}

function translateOpenAIErrorBody(parsed: OpenAIResponseIn) {
  return {
    type: 'error',
    error: {
      type: parsed.error?.type ?? 'api_error',
      message: parsed.error?.message ?? 'OpenAI API error',
    },
  };
}

function stringifyOpenAIResponseContent(
  content: string | null | OpenAIContentPart[] | undefined,
): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part && typeof part === 'object' && part.type === 'text') {
        return (part as { text?: string }).text ?? '';
      }
      return '';
    })
    .filter((s) => s.length > 0)
    .join('');
}

function openAIFinishToAnthropicStop(finish: OpenAIFinishReason | null): AnthropicStopReason {
  switch (finish) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}
