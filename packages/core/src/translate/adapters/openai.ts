import type { TranslationContext } from '../types.js';
import { TranslationError } from '../types.js';
import { getModel } from '../../models.js';
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
  IRToolResultContent,
} from '../ir.js';
import { isIRError } from '../ir.js';

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
      return u.pathname === CHAT_ENDPOINT || u.pathname.endsWith(CHAT_ENDPOINT);
    } catch {
      return false;
    }
  },

  buildChatUrl(base: string): string {
    return `${base.replace(/\/$/, '')}${CHAT_ENDPOINT}`;
  },

  parseRequest,
  serializeRequest,
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
  stop?: string | string[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  user?: string;
  n?: number;
  response_format?: { type: string; json_schema?: { schema?: unknown; name?: string } };
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
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
  error?: { message?: string; type?: string; code?: string };
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

  // Split system messages from the conversation; the IR puts system at top level.
  const conversation: OpenAIMessage[] = [];
  if (Array.isArray(parsed.messages)) {
    for (const m of parsed.messages) {
      if (m && m.role === 'system') {
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
  if (parsed.stop !== undefined) {
    ir.stopSequences = Array.isArray(parsed.stop) ? parsed.stop : [parsed.stop];
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
    }
  }
  return out;
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
  for (const msg of ir.messages) {
    for (const wire of serializeMessageToOpenAI(msg)) {
      out.messages!.push(wire);
    }
  }

  // Sampling params. OpenAI reasoning models reject max_tokens and
  // temperature/top_p — fall back to max_completion_tokens and drop
  // sampling overrides.
  const dst = getModel(ctx.dstModel);
  const isReasoningDst = dst?.capabilities.reasoning === true;
  if (typeof ir.maxTokens === 'number') {
    if (isReasoningDst) out.max_completion_tokens = ir.maxTokens;
    else out.max_tokens = ir.maxTokens;
  }
  if (typeof ir.temperature === 'number' && !isReasoningDst) {
    out.temperature = ir.temperature;
  }
  if (typeof ir.topP === 'number' && !isReasoningDst) out.top_p = ir.topP;
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
 * Translate one IR message into one or more OpenAI messages. tool_result
 * blocks escape the enclosing user message as standalone role:'tool'
 * messages; leftover non-tool blocks stay as a user message.
 */
function serializeMessageToOpenAI(msg: IRMessage): OpenAIMessage[] {
  if (msg.role === 'user') return serializeUserMessageToOpenAI(msg);
  return serializeAssistantMessageToOpenAI(msg);
}

function serializeUserMessageToOpenAI(msg: IRMessage): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  const userParts: OpenAIContentPart[] = [];

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
      case 'tool_result':
        out.push({
          role: 'tool',
          tool_call_id: block.toolUseId,
          content: flattenIRToolResultContent(block.content),
        });
        break;
      // thinking/tool_use inside a user message — drop (invalid for user role)
      default:
        break;
    }
  }

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

function flattenIRToolResultContent(content: IRToolResultContent): string {
  if (content.kind === 'text') return content.text;
  return content.blocks
    .map((b) => (b.type === 'text' ? b.text : ''))
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

  if (parsed.error) {
    return {
      error: {
        type: parsed.error.type ?? 'api_error',
        message: parsed.error.message ?? 'OpenAI API error',
        ...(parsed.error.code ? { code: parsed.error.code } : {}),
      },
    };
  }

  const choice = parsed.choices?.[0];
  const message = choice?.message;
  const blocks: IRResponseBlock[] = [];

  const text = flattenOpenAIContent(message?.content ?? null);
  if (text) blocks.push({ type: 'text', text });

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
    stopReason: mapOpenAIFinishToIR(choice?.finish_reason ?? null),
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
        type: ir.error.type,
        code: ir.error.code ?? null,
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
          stopReason: state.pendingFinish ?? 'end_turn',
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
        stopReason: state.pendingFinish ?? 'end_turn',
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
          type: event.error.type,
          code: event.error.code ?? null,
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
