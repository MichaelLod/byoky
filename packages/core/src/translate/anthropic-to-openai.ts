import type { TranslationContext } from './types.js';
import { TranslationError } from './types.js';
import { getModel } from '../models.js';

/**
 * Translate an Anthropic Messages API request body into an OpenAI Chat
 * Completions API request body.
 *
 * Pure function: takes a JSON string, returns a JSON string. Throws
 * TranslationError on shapes we cannot represent on the destination side.
 *
 * Spec reference: phase 2 translation spec, section 6a.
 */
export function anthropicToOpenAIRequest(
  ctx: TranslationContext,
  body: string,
): string {
  let parsed: AnthropicRequest;
  try {
    parsed = JSON.parse(body) as AnthropicRequest;
  } catch (err) {
    throw new TranslationError('INVALID_JSON', `Anthropic request body is not valid JSON: ${(err as Error).message}`);
  }

  const out: OpenAIRequest = {
    model: ctx.dstModel,
    messages: [],
  };

  // ─── system prompt ─────────────────────────────────────────────────────
  // Anthropic puts the system prompt at the top level (string or text-block
  // array). OpenAI puts it as the first message with role 'system'.
  const systemText = flattenAnthropicSystem(parsed.system);
  if (systemText) {
    out.messages.push({ role: 'system', content: systemText });
  }

  // ─── messages ──────────────────────────────────────────────────────────
  if (Array.isArray(parsed.messages)) {
    for (const msg of parsed.messages) {
      out.messages.push(...translateAnthropicMessage(msg));
    }
  }

  // ─── sampling params ───────────────────────────────────────────────────
  // OpenAI reasoning models (gpt-5.x, o-series) reject `max_tokens` and
  // require `max_completion_tokens`. Look up the destination model to know
  // which field to write.
  const dstModel = getModel(ctx.dstModel);
  const isReasoningDst = dstModel?.capabilities.reasoning === true;
  if (typeof parsed.max_tokens === 'number') {
    if (isReasoningDst) {
      out.max_completion_tokens = parsed.max_tokens;
    } else {
      out.max_tokens = parsed.max_tokens;
    }
  }
  // Reasoning models also reject temperature/top_p — they only support the
  // default sampling. Drop them silently rather than letting OpenAI 400.
  if (typeof parsed.temperature === 'number' && !isReasoningDst) {
    out.temperature = parsed.temperature;
  }
  if (typeof parsed.top_p === 'number' && !isReasoningDst) {
    out.top_p = parsed.top_p;
  }
  // top_k has no OpenAI equivalent — drop silently.

  if (Array.isArray(parsed.stop_sequences) && parsed.stop_sequences.length > 0) {
    out.stop = parsed.stop_sequences;
  }

  if (typeof parsed.stream === 'boolean') {
    out.stream = parsed.stream;
    if (parsed.stream) {
      // Mirror what injectStreamUsageOptions does for OpenAI-family providers,
      // so the destination's last chunk reports usage and parseUsage can log it.
      out.stream_options = { include_usage: true };
    }
  }

  // metadata.user_id → user
  if (parsed.metadata && typeof parsed.metadata.user_id === 'string') {
    out.user = parsed.metadata.user_id;
  }

  // ─── tools ─────────────────────────────────────────────────────────────
  if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    out.tools = parsed.tools.map(translateAnthropicTool);
  }

  if (parsed.tool_choice !== undefined) {
    out.tool_choice = translateAnthropicToolChoice(parsed.tool_choice);
  }

  return JSON.stringify(out);
}

// ─── Anthropic input shapes (narrow, only what we read) ──────────────────

interface AnthropicRequest {
  model?: string;
  system?: string | AnthropicTextBlock[];
  messages?: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: { user_id?: string };
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: AnthropicImageSource }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: string | AnthropicContentBlock[]; is_error?: boolean }
  | { type: 'document' }
  | { type: 'thinking' }
  | { type: string; [k: string]: unknown };

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

// ─── OpenAI output shapes (narrow, only what we write) ───────────────────

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  user?: string;
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
}

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAITool {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
}

type OpenAIToolChoice =
  | 'auto'
  | 'required'
  | 'none'
  | { type: 'function'; function: { name: string } };

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Anthropic's `system` field is either a plain string or an array of text
 * blocks. Flatten to a single string. Non-text blocks (rare) are dropped.
 * Returns undefined if there's no system content at all.
 */
function flattenAnthropicSystem(
  system: string | AnthropicTextBlock[] | undefined,
): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system.length > 0 ? system : undefined;
  if (Array.isArray(system)) {
    const parts = system
      .map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .filter((s) => s.length > 0);
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }
  return undefined;
}

/**
 * Translate one Anthropic message into one or more OpenAI messages.
 *
 * Anthropic packs tool_result blocks inside user messages; OpenAI requires
 * each tool result to be its own role:'tool' message. So a single user message
 * with both tool_results and text/images becomes (tool messages) + (user
 * message with leftover non-tool blocks).
 *
 * Anthropic packs tool_use blocks inside assistant messages alongside text;
 * OpenAI keeps `content` as a string and puts tool calls in a parallel
 * `tool_calls` array.
 */
function translateAnthropicMessage(msg: AnthropicMessage): OpenAIMessage[] {
  if (msg.role === 'user') {
    return translateUserMessage(msg);
  }
  if (msg.role === 'assistant') {
    return translateAssistantMessage(msg);
  }
  // Unknown role — drop. Shouldn't happen given Anthropic only has user/assistant.
  return [];
}

function translateUserMessage(msg: AnthropicMessage): OpenAIMessage[] {
  // Plain string content → straight passthrough.
  if (typeof msg.content === 'string') {
    return [{ role: 'user', content: msg.content }];
  }
  if (!Array.isArray(msg.content)) return [];

  const out: OpenAIMessage[] = [];
  const userParts: OpenAIContentPart[] = [];

  for (const block of msg.content) {
    if (!block || typeof block !== 'object') continue;
    switch (block.type) {
      case 'text':
        if (typeof (block as { text?: unknown }).text === 'string') {
          userParts.push({ type: 'text', text: (block as { text: string }).text });
        }
        break;
      case 'image': {
        const src = (block as { source?: AnthropicImageSource }).source;
        const url = anthropicImageToDataUrl(src);
        if (url) userParts.push({ type: 'image_url', image_url: { url } });
        break;
      }
      case 'tool_result': {
        // Tool results escape the user message and become their own messages.
        const tr = block as Extract<AnthropicContentBlock, { type: 'tool_result' }>;
        out.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: stringifyToolResultContent(tr.content),
        });
        break;
      }
      // document/thinking/unknown — drop
      default:
        break;
    }
  }

  // Emit the leftover user message only if it has any non-tool content.
  if (userParts.length > 0) {
    // If everything is text, collapse to a string for compactness.
    if (userParts.every((p) => p.type === 'text')) {
      out.push({
        role: 'user',
        content: userParts.map((p) => (p as { text: string }).text).join('\n'),
      });
    } else {
      out.push({ role: 'user', content: userParts });
    }
  }

  return out;
}

function translateAssistantMessage(msg: AnthropicMessage): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: 'assistant', content: msg.content }];
  }
  if (!Array.isArray(msg.content)) return [];

  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of msg.content) {
    if (!block || typeof block !== 'object') continue;
    switch (block.type) {
      case 'text':
        if (typeof (block as { text?: unknown }).text === 'string') {
          textParts.push((block as { text: string }).text);
        }
        break;
      case 'tool_use': {
        const tu = block as Extract<AnthropicContentBlock, { type: 'tool_use' }>;
        toolCalls.push({
          id: tu.id,
          type: 'function',
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input ?? {}),
          },
        });
        break;
      }
      // thinking blocks — drop. Anthropic extended thinking has no OpenAI parallel.
      default:
        break;
    }
  }

  const content = textParts.length > 0 ? textParts.join('\n') : null;
  const out: OpenAIMessage = { role: 'assistant', content };
  if (toolCalls.length > 0) out.tool_calls = toolCalls;
  return [out];
}

/**
 * Anthropic image source → OpenAI image_url string.
 *  - base64 → data URL
 *  - url    → identity
 */
function anthropicImageToDataUrl(source: AnthropicImageSource | undefined): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  if (source.type === 'base64' && typeof source.media_type === 'string' && typeof source.data === 'string') {
    return `data:${source.media_type};base64,${source.data}`;
  }
  if (source.type === 'url' && typeof source.url === 'string') {
    return source.url;
  }
  return undefined;
}

/**
 * Anthropic tool_result content can be a plain string, an array of content
 * blocks, or undefined (treated as empty). OpenAI's tool message takes a
 * single string. Flatten array content to text by extracting text blocks.
 */
function stringifyToolResultContent(
  content: string | AnthropicContentBlock[] | undefined,
): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object' && block.type === 'text') {
          return (block as { text?: string }).text ?? '';
        }
        // image/document/etc. inside tool_result — stringify as a placeholder
        return '';
      })
      .filter((s) => s.length > 0)
      .join('\n');
  }
  return '';
}

function translateAnthropicTool(tool: AnthropicTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: tool.input_schema ?? { type: 'object', properties: {} },
    },
  };
}

function translateAnthropicToolChoice(choice: AnthropicToolChoice): OpenAIToolChoice {
  if (!choice || typeof choice !== 'object') return 'auto';
  switch (choice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    case 'tool':
      return { type: 'function', function: { name: choice.name } };
    default:
      return 'auto';
  }
}
