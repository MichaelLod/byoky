import type { TranslationContext } from '../types.js';
import { TranslationError } from '../types.js';
import type { FamilyAdapter, IRStreamParser, IRStreamSerializer } from '../adapter.js';
import type {
  IRRequest,
  IRMessage,
  IRContentBlock,
  IRResponseOrError,
  IRResponseBlock,
  IRStreamEvent,
  IRStopReason,
  IRImageSource,
  IRToolResultContent,
} from '../ir.js';
import { isIRError } from '../ir.js';

/**
 * Cohere v2 Chat adapter.
 *
 * Endpoint: POST /v2/chat (streaming toggled by body `stream: true`).
 *
 * Key quirks:
 *  - v2 uses OpenAI-style `tools[].function.parameters` (JSON Schema). The v1
 *    `parameter_definitions` shape still surfaces in old tutorials — don't.
 *  - `tool_plan` is pre-tool-call reasoning text; maps to IR thinking with
 *    `toolPlanning: true` so the block round-trips if destination is cohere.
 *  - Streaming event names live in the JSON `type` field, not SSE `event:`
 *    lines. Standard SSE discriminators would see every frame as default.
 *  - Tool-call args ARE deltaed (string fragments) across `tool-call-delta`.
 *  - Stream errors arrive on `message-end` with finish_reason:'ERROR',
 *    not a separate event type.
 *  - Tool results use `role:'tool'` with `tool_call_id`; content shape is
 *    either a plain string or `[{type:'document', document:{data:'...'}}]`.
 *  - `p` / `k` are top_p / top_k (single letters).
 *  - Usage is `usage.tokens.{input,output}_tokens`, distinct from
 *    `usage.billed_units.*` which is for billing.
 *  - `tool_choice` has no 'auto' — omit the field for default behaviour;
 *    only `REQUIRED` and `NONE` are explicit.
 */

const CHAT_ENDPOINT = '/v2/chat';

export const cohereAdapter: FamilyAdapter = {
  family: 'cohere',
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

interface CohereRequest {
  model?: string;
  stream?: boolean;
  messages?: CohereMessage[];
  tools?: CohereTool[];
  tool_choice?: 'REQUIRED' | 'NONE';
  response_format?: { type: string; json_schema?: unknown };
  temperature?: number;
  max_tokens?: number;
  p?: number;
  k?: number;
  stop_sequences?: string[];
  seed?: number;
  thinking?: { type?: 'enabled'; token_budget?: number };
}

type CohereMessage =
  | { role: 'system'; content: CohereContent }
  | { role: 'user'; content: CohereContent }
  | {
      role: 'assistant';
      content?: CohereAssistantContent;
      tool_plan?: string;
      tool_calls?: CohereToolCall[];
    }
  | { role: 'tool'; tool_call_id: string; content: CohereToolResultContent };

type CohereContent = string | Array<CohereUserContentPart>;
type CohereUserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } | string };

type CohereAssistantContent = Array<{ type: 'text'; text: string } | { type: 'thinking'; thinking: string }>;

type CohereToolResultContent =
  | string
  | Array<{ type: 'document'; document: { data: string; id?: string } } | { type: 'text'; text: string }>;

interface CohereToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface CohereTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

interface CohereResponse {
  id?: string;
  finish_reason?: CohereFinishReason;
  message?: {
    role?: 'assistant';
    tool_plan?: string;
    tool_calls?: CohereToolCall[];
    content?: CohereAssistantContent;
    citations?: unknown;
  };
  usage?: {
    billed_units?: { input_tokens?: number; output_tokens?: number };
    tokens?: { input_tokens?: number; output_tokens?: number };
  };
  message_error?: string;
}

type CohereFinishReason =
  | 'COMPLETE'
  | 'STOP_SEQUENCE'
  | 'MAX_TOKENS'
  | 'TOOL_CALL'
  | 'ERROR'
  | 'TIMEOUT';

// ─── parseRequest ─────────────────────────────────────────────────────────

function parseRequest(body: string): IRRequest {
  let parsed: CohereRequest;
  try {
    parsed = JSON.parse(body) as CohereRequest;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `Cohere request body is not valid JSON: ${(err as Error).message}`,
    );
  }

  const ir: IRRequest = {
    model: parsed.model,
    system: [],
    messages: [],
  };

  if (Array.isArray(parsed.messages)) {
    ir.messages = translateCohereConversationToIR(parsed.messages, ir);
  }

  if (typeof parsed.temperature === 'number') ir.temperature = parsed.temperature;
  if (typeof parsed.p === 'number') ir.topP = parsed.p;
  if (typeof parsed.k === 'number') ir.topK = parsed.k;
  if (typeof parsed.max_tokens === 'number') ir.maxTokens = parsed.max_tokens;
  if (Array.isArray(parsed.stop_sequences) && parsed.stop_sequences.length > 0) {
    ir.stopSequences = parsed.stop_sequences.slice();
  }
  if (typeof parsed.stream === 'boolean') ir.stream = parsed.stream;

  if (parsed.response_format) {
    if (parsed.response_format.type === 'json_object') {
      if (parsed.response_format.json_schema) {
        ir.responseFormat = { type: 'json_schema', schema: parsed.response_format.json_schema };
      } else {
        ir.responseFormat = { type: 'json' };
      }
    }
  }

  if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    ir.tools = parsed.tools
      .filter((t) => t && t.type === 'function' && t.function)
      .map((t) => ({
        name: t.function.name,
        ...(t.function.description ? { description: t.function.description } : {}),
        parameters: t.function.parameters ?? { type: 'object', properties: {} },
      }));
  }

  // Cohere has no 'auto' — omitting is auto. Only REQUIRED / NONE are explicit.
  if (parsed.tool_choice === 'REQUIRED') {
    ir.toolChoice = { type: 'any' };
  } else if (parsed.tool_choice === 'NONE') {
    ir.toolChoice = { type: 'none' };
  }

  if (parsed.thinking && parsed.thinking.type === 'enabled') {
    ir.thinking = {
      enabled: true,
      ...(typeof parsed.thinking.token_budget === 'number'
        ? { budgetTokens: parsed.thinking.token_budget }
        : {}),
    };
  }

  return ir;
}

function translateCohereConversationToIR(
  messages: CohereMessage[],
  ir: IRRequest,
): IRMessage[] {
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
      case 'system': {
        const text = flattenCohereContent(m.content);
        if (text) ir.system.push({ text });
        break;
      }
      case 'tool': {
        pendingToolResults.push({
          type: 'tool_result',
          toolUseId: m.tool_call_id,
          content: { kind: 'text', text: flattenCohereToolResultContent(m.content) },
        });
        break;
      }
      case 'user': {
        const blocks = parseCohereUserContent(m.content);
        if (pendingToolResults.length > 0) {
          out.push({ role: 'user', content: [...pendingToolResults, ...blocks] });
          pendingToolResults = [];
        } else {
          out.push({ role: 'user', content: blocks });
        }
        break;
      }
      case 'assistant': {
        flushPending();
        out.push(parseCohereAssistantMessage(m));
        break;
      }
    }
  }

  flushPending();
  return out;
}

function parseCohereUserContent(content: CohereContent): IRContentBlock[] {
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
      const url = extractCohereImageUrl(part.image_url);
      const source = parseImageUrl(url);
      if (source) out.push({ type: 'image', source });
    }
  }
  return out;
}

function parseCohereAssistantMessage(m: Extract<CohereMessage, { role: 'assistant' }>): IRMessage {
  const blocks: IRContentBlock[] = [];

  // tool_plan becomes a thinking block flagged as toolPlanning.
  if (m.tool_plan && m.tool_plan.length > 0) {
    blocks.push({ type: 'thinking', text: m.tool_plan, toolPlanning: true });
  }

  // content can contain text and thinking blocks.
  if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
        blocks.push({ type: 'text', text: (part as { text: string }).text });
      } else if (part.type === 'thinking' && typeof (part as { thinking?: unknown }).thinking === 'string') {
        blocks.push({ type: 'thinking', text: (part as { thinking: string }).thinking });
      }
    }
  }

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

function flattenCohereContent(content: CohereContent | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && p.type === 'text' ? (p as { text?: string }).text ?? '' : ''))
    .filter((s) => s.length > 0)
    .join('\n');
}

function flattenCohereToolResultContent(content: CohereToolResultContent | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => {
      if (!p || typeof p !== 'object') return '';
      if (p.type === 'document' && p.document && typeof p.document.data === 'string') {
        return p.document.data;
      }
      if (p.type === 'text' && typeof (p as { text?: unknown }).text === 'string') {
        return (p as { text: string }).text;
      }
      return '';
    })
    .filter((s) => s.length > 0)
    .join('\n');
}

function extractCohereImageUrl(image_url: { url: string } | string): string {
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
  if (typeof ir.n === 'number' && ir.n > 1) {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      'Cohere v2 does not support generating multiple completions per request.',
    );
  }

  const messages: CohereMessage[] = [];

  // System parts become leading system messages (each gets its own or joined).
  if (ir.system.length > 0) {
    const text = ir.system.map((p) => p.text).join('\n\n');
    if (text) messages.push({ role: 'system', content: text });
  }

  for (const msg of ir.messages) {
    for (const wire of serializeMessageToCohere(msg)) {
      messages.push(wire);
    }
  }

  const out: CohereRequest = {
    model: ctx.dstModel,
    messages,
  };

  if (typeof ir.maxTokens === 'number') out.max_tokens = ir.maxTokens;
  if (typeof ir.temperature === 'number') out.temperature = ir.temperature;
  if (typeof ir.topP === 'number') out.p = ir.topP;
  if (typeof ir.topK === 'number') out.k = ir.topK;
  if (ir.stopSequences && ir.stopSequences.length > 0) out.stop_sequences = ir.stopSequences.slice();
  if (typeof ir.stream === 'boolean') out.stream = ir.stream;

  if (ir.responseFormat?.type === 'json') {
    out.response_format = { type: 'json_object' };
  } else if (ir.responseFormat?.type === 'json_schema') {
    out.response_format = { type: 'json_object', json_schema: ir.responseFormat.schema };
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
      case 'any':
        out.tool_choice = 'REQUIRED';
        break;
      case 'tool':
        // Cohere has no named forced tool. Silently downgrading "force tool
        // X" to REQUIRED (any tool) lets the destination model invoke the
        // wrong tool, which breaks app logic with no signal to the caller.
        // Fail loud so the caller knows their constraint can't be honored.
        throw new TranslationError(
          'UNSUPPORTED_FEATURE',
          'Cohere does not support forcing a specific tool by name.',
        );
      case 'none':
        out.tool_choice = 'NONE';
        break;
      // 'auto' — omit field for default.
    }
  }

  if (ir.thinking?.enabled) {
    out.thinking = {
      type: 'enabled',
      ...(typeof ir.thinking.budgetTokens === 'number'
        ? { token_budget: ir.thinking.budgetTokens }
        : {}),
    };
  }

  return JSON.stringify(out);
}

function serializeMessageToCohere(msg: IRMessage): CohereMessage[] {
  if (msg.role === 'user') return serializeUserMessageToCohere(msg);
  return serializeAssistantMessageToCohere(msg);
}

function serializeUserMessageToCohere(msg: IRMessage): CohereMessage[] {
  const out: CohereMessage[] = [];
  const userParts: CohereUserContentPart[] = [];

  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        userParts.push({ type: 'text', text: block.text });
        break;
      case 'image': {
        const url = irImageSourceToUrl(block.source);
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

function serializeAssistantMessageToCohere(msg: IRMessage): CohereMessage[] {
  const contentParts: CohereAssistantContent = [];
  const toolCalls: CohereToolCall[] = [];
  let toolPlan: string | undefined;

  for (const block of msg.content) {
    if (block.type === 'text') {
      contentParts.push({ type: 'text', text: block.text });
    } else if (block.type === 'thinking') {
      if (block.toolPlanning) {
        toolPlan = (toolPlan ?? '') + block.text;
      } else {
        contentParts.push({ type: 'thinking', thinking: block.text });
      }
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }

  const msgOut: Extract<CohereMessage, { role: 'assistant' }> = {
    role: 'assistant',
    content: contentParts,
  };
  if (toolPlan) msgOut.tool_plan = toolPlan;
  if (toolCalls.length > 0) msgOut.tool_calls = toolCalls;
  return [msgOut];
}

function irImageSourceToUrl(source: IRImageSource): string {
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

// ─── parseResponse ────────────────────────────────────────────────────────

function parseResponse(body: string): IRResponseOrError {
  let parsed: CohereResponse & { message?: string };
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `Cohere response body is not valid JSON: ${(err as Error).message}`,
    );
  }

  // Error responses for cohere are non-streaming { message: "..." } or similar.
  // When the body has no `message.role` but has a top-level `message` string
  // or `data: null`, treat as error.
  if (typeof parsed.message === 'string') {
    return {
      error: {
        type: 'api_error',
        message: parsed.message,
      },
    };
  }
  const msg = parsed.message as CohereResponse['message'] | undefined;
  if (!msg || msg.role !== 'assistant') {
    return {
      error: {
        type: 'api_error',
        message: 'Cohere returned an unexpected response shape',
      },
    };
  }

  const blocks: IRResponseBlock[] = [];

  // tool_plan first, as a thinking block.
  if (typeof msg.tool_plan === 'string' && msg.tool_plan.length > 0) {
    blocks.push({ type: 'thinking', text: msg.tool_plan, toolPlanning: true });
  }

  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
        blocks.push({ type: 'text', text: (part as { text: string }).text });
      } else if (part.type === 'thinking' && typeof (part as { thinking?: unknown }).thinking === 'string') {
        blocks.push({ type: 'thinking', text: (part as { thinking: string }).thinking });
      }
    }
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
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

  const tokens = parsed.usage?.tokens;
  return {
    id: parsed.id,
    content: blocks,
    stopReason: mapCohereFinishToIR(parsed.finish_reason),
    stopSequence: null,
    usage: {
      inputTokens: tokens?.input_tokens ?? 0,
      outputTokens: tokens?.output_tokens ?? 0,
    },
  };
}

// ─── serializeResponse ───────────────────────────────────────────────────

function serializeResponse(ctx: TranslationContext, ir: IRResponseOrError): string {
  if (isIRError(ir)) {
    return JSON.stringify({ message: ir.error.message });
  }

  const contentParts: CohereAssistantContent = [];
  const toolCalls: CohereToolCall[] = [];
  let toolPlan: string | undefined;

  for (const block of ir.content) {
    if (block.type === 'text') {
      contentParts.push({ type: 'text', text: block.text });
    } else if (block.type === 'thinking') {
      if (block.toolPlanning) {
        toolPlan = (toolPlan ?? '') + block.text;
      } else {
        contentParts.push({ type: 'thinking', thinking: block.text });
      }
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }

  const out = {
    id: ir.id ?? `msg_${ctx.requestId}`,
    finish_reason: mapIRStopToCohere(ir.stopReason),
    message: {
      role: 'assistant' as const,
      content: contentParts,
      ...(toolPlan ? { tool_plan: toolPlan } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    usage: {
      tokens: {
        input_tokens: ir.usage.inputTokens,
        output_tokens: ir.usage.outputTokens,
      },
      billed_units: {
        input_tokens: ir.usage.inputTokens,
        output_tokens: ir.usage.outputTokens,
      },
    },
  };
  return JSON.stringify(out);
}

function mapCohereFinishToIR(finish: CohereFinishReason | undefined): IRStopReason {
  switch (finish) {
    case 'COMPLETE':
      return 'end_turn';
    case 'STOP_SEQUENCE':
      return 'stop_sequence';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'TOOL_CALL':
      return 'tool_use';
    case 'ERROR':
      return 'error';
    case 'TIMEOUT':
      return 'other';
    default:
      return 'end_turn';
  }
}

function mapIRStopToCohere(stop: IRStopReason): CohereFinishReason {
  switch (stop) {
    case 'end_turn':
      return 'COMPLETE';
    case 'max_tokens':
      return 'MAX_TOKENS';
    case 'stop_sequence':
      return 'STOP_SEQUENCE';
    case 'tool_use':
      return 'TOOL_CALL';
    case 'error':
      return 'ERROR';
    case 'refusal':
      return 'ERROR';
    case 'other':
      return 'COMPLETE';
  }
}

// ─── createStreamParser ───────────────────────────────────────────────────

function createStreamParser(): IRStreamParser {
  // Cohere emits explicit content-start / content-end and tool-call-start /
  // tool-call-end events, so we don't need to synthesize scaffolding from
  // deltas. We do have to map the indices (cohere's own index namespace) to
  // IR content_block indices.
  //
  // Event names live in the JSON `type` field, not in SSE `event:` lines.

  const state = {
    buffer: '',
    started: false,
    done: false,
    messageId: '',
    // cohere index → IR block index
    textBlocks: new Map<number, number>(),
    toolBlocks: new Map<number, { blockIndex: number; id: string; name: string }>(),
    toolPlanOpen: false,
    toolPlanIndex: null as number | null,
    nextBlockIndex: 0,
  };

  return {
    process(chunk: string): IRStreamEvent[] {
      // Normalize CRLF → LF so the frame separator is uniformly `\n\n`.
      // Defensive — SSE canonical form is CRLF and some providers honor it.
      state.buffer += chunk.replace(/\r/g, '');
      const events: IRStreamEvent[] = [];
      let idx: number;
      while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
        const frame = state.buffer.slice(0, idx);
        state.buffer = state.buffer.slice(idx + 2);
        if (state.done) continue;
        processCohereFrame(frame, state, events);
      }
      return events;
    },
    flush(): IRStreamEvent[] {
      if (state.done) return [];
      state.done = true;
      return [];
    },
  };
}

type CohereParseState = {
  buffer: string;
  started: boolean;
  done: boolean;
  messageId: string;
  textBlocks: Map<number, number>;
  toolBlocks: Map<number, { blockIndex: number; id: string; name: string }>;
  toolPlanOpen: boolean;
  toolPlanIndex: number | null;
  nextBlockIndex: number;
};

interface CohereStreamFrame {
  type?: string;
  id?: string;
  index?: number;
  delta?: {
    message?: {
      role?: string;
      content?: { type?: string; text?: string };
      tool_plan?: string;
      tool_calls?: {
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      };
    };
    finish_reason?: CohereFinishReason;
    usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
    error?: string;
  };
}

function processCohereFrame(
  frame: string,
  state: CohereParseState,
  events: IRStreamEvent[],
): void {
  const dataLine = extractCohereDataLine(frame);
  if (dataLine == null) return;

  let data: CohereStreamFrame;
  try {
    data = JSON.parse(dataLine) as CohereStreamFrame;
  } catch {
    return;
  }

  switch (data.type) {
    case 'message-start': {
      if (state.started) return;
      state.started = true;
      state.messageId = data.id ?? '';
      events.push({
        type: 'message_start',
        id: state.messageId,
        usage: {},
      });
      return;
    }
    case 'content-start': {
      if (typeof data.index !== 'number') return;
      const blockIdx = state.nextBlockIndex++;
      state.textBlocks.set(data.index, blockIdx);
      events.push({
        type: 'content_block_start',
        index: blockIdx,
        block: { type: 'text' },
      });
      return;
    }
    case 'content-delta': {
      if (typeof data.index !== 'number') return;
      const blockIdx = state.textBlocks.get(data.index);
      if (blockIdx == null) return;
      const text = data.delta?.message?.content?.text;
      if (typeof text === 'string' && text.length > 0) {
        events.push({ type: 'text_delta', index: blockIdx, text });
      }
      return;
    }
    case 'content-end': {
      if (typeof data.index !== 'number') return;
      const blockIdx = state.textBlocks.get(data.index);
      if (blockIdx == null) return;
      events.push({ type: 'content_block_stop', index: blockIdx });
      state.textBlocks.delete(data.index);
      return;
    }
    case 'tool-plan-delta': {
      const text = data.delta?.message?.tool_plan;
      if (typeof text !== 'string' || text.length === 0) return;
      if (!state.toolPlanOpen) {
        state.toolPlanIndex = state.nextBlockIndex++;
        state.toolPlanOpen = true;
        events.push({
          type: 'content_block_start',
          index: state.toolPlanIndex,
          block: { type: 'thinking', toolPlanning: true },
        });
      }
      events.push({ type: 'thinking_delta', index: state.toolPlanIndex!, text });
      return;
    }
    case 'tool-call-start': {
      // Close any open tool_plan block first.
      if (state.toolPlanOpen && state.toolPlanIndex != null) {
        events.push({ type: 'content_block_stop', index: state.toolPlanIndex });
        state.toolPlanOpen = false;
        state.toolPlanIndex = null;
      }
      if (typeof data.index !== 'number') return;
      const tc = data.delta?.message?.tool_calls;
      if (!tc || !tc.id || !tc.function?.name) return;
      const blockIdx = state.nextBlockIndex++;
      state.toolBlocks.set(data.index, {
        blockIndex: blockIdx,
        id: tc.id,
        name: tc.function.name,
      });
      events.push({
        type: 'content_block_start',
        index: blockIdx,
        block: { type: 'tool_use', id: tc.id, name: tc.function.name },
      });
      return;
    }
    case 'tool-call-delta': {
      if (typeof data.index !== 'number') return;
      const entry = state.toolBlocks.get(data.index);
      if (!entry) return;
      const args = data.delta?.message?.tool_calls?.function?.arguments;
      if (typeof args === 'string' && args.length > 0) {
        events.push({ type: 'tool_input_delta', index: entry.blockIndex, partialJson: args });
      }
      return;
    }
    case 'tool-call-end': {
      if (typeof data.index !== 'number') return;
      const entry = state.toolBlocks.get(data.index);
      if (!entry) return;
      events.push({ type: 'content_block_stop', index: entry.blockIndex });
      state.toolBlocks.delete(data.index);
      return;
    }
    case 'message-end': {
      // Close any lingering tool_plan block.
      if (state.toolPlanOpen && state.toolPlanIndex != null) {
        events.push({ type: 'content_block_stop', index: state.toolPlanIndex });
        state.toolPlanOpen = false;
        state.toolPlanIndex = null;
      }

      // Errors surface here rather than as a dedicated event.
      if (data.delta?.error) {
        events.push({
          type: 'error',
          error: { type: 'api_error', message: data.delta.error },
        });
        state.done = true;
        return;
      }

      const stopReason = mapCohereFinishToIR(data.delta?.finish_reason);
      const tokens = data.delta?.usage?.tokens;
      events.push({
        type: 'message_delta',
        stopReason,
        ...(tokens
          ? {
              usage: {
                inputTokens: tokens.input_tokens ?? 0,
                outputTokens: tokens.output_tokens ?? 0,
              },
            }
          : {}),
      });
      events.push({ type: 'message_stop' });
      state.done = true;
      return;
    }
    default:
      // citation-start, citation-end, debug, etc. — drop.
      return;
  }
}

function extractCohereDataLine(frame: string): string | null {
  const lines = frame.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) return line.slice(6);
    if (line.startsWith('data:')) return line.slice(5).trimStart();
  }
  return null;
}

// ─── createStreamSerializer ───────────────────────────────────────────────

function createStreamSerializer(ctx: TranslationContext): IRStreamSerializer {
  const state = {
    messageId: `msg_${ctx.requestId}`,
    nextCohereIndex: 0,
    // IR block index → { cohereIndex, kind }
    blocks: new Map<number, { cohereIndex: number; kind: 'text' | 'tool_use' | 'thinking' }>(),
    done: false,
    inputTokens: 0,
    outputTokens: 0,
    pendingFinish: 'COMPLETE' as CohereFinishReason,
  };

  function emitFrame(data: object): string {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  return {
    process(events: IRStreamEvent[]): string {
      let out = '';
      for (const event of events) {
        if (state.done) break;
        out += serializeCohereStreamEvent(event, state, emitFrame);
      }
      return out;
    },
    flush(): string {
      // Cohere has no terminal sentinel beyond message-end.
      state.done = true;
      return '';
    },
  };
}

function serializeCohereStreamEvent(
  event: IRStreamEvent,
  state: {
    messageId: string;
    nextCohereIndex: number;
    blocks: Map<number, { cohereIndex: number; kind: 'text' | 'tool_use' | 'thinking' }>;
    done: boolean;
    inputTokens: number;
    outputTokens: number;
    pendingFinish: CohereFinishReason;
  },
  emitFrame: (d: object) => string,
): string {
  switch (event.type) {
    case 'message_start':
      if (event.id) state.messageId = event.id;
      if (typeof event.usage.inputTokens === 'number') state.inputTokens = event.usage.inputTokens;
      if (typeof event.usage.outputTokens === 'number') state.outputTokens = event.usage.outputTokens;
      return emitFrame({
        type: 'message-start',
        id: state.messageId,
        delta: { message: { role: 'assistant' } },
      });
    case 'content_block_start': {
      const cohereIndex = state.nextCohereIndex++;
      if (event.block.type === 'text') {
        state.blocks.set(event.index, { cohereIndex, kind: 'text' });
        return emitFrame({
          type: 'content-start',
          index: cohereIndex,
          delta: { message: { content: { type: 'text', text: '' } } },
        });
      }
      if (event.block.type === 'tool_use') {
        state.blocks.set(event.index, { cohereIndex, kind: 'tool_use' });
        return emitFrame({
          type: 'tool-call-start',
          index: cohereIndex,
          delta: {
            message: {
              tool_calls: {
                id: event.block.id,
                type: 'function',
                function: { name: event.block.name, arguments: '' },
              },
            },
          },
        });
      }
      // thinking — handled via tool-plan-delta frames; no start event emitted.
      state.blocks.set(event.index, { cohereIndex, kind: 'thinking' });
      return '';
    }
    case 'text_delta': {
      const entry = state.blocks.get(event.index);
      if (!entry || entry.kind !== 'text') return '';
      return emitFrame({
        type: 'content-delta',
        index: entry.cohereIndex,
        delta: { message: { content: { text: event.text } } },
      });
    }
    case 'tool_input_delta': {
      const entry = state.blocks.get(event.index);
      if (!entry || entry.kind !== 'tool_use') return '';
      return emitFrame({
        type: 'tool-call-delta',
        index: entry.cohereIndex,
        delta: { message: { tool_calls: { function: { arguments: event.partialJson } } } },
      });
    }
    case 'thinking_delta': {
      const entry = state.blocks.get(event.index);
      if (!entry || entry.kind !== 'thinking') return '';
      return emitFrame({
        type: 'tool-plan-delta',
        delta: { message: { tool_plan: event.text } },
      });
    }
    case 'content_block_stop': {
      const entry = state.blocks.get(event.index);
      if (!entry) return '';
      state.blocks.delete(event.index);
      if (entry.kind === 'text') {
        return emitFrame({ type: 'content-end', index: entry.cohereIndex });
      }
      if (entry.kind === 'tool_use') {
        return emitFrame({ type: 'tool-call-end', index: entry.cohereIndex });
      }
      // thinking blocks have no explicit end event in cohere's format.
      return '';
    }
    case 'message_delta':
      if (typeof event.usage?.inputTokens === 'number') state.inputTokens = event.usage.inputTokens;
      if (typeof event.usage?.outputTokens === 'number') state.outputTokens = event.usage.outputTokens;
      if (event.stopReason) state.pendingFinish = mapIRStopToCohere(event.stopReason);
      return '';
    case 'message_stop':
      state.done = true;
      return emitFrame({
        type: 'message-end',
        delta: {
          finish_reason: state.pendingFinish,
          usage: {
            tokens: {
              input_tokens: state.inputTokens,
              output_tokens: state.outputTokens,
            },
          },
        },
      });
    case 'error':
      state.done = true;
      return emitFrame({
        type: 'message-end',
        delta: {
          finish_reason: 'ERROR' as CohereFinishReason,
          error: event.error.message,
        },
      });
  }
}
