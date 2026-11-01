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
  IRDocumentSource,
  IRToolResultContent,
} from '../ir.js';
import { isIRError } from '../ir.js';

/**
 * Google Gemini (Generative Language v1beta) adapter.
 *
 * Endpoints:
 *   POST /v1beta/models/{model}:generateContent            (non-streaming)
 *   POST /v1beta/models/{model}:streamGenerateContent?alt=sse  (streaming)
 *
 * Key quirks vs the chat-completions surface:
 *  - The model lives in the URL path, not the request body; buildChatUrl is
 *    parameterized on it and the streaming flag.
 *  - Roles are `user` | `model` (not `assistant`). Tool results are packed
 *    into a `user`-role turn as `functionResponse` parts — there is no
 *    separate `tool` role.
 *  - Function calls in responses are NOT deltaed in streaming: a single
 *    frame contains a complete `functionCall` with fully-formed args.
 *  - No `[DONE]` terminator — HTTP stream end is the signal.
 *  - tools + responseMimeType:'application/json' is a 400 on the 2.5 series;
 *    the translation refuses the combination for every model.
 *  - Gemini 3 validates thought signatures on the function calls of the
 *    current turn (see THOUGHT_SIGNATURE_SKIP).
 *  - The `STOP` finish reason is used for both normal end and tool-calling
 *    turns; IR distinguishes them by whether the content has tool_use blocks.
 */

export const geminiAdapter: FamilyAdapter = {
  family: 'gemini',
  chatEndpoint: '/v1beta/models',

  matchesChatEndpoint(url: string): boolean {
    try {
      const u = new URL(url);
      return /^\/v1beta\/models\/[^/]+:(?:stream)?[Gg]enerateContent$/.test(u.pathname);
    } catch {
      return false;
    }
  },

  buildChatUrl(base: string, model: string, stream: boolean): string {
    const b = base.replace(/\/$/, '');
    const method = stream ? 'streamGenerateContent' : 'generateContent';
    const suffix = stream ? '?alt=sse' : '';
    return `${b}/v1beta/models/${encodeURIComponent(model)}:${method}${suffix}`;
  },

  rewriteUrlModel,

  parseRequest,
  serializeRequest,
  parseResponse,
  serializeResponse,
  createStreamParser,
  createStreamSerializer,
};

/**
 * `url` with the model of a generateContent, streamGenerateContent or
 * countTokens call (`…/models/{model}:{method}`) replaced by `model`; null
 * for any other URL (embeddings, model lists, tuned models). Gemini takes
 * the model from the path alone: a `model` field in the body is ignored
 * (live 2026-11-01: a call to models/gemini-2.5-flash with body model
 * gemini-3.5-flash-lite answered as gemini-2.5-flash). String surgery
 * rather than URL, so the query (?alt=sse) stays byte for byte.
 */
function rewriteUrlModel(url: string, model: string): string | null {
  const end = url.search(/[?#]/);
  const path = end < 0 ? url : url.slice(0, end);
  const rest = end < 0 ? '' : url.slice(end);
  const match = /^(https?:\/\/[^/?#]+(?:\/[^?#]*)?\/models\/)[^/?#:]+(:(?:streamGenerateContent|generateContent|countTokens))$/.exec(path);
  if (!match) return null;
  return `${match[1]}${encodeURIComponent(model)}${match[2]}${rest}`;
}

// ─── Wire shapes ──────────────────────────────────────────────────────────

interface GeminiRequest {
  contents?: GeminiContent[];
  systemInstruction?: { parts?: GeminiPart[] };
  tools?: GeminiToolGroup[];
  toolConfig?: {
    functionCallingConfig?: {
      mode?: 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED';
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: unknown;
}

interface GeminiContent {
  role?: 'user' | 'model';
  parts?: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType?: string; fileUri: string } }
  | { functionCall: { id?: string; name: string; args?: unknown }; thoughtSignature?: string }
  | { functionResponse: { id?: string; name: string; response: unknown } };

interface GeminiToolGroup {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    /** Gemini's restricted OpenAPI Schema; rejects unknown keywords. */
    parameters?: unknown;
    /** Standard JSON Schema; mutually exclusive with `parameters`. */
    parametersJsonSchema?: unknown;
  }>;
}

interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
  responseMimeType?: string;
  /** Gemini's restricted OpenAPI Schema; rejects unknown keywords. */
  responseSchema?: unknown;
  /** Standard JSON Schema; the alternative to `responseSchema`. */
  responseJsonSchema?: unknown;
  thinkingConfig?: { thinkingBudget?: number; includeThoughts?: boolean };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
  responseId?: string;
  error?: { code?: number; message?: string; status?: string };
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: GeminiFinishReason;
  index?: number;
  safetyRatings?: unknown;
}

type GeminiFinishReason =
  | 'STOP'
  | 'MAX_TOKENS'
  | 'SAFETY'
  | 'RECITATION'
  | 'LANGUAGE'
  | 'OTHER'
  | 'BLOCKLIST'
  | 'PROHIBITED_CONTENT'
  | 'SPII'
  | 'MALFORMED_FUNCTION_CALL';

// ─── parseRequest ─────────────────────────────────────────────────────────

function parseRequest(body: string): IRRequest {
  let parsed: GeminiRequest;
  try {
    parsed = JSON.parse(body) as GeminiRequest;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `Gemini request body is not valid JSON: ${(err as Error).message}`,
    );
  }
  normalizeSnakeCase(parsed);

  const ir: IRRequest = {
    system: parseSystemInstruction(parsed.systemInstruction),
    messages: [],
  };

  if (Array.isArray(parsed.contents)) {
    const pairing: ToolCallPairing = { calls: [] };
    parsed.contents.forEach((c, i) => {
      const msg = parseGeminiContent(c, i, pairing);
      if (msg) ir.messages.push(msg);
    });
  }

  const gc = parsed.generationConfig;
  if (gc) {
    if (typeof gc.temperature === 'number') ir.temperature = gc.temperature;
    if (typeof gc.topP === 'number') ir.topP = gc.topP;
    if (typeof gc.topK === 'number') ir.topK = gc.topK;
    if (typeof gc.maxOutputTokens === 'number') ir.maxTokens = gc.maxOutputTokens;
    if (Array.isArray(gc.stopSequences) && gc.stopSequences.length > 0) {
      ir.stopSequences = gc.stopSequences.slice();
    }
    if (gc.responseMimeType === 'application/json') {
      const schema = gc.responseJsonSchema ?? gc.responseSchema;
      if (schema) {
        ir.responseFormat = { type: 'json_schema', schema };
      } else {
        ir.responseFormat = { type: 'json' };
      }
    }
    // thinkingBudget: 0 turns thinking off, -1 asks for dynamic thinking.
    const budget = gc.thinkingConfig?.thinkingBudget;
    if (typeof budget === 'number') {
      if (budget > 0) ir.thinking = { enabled: true, budgetTokens: budget };
      else if (budget === -1) ir.thinking = { enabled: true };
    }
  }

  if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    const flat: IRRequest['tools'] = [];
    for (const group of parsed.tools) {
      if (!group?.functionDeclarations) continue;
      for (const fn of group.functionDeclarations) {
        flat.push({
          name: fn.name,
          ...(fn.description ? { description: fn.description } : {}),
          parameters: fn.parametersJsonSchema ?? fn.parameters ?? { type: 'object', properties: {} },
        });
      }
    }
    if (flat.length > 0) ir.tools = flat;
  }

  const tcMode = parsed.toolConfig?.functionCallingConfig?.mode;
  if (tcMode) {
    switch (tcMode) {
      case 'AUTO':
        ir.toolChoice = { type: 'auto' };
        break;
      case 'ANY':
      case 'VALIDATED': {
        const allowed = parsed.toolConfig?.functionCallingConfig?.allowedFunctionNames;
        if (Array.isArray(allowed) && allowed.length === 1) {
          ir.toolChoice = { type: 'tool', name: allowed[0] };
        } else {
          ir.toolChoice = { type: 'any' };
        }
        break;
      }
      case 'NONE':
        ir.toolChoice = { type: 'none' };
        break;
    }
  }

  return ir;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Copy each snake_case key present to its camelCase name; camelCase wins. */
function camelizeKeys(obj: unknown, keys: Record<string, string>): void {
  if (!isJsonObject(obj)) return;
  for (const [snake, camel] of Object.entries(keys)) {
    if (snake in obj && !(camel in obj)) obj[camel] = obj[snake];
  }
}

/**
 * The Gemini REST API takes proto field names in snake_case as well as
 * camelCase, and Google's curl examples use snake_case (system_instruction,
 * inline_data/mime_type, generation_config, function_declarations, ...).
 * Only the known request fields are renamed, level by level, never the
 * keys inside a schema, args object or function response.
 */
function normalizeSnakeCase(req: GeminiRequest): void {
  const r = req as unknown as JsonObject;
  if (!isJsonObject(r)) return;
  camelizeKeys(r, {
    system_instruction: 'systemInstruction',
    generation_config: 'generationConfig',
    tool_config: 'toolConfig',
    safety_settings: 'safetySettings',
  });
  camelizeKeys(r.generationConfig, {
    max_output_tokens: 'maxOutputTokens',
    top_p: 'topP',
    top_k: 'topK',
    stop_sequences: 'stopSequences',
    candidate_count: 'candidateCount',
    response_mime_type: 'responseMimeType',
    response_schema: 'responseSchema',
    response_json_schema: 'responseJsonSchema',
    thinking_config: 'thinkingConfig',
  });
  if (isJsonObject(r.generationConfig)) {
    camelizeKeys(r.generationConfig.thinkingConfig, {
      thinking_budget: 'thinkingBudget',
      include_thoughts: 'includeThoughts',
    });
  }
  camelizeKeys(r.toolConfig, { function_calling_config: 'functionCallingConfig' });
  if (isJsonObject(r.toolConfig)) {
    camelizeKeys(r.toolConfig.functionCallingConfig, { allowed_function_names: 'allowedFunctionNames' });
  }
  if (Array.isArray(r.tools)) {
    for (const group of r.tools) {
      camelizeKeys(group, { function_declarations: 'functionDeclarations' });
      if (isJsonObject(group) && Array.isArray(group.functionDeclarations)) {
        for (const fn of group.functionDeclarations) {
          camelizeKeys(fn, { parameters_json_schema: 'parametersJsonSchema' });
        }
      }
    }
  }
  const withParts = [...(Array.isArray(r.contents) ? r.contents : []), r.systemInstruction];
  for (const content of withParts) {
    if (!isJsonObject(content) || !Array.isArray(content.parts)) continue;
    for (const part of content.parts) {
      camelizeKeys(part, {
        inline_data: 'inlineData',
        file_data: 'fileData',
        function_call: 'functionCall',
        function_response: 'functionResponse',
      });
      if (!isJsonObject(part)) continue;
      camelizeKeys(part.inlineData, { mime_type: 'mimeType' });
      camelizeKeys(part.fileData, { mime_type: 'mimeType', file_uri: 'fileUri' });
    }
  }
}

function parseSystemInstruction(si: GeminiRequest['systemInstruction']): IRRequest['system'] {
  if (!si || !Array.isArray(si.parts)) return [];
  const out: IRRequest['system'] = [];
  for (const p of si.parts) {
    if (p && 'text' in p && typeof p.text === 'string' && p.text.length > 0) {
      out.push({ text: p.text });
    }
  }
  return out;
}

/**
 * Function calls of the latest model turn, for pairing the next turn's
 * functionResponse parts with them. Gemini apps build functionResponse from
 * name + response, usually without the call's id, while the other families
 * pair a tool result with its call by id only.
 */
interface ToolCallPairing {
  calls: Array<{ id: string; name: string; used: boolean }>;
}

/**
 * The tool_use id a functionResponse answers: the call with the same id,
 * else the first unanswered call with the same name, else the next
 * unanswered call; the response's own id or name only as a last resort.
 */
function pairToolResultId(
  fr: { id?: string; name: string },
  pairing: ToolCallPairing,
): string {
  const pending = pairing.calls.filter((c) => !c.used);
  const match =
    (fr.id ? pending.find((c) => c.id === fr.id) : undefined) ??
    pending.find((c) => c.name === fr.name) ??
    pending[0];
  if (!match) return fr.id ?? fr.name;
  match.used = true;
  return match.id;
}

function parseGeminiContent(
  c: GeminiContent,
  contentIndex: number,
  pairing: ToolCallPairing,
): IRMessage | null {
  if (!c || !Array.isArray(c.parts)) return null;
  const role: 'user' | 'assistant' = c.role === 'model' ? 'assistant' : 'user';
  const blocks: IRContentBlock[] = [];
  if (role === 'assistant') pairing.calls = [];

  for (const [partIndex, part] of c.parts.entries()) {
    if (!part || typeof part !== 'object') continue;
    if ('text' in part && typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text });
    } else if ('inlineData' in part && part.inlineData) {
      const { mimeType, data } = part.inlineData;
      // Images stay images; anything else (PDF, text, audio, ...) is a
      // document, which destinations take or refuse explicitly.
      blocks.push(
        isNonImageType(mimeType)
          ? { type: 'document', source: { kind: 'base64', mediaType: mimeType, data } }
          : { type: 'image', source: { kind: 'base64', mediaType: mimeType, data } },
      );
    } else if ('fileData' in part && part.fileData) {
      const { mimeType, fileUri } = part.fileData;
      blocks.push(
        isNonImageType(mimeType)
          ? { type: 'document', source: { kind: 'url', url: fileUri, ...(mimeType ? { mediaType: mimeType } : {}) } }
          : { type: 'image', source: { kind: 'url', url: fileUri } },
      );
    } else if ('functionCall' in part && part.functionCall) {
      const fc = part.functionCall;
      // An id-less call gets a deterministic one (the same history gives the
      // same ids on every turn). Never the name: two parallel calls to one
      // function would collide, and names may hold '.' or ':', which tool
      // ids elsewhere may not.
      const id = fc.id ?? `fc_${contentIndex}_${partIndex}`;
      if (role === 'assistant') pairing.calls.push({ id, name: fc.name, used: false });
      blocks.push({
        type: 'tool_use',
        id,
        name: fc.name,
        input: fc.args ?? {},
      });
    } else if ('functionResponse' in part && part.functionResponse) {
      const fr = part.functionResponse;
      blocks.push({
        type: 'tool_result',
        toolUseId: pairToolResultId(fr, pairing),
        content: { kind: 'text', text: JSON.stringify(fr.response ?? {}) },
      });
    }
  }

  return { role, content: blocks };
}

// ─── serializeRequest ────────────────────────────────────────────────────

function serializeRequest(ctx: TranslationContext, ir: IRRequest): string {
  // Gemini 2.5 refuses tools + responseMimeType:'application/json' together.
  if (ir.tools && ir.tools.length > 0 && ir.responseFormat) {
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      'Combining tools with JSON response format is not supported when translating to Gemini.',
    );
  }

  if (typeof ir.n === 'number' && ir.n > 1) {
    // candidateCount can be > 1 on some models, but it's not widely
    // supported and shape-dependent. Refuse rather than silently degrade.
    throw new TranslationError(
      'UNSUPPORTED_FEATURE',
      'Gemini does not reliably support generating multiple completions per request.',
    );
  }

  // Build a map from tool_use id → name so tool_result blocks can emit the
  // `name` field Gemini requires. Walks ir.messages once.
  const toolUseNames = new Map<string, string>();
  for (const msg of ir.messages) {
    for (const b of msg.content) {
      if (b.type === 'tool_use') toolUseNames.set(b.id, b.name);
    }
  }

  const contents: GeminiContent[] = [];
  for (const msg of ir.messages) {
    const c = serializeMessageToGemini(msg, toolUseNames, signsFunctionCalls(ctx.dstModel));
    if (c) contents.push(c);
  }

  const out: GeminiRequest = {
    contents,
  };

  if (ir.system.length > 0) {
    out.systemInstruction = {
      parts: ir.system.map((p) => ({ text: p.text })),
    };
  }

  const gc: GeminiGenerationConfig = {};
  if (typeof ir.temperature === 'number') gc.temperature = ir.temperature;
  if (typeof ir.topP === 'number') gc.topP = ir.topP;
  if (typeof ir.topK === 'number') gc.topK = ir.topK;
  if (typeof ir.maxTokens === 'number') gc.maxOutputTokens = ir.maxTokens;
  if (ir.stopSequences && ir.stopSequences.length > 0) gc.stopSequences = ir.stopSequences.slice();
  if (ir.responseFormat?.type === 'json') {
    gc.responseMimeType = 'application/json';
  } else if (ir.responseFormat?.type === 'json_schema') {
    gc.responseMimeType = 'application/json';
    // The other families speak JSON Schema ($schema, additionalProperties,
    // exclusiveMinimum, ...). responseSchema is Gemini's restricted OpenAPI
    // subset and rejects those keywords; responseJsonSchema takes them.
    gc.responseJsonSchema = toGeminiJsonSchema(ir.responseFormat.schema);
  }
  if (ir.thinking?.enabled) {
    gc.thinkingConfig = {
      ...(typeof ir.thinking.budgetTokens === 'number'
        ? { thinkingBudget: ir.thinking.budgetTokens }
        : {}),
    };
  }
  if (Object.keys(gc).length > 0) out.generationConfig = gc;

  if (ir.tools && ir.tools.length > 0) {
    out.tools = [
      {
        // parametersJsonSchema, not parameters: see responseJsonSchema above.
        functionDeclarations: ir.tools.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          ...(isEmptyObjectSchema(t.parameters)
            ? {}
            : { parametersJsonSchema: toGeminiJsonSchema(t.parameters) }),
        })),
      },
    ];
  }

  if (ir.toolChoice) {
    switch (ir.toolChoice.type) {
      case 'auto':
        out.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
        break;
      case 'any':
        out.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
        break;
      case 'none':
        out.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
        break;
      case 'tool':
        out.toolConfig = {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [ir.toolChoice.name],
          },
        };
        break;
    }
  }

  // userId, stream, safetySettings — gemini has no direct equivalent for
  // userId on this surface. stream is determined by the URL suffix, not the
  // body. Safety settings are left at gemini defaults.
  // Suppress the unused-ctx warning — kept for future use.
  void ctx;

  return JSON.stringify(out);
}

/** Drop the top-level `$schema` dialect marker, which Gemini doesn't need. */
function toGeminiJsonSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const rest: Record<string, unknown> = { ...(schema as Record<string, unknown>) };
  delete rest.$schema;
  return rest;
}

/**
 * True for a missing schema or an object schema that declares no
 * parameters. Gemini wants the parameters field left unset for a function
 * that takes none.
 */
function isEmptyObjectSchema(schema: unknown): boolean {
  if (schema == null) return true;
  if (typeof schema !== 'object' || Array.isArray(schema)) return false;
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === '$schema' || key === 'additionalProperties' || key === 'description') continue;
    if (key === 'type' && value === 'object') continue;
    if (key === 'properties' && isEmptyRecord(value)) continue;
    if (key === 'required' && Array.isArray(value) && value.length === 0) continue;
    return false;
  }
  return true;
}

function isEmptyRecord(value: unknown): boolean {
  return value !== null && typeof value === 'object' && Object.keys(value).length === 0;
}

/**
 * Gemini 3 rejects (400) a request whose current turn has a model function
 * call without the thought signature Gemini attached to it. Calls that
 * came from another family have no signature; Google documents this value
 * for function calls the API did not generate.
 */
const THOUGHT_SIGNATURE_SKIP = 'skip_thought_signature_validator';

/** Gemini 1.x and 2.x don't validate thought signatures; later models do. */
function signsFunctionCalls(model: string): boolean {
  return !/(?:^|\/)gemini-[12](?:[.-]|$)/i.test(model);
}

function serializeMessageToGemini(
  msg: IRMessage,
  toolUseNames: Map<string, string>,
  signFunctionCalls: boolean,
): GeminiContent | null {
  const parts: GeminiPart[] = [];
  let signed = false;
  for (const block of msg.content) {
    const wire = serializeBlockToGemini(block, toolUseNames);
    if (!wire) continue;
    // The signature goes on the first function call of each model step.
    if (signFunctionCalls && msg.role === 'assistant' && !signed && 'functionCall' in wire) {
      wire.thoughtSignature = THOUGHT_SIGNATURE_SKIP;
      signed = true;
    }
    parts.push(wire);
    // functionResponse.response holds JSON only; images and documents a
    // tool returned travel as parts next to it.
    if (block.type === 'tool_result' && block.content.kind === 'blocks') {
      for (const inner of block.content.blocks) {
        if (inner.type === 'image') parts.push(irImageToGeminiPart(inner.source));
        else if (inner.type === 'document' && inner.source.kind !== 'text') {
          parts.push(irDocumentToGeminiPart(inner.source));
        }
      }
    }
  }
  if (parts.length === 0) return null;
  return {
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts,
  };
}

function serializeBlockToGemini(
  block: IRContentBlock,
  toolUseNames: Map<string, string>,
): GeminiPart | null {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'image':
      return irImageToGeminiPart(block.source);
    case 'document':
      return irDocumentToGeminiPart(block.source);
    case 'tool_use':
      return {
        functionCall: {
          id: block.id,
          name: block.name,
          args: block.input ?? {},
        },
      };
    case 'tool_result': {
      const name = toolUseNames.get(block.toolUseId) ?? block.toolUseId;
      return {
        functionResponse: {
          id: block.toolUseId,
          name,
          response: parseToolResultForGemini(block.content),
        },
      };
    }
    case 'thinking':
      // Gemini has no visible thinking surface; drop.
      return null;
  }
}

function irImageToGeminiPart(source: IRImageSource): GeminiPart {
  if (source.kind === 'base64') {
    return { inlineData: { mimeType: source.mediaType, data: source.data } };
  }
  return { fileData: { fileUri: source.url } };
}

/** Gemini reads PDFs and other documents inline or by URI. */
function irDocumentToGeminiPart(source: IRDocumentSource): GeminiPart {
  if (source.kind === 'base64') {
    return { inlineData: { mimeType: source.mediaType, data: source.data } };
  }
  if (source.kind === 'url') {
    return { fileData: { ...(source.mediaType ? { mimeType: source.mediaType } : {}), fileUri: source.url } };
  }
  return { text: source.text };
}

function isNonImageType(mimeType: string | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.length > 0 && !mimeType.startsWith('image/');
}

/**
 * Gemini's functionResponse.response is a protobuf Struct, so it must be a
 * JSON object. Text that parses to an object is passed through as is; any
 * other parsed value (array, number, boolean, null, string) and text that
 * isn't JSON is wrapped as {result: value}.
 */
function parseToolResultForGemini(content: IRToolResultContent): Record<string, unknown> {
  if (content.kind === 'text') return toStruct(content.text);
  // Blocks → flatten the text (and plain-text documents) into a string and
  // wrap; images and binary documents go next to the functionResponse.
  const text = content.blocks
    .map((b) => (b.type === 'text' ? b.text : b.type === 'document' && b.source.kind === 'text' ? b.source.text : ''))
    .filter((s) => s.length > 0)
    .join('\n');
  return toStruct(text);
}

function toStruct(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { result: text };
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { result: parsed };
}

// ─── parseResponse ────────────────────────────────────────────────────────

function parseResponse(body: string): IRResponseOrError {
  let parsed: GeminiResponse;
  try {
    parsed = JSON.parse(body) as GeminiResponse;
  } catch (err) {
    throw new TranslationError(
      'INVALID_JSON',
      `Gemini response body is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (parsed.error) {
    return {
      error: {
        type: parsed.error.status ?? 'api_error',
        message: parsed.error.message ?? 'Gemini API error',
        ...(typeof parsed.error.code === 'number' ? { code: String(parsed.error.code) } : {}),
      },
    };
  }

  const candidate = parsed.candidates?.[0];
  const blocks: IRResponseBlock[] = [];
  let hasToolUse = false;
  let toolCallIndex = 0;
  // A blocked prompt comes back with no candidate, only promptFeedback.
  const blocked = !candidate ? promptBlockedText(parsed.promptFeedback) : null;
  if (blocked) blocks.push({ type: 'text', text: blocked });

  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (!part || typeof part !== 'object') continue;
      if ('text' in part && typeof part.text === 'string' && part.text.length > 0) {
        blocks.push({ type: 'text', text: part.text });
      } else if ('functionCall' in part && part.functionCall) {
        hasToolUse = true;
        blocks.push({
          type: 'tool_use',
          id: part.functionCall.id ?? upstreamCallId(parsed.responseId, toolCallIndex++),
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        });
      }
    }
  }

  const inputTokens = parsed.usageMetadata?.promptTokenCount ?? 0;
  const candidateTokens = parsed.usageMetadata?.candidatesTokenCount ?? 0;
  const thoughtsTokens = parsed.usageMetadata?.thoughtsTokenCount ?? 0;

  return {
    id: parsed.responseId,
    model: parsed.modelVersion,
    content: blocks,
    stopReason: blocked ? 'refusal' : mapGeminiFinishToIR(candidate?.finishReason, hasToolUse),
    stopSequence: null,
    usage: {
      inputTokens,
      outputTokens: candidateTokens + thoughtsTokens,
    },
  };
}

function promptBlockedText(feedback: GeminiResponse['promptFeedback']): string | null {
  if (!feedback?.blockReason) return null;
  return feedback.blockReasonMessage || `Prompt blocked: ${feedback.blockReason}`;
}

let upstreamCallCounter = 0;

/**
 * Id for a function call Gemini returned without one. The app keys its tool
 * results by this id, so it must be unique across the conversation: the
 * response id plus the call's index, or a time-and-counter id when there is
 * no response id. Fits ^[A-Za-z0-9_-]{1,40}$ (OpenAI caps call ids at 40).
 */
function upstreamCallId(responseId: string | undefined, index: number): string {
  const suffix = `_${index}`;
  const base = (responseId ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  if (base) return `call_${base.slice(0, 40 - 5 - suffix.length)}${suffix}`;
  return `call_${Date.now().toString(36)}_${(upstreamCallCounter++).toString(36)}${suffix}`;
}

// ─── serializeResponse ───────────────────────────────────────────────────

function serializeResponse(ctx: TranslationContext, ir: IRResponseOrError): string {
  if (isIRError(ir)) {
    return JSON.stringify({
      error: {
        code: ir.error.code ? Number(ir.error.code) || 500 : 500,
        message: ir.error.message,
        status: ir.error.type,
      },
    });
  }

  const parts: GeminiPart[] = [];
  for (const block of ir.content) {
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else if (block.type === 'tool_use') {
      parts.push({
        functionCall: {
          id: block.id,
          name: block.name,
          args: block.input ?? {},
        },
      });
    }
    // thinking blocks dropped.
  }

  if (parts.length === 0) parts.push({ text: '' });

  const out: GeminiResponse = {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: mapIRStopToGeminiFinish(ir.stopReason),
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: ir.usage.inputTokens,
      candidatesTokenCount: ir.usage.outputTokens,
      totalTokenCount: ir.usage.inputTokens + ir.usage.outputTokens,
    },
    modelVersion: ctx.srcModel ?? ir.model ?? ctx.dstModel,
    ...(ir.id ? { responseId: ir.id } : {}),
  };
  return JSON.stringify(out);
}

function mapGeminiFinishToIR(
  finish: GeminiFinishReason | undefined,
  hasToolUse: boolean,
): IRStopReason {
  // Gemini returns STOP for normal end AND for tool-calling turns — there
  // is no dedicated TOOL_CALL finish reason. Disambiguate by content.
  if (finish === 'STOP' && hasToolUse) return 'tool_use';
  switch (finish) {
    case 'STOP':
      return 'end_turn';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'refusal';
    case 'MALFORMED_FUNCTION_CALL':
      return 'error';
    case 'LANGUAGE':
    case 'OTHER':
      return 'other';
    default:
      return 'end_turn';
  }
}

function mapIRStopToGeminiFinish(stop: IRStopReason): GeminiFinishReason {
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
      return 'STOP';
    case 'max_tokens':
      return 'MAX_TOKENS';
    case 'refusal':
      return 'SAFETY';
    case 'error':
      return 'OTHER';
    case 'other':
      return 'OTHER';
  }
}

// ─── createStreamParser ───────────────────────────────────────────────────

function createStreamParser(): IRStreamParser {
  // Gemini streams standard SSE (with ?alt=sse). Each frame is a complete
  // GenerateContentResponse. No [DONE] terminator — HTTP end is the signal.
  //
  // Text arrives as deltas in parts[].text across frames.
  // Function calls arrive as a single complete `functionCall` in one frame.
  // usageMetadata typically arrives on the final frame with finishReason.
  //
  // We synthesize the IR block scaffolding: text block opens on first text
  // delta; tool_use block opens+delta+stops all at once when a functionCall
  // arrives; everything closes at flush().

  const state = {
    buffer: '',
    started: false,
    nextBlockIndex: 0,
    textBlockIndex: null as number | null,
    textBlockOpen: false,
    inputTokens: 0,
    outputTokens: 0,
    done: false,
    pendingFinish: null as IRStopReason | null,
    messageId: '',
    model: undefined as string | undefined,
    hasToolUse: false,
    toolCallCount: 0,
  };

  return {
    process(chunk: string): IRStreamEvent[] {
      // Gemini sends CRLF-canonical SSE (`\r\n\r\n` between frames). Strip
      // CRs at the byte boundary so the rest of the parser can use the
      // common `\n\n` separator. The SSE spec allows either form.
      state.buffer += chunk.replace(/\r/g, '');
      const events: IRStreamEvent[] = [];
      let idx: number;
      while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
        const frame = state.buffer.slice(0, idx);
        state.buffer = state.buffer.slice(idx + 2);
        if (state.done) continue;
        processGeminiFrame(frame, state, events);
      }
      return events;
    },
    flush(): IRStreamEvent[] {
      if (state.done) return [];
      const events: IRStreamEvent[] = [];
      if (state.textBlockOpen && state.textBlockIndex != null) {
        events.push({ type: 'content_block_stop', index: state.textBlockIndex });
        state.textBlockOpen = false;
      }
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

type GeminiParseState = {
  buffer: string;
  started: boolean;
  nextBlockIndex: number;
  textBlockIndex: number | null;
  textBlockOpen: boolean;
  inputTokens: number;
  outputTokens: number;
  done: boolean;
  pendingFinish: IRStopReason | null;
  messageId: string;
  model: string | undefined;
  hasToolUse: boolean;
  toolCallCount: number;
};

function processGeminiFrame(
  frame: string,
  state: GeminiParseState,
  events: IRStreamEvent[],
): void {
  const dataLine = extractGeminiDataLine(frame);
  if (dataLine == null) return;

  let data: GeminiResponse;
  try {
    data = JSON.parse(dataLine) as GeminiResponse;
  } catch {
    return;
  }

  if (data.error) {
    state.done = true;
    events.push({
      type: 'error',
      error: {
        type: data.error.status ?? 'api_error',
        message: data.error.message ?? 'Gemini stream error',
      },
    });
    return;
  }

  if (!state.started) {
    state.started = true;
    if (data.responseId) state.messageId = data.responseId;
    if (data.modelVersion) state.model = data.modelVersion;
    events.push({
      type: 'message_start',
      id: state.messageId,
      model: state.model,
      usage: {},
    });
  }

  if (data.usageMetadata) {
    if (typeof data.usageMetadata.promptTokenCount === 'number') {
      state.inputTokens = data.usageMetadata.promptTokenCount;
    }
    const cand = data.usageMetadata.candidatesTokenCount ?? 0;
    const thoughts = data.usageMetadata.thoughtsTokenCount ?? 0;
    if (cand > 0 || thoughts > 0) state.outputTokens = cand + thoughts;
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    const blocked = promptBlockedText(data.promptFeedback);
    if (blocked) {
      if (!state.textBlockOpen) {
        state.textBlockIndex = state.nextBlockIndex++;
        state.textBlockOpen = true;
        events.push({ type: 'content_block_start', index: state.textBlockIndex, block: { type: 'text' } });
      }
      events.push({ type: 'text_delta', index: state.textBlockIndex!, text: blocked });
      state.pendingFinish = 'refusal';
    }
    return;
  }

  if (Array.isArray(candidate.content?.parts)) {
    for (const part of candidate.content.parts) {
      if (!part || typeof part !== 'object') continue;
      if ('text' in part && typeof part.text === 'string' && part.text.length > 0) {
        if (!state.textBlockOpen) {
          state.textBlockIndex = state.nextBlockIndex++;
          state.textBlockOpen = true;
          events.push({
            type: 'content_block_start',
            index: state.textBlockIndex,
            block: { type: 'text' },
          });
        }
        events.push({ type: 'text_delta', index: state.textBlockIndex!, text: part.text });
      } else if ('functionCall' in part && part.functionCall) {
        // Close the text block first — the IR invariant is one open block
        // at a time. Then emit start + full-args delta + stop all at once.
        if (state.textBlockOpen && state.textBlockIndex != null) {
          events.push({ type: 'content_block_stop', index: state.textBlockIndex });
          state.textBlockOpen = false;
          state.textBlockIndex = null;
        }
        const blockIdx = state.nextBlockIndex++;
        const fc = part.functionCall;
        state.hasToolUse = true;
        events.push({
          type: 'content_block_start',
          index: blockIdx,
          block: {
            type: 'tool_use',
            id: fc.id ?? upstreamCallId(state.messageId || data.responseId, state.toolCallCount++),
            name: fc.name,
          },
        });
        events.push({
          type: 'tool_input_delta',
          index: blockIdx,
          partialJson: JSON.stringify(fc.args ?? {}),
        });
        events.push({ type: 'content_block_stop', index: blockIdx });
      }
    }
  }

  if (candidate.finishReason) {
    state.pendingFinish = mapGeminiFinishToIR(candidate.finishReason, state.hasToolUse);
  }
}

function extractGeminiDataLine(frame: string): string | null {
  const lines = frame.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) return line.slice(6);
    if (line.startsWith('data:')) return line.slice(5).trimStart();
  }
  return null;
}

// ─── createStreamSerializer ───────────────────────────────────────────────

function createStreamSerializer(ctx: TranslationContext): IRStreamSerializer {
  // Build a Gemini-shaped SSE stream from IR events. Each emitted frame is a
  // complete GenerateContentResponse. Text deltas emit a frame per delta.
  // Tool calls emit a single frame with the buffered args (we buffer tool
  // input across tool_input_delta events, flush at content_block_stop).
  //
  // Usage + finishReason go on the final frame at message_stop time.

  const state = {
    model: ctx.srcModel ?? ctx.dstModel,
    responseId: `msg_${ctx.requestId}`,
    blocks: new Map<number, { type: 'text' | 'tool_use' | 'thinking'; id?: string; name?: string; args: string }>(),
    inputTokens: 0,
    outputTokens: 0,
    pendingFinish: 'STOP' as GeminiFinishReason,
    done: false,
  };

  function emitFrame(data: object): string {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  return {
    process(events: IRStreamEvent[]): string {
      let out = '';
      for (const event of events) {
        if (state.done) break;
        switch (event.type) {
          case 'message_start':
            if (event.id) state.responseId = event.id;
            // Echo the app's own model, as serializeResponse does; the
            // upstream model only fills in when the app's is unknown.
            if (event.model && ctx.srcModel == null) state.model = event.model;
            if (typeof event.usage.inputTokens === 'number') state.inputTokens = event.usage.inputTokens;
            if (typeof event.usage.outputTokens === 'number') state.outputTokens = event.usage.outputTokens;
            break;
          case 'content_block_start':
            state.blocks.set(event.index, {
              type: event.block.type,
              ...(event.block.type === 'tool_use'
                ? { id: event.block.id, name: event.block.name }
                : {}),
              args: '',
            });
            break;
          case 'text_delta':
            out += emitFrame({
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: event.text }] },
                  index: 0,
                },
              ],
              modelVersion: state.model,
              responseId: state.responseId,
            });
            break;
          case 'tool_input_delta': {
            const entry = state.blocks.get(event.index);
            if (entry) entry.args += event.partialJson;
            break;
          }
          case 'content_block_stop': {
            const entry = state.blocks.get(event.index);
            if (entry && entry.type === 'tool_use' && entry.name) {
              let args: unknown = {};
              if (entry.args) {
                try { args = JSON.parse(entry.args); } catch { args = { _raw: entry.args }; }
              }
              out += emitFrame({
                candidates: [
                  {
                    content: {
                      role: 'model',
                      parts: [{ functionCall: { id: entry.id, name: entry.name, args } }],
                    },
                    index: 0,
                  },
                ],
                modelVersion: state.model,
                responseId: state.responseId,
              });
            }
            state.blocks.delete(event.index);
            break;
          }
          case 'thinking_delta':
            // Gemini has no streaming thinking surface — drop.
            break;
          case 'message_delta':
            if (typeof event.usage?.inputTokens === 'number') state.inputTokens = event.usage.inputTokens;
            if (typeof event.usage?.outputTokens === 'number') state.outputTokens = event.usage.outputTokens;
            state.pendingFinish = mapIRStopToGeminiFinish(event.stopReason ?? 'end_turn');
            break;
          case 'message_stop':
            out += emitFrame({
              candidates: [
                {
                  content: { role: 'model', parts: [] },
                  finishReason: state.pendingFinish,
                  index: 0,
                },
              ],
              usageMetadata: {
                promptTokenCount: state.inputTokens,
                candidatesTokenCount: state.outputTokens,
                totalTokenCount: state.inputTokens + state.outputTokens,
              },
              modelVersion: state.model,
              responseId: state.responseId,
            });
            state.done = true;
            break;
          case 'error':
            out += emitFrame({
              error: {
                code: 500,
                message: event.error.message,
                status: event.error.type,
              },
            });
            state.done = true;
            break;
        }
      }
      return out;
    },
    flush(): string {
      // Gemini has no terminal sentinel; just signal done.
      state.done = true;
      return '';
    },
  };
}
