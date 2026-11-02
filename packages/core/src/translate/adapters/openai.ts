import type { ModelShapingContext, TranslationContext } from '../types.js';
import { TranslationError } from '../types.js';
import { capMaxTokens, getModel } from '../../models.js';
import type { FamilyAdapter, IRStreamParser, IRStreamSerializer } from '../adapter.js';
import type {
  IRRequest,
  IRMessage,
  IRContentBlock,
  IRResponse,
  IRResponseOrError,
  IRResponseBlock,
  IRStreamEvent,
  IRStopReason,
  IRImageSource,
  IRDocumentBlock,
  IRToolResultContent,
} from '../ir.js';
import { isIRError } from '../ir.js';
import { openaiErrorCode, openaiErrorType } from '../errors.js';

/**
 * OpenAI Chat Completions API adapter.
 *
 * Covers /v1/chat/completions for the whole OpenAI family (openai,
 * azure_openai, groq, together, deepseek, xai, perplexity, fireworks,
 * openrouter, mistral).
 *
 * The stream parser is the notable piece: OpenAI SSE doesn't have explicit
 * content-block boundaries, so this parser synthesizes them by tracking when
 * text content and tool-call deltas arrive across chunks. The stream
 * serializer is a direct mapping in the other direction.
 */

const CHAT_ENDPOINT = '/v1/chat/completions';

export const openaiAdapter: FamilyAdapter = {
  family: 'openai',
  chatEndpoint: CHAT_ENDPOINT,

  matchesChatEndpoint(url: string): boolean {
    try {
      const u = new URL(url);
      // OpenAI-compatible providers mount it under other prefixes
      // (/chat/completions on DeepSeek and Perplexity, /openai/v1/… on Groq).
      return u.pathname.endsWith('/chat/completions');
    } catch {
      return false;
    }
  },

  buildChatUrl(base: string): string {
    return `${base.replace(/\/$/, '')}${CHAT_ENDPOINT}`;
  },

  parseRequest,
  serializeRequest,
  shapeRequestForModel,
  parseResponse,
  serializeResponse,
  createStreamParser,
  createStreamSerializer,
};

// ─── Wire shapes ──────────────────────────────────────────────────────────

interface OpenAIRequest {
  model?: string;
  messages?: OpenAIMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[] | null;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  user?: string;
  n?: number;
  response_format?: { type: string; json_schema?: { schema?: unknown; name?: string } };
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  reasoning_effort?: string;
}

type OpenAIMessage =
  | { role: 'system'; content: OpenAIMessageContent }
  // OpenAI's name for system instructions on GPT-5 / o-series models.
  | { role: 'developer'; content: OpenAIMessageContent }
  | { role: 'user'; content: OpenAIMessageContent }
  | { role: 'assistant'; content: OpenAIMessageContent | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: OpenAIMessageContent };

type OpenAIMessageContent = string | OpenAIContentPart[];

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } | string }
  | { type: 'file'; file: { filename?: string; file_data?: string; file_id?: string } };

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

interface OpenAIResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAIChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  // OpenAI and most compatible hosts send an error object; xAI sends the
  // message as a string with a top-level `code`.
  error?: { message?: string; type?: string; code?: string | number | null } | string;
  code?: unknown;
  /** OpenAI repeats the HTTP status here (`"status": 401`). */
  status?: unknown;
  // Mistral errors carry a top-level message (string or object) or detail.
  message?: unknown;
  detail?: unknown;
  type?: unknown;
}

interface OpenAIChoice {
  index?: number;
  message?: {
    role?: string;
    content?: string | null | OpenAIContentPart[];
    tool_calls?: OpenAIToolCall[];
    refusal?: string | null;
  };
  finish_reason?: OpenAIFinishReason | null;
}

type OpenAIFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';

// ─── parseRequest ─────────────────────────────────────────────────────────

function parseRequest(body: string): IRRequest {
  let parsed: OpenAIRequest;
  try {
    parsed = JSON.parse(body) as OpenAIRequest;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `OpenAI request body is not valid JSON: ${(err as Error).message}`,
    );
  }

  const ir: IRRequest = {
    model: parsed.model,
    system: [],
    messages: [],
  };

  // Split system and developer messages from the conversation, in their
  // original order; the IR puts system at top level.
  const conversation: OpenAIMessage[] = [];
  if (Array.isArray(parsed.messages)) {
    for (const m of parsed.messages) {
      if (m && (m.role === 'system' || m.role === 'developer')) {
        const text = flattenOpenAIContent(m.content);
        if (text) ir.system.push({ text });
      } else if (m) {
        conversation.push(m);
      }
    }
  }

  ir.messages = translateOpenAIConversationToIR(conversation);

  if (typeof parsed.max_completion_tokens === 'number') {
    ir.maxTokens = parsed.max_completion_tokens;
  } else if (typeof parsed.max_tokens === 'number') {
    ir.maxTokens = parsed.max_tokens;
  }
  if (typeof parsed.temperature === 'number') ir.temperature = parsed.temperature;
  if (typeof parsed.top_p === 'number') ir.topP = parsed.top_p;
  if (parsed.stop != null) {
    // Hand-built bodies send `stop: null` or `""`; neither is a stop sequence,
    // and the other families reject null or empty entries. Whitespace-only
    // ones such as "\n" are kept: only Anthropic refuses those, and its
    // serializer leaves them out.
    const raw: unknown[] = Array.isArray(parsed.stop) ? parsed.stop : [parsed.stop];
    const stops = raw.filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (stops.length > 0) ir.stopSequences = stops;
  }
  if (typeof parsed.stream === 'boolean') ir.stream = parsed.stream;
  if (typeof parsed.user === 'string') ir.userId = parsed.user;
  if (typeof parsed.n === 'number') ir.n = parsed.n;

  if (parsed.response_format) {
    if (parsed.response_format.type === 'json_object') {
      ir.responseFormat = { type: 'json' };
    } else if (parsed.response_format.type === 'json_schema') {
      const schema = parsed.response_format.json_schema?.schema ?? {};
      ir.responseFormat = { type: 'json_schema', schema };
    }
  }

  if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    ir.tools = parsed.tools
      .filter((t): t is OpenAITool => !!t && t.type === 'function' && !!t.function)
      .map((t) => ({
        name: t.function.name,
        ...(t.function.description ? { description: t.function.description } : {}),
        parameters: t.function.parameters ?? { type: 'object', properties: {} },
      }));
  }

  if (parsed.tool_choice !== undefined) {
    if (typeof parsed.tool_choice === 'string') {
      switch (parsed.tool_choice) {
        case 'auto':
          ir.toolChoice = { type: 'auto' };
          break;
        case 'required':
          ir.toolChoice = { type: 'any' };
          break;
        case 'none':
          ir.toolChoice = { type: 'none' };
          break;
      }
    } else if (
      parsed.tool_choice &&
      typeof parsed.tool_choice === 'object' &&
      parsed.tool_choice.type === 'function' &&
      parsed.tool_choice.function
    ) {
      ir.toolChoice = { type: 'tool', name: parsed.tool_choice.function.name };
    }
  }

  return ir;
}

function translateOpenAIConversationToIR(messages: OpenAIMessage[]): IRMessage[] {
  // OpenAI has standalone role:'tool' messages; the IR packs tool results
  // as blocks inside the NEXT user message (or standalone user message if
  // the next turn isn't user-initiated).
  const out: IRMessage[] = [];
  let pendingToolResults: IRContentBlock[] = [];

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
          toolUseId: m.tool_call_id,
          content: { kind: 'text', text: flattenOpenAIContent(m.content) },
        });
        break;
      }
      case 'user': {
        const userBlocks = parseOpenAIUserContent(m.content);
        if (pendingToolResults.length > 0) {
          out.push({ role: 'user', content: [...pendingToolResults, ...userBlocks] });
          pendingToolResults = [];
        } else {
          out.push({ role: 'user', content: userBlocks });
        }
        break;
      }
      case 'assistant': {
        flushPending();
        out.push(parseOpenAIAssistantMessage(m));
        break;
      }
      default:
        break;
    }
  }

  flushPending();
  return out;
}

function parseOpenAIUserContent(content: OpenAIMessageContent): IRContentBlock[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: IRContentBlock[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
      out.push({ type: 'text', text: (part as { text: string }).text });
    } else if (part.type === 'image_url') {
      const url = extractOpenAIImageUrl((part as { image_url: { url: string } | string }).image_url);
      const source = parseImageUrl(url);
      if (source) out.push({ type: 'image', source });
    } else if (part.type === 'file') {
      const doc = parseOpenAIFilePart((part as { file?: { filename?: unknown; file_data?: unknown } }).file);
      if (doc) out.push(doc);
    }
  }
  return out;
}

/** A file part with inline data (file_id refers to OpenAI's own storage). */
function parseOpenAIFilePart(
  file: { filename?: unknown; file_data?: unknown } | undefined,
): IRDocumentBlock | null {
  if (!file || typeof file.file_data !== 'string' || !file.file_data) return null;
  const title = typeof file.filename === 'string' && file.filename ? { title: file.filename } : {};
  const match = /^data:([^;,]+);base64,(.+)$/.exec(file.file_data);
  // Chat completions takes PDFs here; bare base64 is one.
  const source = match
    ? { kind: 'base64' as const, mediaType: match[1], data: match[2] }
    : { kind: 'base64' as const, mediaType: 'application/pdf', data: file.file_data };
  return { type: 'document', source, ...title };
}

function parseOpenAIAssistantMessage(
  m: Extract<OpenAIMessage, { role: 'assistant' }>,
): IRMessage {
  const blocks: IRContentBlock[] = [];
  const text = flattenOpenAIContent(m.content);
  if (text) blocks.push({ type: 'text', text });

  if (Array.isArray(m.tool_calls)) {
    for (const tc of m.tool_calls) {
      if (!tc || tc.type !== 'function' || !tc.function) continue;
      let input: unknown;
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        input = { _raw: tc.function.arguments };
      }
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
  }

  return { role: 'assistant', content: blocks };
}

function flattenOpenAIContent(content: OpenAIMessageContent | null | undefined): string {
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

function parseImageUrl(url: string): IRImageSource | null {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
    if (!match) return null;
    return { kind: 'base64', mediaType: match[1], data: match[2] };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { kind: 'url', url };
  }
  return null;
}

// ─── serializeRequest ────────────────────────────────────────────────────

function serializeRequest(ctx: TranslationContext, ir: IRRequest): string {
  const out: OpenAIRequest = {
    model: ctx.dstModel,
    messages: [],
  };

  // System parts become a single leading system message with joined text.
  if (ir.system.length > 0) {
    const text = ir.system.map((p) => p.text).join('\n\n');
    if (text) out.messages!.push({ role: 'system', content: text });
  }

  // Conversation: each IR message gets translated, possibly splitting into
  // multiple openai messages (tool_result blocks escape into role:'tool').
  const acceptsImages = openAIAcceptsImages(ctx.dstModel, ctx.dstProviderId);
  for (const msg of ir.messages) {
    for (const wire of serializeMessageToOpenAI(msg, ctx.dstModel, acceptsImages)) {
      out.messages!.push(wire);
    }
  }

  // Sampling params. OpenAI reasoning models reject max_tokens and, unless
  // their reasoning is off, temperature/top_p — use max_completion_tokens
  // and drop the sampling overrides. OpenAI itself takes
  // max_completion_tokens for every model (max_tokens is deprecated there);
  // the other hosts of this dialect (DeepSeek, Mistral, OpenRouter, ...)
  // document max_tokens.
  const isReasoningDst = isOpenAIReasoningModel(ctx.dstModel);
  // Tools on a model that calls them on Chat Completions only with its
  // reasoning off: the tool calls are what the app's code relies on.
  const reasoningOff =
    isReasoningDst &&
    !!ir.tools && ir.tools.length > 0 &&
    reasoningOffForTools(ctx.dstModel, ctx.dstProviderId);
  if (reasoningOff) out.reasoning_effort = 'none';
  if (typeof ir.maxTokens === 'number') {
    const maxTokens = capMaxTokens(ir.maxTokens, ctx.dstModel, ctx.dstProviderId);
    if (usesMaxCompletionTokens(isReasoningDst, ctx.dstProviderId)) out.max_completion_tokens = maxTokens;
    else out.max_tokens = maxTokens;
  }
  if (typeof ir.temperature === 'number' && (!isReasoningDst || reasoningOff)) {
    out.temperature = ir.temperature;
  }
  if (typeof ir.topP === 'number' && (!isReasoningDst || reasoningOff)) out.top_p = ir.topP;
  // top_k has no OpenAI equivalent — drop.

  if (ir.stopSequences && ir.stopSequences.length > 0) out.stop = ir.stopSequences.slice();
  if (typeof ir.stream === 'boolean') {
    out.stream = ir.stream;
    if (ir.stream) {
      // Ensure the final usage chunk is emitted so proxy-level usage logging
      // can read it, matching the behaviour of injectStreamUsageOptions.
      out.stream_options = { include_usage: true };
    }
  }
  if (ir.userId) out.user = ir.userId;
  if (typeof ir.n === 'number') out.n = ir.n;

  if (ir.responseFormat?.type === 'json') {
    out.response_format = { type: 'json_object' };
  } else if (ir.responseFormat?.type === 'json_schema') {
    out.response_format = {
      type: 'json_schema',
      json_schema: { name: 'response', schema: ir.responseFormat.schema },
    };
  }

  if (ir.tools && ir.tools.length > 0) {
    out.tools = ir.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.parameters ?? { type: 'object', properties: {} },
      },
    }));
  }

  if (ir.toolChoice) {
    switch (ir.toolChoice.type) {
      case 'auto':
        out.tool_choice = 'auto';
        break;
      case 'any':
        out.tool_choice = 'required';
        break;
      case 'none':
        out.tool_choice = 'none';
        break;
      case 'tool':
        out.tool_choice = { type: 'function', function: { name: ir.toolChoice.name } };
        break;
    }
  }

  // Thinking is silently dropped — OpenAI reasoning models have their own
  // separate surface that isn't a flag on the chat completions request.

  return JSON.stringify(out);
}

/**
 * Fit an OpenAI Chat Completions request written for another model of the
 * dialect to `ctx.dstModel`, in place (a group pins the model; nothing is
 * translated): the reasoning-model rules serializeRequest follows, applied
 * to the app's own body so every field they don't cover is kept.
 */
function shapeRequestForModel(body: Record<string, unknown>, ctx: ModelShapingContext): void {
  // An output limit sized for the app's own model, capped at the pinned one's.
  for (const key of ['max_tokens', 'max_completion_tokens']) {
    const limit = body[key];
    if (typeof limit === 'number') body[key] = capMaxTokens(limit, ctx.dstModel, ctx.dstProviderId);
  }
  if (!isOpenAIReasoningModel(ctx.dstModel)) return;
  if (Array.isArray(body.tools) && body.tools.length > 0 && reasoningOffForTools(ctx.dstModel, ctx.dstProviderId)) {
    body.reasoning_effort = 'none';
  }
  if (typeof body.max_tokens === 'number' && usesMaxCompletionTokens(true, ctx.dstProviderId)) {
    if (typeof body.max_completion_tokens !== 'number') body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  // OpenAI: "When reasoning effort is not none, remove temperature, top_p,
  // and top_logprobs. For Chat Completions, also remove logprobs."
  if (body.reasoning_effort !== 'none') {
    delete body.temperature;
    delete body.top_p;
    delete body.logprobs;
    delete body.top_logprobs;
  }
}

/**
 * Whether a request's output cap goes in max_completion_tokens: always on
 * OpenAI, and for reasoning models on Azure OpenAI and unknown hosts (which
 * reject max_tokens). Other hosts of the dialect document max_tokens.
 */
function usesMaxCompletionTokens(isReasoning: boolean, providerId: string | undefined): boolean {
  return providerId === 'openai' || (isReasoning && (providerId == null || providerId === 'azure_openai'));
}

/**
 * True for OpenAI reasoning models (the o-series and GPT-5 onward), which
 * reject max_tokens and, unless their reasoning is off, temperature/top_p.
 * A registry entry decides for its own id. Groups accept any model id, so
 * other ids are matched by name (also behind OpenRouter's `openai/`
 * prefix): every GPT from 5 on reasons, GPT-6 included.
 */
function isOpenAIReasoningModel(model: string): boolean {
  const entry = getModel(model);
  if (entry?.family === 'openai') return entry.capabilities.reasoning;
  const id = model.replace(/^openai\//i, '');
  if (/^o\d/i.test(id)) return true;
  const gpt = /^gpt-(\d+)/i.exec(id);
  return !!gpt && Number(gpt[1]) >= 5;
}

/**
 * OpenAI models with no reasoning_effort 'none' ("GPT-6 Astra and GPT-6.1
 * Sol do not support the none reasoning effort", OpenAI's latest-model
 * guide, checked 2026-11-01; both answer 400 to it).
 */
const ALWAYS_REASONING = [/^gpt-6-astra(?![a-z0-9])/i, /^gpt-6\.1-sol(?![a-z0-9])/i];

/**
 * Whether a request with tools must turn `model`'s reasoning off. From
 * GPT-5.6 on, OpenAI's Chat Completions takes function tools only with
 * reasoning_effort 'none' (gpt-6-luna model page: "Chat Completions
 * supports function calling only with reasoning_effort set to none"; the
 * same 400 from gpt-5.6-luna, gpt-6-sol, gpt-6.1-terra, checked live
 * 2026-11-01); reasoning with tools needs the Responses API, which Byoky
 * doesn't speak. Models that can't turn reasoning off can't take tools there
 * at all: that is a TranslationError rather than the upstream's 400. Only
 * OpenAI's own API (and Azure's, and unknown hosts) are held to this; other
 * hosts serve these models their own way.
 */
function reasoningOffForTools(model: string, providerId: string | undefined): boolean {
  if (providerId != null && providerId !== 'openai' && providerId !== 'azure_openai') return false;
  const id = model.replace(/^openai\//i, '');
  const version = /^gpt-(\d+)(?:\.(\d+))?/i.exec(id);
  if (!version) return false;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  if (major < 5 || (major === 5 && minor < 6)) return false;
  if (ALWAYS_REASONING.some((re) => re.test(id))) {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      `OpenAI's Chat Completions API doesn't take tools for ${model} (only its Responses API does). Pin this app to a model that does, such as gpt-5.5 or gpt-6-luna.`,
    );
  }
  return true;
}

/**
 * Translate one IR message into one or more OpenAI messages. tool_result
 * blocks escape the enclosing user message as standalone role:'tool'
 * messages; leftover non-tool blocks stay as a user message.
 */
function serializeMessageToOpenAI(msg: IRMessage, model: string, acceptsImages: boolean): OpenAIMessage[] {
  if (msg.role === 'user') return serializeUserMessageToOpenAI(msg, model, acceptsImages);
  return serializeAssistantMessageToOpenAI(msg);
}

/**
 * OpenAI-dialect hosts whose models take image input unless the registry
 * says otherwise: OpenAI's current chat models are multimodal, and Azure
 * serves the same models. The other hosts (DeepSeek, Groq, Mistral, the
 * local servers, ...) serve many text-only models and answer an image part
 * with a 400, so an id the registry doesn't know is taken as text-only there.
 */
const VISION_BY_DEFAULT_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'azure_openai']);

/**
 * Whether the destination model takes image (and so file) input: the
 * registry's answer when it knows the model, otherwise the destination
 * host's default (VISION_BY_DEFAULT_PROVIDERS). Without a dstProviderId the
 * dialect's own host, OpenAI, is assumed. OpenRouter names OpenAI's models
 * with an `openai/` prefix, so those are looked up without it.
 */
function openAIAcceptsImages(model: string, dstProviderId: string | undefined): boolean {
  const entry =
    getModel(model) ??
    (dstProviderId === 'openrouter' && model.startsWith('openai/') ? getModel(model.slice('openai/'.length)) : undefined);
  if (entry) return entry.capabilities.vision;
  return VISION_BY_DEFAULT_PROVIDERS.has(dstProviderId ?? 'openai');
}

function serializeUserMessageToOpenAI(msg: IRMessage, model: string, acceptsImages: boolean): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  const userParts: OpenAIContentPart[] = [];
  // Tool messages take text only. Images and documents a tool returned go
  // into the user message that follows the tool messages. What the model
  // can't take is named in the tool text instead of failing the request:
  // the app resends its tool results with every later turn, so a refusal
  // here would end the conversation.
  const toolAttachments: OpenAIContentPart[] = [];

  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        userParts.push({ type: 'text', text: block.text });
        break;
      case 'image': {
        const url = irImageSourceToDataUrl(block.source);
        if (url) userParts.push({ type: 'image_url', image_url: { url } });
        break;
      }
      case 'document':
        userParts.push(irDocumentToOpenAIPart(block));
        break;
      case 'tool_result': {
        const attachments: OpenAIContentPart[] = [];
        const omitted: string[] = [];
        if (block.content.kind === 'blocks') {
          for (const inner of block.content.blocks) {
            if (inner.type === 'image') {
              if (acceptsImages) {
                attachments.push({ type: 'image_url', image_url: { url: irImageSourceToDataUrl(inner.source) } });
              } else {
                omitted.push(`[image omitted: ${model} does not accept images]`);
              }
            } else if (inner.type === 'document' && inner.source.kind !== 'text') {
              if (!acceptsImages) {
                omitted.push(`[document omitted: ${model} does not accept files]`);
              } else if (inner.source.kind === 'url') {
                omitted.push('[document omitted: chat completions cannot read a document by URL]');
              } else {
                attachments.push(irDocumentToOpenAIPart(inner));
              }
            }
          }
        }
        let text = [flattenIRToolResultContent(block.content), ...omitted].filter((t) => t.length > 0).join('\n');
        if (attachments.length > 0) {
          if (!text) text = TOOL_ATTACHMENTS_NOTE;
          toolAttachments.push({ type: 'text', text: `Attachments from tool call ${block.toolUseId}:` }, ...attachments);
        }
        out.push({ role: 'tool', tool_call_id: block.toolUseId, content: text });
        break;
      }
      // thinking/tool_use inside a user message — drop (invalid for user role)
      default:
        break;
    }
  }
  userParts.unshift(...toolAttachments);

  if (userParts.length > 0) {
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

function serializeAssistantMessageToOpenAI(msg: IRMessage): OpenAIMessage[] {
  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  for (const block of msg.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
    // thinking and tool_result inside assistant content — drop
  }
  const content = textParts.length > 0 ? textParts.join('\n') : null;
  const msgOut: OpenAIMessage = { role: 'assistant', content };
  if (toolCalls.length > 0) msgOut.tool_calls = toolCalls;
  return [msgOut];
}

function irImageSourceToDataUrl(source: IRImageSource): string {
  if (source.kind === 'base64') {
    return `data:${source.mediaType};base64,${source.data}`;
  }
  return source.url;
}

/** Stands in for the text of a tool result that returned only attachments. */
const TOOL_ATTACHMENTS_NOTE = '[The tool returned attachments; they follow in the next user message.]';

/**
 * A document as a chat-completions content part: inline file data, or text.
 * Chat completions can't fetch a document by URL.
 */
function irDocumentToOpenAIPart(doc: IRDocumentBlock): OpenAIContentPart {
  const { source } = doc;
  if (source.kind === 'text') return { type: 'text', text: source.text };
  if (source.kind === 'url') {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      'OpenAI chat completions cannot read a document by URL; send it inline.',
    );
  }
  const filename = doc.title ?? (source.mediaType === 'application/pdf' ? 'document.pdf' : 'document');
  return { type: 'file', file: { filename, file_data: `data:${source.mediaType};base64,${source.data}` } };
}

function flattenIRToolResultContent(content: IRToolResultContent): string {
  if (content.kind === 'text') return content.text;
  return content.blocks
    .map((b) => (b.type === 'text' ? b.text : b.type === 'document' && b.source.kind === 'text' ? b.source.text : ''))
    .filter((s) => s.length > 0)
    .join('\n');
}

// ─── parseResponse ───────────────────────────────────────────────────────

function parseResponse(body: string): IRResponseOrError {
  let parsed: OpenAIResponse;
  try {
    parsed = JSON.parse(body) as OpenAIResponse;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `OpenAI response body is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed.error === 'string') {
    return {
      error: {
        type: 'api_error',
        message: parsed.error,
        ...(typeof parsed.code === 'string' && parsed.code ? { code: parsed.code } : {}),
      },
    };
  }
  if (parsed.error) {
    return {
      error: {
        type: parsed.error.type ?? 'api_error',
        message: parsed.error.message ?? 'OpenAI API error',
        ...(parsed.error.code != null && parsed.error.code !== '' ? { code: String(parsed.error.code) } : {}),
        ...(typeof parsed.status === 'number' ? { status: parsed.status } : {}),
      },
    };
  }
  if (!Array.isArray(parsed.choices)) {
    const detail = parsed.message ?? parsed.detail;
    if (detail != null) {
      return {
        error: {
          type: typeof parsed.type === 'string' && parsed.type ? parsed.type : 'api_error',
          message: typeof detail === 'string' ? detail : JSON.stringify(detail),
        },
      };
    }
  }

  const choice = parsed.choices?.[0];
  const message = choice?.message;
  const blocks: IRResponseBlock[] = [];

  const text = flattenOpenAIContent(message?.content ?? null);
  if (text) blocks.push({ type: 'text', text });
  // A refusal arrives in message.refusal with content null and finish_reason
  // 'stop'; surface its text and report it as a refusal, not an empty answer.
  const refusal = typeof message?.refusal === 'string' && message.refusal.length > 0 ? message.refusal : null;
  if (refusal && !text) blocks.push({ type: 'text', text: refusal });

  if (Array.isArray(message?.tool_calls)) {
    for (const tc of message.tool_calls) {
      if (!tc || tc.type !== 'function' || !tc.function) continue;
      let input: unknown;
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        input = { _raw: tc.function.arguments };
      }
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
  }

  return {
    id: parsed.id,
    model: parsed.model,
    content: blocks,
    stopReason: refusal ? 'refusal' : mapOpenAIFinishToIR(choice?.finish_reason ?? null),
    stopSequence: null,
    usage: {
      inputTokens: parsed.usage?.prompt_tokens ?? 0,
      outputTokens: parsed.usage?.completion_tokens ?? 0,
    },
  };
}

// ─── serializeResponse ───────────────────────────────────────────────────

function serializeResponse(ctx: TranslationContext, ir: IRResponseOrError): string {
  if (isIRError(ir)) {
    return JSON.stringify({
      error: {
        message: ir.error.message,
        type: openaiErrorType(ir.error),
        code: openaiErrorCode(ir.error),
      },
    });
  }

  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  for (const block of ir.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
    // thinking blocks are dropped — OpenAI has no equivalent surface.
  }

  const out: OpenAIResponse = {
    id: ir.id ?? `chatcmpl-${ctx.requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: ctx.srcModel ?? ir.model ?? ctx.dstModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('') : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: mapIRStopToOpenAIFinish(ir.stopReason),
      },
    ],
    usage: {
      prompt_tokens: ir.usage.inputTokens,
      completion_tokens: ir.usage.outputTokens,
      total_tokens: ir.usage.inputTokens + ir.usage.outputTokens,
    },
  };
  return JSON.stringify(out);
}

function mapOpenAIFinishToIR(finish: OpenAIFinishReason | null): IRStopReason {
  switch (finish) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

function mapIRStopToOpenAIFinish(stop: IRStopReason): OpenAIFinishReason {
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
    case 'other':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    case 'error':
      return 'stop';
  }
}

// ─── createStreamParser (openai SSE → IR events) ─────────────────────────

function createStreamParser(): IRStreamParser {
  // OpenAI streams are "flat": no explicit block boundaries. We synthesize
  // content_block_start / content_block_stop events from the shape of the
  // deltas we see. Algorithm:
  //   - First chunk → message_start
  //   - content delta appears → open a text block (close any open tool blocks)
  //   - tool_calls[N] delta with id+name → open a tool_use block at N (close others)
  //   - tool_calls[N] delta with args → tool_input_delta
  //   - usage chunk → remember for final message_delta
  //   - finish_reason → remember; emitted in the message_delta at [DONE]
  //   - [DONE] → close open blocks, emit message_delta + message_stop

  const state = {
    buffer: '',
    started: false,
    done: false,
    nextBlockIndex: 0,
    textBlockIndex: null as number | null,
    textBlockOpen: false,
    toolCalls: new Map<number, ToolCallState>(),
    pendingFinish: null as IRStopReason | null,
    sawRefusal: false,
    inputTokens: 0,
    outputTokens: 0,
    messageId: '',
    model: undefined as string | undefined,
  };

  return {
    process(chunk: string): IRStreamEvent[] {
      // Normalize CRLF → LF so the frame separator is uniformly `\n\n`.
      // OpenAI streams use LF in practice; this is defensive in case any
      // OpenAI-family provider (azure_openai, etc.) sends CRLF.
      state.buffer += chunk.replace(/\r/g, '');
      const events: IRStreamEvent[] = [];
      let idx: number;
      while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
        const frame = state.buffer.slice(0, idx);
        state.buffer = state.buffer.slice(idx + 2);
        if (state.done) continue;
        processOpenAIFrame(frame, state, events);
      }
      return events;
    },
    flush(): IRStreamEvent[] {
      if (state.done) return [];
      const events: IRStreamEvent[] = [];
      closeAllOpenBlocks(state, events);
      if (state.started) {
        events.push({
          type: 'message_delta',
          stopReason: finalStopReason(state),
          usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens },
        });
        events.push({ type: 'message_stop' });
      }
      state.done = true;
      return events;
    },
  };
}

interface ToolCallState {
  blockIndex: number;
  open: boolean;
  started: boolean;
  id: string;
  name: string;
}

interface OpenAIChunkData {
  id?: string;
  model?: string;
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
  finish_reason?: OpenAIFinishReason | null;
}

interface OpenAIDeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

type OpenAIParseState = {
  buffer: string;
  started: boolean;
  done: boolean;
  nextBlockIndex: number;
  textBlockIndex: number | null;
  textBlockOpen: boolean;
  toolCalls: Map<number, ToolCallState>;
  pendingFinish: IRStopReason | null;
  /** A refusal streamed in (delta.refusal); finish_reason is still 'stop'. */
  sawRefusal: boolean;
  inputTokens: number;
  outputTokens: number;
  messageId: string;
  model: string | undefined;
};

function processOpenAIFrame(
  frame: string,
  state: OpenAIParseState,
  events: IRStreamEvent[],
): void {
  const dataLine = extractOpenAIDataLine(frame);
  if (dataLine == null) return;

  if (dataLine === '[DONE]') {
    if (state.done) return;
    closeAllOpenBlocks(state, events);
    if (state.started) {
      events.push({
        type: 'message_delta',
        stopReason: finalStopReason(state),
        usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens },
      });
      events.push({ type: 'message_stop' });
    }
    state.done = true;
    return;
  }

  let data: OpenAIChunkData;
  try {
    data = JSON.parse(dataLine) as OpenAIChunkData;
  } catch {
    return;
  }

  if (data.error) {
    state.done = true;
    events.push({
      type: 'error',
      error: {
        type: data.error.type ?? 'api_error',
        message: data.error.message ?? 'OpenAI stream error',
        ...(data.error.code ? { code: data.error.code } : {}),
      },
    });
    return;
  }

  if (!state.started) {
    state.started = true;
    if (data.id) state.messageId = data.id;
    if (data.model) state.model = data.model;
    events.push({
      type: 'message_start',
      id: state.messageId || `chatcmpl-${data.id ?? ''}`,
      model: state.model,
      usage: {},
    });
  }

  if (data.usage) {
    if (typeof data.usage.prompt_tokens === 'number') state.inputTokens = data.usage.prompt_tokens;
    if (typeof data.usage.completion_tokens === 'number') state.outputTokens = data.usage.completion_tokens;
  }

  const choice = data.choices?.[0];
  if (!choice) return;

  const delta = choice.delta;
  if (delta) {
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      handleTextDelta(state, events, delta.content);
    }
    if (typeof delta.refusal === 'string' && delta.refusal.length > 0) {
      handleTextDelta(state, events, delta.refusal);
      state.sawRefusal = true;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        handleToolCallDelta(state, events, tc);
      }
    }
  }

  if (choice.finish_reason) {
    state.pendingFinish = mapOpenAIFinishToIR(choice.finish_reason);
  }
}

function finalStopReason(state: OpenAIParseState): IRStopReason {
  return state.sawRefusal ? 'refusal' : state.pendingFinish ?? 'end_turn';
}

function extractOpenAIDataLine(frame: string): string | null {
  const lines = frame.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) return line.slice(6);
    if (line.startsWith('data:')) return line.slice(5).trimStart();
  }
  return null;
}

function handleTextDelta(
  state: OpenAIParseState,
  events: IRStreamEvent[],
  text: string,
): void {
  if (!state.textBlockOpen) {
    // Close any open tool blocks before opening the text block — the IR
    // invariant is one open block at a time.
    closeAllOpenBlocksExcept(state, events, 'text');
    state.textBlockIndex = state.nextBlockIndex++;
    state.textBlockOpen = true;
    events.push({
      type: 'content_block_start',
      index: state.textBlockIndex,
      block: { type: 'text' },
    });
  }
  events.push({ type: 'text_delta', index: state.textBlockIndex!, text });
}

function handleToolCallDelta(
  state: OpenAIParseState,
  events: IRStreamEvent[],
  tc: OpenAIDeltaToolCall,
): void {
  if (!tc || typeof tc.index !== 'number') return;

  let entry = state.toolCalls.get(tc.index);
  if (!entry) {
    entry = {
      blockIndex: -1,
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

  if (!entry.started && entry.id && entry.name) {
    closeAllOpenBlocksExcept(state, events, tc.index);
    entry.blockIndex = state.nextBlockIndex++;
    entry.started = true;
    entry.open = true;
    events.push({
      type: 'content_block_start',
      index: entry.blockIndex,
      block: { type: 'tool_use', id: entry.id, name: entry.name },
    });
  }

  const args = tc.function?.arguments;
  if (typeof args === 'string' && args.length > 0 && entry.open) {
    events.push({ type: 'tool_input_delta', index: entry.blockIndex, partialJson: args });
  }
}

function closeAllOpenBlocks(state: OpenAIParseState, events: IRStreamEvent[]): void {
  if (state.textBlockOpen && state.textBlockIndex != null) {
    events.push({ type: 'content_block_stop', index: state.textBlockIndex });
    state.textBlockOpen = false;
  }
  for (const entry of state.toolCalls.values()) {
    if (entry.open) {
      events.push({ type: 'content_block_stop', index: entry.blockIndex });
      entry.open = false;
    }
  }
}

/**
 * Close every open block except the one identified by `keep`. Used when
 * switching active blocks: 'text' keeps the text block open; a number keeps
 * the tool call at that openai index open.
 */
function closeAllOpenBlocksExcept(
  state: OpenAIParseState,
  events: IRStreamEvent[],
  keep: 'text' | number,
): void {
  if (keep !== 'text' && state.textBlockOpen && state.textBlockIndex != null) {
    events.push({ type: 'content_block_stop', index: state.textBlockIndex });
    state.textBlockOpen = false;
  }
  for (const [idx, entry] of state.toolCalls.entries()) {
    if (idx === keep) continue;
    if (entry.open) {
      events.push({ type: 'content_block_stop', index: entry.blockIndex });
      entry.open = false;
    }
  }
}

// ─── createStreamSerializer (IR events → openai SSE) ─────────────────────

function createStreamSerializer(ctx: TranslationContext): IRStreamSerializer {
  const state = {
    messageId: `chatcmpl-${ctx.requestId}`,
    model: ctx.srcModel ?? ctx.dstModel,
    created: Math.floor(Date.now() / 1000),
    toolCallIndices: new Map<number, number>(),
    nextToolCallIndex: 0,
    inputTokens: 0,
    outputTokens: 0,
    done: false,
  };

  return {
    process(events: IRStreamEvent[]): string {
      let out = '';
      for (const event of events) {
        out += handleSerializeEvent(event, state, ctx);
      }
      return out;
    },
    flush(): string {
      if (state.done) return '';
      let out = '';
      out += emitChunk(state, {}, null);
      out += emitUsageChunk(state);
      out += 'data: [DONE]\n\n';
      state.done = true;
      return out;
    },
  };
}

interface OpenAIStreamSerState {
  messageId: string;
  model: string;
  created: number;
  toolCallIndices: Map<number, number>;
  nextToolCallIndex: number;
  inputTokens: number;
  outputTokens: number;
  done: boolean;
}

function handleSerializeEvent(
  event: IRStreamEvent,
  state: OpenAIStreamSerState,
  _ctx: TranslationContext,
): string {
  if (state.done) return '';
  switch (event.type) {
    case 'message_start': {
      if (event.id) state.messageId = event.id;
      if (typeof event.usage.inputTokens === 'number') state.inputTokens = event.usage.inputTokens;
      if (typeof event.usage.outputTokens === 'number') state.outputTokens = event.usage.outputTokens;
      return emitChunk(state, { role: 'assistant', content: '' }, null);
    }
    case 'content_block_start': {
      if (event.block.type === 'tool_use') {
        const toolIndex = state.nextToolCallIndex++;
        state.toolCallIndices.set(event.index, toolIndex);
        return emitChunk(
          state,
          {
            tool_calls: [
              {
                index: toolIndex,
                id: event.block.id,
                type: 'function',
                function: { name: event.block.name, arguments: '' },
              },
            ],
          },
          null,
        );
      }
      // text / thinking — no equivalent "block start" in openai; nothing to emit
      return '';
    }
    case 'text_delta':
      return emitChunk(state, { content: event.text }, null);
    case 'tool_input_delta': {
      const toolIndex = state.toolCallIndices.get(event.index);
      if (toolIndex == null) return '';
      return emitChunk(
        state,
        {
          tool_calls: [
            {
              index: toolIndex,
              function: { arguments: event.partialJson },
            },
          ],
        },
        null,
      );
    }
    case 'thinking_delta':
      // OpenAI has no surface for thinking content in streaming chunks — drop.
      return '';
    case 'content_block_stop':
      // OpenAI has no explicit block boundary — drop.
      return '';
    case 'message_delta': {
      if (typeof event.usage?.inputTokens === 'number') state.inputTokens = event.usage.inputTokens;
      if (typeof event.usage?.outputTokens === 'number') state.outputTokens = event.usage.outputTokens;
      const finish = mapIRStopToOpenAIFinish(event.stopReason ?? 'end_turn');
      return emitChunk(state, {}, finish);
    }
    case 'message_stop': {
      state.done = true;
      let out = emitUsageChunk(state);
      out += 'data: [DONE]\n\n';
      return out;
    }
    case 'error': {
      state.done = true;
      const errChunk = {
        error: {
          message: event.error.message,
          type: openaiErrorType(event.error),
          code: openaiErrorCode(event.error),
        },
      };
      return `data: ${JSON.stringify(errChunk)}\n\ndata: [DONE]\n\n`;
    }
  }
}

interface OpenAIStreamDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: OpenAIStreamDeltaToolCall[];
}

interface OpenAIStreamDeltaToolCall {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

function emitChunk(
  state: OpenAIStreamSerState,
  delta: OpenAIStreamDelta,
  finish: OpenAIFinishReason | null,
): string {
  const chunk = {
    id: state.messageId,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finish,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function emitUsageChunk(state: OpenAIStreamSerState): string {
  const chunk = {
    id: state.messageId,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [],
    usage: {
      prompt_tokens: state.inputTokens,
      completion_tokens: state.outputTokens,
      total_tokens: state.inputTokens + state.outputTokens,
    },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}
