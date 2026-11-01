import type { ModelShapingContext, TranslationContext } from '../types.js';
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
  IRToolResultContent,
  IRImageSource,
  IRDocumentSource,
} from '../ir.js';
import { isIRError } from '../ir.js';

/**
 * Anthropic Messages API adapter.
 *
 * Translates between the anthropic wire format (POST /v1/messages) and the
 * canonical IR. All other families reach anthropic by composing this
 * adapter's serialize side with their own parse side, or vice versa.
 */

const CHAT_ENDPOINT = '/v1/messages';

export const anthropicAdapter: FamilyAdapter = {
  family: 'anthropic',
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
  shapeRequestForModel,
  parseResponse,
  serializeResponse,
  createStreamParser,
  createStreamSerializer,
};

// ─── Wire shapes (narrow, only what we read/write) ───────────────────────

interface AnthropicRequest {
  model?: string;
  system?: string | AnthropicSystemBlock[];
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
  thinking?: { type?: 'enabled' | 'adaptive' | 'disabled' | 'between_tools'; budget_tokens?: number };
}

interface AnthropicSystemBlock {
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
  | { type: 'document'; source: AnthropicDocumentSource; title?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content?: string | AnthropicContentBlock[];
      is_error?: boolean;
    }
  | { type: 'thinking'; thinking?: string; text?: string; signature?: string }
  | { type: string; [k: string]: unknown };

type AnthropicImageSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'url'; url: string };

/** PDF as base64 or URL, or plain text. (Content and file sources aren't
 *  translatable: file ids belong to Anthropic's Files API.) */
type AnthropicDocumentSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'url'; url: string }
  | { type: 'text'; media_type: 'text/plain'; data: string };

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

interface AnthropicResponse {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: AnthropicResponseBlock[];
  stop_reason?: AnthropicStopReason;
  stop_sequence?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

type AnthropicResponseBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking?: string; text?: string; signature?: string }
  | { type: string; [k: string]: unknown };

type AnthropicStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal';

// ─── parseRequest ─────────────────────────────────────────────────────────

function parseRequest(body: string): IRRequest {
  let parsed: AnthropicRequest;
  try {
    parsed = JSON.parse(body) as AnthropicRequest;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `Anthropic request body is not valid JSON: ${(err as Error).message}`,
    );
  }

  const ir: IRRequest = {
    model: parsed.model,
    system: parseSystem(parsed.system),
    messages: Array.isArray(parsed.messages)
      ? parsed.messages.map(parseAnthropicMessage).filter((m): m is IRMessage => m != null)
      : [],
  };

  if (typeof parsed.max_tokens === 'number') ir.maxTokens = parsed.max_tokens;
  if (typeof parsed.temperature === 'number') ir.temperature = parsed.temperature;
  if (typeof parsed.top_p === 'number') ir.topP = parsed.top_p;
  if (typeof parsed.top_k === 'number') ir.topK = parsed.top_k;
  if (Array.isArray(parsed.stop_sequences) && parsed.stop_sequences.length > 0) {
    ir.stopSequences = parsed.stop_sequences.slice();
  }
  if (typeof parsed.stream === 'boolean') ir.stream = parsed.stream;
  if (parsed.metadata && typeof parsed.metadata.user_id === 'string') {
    ir.userId = parsed.metadata.user_id;
  }

  if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    ir.tools = parsed.tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.input_schema ?? { type: 'object', properties: {} },
    }));
  }

  if (parsed.tool_choice) {
    switch (parsed.tool_choice.type) {
      case 'auto':
        ir.toolChoice = { type: 'auto' };
        break;
      case 'any':
        ir.toolChoice = { type: 'any' };
        break;
      case 'none':
        ir.toolChoice = { type: 'none' };
        break;
      case 'tool':
        ir.toolChoice = { type: 'tool', name: parsed.tool_choice.name };
        break;
    }
  }

  // Only an explicit thinking request goes into the IR. Adaptive thinking
  // (Claude Code's default on current models) leaves the depth to the model,
  // which is what every other family does when no thinking config is sent.
  if (parsed.thinking && parsed.thinking.type === 'enabled') {
    ir.thinking = {
      enabled: true,
      ...(typeof parsed.thinking.budget_tokens === 'number'
        ? { budgetTokens: parsed.thinking.budget_tokens }
        : {}),
    };
  }

  return ir;
}

function parseSystem(system: AnthropicRequest['system']): IRRequest['system'] {
  if (!system) return [];
  if (typeof system === 'string') {
    return system.length > 0 ? [{ text: system }] : [];
  }
  if (Array.isArray(system)) {
    return system
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.length > 0)
      .map((b) => ({ text: b.text }));
  }
  return [];
}

function parseAnthropicMessage(msg: AnthropicMessage): IRMessage | null {
  if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) return null;
  const content: IRContentBlock[] = [];
  if (typeof msg.content === 'string') {
    if (msg.content.length > 0) content.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      const parsed = parseAnthropicContentBlock(block);
      if (parsed) content.push(parsed);
    }
  }
  return { role: msg.role, content };
}

function parseAnthropicContentBlock(
  block: AnthropicContentBlock,
): IRContentBlock | null {
  if (!block || typeof block !== 'object') return null;
  switch (block.type) {
    case 'text':
      if (typeof (block as { text?: unknown }).text === 'string') {
        return { type: 'text', text: (block as { text: string }).text };
      }
      return null;
    case 'image': {
      const src = (block as { source?: AnthropicImageSource }).source;
      const irSrc = parseAnthropicImageSource(src);
      return irSrc ? { type: 'image', source: irSrc } : null;
    }
    case 'document': {
      const doc = block as { source?: AnthropicDocumentSource; title?: unknown };
      const irSrc = parseAnthropicDocumentSource(doc.source);
      if (!irSrc) return null;
      return {
        type: 'document',
        source: irSrc,
        ...(typeof doc.title === 'string' && doc.title ? { title: doc.title } : {}),
      };
    }
    case 'tool_use': {
      const tu = block as Extract<AnthropicContentBlock, { type: 'tool_use' }>;
      return { type: 'tool_use', id: tu.id, name: tu.name, input: tu.input ?? {} };
    }
    case 'tool_result': {
      const tr = block as Extract<AnthropicContentBlock, { type: 'tool_result' }>;
      return {
        type: 'tool_result',
        toolUseId: tr.tool_use_id,
        content: parseAnthropicToolResultContent(tr.content),
        ...(tr.is_error ? { isError: true } : {}),
      };
    }
    case 'thinking': {
      const th = block as { thinking?: string; text?: string; signature?: string };
      const text = typeof th.thinking === 'string' ? th.thinking : th.text ?? '';
      return {
        type: 'thinking',
        text,
        ...(th.signature ? { signature: th.signature } : {}),
      };
    }
    default:
      return null;
  }
}

function parseAnthropicImageSource(
  src: AnthropicImageSource | undefined,
): IRImageSource | null {
  if (!src || typeof src !== 'object') return null;
  if (
    src.type === 'base64' &&
    typeof src.media_type === 'string' &&
    typeof src.data === 'string'
  ) {
    return { kind: 'base64', mediaType: src.media_type, data: src.data };
  }
  if (src.type === 'url' && typeof src.url === 'string') {
    return { kind: 'url', url: src.url };
  }
  return null;
}

function parseAnthropicDocumentSource(
  src: AnthropicDocumentSource | undefined,
): IRDocumentSource | null {
  if (!src || typeof src !== 'object') return null;
  if (src.type === 'base64' && typeof src.media_type === 'string' && typeof src.data === 'string') {
    return { kind: 'base64', mediaType: src.media_type, data: src.data };
  }
  // Anthropic fetches URL documents as PDFs.
  if (src.type === 'url' && typeof src.url === 'string') {
    return { kind: 'url', url: src.url, mediaType: 'application/pdf' };
  }
  if (src.type === 'text' && typeof src.data === 'string') {
    return { kind: 'text', text: src.data };
  }
  return null;
}

function parseAnthropicToolResultContent(
  content: string | AnthropicContentBlock[] | undefined,
): IRToolResultContent {
  if (content == null) return { kind: 'text', text: '' };
  if (typeof content === 'string') return { kind: 'text', text: content };
  if (!Array.isArray(content)) return { kind: 'text', text: '' };
  const blocks: IRContentBlock[] = [];
  for (const b of content) {
    const parsed = parseAnthropicContentBlock(b);
    if (parsed) blocks.push(parsed);
  }
  return { kind: 'blocks', blocks };
}

// ─── serializeRequest ────────────────────────────────────────────────────

function serializeRequest(ctx: TranslationContext, ir: IRRequest): string {
  // n > 1 is unrepresentable on anthropic — fail loud rather than silently
  // dropping completions.
  if (typeof ir.n === 'number' && ir.n > 1) {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      'Anthropic does not support generating multiple completions per request (n > 1).',
    );
  }

  // json_schema has no anthropic equivalent. json mode can be shimmed by
  // appending a hint to the system prompt; do so for 'json' but refuse for
  // 'json_schema' since the constraint is too strict to fake.
  let systemParts = ir.system.slice();
  if (ir.responseFormat?.type === 'json_schema') {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      'OpenAI json_schema response format cannot be translated to Anthropic. Pin this app to an OpenAI- or Gemini-family model.',
    );
  }
  if (ir.responseFormat?.type === 'json') {
    systemParts.push({
      text: 'Respond with valid JSON only. Do not include any prose outside the JSON object.',
    });
  }

  const rules = claudeRequestRules(ctx.dstModel);
  // Some models reject a forced tool choice with a 400. Anthropic's advice
  // for them is `auto` plus an instruction that names the tool, so the
  // request still asks for the call the app's code expects.
  let toolChoice = ir.toolChoice;
  if (!rules.forcedToolChoice && (toolChoice?.type === 'any' || toolChoice?.type === 'tool')) {
    if (ir.tools && ir.tools.length > 0) systemParts.push({ text: forcedToolInstruction(toolChoice) });
    toolChoice = { type: 'auto' };
  }
  // Extended thinking can't be combined with a forced tool choice. The
  // forced tool is what the app's code relies on; thinking only shapes the
  // answer, so it gives way.
  const forcedTool = toolChoice?.type === 'any' || toolChoice?.type === 'tool';
  const wantsThinking = ir.thinking?.enabled === true && !forcedTool;
  const requestedBudget = ir.thinking?.budgetTokens;

  // Anthropic requires max_tokens. Default to the destination model's max
  // output, capped at 4096 (plus room for thinking), if the source omitted it.
  const dst = getModel(ctx.dstModel);
  let maxTokens = ir.maxTokens;
  if (typeof maxTokens !== 'number') {
    maxTokens = wantsThinking
      ? Math.min(
          dst?.maxOutput ?? 32_000,
          Math.max(MIN_THINKING_BUDGET, requestedBudget ?? DEFAULT_THINKING_BUDGET) + 4096,
        )
      : Math.min(dst?.maxOutput ?? 4096, 4096);
  }
  const thinking = wantsThinking
    ? anthropicThinking(rules.thinking, requestedBudget, maxTokens)
    : undefined;

  const out: AnthropicRequest = {
    model: ctx.dstModel,
    max_tokens: maxTokens,
    messages: serializeMessagesToAnthropic(ir.messages),
  };

  if (systemParts.length > 0) {
    out.system = systemParts.map((p) => p.text).join('\n\n');
  }

  const { temperature, topP, topK } = claudeSampling(rules, !!thinking, ir);
  if (typeof temperature === 'number') {
    // Anthropic clamps temperature to [0, 1]; OpenAI accepts up to 2.
    out.temperature = Math.max(0, Math.min(1, temperature));
  }
  if (typeof topP === 'number') out.top_p = topP;
  if (typeof topK === 'number') out.top_k = topK;
  if (ir.stopSequences && ir.stopSequences.length > 0) out.stop_sequences = anthropicStopSequences(ir.stopSequences);
  if (typeof ir.stream === 'boolean') out.stream = ir.stream;
  if (ir.userId) out.metadata = { user_id: ir.userId };

  if (ir.tools && ir.tools.length > 0) {
    out.tools = ir.tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      input_schema: t.parameters ?? { type: 'object', properties: {} },
    }));
  }

  if (toolChoice) {
    switch (toolChoice.type) {
      case 'auto':
        out.tool_choice = { type: 'auto' };
        break;
      case 'any':
        out.tool_choice = { type: 'any' };
        break;
      case 'none':
        out.tool_choice = { type: 'none' };
        break;
      case 'tool':
        out.tool_choice = { type: 'tool', name: toolChoice.name };
        break;
    }
  }

  if (thinking) out.thinking = thinking;

  return JSON.stringify(out);
}

const MIN_THINKING_BUDGET = 1024;
const DEFAULT_THINKING_BUDGET = 8192;

type ClaudeSamplingRule = 'none' | 'single';
/** adaptive: thinking:{type:'adaptive'} only; budget: {type:'enabled',
 *  budget_tokens} only; either: adaptive, or a budget when one is asked for. */
type ClaudeThinkingRule = 'adaptive' | 'either' | 'budget';
/** How thinking is turned off: `disabled` ({type:'disabled'}),
 *  `between_tools` ({type:'between_tools'}, Sonnet 5.5's off switch), or
 *  `never` (thinking is always on; the field is left out). */
type ClaudeThinkingOffRule = 'disabled' | 'between_tools' | 'never';
type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const CLAUDE_EFFORTS: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface ClaudeRequestRules {
  sampling: ClaudeSamplingRule;
  thinking: ClaudeThinkingRule;
  /** Accepts a forced tool choice (`tool_choice` `any` or `tool`). */
  forcedToolChoice: boolean;
  /** How the model turns thinking off; null when the id doesn't say. */
  thinkingOff: ClaudeThinkingOffRule | null;
  /** Thinking turns off only at effort `high` or below (a 400 at `xhigh`/`max`). */
  thinkingOffUpToHigh: boolean;
  /** The `output_config.effort` levels the model takes (none: it rejects the
   *  parameter); null when the id doesn't say. */
  efforts: readonly ClaudeEffort[] | null;
}

interface ClaudeId {
  /** opus, sonnet, haiku, fable or mythos. */
  line: string;
  major: number;
  minor: number;
  /** Named claude-<line>-<version> (Claude 4 on); legacy ids are claude-<version>-<line>. */
  named: boolean;
}

/** The line and version of a Claude model id, or null when it doesn't name one. */
function parseClaudeId(model: string): ClaudeId | null {
  const id = model.toLowerCase();
  const named = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d{1,2})(?!\d))?/.exec(id);
  if (named) return { line: named[1], major: Number(named[2]), minor: Number(named[3] ?? 0), named: true };
  const legacy = /claude-(\d+)(?:[-.](\d)(?!\d))?-(opus|sonnet|haiku)/.exec(id);
  if (legacy) return { line: legacy[3], major: Number(legacy[1]), minor: Number(legacy[2] ?? 0), named: false };
  return null;
}

/**
 * What a Claude model accepts, read from its id (groups accept any id, so
 * the registry can't be the only source):
 *  - Opus 4.7 and later, every 5.x model, Fable and Mythos reject
 *    temperature/top_p/top_k and budget_tokens; they think adaptively.
 *  - Claude 4.6 takes temperature or top_p (not both) and either form of
 *    thinking (budget_tokens is deprecated there).
 *  - Earlier models take temperature or top_p and a thinking budget.
 *  - Opus and Sonnet from 5.5 on, and Fable and Mythos from 5.1 on, reject
 *    a forced tool choice with a 400. Haiku 5.5 and the earlier models
 *    accept one.
 *  - Thinking can't be turned off on Opus 5.5, Fable and Mythos (from 5);
 *    `{type:'disabled'}` is a 400 there. Sonnet 5.5 turns it off with
 *    `{type:'between_tools'}` and answers `disabled` with a 400; every other
 *    model answers `between_tools` with a 400. Sonnet 5.5's
 *    `between_tools` and Opus 5's and Haiku 5.5's `disabled` hold only at
 *    effort `high` or below.
 *  - `output_config.effort`: Opus 4.5 takes low/medium/high, Claude 4.6
 *    adds max, Opus 4.7 and later (every 5.x model, Fable, Mythos) add
 *    xhigh; Sonnet 4.5, Haiku 4.5 and earlier models reject the parameter.
 * (platform.claude.com/docs/en/api/errors, "Thinking cannot be disabled".
 * Checked live on 2026-11-01: disabled on Opus 5.5, Sonnet 5.5 and Fable
 * 5.1, between_tools on Sonnet 5.5, disabled at xhigh on Opus 5, effort on
 * Haiku 4.5, Sonnet 4.5, Opus 4.6 and Opus 4.5.)
 * An id that doesn't parse is treated like a current model on sampling and
 * gets adaptive thinking; its thinking-off form and effort levels are left
 * as the request has them.
 */
function claudeRequestRules(model: string): ClaudeRequestRules {
  const claude = parseClaudeId(model);
  if (!claude) {
    return {
      sampling: 'single', thinking: 'adaptive', forcedToolChoice: true,
      thinkingOff: null, thinkingOffUpToHigh: false, efforts: null,
    };
  }
  const { line, major, minor, named } = claude;
  const atLeast = (maj: number, min: number) => major > maj || (major === maj && minor >= min);
  const efforts: readonly ClaudeEffort[] = atLeast(4, 7)
    ? CLAUDE_EFFORTS
    : major === 4 && minor === 6
      ? ['low', 'medium', 'high', 'max']
      : named && line === 'opus' && major === 4 && minor === 5
        ? ['low', 'medium', 'high']
        : [];
  if (named && (line === 'fable' || line === 'mythos')) {
    return {
      sampling: 'none', thinking: 'adaptive', forcedToolChoice: !atLeast(5, 1),
      thinkingOff: atLeast(5, 0) ? 'never' : 'disabled', thinkingOffUpToHigh: false, efforts,
    };
  }
  const forcedToolChoice = !(named && (line === 'opus' || line === 'sonnet') && atLeast(5, 5));
  let thinkingOff: ClaudeThinkingOffRule = 'disabled';
  let thinkingOffUpToHigh = false;
  if (named && atLeast(5, 0)) {
    if (line === 'opus') {
      thinkingOff = atLeast(5, 5) ? 'never' : 'disabled';
      thinkingOffUpToHigh = true;
    } else if (line === 'sonnet' && atLeast(5, 5)) {
      thinkingOff = 'between_tools';
      thinkingOffUpToHigh = true;
    } else if (line === 'haiku' && atLeast(5, 5)) {
      thinkingOffUpToHigh = true;
    }
  }
  const off = { forcedToolChoice, thinkingOff, thinkingOffUpToHigh, efforts };
  if (atLeast(4, 7)) return { sampling: 'none', thinking: 'adaptive', ...off };
  if (major === 4 && minor === 6) return { sampling: 'single', thinking: 'either', ...off };
  return { sampling: 'single', thinking: 'budget', ...off };
}

interface ClaudeSampling {
  temperature?: number;
  topP?: number;
  topK?: number;
}

/** The sampling parameters of `requested` that a model with `rules` accepts. */
function claudeSampling(rules: ClaudeRequestRules, thinking: boolean, requested: ClaudeSampling): ClaudeSampling {
  if (rules.sampling === 'none') return {};
  let { temperature, topP, topK } = requested;
  if (thinking) {
    // With thinking: no temperature or top_k change, top_p only in [0.95, 1].
    temperature = topK = undefined;
    if (typeof topP === 'number' && (topP < 0.95 || topP > 1)) topP = undefined;
  }
  // Claude 4 models take temperature or top_p, not both.
  if (typeof temperature === 'number') topP = undefined;
  return { temperature, topP, topK };
}

/**
 * Fit an Anthropic request written for another Claude model to
 * `ctx.dstModel`, in place (a group pins the model; nothing is translated):
 * the rules serializeRequest follows, applied to the app's own body so
 * every field they don't cover (cache_control, metadata, output_config's
 * other fields, ...) is kept. Thinking turned off and the effort level are
 * fitted too, which a translated request never carries.
 */
function shapeRequestForModel(body: Record<string, unknown>, ctx: ModelShapingContext): void {
  const rules = claudeRequestRules(ctx.dstModel);
  const isForced = (choice: unknown): choice is Record<string, unknown> =>
    isRecord(choice) && (choice.type === 'any' || choice.type === 'tool');

  if (!rules.forcedToolChoice && isForced(body.tool_choice)) {
    const choice = body.tool_choice;
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      appendSystemText(
        body,
        forcedToolInstruction(choice.type === 'tool' ? { type: 'tool', name: String(choice.name) } : { type: 'any' }),
      );
    }
    // disable_parallel_tool_use still applies to auto.
    const auto: Record<string, unknown> = { ...choice, type: 'auto' };
    delete auto.name;
    body.tool_choice = auto;
  }

  const thinking = body.thinking;
  if (isRecord(thinking) && (thinking.type === 'enabled' || thinking.type === 'adaptive')) {
    if (isForced(body.tool_choice)) {
      // Thinking can't be combined with a forced tool choice; the forced
      // tool is what the app's code relies on.
      delete body.thinking;
    } else if (thinking.type === 'enabled' && rules.thinking === 'adaptive') {
      const adaptive: Record<string, unknown> = { ...thinking, type: 'adaptive' };
      delete adaptive.budget_tokens;
      body.thinking = adaptive;
    } else if (thinking.type === 'adaptive' && rules.thinking === 'budget') {
      // Adaptive leaves the depth to the model; one that only takes a budget
      // then answers without thinking, as after translation.
      delete body.thinking;
    }
  } else if (isRecord(thinking) && (thinking.type === 'disabled' || thinking.type === 'between_tools')) {
    // Thinking off, in the form the model takes it. A model that always
    // thinks gets no thinking field, which is what it does by default.
    if (rules.thinkingOff === 'never') delete body.thinking;
    else if (rules.thinkingOff && thinking.type !== rules.thinkingOff) body.thinking = { type: rules.thinkingOff };
  }

  const outputConfig = body.output_config;
  if (isRecord(outputConfig) && typeof outputConfig.effort === 'string') {
    const effort = claudeEffort(outputConfig.effort, rules, body.thinking);
    if (effort === null) {
      const rest: Record<string, unknown> = { ...outputConfig };
      delete rest.effort;
      if (Object.keys(rest).length > 0) body.output_config = rest;
      else delete body.output_config;
    } else if (effort !== outputConfig.effort) {
      body.output_config = { ...outputConfig, effort };
    }
  }

  const thinkingOn = isRecord(body.thinking) && (body.thinking.type === 'enabled' || body.thinking.type === 'adaptive');
  const requested: ClaudeSampling = {
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    topP: typeof body.top_p === 'number' ? body.top_p : undefined,
    topK: typeof body.top_k === 'number' ? body.top_k : undefined,
  };
  const kept = claudeSampling(rules, thinkingOn, requested);
  if (requested.temperature !== undefined && kept.temperature === undefined) delete body.temperature;
  if (requested.topP !== undefined && kept.topP === undefined) delete body.top_p;
  if (requested.topK !== undefined && kept.topK === undefined) delete body.top_k;
}

/**
 * The `output_config.effort` level a model with `rules` takes for
 * `requested`, with the request's thinking set to `thinking`: the highest
 * level it supports at or below the one asked for (at most `high` when
 * thinking is off on a model that turns it off only up to `high`), or null
 * when the model takes no effort parameter. A level Byoky doesn't know is
 * kept as it is.
 */
function claudeEffort(requested: string, rules: ClaudeRequestRules, thinking: unknown): string | null {
  let level = CLAUDE_EFFORTS.indexOf(requested as ClaudeEffort);
  if (level < 0) return requested;
  const off = isRecord(thinking) && (thinking.type === 'disabled' || thinking.type === 'between_tools');
  if (off && rules.thinkingOffUpToHigh) level = Math.min(level, CLAUDE_EFFORTS.indexOf('high'));
  if (rules.efforts === null) return CLAUDE_EFFORTS[level];
  if (rules.efforts.length === 0) return null;
  for (let i = level; i >= 0; i--) {
    if (rules.efforts.includes(CLAUDE_EFFORTS[i])) return CLAUDE_EFFORTS[i];
  }
  return rules.efforts[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Add `text` at the end of a request's system prompt, in whichever form it has. */
function appendSystemText(body: Record<string, unknown>, text: string): void {
  const system = body.system;
  if (typeof system === 'string' && system.length > 0) body.system = `${system}\n\n${text}`;
  else if (Array.isArray(system) && system.length > 0) body.system = [...system, { type: 'text', text }];
  else body.system = text;
}

/**
 * The instruction that stands in for a forced tool choice on a model that
 * rejects one.
 */
function forcedToolInstruction(choice: { type: 'any' } | { type: 'tool'; name: string }): string {
  return choice.type === 'tool'
    ? `You must call the ${choice.name} tool in this response. Start your response with that tool call.`
    : 'You must call one of the provided tools in this response. Start your response with a tool call.';
}

/**
 * Anthropic thinking config for the destination. A budget is at least 1024
 * tokens and below max_tokens; when max_tokens leaves no room for that,
 * thinking is left off.
 */
function anthropicThinking(
  rule: ClaudeThinkingRule,
  requestedBudget: number | undefined,
  maxTokens: number,
): AnthropicRequest['thinking'] | undefined {
  const useBudget = rule === 'budget' || (rule === 'either' && typeof requestedBudget === 'number');
  if (!useBudget) return { type: 'adaptive' };
  const budget = Math.min(
    Math.max(MIN_THINKING_BUDGET, requestedBudget ?? DEFAULT_THINKING_BUDGET),
    maxTokens - 1,
  );
  if (budget < MIN_THINKING_BUDGET) return undefined;
  return { type: 'enabled', budget_tokens: budget };
}

function serializeMessagesToAnthropic(messages: IRMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const msg of messages) {
    const wire = serializeMessageToAnthropic(msg);
    if (wire) out.push(wire);
  }
  return out;
}

/**
 * Returns null when every block of a non-empty message was dropped (e.g. an
 * assistant turn holding only another family's unsigned reasoning): sending
 * it with empty content would be rejected. Anthropic merges the neighbouring
 * same-role turns that this can leave behind.
 */
function serializeMessageToAnthropic(msg: IRMessage): AnthropicMessage | null {
  const blocks: AnthropicContentBlock[] = [];
  for (const b of msg.content) {
    const wire = serializeContentBlockToAnthropic(b);
    if (wire) blocks.push(wire);
  }
  if (blocks.length === 0 && msg.content.length > 0) return null;

  // Collapse single text block to plain string for compactness.
  if (blocks.length === 1 && blocks[0].type === 'text') {
    return { role: msg.role, content: (blocks[0] as { text: string }).text };
  }
  if (blocks.length === 0) {
    return { role: msg.role, content: '' };
  }
  return { role: msg.role, content: blocks };
}

function serializeContentBlockToAnthropic(
  block: IRContentBlock,
): AnthropicContentBlock | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return { type: 'image', source: irImageSourceToAnthropic(block.source) };
    case 'document':
      return {
        type: 'document',
        source: irDocumentSourceToAnthropic(block.source),
        ...(block.title ? { title: block.title } : {}),
      };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result': {
      let content: string | AnthropicContentBlock[];
      if (block.content.kind === 'text') {
        content = block.content.text;
      } else {
        const nested: AnthropicContentBlock[] = [];
        for (const inner of block.content.blocks) {
          const wire = serializeContentBlockToAnthropic(inner);
          if (wire) nested.push(wire);
        }
        content = nested;
      }
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content,
        ...(block.isError ? { is_error: true } : {}),
      };
    }
    case 'thinking':
      // Anthropic requires the signature on every thinking block in history.
      // Other families' reasoning (Cohere tool_plan and thinking content)
      // has none, so it can't be replayed; drop it like the OpenAI and
      // Gemini serializers do.
      if (!block.signature) return null;
      return { type: 'thinking', thinking: block.text, signature: block.signature };
  }
}

/** Anthropic documents are PDFs (base64 or URL) or plain text. */
function irDocumentSourceToAnthropic(source: IRDocumentSource): AnthropicDocumentSource {
  if (source.kind === 'text') return { type: 'text', media_type: 'text/plain', data: source.text };
  const mediaType = source.kind === 'base64' ? source.mediaType : source.mediaType ?? 'application/pdf';
  if (mediaType !== 'application/pdf') {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      `Anthropic accepts PDF and plain-text documents only, not ${mediaType}.`,
    );
  }
  if (source.kind === 'base64') return { type: 'base64', media_type: mediaType, data: source.data };
  return { type: 'url', url: source.url };
}

function irImageSourceToAnthropic(source: IRImageSource): AnthropicImageSource {
  if (source.kind === 'base64') {
    return { type: 'base64', media_type: source.mediaType, data: source.data };
  }
  return { type: 'url', url: source.url };
}

/**
 * Stop sequences Anthropic takes: it refuses blank or whitespace-only ones
 * (such as "\n", which the other families accept), so those are left out
 * here rather than when the request is parsed. Undefined when none is left.
 */
function anthropicStopSequences(stops: string[]): string[] | undefined {
  const kept = stops.filter((s) => s.trim().length > 0);
  return kept.length > 0 ? kept : undefined;
}

// ─── parseResponse ────────────────────────────────────────────────────────

function parseResponse(body: string): IRResponseOrError {
  let parsed: AnthropicResponse;
  try {
    parsed = JSON.parse(body) as AnthropicResponse;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `Anthropic response body is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (parsed.type === 'error') {
    return {
      error: {
        type: parsed.error?.type ?? 'api_error',
        message: parsed.error?.message ?? 'Anthropic API error',
      },
    };
  }

  const content: IRResponseBlock[] = [];
  if (Array.isArray(parsed.content)) {
    for (const block of parsed.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        content.push({ type: 'text', text: (block as { text: string }).text });
      } else if (block.type === 'tool_use') {
        const tu = block as Extract<AnthropicResponseBlock, { type: 'tool_use' }>;
        content.push({
          type: 'tool_use',
          id: tu.id,
          name: tu.name,
          input: tu.input ?? {},
        });
      } else if (block.type === 'thinking') {
        const th = block as { thinking?: string; text?: string; signature?: string };
        const text = typeof th.thinking === 'string' ? th.thinking : th.text ?? '';
        content.push({
          type: 'thinking',
          text,
          ...(th.signature ? { signature: th.signature } : {}),
        });
      }
    }
  }

  return {
    id: parsed.id,
    model: parsed.model,
    content,
    stopReason: mapAnthropicStopToIR(parsed.stop_reason),
    stopSequence: parsed.stop_sequence ?? null,
    usage: {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
    },
  };
}

// ─── serializeResponse ───────────────────────────────────────────────────

function serializeResponse(ctx: TranslationContext, ir: IRResponseOrError): string {
  if (isIRError(ir)) {
    return JSON.stringify({
      type: 'error',
      error: { type: ir.error.type, message: ir.error.message },
    });
  }

  const content: AnthropicResponseBlock[] = [];
  for (const block of ir.content) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    } else if (block.type === 'thinking') {
      content.push({
        type: 'thinking',
        thinking: block.text,
        ...(block.signature ? { signature: block.signature } : {}),
      });
    }
  }
  // Anthropic expects at least one content block.
  if (content.length === 0) content.push({ type: 'text', text: '' });

  const out = {
    id: ir.id ?? `msg_${ctx.requestId}`,
    type: 'message' as const,
    role: 'assistant' as const,
    model: ctx.srcModel ?? ir.model ?? ctx.dstModel,
    content,
    stop_reason: mapIRStopToAnthropic(ir.stopReason),
    stop_sequence: ir.stopSequence ?? null,
    usage: {
      input_tokens: ir.usage.inputTokens,
      output_tokens: ir.usage.outputTokens,
    },
  };
  return JSON.stringify(out);
}

function mapAnthropicStopToIR(stop: AnthropicStopReason | undefined): IRStopReason {
  switch (stop) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'tool_use':
      return 'tool_use';
    case 'refusal':
      return 'refusal';
    case 'pause_turn':
      return 'other';
    default:
      return 'end_turn';
  }
}

function mapIRStopToAnthropic(stop: IRStopReason): AnthropicStopReason {
  switch (stop) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'tool_use':
      return 'tool_use';
    case 'refusal':
      return 'refusal';
    case 'error':
    case 'other':
      return 'end_turn';
  }
}

// ─── createStreamParser (anthropic SSE → IR events) ──────────────────────

function createStreamParser(): IRStreamParser {
  let buffer = '';
  let done = false;

  return {
    process(chunk: string): IRStreamEvent[] {
      // Normalize CRLF → LF so the frame separator is uniformly `\n\n`.
      // SSE spec canonicalizes CRLF; some servers (e.g. gemini) actually send
      // it. Anthropic streams use LF in practice but tolerate either.
      buffer += chunk.replace(/\r/g, '');
      const events: IRStreamEvent[] = [];
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (done) continue;
        parseAnthropicFrame(frame, events);
        if (events.length > 0 && events[events.length - 1].type === 'message_stop') {
          done = true;
        }
      }
      return events;
    },
    flush(): IRStreamEvent[] {
      // Nothing to emit — upstream sends a clean message_stop in normal
      // operation. If the stream aborted mid-frame we drop the partial.
      return [];
    },
  };
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
    thinking?: string;
    text?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

function parseAnthropicFrame(frame: string, out: IRStreamEvent[]): void {
  const data = parseDataLine(frame);
  if (!data) return;

  switch (data.type) {
    case 'message_start': {
      const id = data.message?.id ?? '';
      out.push({
        type: 'message_start',
        id,
        model: data.message?.model,
        usage: {
          inputTokens: data.message?.usage?.input_tokens ?? 0,
          outputTokens: data.message?.usage?.output_tokens ?? 0,
        },
      });
      return;
    }
    case 'content_block_start': {
      const index = data.index;
      const cb = data.content_block;
      if (typeof index !== 'number' || !cb) return;
      if (cb.type === 'text') {
        out.push({ type: 'content_block_start', index, block: { type: 'text' } });
      } else if (cb.type === 'tool_use') {
        out.push({
          type: 'content_block_start',
          index,
          block: { type: 'tool_use', id: cb.id ?? '', name: cb.name ?? '' },
        });
      } else if (cb.type === 'thinking') {
        out.push({ type: 'content_block_start', index, block: { type: 'thinking' } });
      }
      return;
    }
    case 'content_block_delta': {
      const index = data.index;
      if (typeof index !== 'number') return;
      const deltaType = data.delta?.type;
      if (deltaType === 'text_delta' && typeof data.delta?.text === 'string') {
        out.push({ type: 'text_delta', index, text: data.delta.text });
      } else if (deltaType === 'input_json_delta' && typeof data.delta?.partial_json === 'string') {
        out.push({ type: 'tool_input_delta', index, partialJson: data.delta.partial_json });
      } else if (deltaType === 'thinking_delta' && typeof data.delta?.thinking === 'string') {
        out.push({ type: 'thinking_delta', index, text: data.delta.thinking });
      }
      return;
    }
    case 'content_block_stop': {
      const index = data.index;
      if (typeof index !== 'number') return;
      out.push({ type: 'content_block_stop', index });
      return;
    }
    case 'message_delta': {
      const stopReason = data.delta?.stop_reason
        ? mapAnthropicStopToIR(data.delta.stop_reason as AnthropicStopReason)
        : undefined;
      const usage: Partial<IRResponse['usage']> = {};
      if (typeof data.usage?.input_tokens === 'number') usage.inputTokens = data.usage.input_tokens;
      if (typeof data.usage?.output_tokens === 'number') usage.outputTokens = data.usage.output_tokens;
      out.push({
        type: 'message_delta',
        ...(stopReason ? { stopReason } : {}),
        ...(Object.keys(usage).length > 0 ? { usage } : {}),
      });
      return;
    }
    case 'message_stop':
      out.push({ type: 'message_stop' });
      return;
    case 'ping':
      return;
    case 'error':
      out.push({
        type: 'error',
        error: {
          type: data.error?.type ?? 'api_error',
          message: data.error?.message ?? 'Anthropic stream error',
        },
      });
      return;
    default:
      return;
  }
}

function parseDataLine(frame: string): AnthropicFrameData | undefined {
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

// ─── createStreamSerializer (IR events → anthropic SSE) ──────────────────

function createStreamSerializer(ctx: TranslationContext): IRStreamSerializer {
  // State: we need to synthesize a clean anthropic stream even when the
  // source was a "flat" family (openai, gemini). The IR events already
  // carry the scaffolding the openai parser synthesizes on its side, so
  // this serializer is mostly a direct mapping.
  const state = {
    messageId: `msg_${ctx.requestId}`,
    model: ctx.srcModel ?? ctx.dstModel,
    // The app's own model is echoed back, as serializeResponse does; the
    // upstream model only fills in when the app's is unknown.
    modelPinned: ctx.srcModel != null,
    inputTokens: 0,
    outputTokens: 0,
    started: false,
    done: false,
    openBlocks: new Set<number>(),
  };

  return {
    process(events: IRStreamEvent[]): string {
      let out = '';
      for (const event of events) {
        out += handleEvent(event, state);
      }
      return out;
    },
    flush(): string {
      if (state.done) return '';
      // Synthesize a clean terminator if the source stream cut out early.
      let out = '';
      for (const idx of state.openBlocks) {
        out += emitFrame('content_block_stop', { type: 'content_block_stop', index: idx });
      }
      state.openBlocks.clear();
      if (state.started) {
        out += emitFrame('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { input_tokens: state.inputTokens, output_tokens: state.outputTokens },
        });
        out += emitFrame('message_stop', { type: 'message_stop' });
      }
      state.done = true;
      return out;
    },
  };
}

function handleEvent(
  event: IRStreamEvent,
  state: {
    messageId: string;
    model: string;
    modelPinned: boolean;
    inputTokens: number;
    outputTokens: number;
    started: boolean;
    done: boolean;
    openBlocks: Set<number>;
  },
): string {
  if (state.done) return '';
  switch (event.type) {
    case 'message_start': {
      state.started = true;
      if (event.id) state.messageId = event.id;
      if (event.model && !state.modelPinned) state.model = event.model;
      if (typeof event.usage.inputTokens === 'number') state.inputTokens = event.usage.inputTokens;
      if (typeof event.usage.outputTokens === 'number') state.outputTokens = event.usage.outputTokens;
      return emitFrame('message_start', {
        type: 'message_start',
        message: {
          id: state.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: state.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: state.inputTokens, output_tokens: 0 },
        },
      });
    }
    case 'content_block_start': {
      state.openBlocks.add(event.index);
      if (event.block.type === 'text') {
        return emitFrame('content_block_start', {
          type: 'content_block_start',
          index: event.index,
          content_block: { type: 'text', text: '' },
        });
      }
      if (event.block.type === 'tool_use') {
        return emitFrame('content_block_start', {
          type: 'content_block_start',
          index: event.index,
          content_block: {
            type: 'tool_use',
            id: event.block.id,
            name: event.block.name,
            input: {},
          },
        });
      }
      return emitFrame('content_block_start', {
        type: 'content_block_start',
        index: event.index,
        content_block: { type: 'thinking', thinking: '' },
      });
    }
    case 'text_delta':
      return emitFrame('content_block_delta', {
        type: 'content_block_delta',
        index: event.index,
        delta: { type: 'text_delta', text: event.text },
      });
    case 'tool_input_delta':
      return emitFrame('content_block_delta', {
        type: 'content_block_delta',
        index: event.index,
        delta: { type: 'input_json_delta', partial_json: event.partialJson },
      });
    case 'thinking_delta':
      return emitFrame('content_block_delta', {
        type: 'content_block_delta',
        index: event.index,
        delta: { type: 'thinking_delta', thinking: event.text },
      });
    case 'content_block_stop':
      state.openBlocks.delete(event.index);
      return emitFrame('content_block_stop', {
        type: 'content_block_stop',
        index: event.index,
      });
    case 'message_delta': {
      if (typeof event.usage?.inputTokens === 'number') state.inputTokens = event.usage.inputTokens;
      if (typeof event.usage?.outputTokens === 'number') state.outputTokens = event.usage.outputTokens;
      const stopReason = mapIRStopToAnthropic(event.stopReason ?? 'end_turn');
      return emitFrame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { input_tokens: state.inputTokens, output_tokens: state.outputTokens },
      });
    }
    case 'message_stop':
      state.done = true;
      return emitFrame('message_stop', { type: 'message_stop' });
    case 'error':
      state.done = true;
      return emitFrame('error', {
        type: 'error',
        error: { type: event.error.type, message: event.error.message },
      });
  }
}

function emitFrame(eventType: string, data: object): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}
