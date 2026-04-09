import { getModel } from '../models.js';
import type { TranslationContext } from './types.js';
import { TranslationError } from './types.js';

/**
 * Translate an OpenAI Chat Completions API request body into an Anthropic
 * Messages API request body.
 *
 * Pure function: takes a JSON string, returns a JSON string. Throws
 * TranslationError on shapes Anthropic cannot represent (e.g. n > 1).
 *
 * Spec reference: phase 2 translation spec, section 6b.
 */
export function openAIToAnthropicRequest(
  ctx: TranslationContext,
  body: string,
): string {
  let parsed: OpenAIRequest;
  try {
    parsed = JSON.parse(body) as OpenAIRequest;
  } catch (err) {
    throw new TranslationError('INVALID_JSON', `OpenAI request body is not valid JSON: ${(err as Error).message}`);
  }

  // n > 1 is unrepresentable on Anthropic — fail loud rather than silently
  // dropping completions.
  if (typeof parsed.n === 'number' && parsed.n > 1) {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      'Anthropic does not support generating multiple completions per request (n > 1).',
    );
  }

  // ─── separate system messages from the conversation ───────────────────
  const systemParts: string[] = [];
  const conversation: OpenAIMessage[] = [];
  if (Array.isArray(parsed.messages)) {
    for (const m of parsed.messages) {
      if (m && m.role === 'system') {
        const text = stringifyOpenAIMessageContent(m.content);
        if (text) systemParts.push(text);
      } else {
        conversation.push(m);
      }
    }
  }

  // response_format json_object: Anthropic has no equivalent. Best-effort
  // shim: append a hint to the system prompt asking for JSON-only output.
  if (
    parsed.response_format &&
    typeof parsed.response_format === 'object' &&
    parsed.response_format.type === 'json_object'
  ) {
    systemParts.push('Respond with valid JSON only. Do not include any prose outside the JSON object.');
  }

  // response_format json_schema is too rich to silently shim — refuse.
  if (
    parsed.response_format &&
    typeof parsed.response_format === 'object' &&
    parsed.response_format.type === 'json_schema'
  ) {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      'OpenAI response_format json_schema cannot be translated to Anthropic. Pin this app to an OpenAI-family model.',
    );
  }

  // ─── translate the conversation ────────────────────────────────────────
  const messages = translateOpenAIConversation(conversation);

  // ─── max_tokens (Anthropic requires it) ────────────────────────────────
  let maxTokens = parsed.max_completion_tokens ?? parsed.max_tokens;
  if (typeof maxTokens !== 'number') {
    // Default to the destination model's max output, capped at 4096 to keep
    // costs predictable for apps that don't ask for a specific limit.
    const dst = getModel(ctx.dstModel);
    maxTokens = Math.min(dst?.maxOutput ?? 4096, 4096);
  }

  const out: AnthropicRequest = {
    model: ctx.dstModel,
    max_tokens: maxTokens,
    messages,
  };

  if (systemParts.length > 0) {
    out.system = systemParts.join('\n\n');
  }

  // ─── sampling params ───────────────────────────────────────────────────
  if (typeof parsed.temperature === 'number') {
    // Anthropic clamps temperature to [0, 1]; OpenAI accepts up to 2.
    out.temperature = Math.max(0, Math.min(1, parsed.temperature));
  }
  if (typeof parsed.top_p === 'number') out.top_p = parsed.top_p;
  // frequency_penalty / presence_penalty / seed / logprobs / logit_bias — drop

  if (parsed.stop !== undefined) {
    out.stop_sequences = Array.isArray(parsed.stop) ? parsed.stop : [parsed.stop];
  }

  if (typeof parsed.stream === 'boolean') out.stream = parsed.stream;
  // stream_options is OpenAI-specific — drop.

  if (typeof parsed.user === 'string') {
    out.metadata = { user_id: parsed.user };
  }

  // ─── tools ─────────────────────────────────────────────────────────────
  if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    out.tools = parsed.tools
      .filter((t): t is OpenAITool => !!t && t.type === 'function' && !!t.function)
      .map((t) => ({
        name: t.function.name,
        ...(t.function.description ? { description: t.function.description } : {}),
        input_schema: t.function.parameters ?? { type: 'object', properties: {} },
      }));
  }

  if (parsed.tool_choice !== undefined) {
    out.tool_choice = translateOpenAIToolChoice(parsed.tool_choice);
  }

  return JSON.stringify(out);
}

// ─── OpenAI input shapes (narrow) ────────────────────────────────────────

interface OpenAIRequest {
  model?: string;
  messages?: OpenAIMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  user?: string;
  n?: number;
  response_format?: { type: string };
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  // ignored: frequency_penalty, presence_penalty, seed, logprobs, top_logprobs,
  //         logit_bias, stream_options, service_tier, parallel_tool_calls
}

type OpenAIMessage =
  | { role: 'system'; content: OpenAIMessageContent }
  | { role: 'user'; content: OpenAIMessageContent }
  | { role: 'assistant'; content: OpenAIMessageContent | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: OpenAIMessageContent };

type OpenAIMessageContent = string | OpenAIContentPart[];

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } | string };

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: { name: string; description?: string; parameters?: unknown };
}

type OpenAIToolChoice =
  | 'auto'
  | 'required'
  | 'none'
  | { type: 'function'; function: { name: string } };

// ─── Anthropic output shapes (narrow) ────────────────────────────────────

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: { user_id: string };
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: AnthropicImageSource }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] };

type AnthropicImageSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'url'; url: string };

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: unknown;
}

type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

// ─── Conversation translator ──────────────────────────────────────────────

/**
 * Walk the OpenAI message list and produce the Anthropic equivalent.
 *
 * The asymmetry: OpenAI has standalone `role:'tool'` messages that follow
 * the assistant message that produced the tool_call. Anthropic represents
 * tool results as `tool_result` content blocks INSIDE the next user message.
 *
 * Algorithm: buffer pending tool results until we hit the next non-tool
 * message, then prepend them to that message's content (creating a fresh
 * user message if the next message is also assistant or there is no next).
 */
function translateOpenAIConversation(messages: OpenAIMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  let pendingToolResults: AnthropicContentBlock[] = [];

  const flushPending = () => {
    if (pendingToolResults.length === 0) return;
    out.push({ role: 'user', content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    switch (m.role) {
      case 'tool': {
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: stringifyOpenAIMessageContent(m.content),
        });
        break;
      }
      case 'user': {
        // Pending tool results merge into the front of this user message.
        const userBlocks = openAIUserContentToAnthropicBlocks(m.content);
        if (pendingToolResults.length > 0) {
          out.push({
            role: 'user',
            content: [...pendingToolResults, ...userBlocks],
          });
          pendingToolResults = [];
        } else if (
          userBlocks.length === 1 &&
          userBlocks[0].type === 'text'
        ) {
          // Single text block — collapse to plain string for compactness.
          out.push({ role: 'user', content: (userBlocks[0] as { text: string }).text });
        } else {
          out.push({ role: 'user', content: userBlocks });
        }
        break;
      }
      case 'assistant': {
        flushPending();
        out.push(translateAssistantMessage(m));
        break;
      }
      // role:'system' was already extracted before reaching this loop.
      default:
        break;
    }
  }

  // Trailing tool results without a following user message become a user
  // message on their own. Anthropic accepts this — the next assistant turn
  // will respond to it.
  flushPending();

  return out;
}

function translateAssistantMessage(m: Extract<OpenAIMessage, { role: 'assistant' }>): AnthropicMessage {
  const blocks: AnthropicContentBlock[] = [];

  const text = stringifyOpenAIMessageContent(m.content);
  if (text) blocks.push({ type: 'text', text });

  if (Array.isArray(m.tool_calls)) {
    for (const tc of m.tool_calls) {
      if (!tc || tc.type !== 'function' || !tc.function) continue;
      let input: unknown;
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        // Malformed arguments — preserve as a string under a synthetic key
        // so Anthropic still sees a tool_use block (not ideal, but better
        // than dropping the call entirely).
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

  // If the assistant message had only text, collapse to string form.
  if (blocks.length === 1 && blocks[0].type === 'text') {
    return { role: 'assistant', content: (blocks[0] as { text: string }).text };
  }
  // If everything was empty (shouldn't normally happen), emit a no-op text block.
  if (blocks.length === 0) {
    return { role: 'assistant', content: '' };
  }
  return { role: 'assistant', content: blocks };
}

/**
 * Translate an OpenAI user message's content (string or content-part array)
 * into Anthropic content blocks.
 */
function openAIUserContentToAnthropicBlocks(
  content: OpenAIMessageContent,
): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) return [{ type: 'text', text: '' }];

  const out: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
      out.push({ type: 'text', text: (part as { text: string }).text });
    } else if (part.type === 'image_url') {
      const url = extractOpenAIImageUrl((part as { image_url: { url: string } | string }).image_url);
      const source = parseImageUrlToAnthropicSource(url);
      if (source) out.push({ type: 'image', source });
    }
  }
  return out;
}

/**
 * Flatten an OpenAI message content (string | parts[]) into a single string.
 * Used for system messages and tool result messages, where Anthropic only
 * accepts text. Image parts are dropped with no equivalent on those surfaces.
 */
function stringifyOpenAIMessageContent(content: OpenAIMessageContent | null | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => {
      if (p && typeof p === 'object' && p.type === 'text') {
        return (p as { text?: string }).text ?? '';
      }
      return '';
    })
    .filter((s) => s.length > 0)
    .join('\n');
}

function extractOpenAIImageUrl(image_url: { url: string } | string): string {
  if (typeof image_url === 'string') return image_url;
  if (image_url && typeof image_url === 'object' && typeof image_url.url === 'string') {
    return image_url.url;
  }
  return '';
}

/**
 * Convert an OpenAI image_url string to an Anthropic image source. Handles
 * both data: URLs (→ base64 source) and HTTP/HTTPS URLs (→ url source).
 */
function parseImageUrlToAnthropicSource(url: string): AnthropicImageSource | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:')) {
    // data:<media_type>;base64,<data>
    const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
    if (!match) return undefined;
    return { type: 'base64', media_type: match[1], data: match[2] };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { type: 'url', url };
  }
  return undefined;
}

function translateOpenAIToolChoice(choice: OpenAIToolChoice): AnthropicToolChoice {
  if (typeof choice === 'string') {
    switch (choice) {
      case 'auto':
        return { type: 'auto' };
      case 'required':
        return { type: 'any' };
      case 'none':
        return { type: 'none' };
      default:
        return { type: 'auto' };
    }
  }
  if (choice && typeof choice === 'object' && choice.type === 'function' && choice.function) {
    return { type: 'tool', name: choice.function.name };
  }
  return { type: 'auto' };
}
