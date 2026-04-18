import type { RequestLogEntry, TokenAllowance, CapabilitySet } from './types.js';
import { PROVIDERS } from './providers.js';

/**
 * Validate that a proxy request URL targets the registered provider's base URL.
 * Prevents API key exfiltration by rejecting requests to arbitrary domains.
 *
 * `overrideBaseUrl` lets the caller supply a per-credential base URL for
 * providers whose host isn't fixed globally (e.g. Azure OpenAI, where every
 * tenant has its own `<resource>.openai.azure.com`). Strictly honored for
 * `requiresCustomBaseUrl` providers — absent override means reject.
 */
export function validateProxyUrl(
  providerId: string,
  url: string,
  overrideBaseUrl?: string,
): boolean {
  const provider = PROVIDERS[providerId];
  if (!provider) return false;
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:') return false;

    if (provider.requiresCustomBaseUrl) {
      if (!overrideBaseUrl) return false;
      const base = new URL(overrideBaseUrl);
      if (base.protocol !== 'https:') return false;
      return target.origin === base.origin;
    }

    // If a trusted override is supplied for a fixed-host provider, it must
    // still match that provider's registered origin — we refuse to trust a
    // per-credential baseUrl that would redirect traffic elsewhere.
    const base = new URL(overrideBaseUrl ?? provider.baseUrl);
    return target.origin === base.origin;
  } catch {
    return false;
  }
}

/**
 * Allow-list of forwardable client header names (lowercase). Anything not on
 * this list is dropped before we hit the upstream provider.
 *
 * Why an allow-list and not a deny-list:
 *   - Hop-by-hop headers (`host`, `connection`, `transfer-encoding`, `te`,
 *     `upgrade`, `proxy-authorization`) must never traverse a proxy — and
 *     transfer-encoding mismatched with content-length is a classic request-
 *     smuggling vector against any upstream that disagrees with our parser.
 *   - `cookie` would carry session state into the provider's logs.
 *   - SDK telemetry / browser-fetch metadata (`x-stainless-*`, `sec-fetch-*`,
 *     `origin`, `referer`) leaks the real client environment to providers
 *     and frequently triggers their bot-detection middleware.
 *   - `authorization` / `x-api-key` / `api-key` are the SDK's *fake* session
 *     keys; the real ones are injected below.
 *
 * Auth-related headers and content-length are added back below by the
 * provider-specific branches and by fetch() itself.
 */
const FORWARDABLE_HEADERS = new Set([
  'content-type',
  'accept',
  // Anthropic
  'anthropic-version',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'x-app',
  'user-agent',
  // Cohere
  'x-client-name',
  // OpenAI
  'openai-organization',
  'openai-project',
  'openai-beta',
  // Google
  'x-goog-api-client',
]);

/**
 * Reject header values containing CR/LF/NUL — defense against header injection
 * smuggled through arbitrary string values. undici already rejects these,
 * but explicit + early is cheaper than discovering it inside fetch().
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x0a || code === 0x0d || code === 0x00) return true;
  }
  return false;
}

/**
 * Build the real auth headers for a provider API request.
 * Strips any fake session-key headers and injects the real API key.
 */
export function buildHeaders(
  providerId: string,
  requestHeaders: Record<string, string>,
  apiKey: string,
  authMethod: string = 'api_key',
): Record<string, string> {
  // Allow-list: only known-safe headers are forwarded. Everything else (host,
  // cookie, transfer-encoding, x-stainless-*, sec-fetch-*, origin, referer,
  // proxy-authorization, content-length, ...) is dropped silently. fetch()
  // recomputes content-length from the actual body it sends, and the auth
  // headers are injected in the provider-specific branches below.
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (typeof value !== 'string') continue;
    const lower = key.toLowerCase();
    if (!FORWARDABLE_HEADERS.has(lower)) continue;
    if (hasControlChars(value)) continue;
    headers[lower] = value;
  }

  if (providerId === 'anthropic') {
    if (authMethod === 'oauth') {
      headers['authorization'] = `Bearer ${apiKey}`;
      headers['user-agent'] = 'claude-cli/2.1.76';
      headers['x-app'] = 'cli';
      headers['accept'] = headers['accept'] ?? 'application/json';
      // Merge app's beta flags with OAuth-required flags
      const oauthBeta = ['claude-code-20250219', 'oauth-2025-04-20', 'fine-grained-tool-streaming-2025-05-14', 'interleaved-thinking-2025-05-14'];
      const existing = headers['anthropic-beta'] ? headers['anthropic-beta'].split(',').map(s => s.trim()) : [];
      headers['anthropic-beta'] = [...new Set([...existing, ...oauthBeta])].join(',');
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      headers['x-api-key'] = apiKey;
    }
    headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
  } else if (providerId === 'azure_openai') {
    headers['api-key'] = apiKey;
  } else if (providerId === 'gemini') {
    // Google AI Studio accepts x-goog-api-key OR ?key= query param. The
    // header is safer (query params get sanitized out of logs).
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers['authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * Parse the model name from a request body (JSON).
 */
const MAX_BODY_PARSE_SIZE = 10_485_760; // 10 MB

/**
 * Inspect a request body and return the set of advanced capabilities it uses.
 *
 * Used by the request logger to record per-request capability fingerprints,
 * which the popup later aggregates by app to surface drag-time warnings when
 * a user is about to route an app to a model that lacks one of those
 * capabilities.
 *
 * Inspects the body shape generously: tries both Anthropic and OpenAI shapes
 * since either dialect may be on the wire (the source-side body is what we
 * inspect, before any translation).
 */
export function detectRequestCapabilities(body?: string): CapabilitySet {
  const empty: CapabilitySet = {
    tools: false,
    vision: false,
    structuredOutput: false,
    reasoning: false,
  };
  if (!body || body.length > MAX_BODY_PARSE_SIZE) return empty;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return empty;
  }

  const out: CapabilitySet = { ...empty };

  // tools[] is the same key in both Anthropic and OpenAI dialects.
  if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    out.tools = true;
  }

  // OpenAI structured output: response_format with json_schema (not just json_object).
  const rf = parsed.response_format as { type?: string } | undefined;
  if (rf && typeof rf === 'object' && rf.type === 'json_schema') {
    out.structuredOutput = true;
  }

  // Anthropic extended thinking is opted-in via the `thinking` field.
  if (parsed.thinking != null) {
    out.reasoning = true;
  }

  // Vision: walk messages[] looking for image/image_url content blocks.
  if (Array.isArray(parsed.messages)) {
    outer: for (const msg of parsed.messages) {
      const content = (msg as { content?: unknown })?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const type = (block as { type?: unknown }).type;
        if (type === 'image' || type === 'image_url') {
          out.vision = true;
          break outer;
        }
      }
    }
  }

  return out;
}

export function parseModel(body?: string): string | undefined {
  if (!body || body.length > MAX_BODY_PARSE_SIZE) return undefined;
  try {
    const parsed = JSON.parse(body);
    return parsed.model ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Providers that require `stream_options: { include_usage: true }` to report
 * token usage in streaming (SSE) responses. Without this flag their streaming
 * chunks never contain a `usage` object and we record 0 tokens.
 */
const STREAM_USAGE_PROVIDERS = new Set([
  'openai',
  'azure_openai',
  'together',
  'deepseek',
]);

/**
 * Inject `stream_options.include_usage` into the request body for providers
 * that don't report token usage in streaming responses by default.
 * Returns the (possibly modified) body string. No-ops for non-JSON or
 * non-streaming requests.
 */
export function injectStreamUsageOptions(
  providerId: string,
  body?: string,
): string | undefined {
  if (!body || !STREAM_USAGE_PROVIDERS.has(providerId)) return body;
  try {
    const parsed = JSON.parse(body);
    if (parsed.stream === true && !parsed.stream_options?.include_usage) {
      parsed.stream_options = { ...parsed.stream_options, include_usage: true };
      return JSON.stringify(parsed);
    }
  } catch {
    // not JSON — return as-is
  }
  return body;
}

/**
 * Parse token usage from a provider API response body.
 * Handles both regular JSON responses and SSE streaming responses.
 */
export function parseUsage(
  providerId: string,
  body: string,
): { inputTokens: number; outputTokens: number } | undefined {
  try {
    // For streaming responses (SSE), try to find usage in the last data chunk
    if (body.includes('data: ')) {
      const lines = body.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));

      // Anthropic streaming: input_tokens is in message_start.message.usage,
      // output_tokens is in message_delta.usage — combine both.
      if (providerId === 'anthropic') {
        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.replace('data: ', ''));
            if (parsed.type === 'message_start') {
              const u = (parsed.message as Record<string, unknown>)?.usage as Record<string, number> | undefined;
              if (u?.input_tokens != null) inputTokens = u.input_tokens;
            } else if (parsed.type === 'message_delta') {
              const u = parsed.usage as Record<string, number> | undefined;
              if (u?.output_tokens != null) outputTokens = u.output_tokens;
            }
          } catch { continue; }
        }
        if (inputTokens != null && outputTokens != null) {
          return sanitizeTokenCounts(inputTokens, outputTokens);
        }
        return undefined;
      }

      // Gemini streaming (?alt=sse): each frame is a full GenerateContentResponse.
      // usageMetadata typically appears on the last frame.
      if (providerId === 'gemini') {
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i].replace('data: ', ''));
            const usage = extractUsageFromParsed('gemini', parsed);
            if (usage) return usage;
          } catch {
            continue;
          }
        }
        return undefined;
      }

      // Cohere streaming: usage is on the final `message-end` frame under
      // `delta.usage.tokens`.
      if (providerId === 'cohere') {
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i].replace('data: ', ''));
            if (parsed.type === 'message-end') {
              const tokens = parsed.delta?.usage?.tokens as
                | { input_tokens?: number; output_tokens?: number }
                | undefined;
              if (tokens?.input_tokens != null && tokens.output_tokens != null) {
                return sanitizeTokenCounts(tokens.input_tokens, tokens.output_tokens);
              }
            }
          } catch { continue; }
        }
        return undefined;
      }

      // OpenAI-compatible streaming: last chunk may include usage
      for (let i = lines.length - 1; i >= 0; i--) {
        const json = lines[i].replace('data: ', '');
        try {
          const parsed = JSON.parse(json);
          const usage = extractUsageFromParsed(providerId, parsed);
          if (usage) return usage;
        } catch {
          continue;
        }
      }
      return undefined;
    }

    const parsed = JSON.parse(body);
    return extractUsageFromParsed(providerId, parsed);
  } catch {
    return undefined;
  }
}

function sanitizeTokenCounts(
  input: number,
  output: number,
): { inputTokens: number; outputTokens: number } | undefined {
  const i = Math.max(0, Math.floor(input));
  const o = Math.max(0, Math.floor(output));
  if (!Number.isFinite(i) || !Number.isFinite(o)) return undefined;
  return { inputTokens: i, outputTokens: o };
}

/**
 * Extract token usage from a parsed provider response object.
 */
export function extractUsageFromParsed(
  providerId: string,
  parsed: Record<string, unknown>,
): { inputTokens: number; outputTokens: number } | undefined {
  // Anthropic: { usage: { input_tokens, output_tokens } }
  if (providerId === 'anthropic') {
    const usage = parsed.usage as Record<string, number> | undefined;
    if (usage?.input_tokens != null && usage?.output_tokens != null) {
      return sanitizeTokenCounts(usage.input_tokens, usage.output_tokens);
    }
  }

  // Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
  if (providerId === 'gemini') {
    const meta = parsed.usageMetadata as Record<string, number> | undefined;
    if (meta?.promptTokenCount != null) {
      // thoughtsTokenCount is charged separately on thinking-enabled models;
      // roll it into output tokens so billing adds up.
      const thoughts = meta.thoughtsTokenCount ?? 0;
      return sanitizeTokenCounts(
        meta.promptTokenCount,
        (meta.candidatesTokenCount ?? 0) + thoughts,
      );
    }
  }

  // Cohere v2: { usage: { tokens: { input_tokens, output_tokens } } }
  if (providerId === 'cohere') {
    const usage = parsed.usage as
      | { tokens?: { input_tokens?: number; output_tokens?: number } }
      | undefined;
    if (usage?.tokens?.input_tokens != null && usage.tokens.output_tokens != null) {
      return sanitizeTokenCounts(usage.tokens.input_tokens, usage.tokens.output_tokens);
    }
  }

  // Groq streaming: usage is nested under x_groq.usage instead of top-level usage
  if (providerId === 'groq') {
    const xGroq = parsed.x_groq as Record<string, unknown> | undefined;
    if (xGroq?.usage) {
      const groqUsage = xGroq.usage as Record<string, number>;
      if (groqUsage.prompt_tokens != null && groqUsage.completion_tokens != null) {
        return sanitizeTokenCounts(groqUsage.prompt_tokens, groqUsage.completion_tokens);
      }
    }
  }

  // OpenAI-compatible (openai, groq, together, deepseek, xai, perplexity, fireworks, openrouter, mistral, azure_openai):
  // { usage: { prompt_tokens, completion_tokens } }
  const usage = parsed.usage as Record<string, number> | undefined;
  if (usage?.prompt_tokens != null && usage?.completion_tokens != null) {
    return sanitizeTokenCounts(usage.prompt_tokens, usage.completion_tokens);
  }

  return undefined;
}

/**
 * Check whether a request is allowed given token allowances and usage history.
 * Pure computation — no storage access.
 */
export function computeAllowanceCheck(
  allowance: TokenAllowance | undefined,
  entries: Pick<RequestLogEntry, 'providerId' | 'inputTokens' | 'outputTokens'>[],
  providerId: string,
): { allowed: boolean; reason?: string } {
  if (!allowance) return { allowed: true };

  let totalUsed = 0;
  const byProvider: Record<string, number> = {};
  for (const entry of entries) {
    const tokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
    totalUsed += tokens;
    byProvider[entry.providerId] = (byProvider[entry.providerId] ?? 0) + tokens;
  }

  if (allowance.totalLimit != null && totalUsed >= allowance.totalLimit) {
    return { allowed: false, reason: `Token allowance exceeded for ${allowance.origin}` };
  }

  const providerLimit = allowance.providerLimits?.[providerId];
  if (providerLimit != null && (byProvider[providerId] ?? 0) >= providerLimit) {
    return { allowed: false, reason: `Token allowance for ${providerId} exceeded` };
  }

  return { allowed: true };
}

const CLAUDE_CODE_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

/**
 * Inject the Claude Code system prompt prefix into a JSON request body.
 *
 * Two modes based on `relocateExisting`:
 *  - false (default, for Claude Code CLI): prepend the prefix to whatever system
 *    field already exists (preserving the user's system content as a Claude Code
 *    extension).
 *  - true (for non-Claude-Code frameworks like OpenClaw): replace the system
 *    field with ONLY the Claude Code prefix, and move the original system content
 *    into the first user message wrapped in <system_context> tags. Anthropic's
 *    third-party detection inspects the system field content; relocating it lets
 *    arbitrary frameworks pass the check.
 */
export function injectClaudeCodeSystemPrompt(
  body: string | undefined,
  options?: { relocateExisting?: boolean },
): string | undefined {
  if (!body) return body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const relocate = options?.relocateExisting === true;

    if (relocate) {
      // Extract the original system text (if any)
      const originalSystem = extractSystemText(parsed.system);
      // Replace system with bare Claude Code prefix
      parsed.system = CLAUDE_CODE_SYSTEM_PREFIX;
      // Prepend original system content to the first user message as a context block
      if (originalSystem && Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        parsed.messages = relocateSystemToFirstUserMessage(
          parsed.messages,
          originalSystem,
        );
      }
    } else {
      // Original behavior: prepend prefix to existing system
      if (!parsed.system) {
        parsed.system = CLAUDE_CODE_SYSTEM_PREFIX;
      } else if (typeof parsed.system === 'string') {
        parsed.system = `${CLAUDE_CODE_SYSTEM_PREFIX}\n\n${parsed.system}`;
      } else if (Array.isArray(parsed.system)) {
        parsed.system = [{ type: 'text', text: CLAUDE_CODE_SYSTEM_PREFIX }, ...parsed.system];
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

/**
 * Concatenate any system field shape (string, text-block array, or undefined)
 * into a single string for relocation. Non-text blocks are skipped.
 */
function extractSystemText(system: unknown): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
          return String((block as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .filter((s) => s.length > 0)
      .join('\n\n');
  }
  return '';
}

/**
 * Prepend the original system content to the first user message in a messages
 * array, wrapped in <system_context> tags. Returns a new messages array.
 *
 * The first message must be a user-role message (Anthropic API requires this).
 * If the first message has structured content (array of blocks), the context is
 * added as a new text block at the start. If it has plain string content, the
 * context is concatenated.
 */
function relocateSystemToFirstUserMessage(
  messages: unknown[],
  systemText: string,
): unknown[] {
  const wrapped = `<system_context>\n${systemText}\n</system_context>\n\n`;
  const out = [...messages];
  const first = out[0] as { role?: unknown; content?: unknown } | undefined;
  if (!first || first.role !== 'user') return out;

  if (typeof first.content === 'string') {
    out[0] = { ...first, content: `${wrapped}${first.content}` };
  } else if (Array.isArray(first.content)) {
    out[0] = {
      ...first,
      content: [{ type: 'text', text: wrapped }, ...first.content],
    };
  }
  return out;
}

/**
 * Rewrite tool names in an Anthropic /v1/messages request body so the request
 * looks like it came from Claude Code (Anthropic's first-party CLI).
 *
 * Why: when an OAuth setup token is used to call /v1/messages, Anthropic
 * classifies the request as "Claude Code" or "third-party" based partly on
 * tool names. Tools whose names don't match the canonical Claude Code set
 * (Read, Edit, Bash, ...) get rejected with a billing error even when the
 * Claude Code system prompt is injected.
 *
 * This function:
 *  1. Detects "non-Claude-Code" tool names (lowercase or snake_case)
 *  2. Builds a bidirectional mapping (original ↔ PascalCase alias)
 *  3. Rewrites the tools[] array, all past tool_use blocks in messages,
 *     and all tool_result blocks (which reference tool_use_id, not name —
 *     so those don't need rewriting)
 *
 * Returns { body, toolNameMap } where toolNameMap goes from CC-alias → original,
 * so the caller can pass it to `rewriteToolUseInSSEChunk` to translate the
 * streaming response back to names the framework expects.
 *
 * If no rewriting is needed (all names already PascalCase or no tools), returns
 * the body unchanged with an empty map.
 */
export function rewriteToolNamesForClaudeCode(
  body: string | undefined,
): { body: string | undefined; toolNameMap: Record<string, string> } {
  if (!body) return { body, toolNameMap: {} };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { body, toolNameMap: {} };
  }

  const tools = parsed.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return { body, toolNameMap: {} };
  }

  // Detect: any tool with a non-PascalCase name needs the rewrite
  const needsRewrite = tools.some((t) => {
    const name = (t as { name?: unknown })?.name;
    return typeof name === 'string' && !/^[A-Z][A-Za-z0-9]*$/.test(name);
  });
  if (!needsRewrite) return { body, toolNameMap: {} };

  // Build forward (original → alias) and reverse (alias → original) maps
  const forward: Record<string, string> = {};
  const reverse: Record<string, string> = {};
  for (const t of tools) {
    const name = (t as { name?: unknown })?.name;
    if (typeof name !== 'string') continue;
    if (forward[name]) continue;
    const alias = toClaudeCodeToolName(name, new Set(Object.values(forward)));
    forward[name] = alias;
    reverse[alias] = name;
  }

  // Rewrite the tools[] array
  parsed.tools = tools.map((t) => {
    const tt = t as { name?: unknown };
    if (typeof tt.name === 'string' && forward[tt.name]) {
      return { ...t, name: forward[tt.name] };
    }
    return t;
  });

  // Rewrite tool_use blocks in past assistant messages (so the conversation
  // history stays consistent — Claude needs the names in past tool_use to
  // match what's in tools[])
  const messages = parsed.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      const content = (msg as { content?: unknown })?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as { type?: unknown; name?: unknown };
        if (b.type === 'tool_use' && typeof b.name === 'string' && forward[b.name]) {
          (b as { name: string }).name = forward[b.name];
        }
      }
    }
  }

  return { body: JSON.stringify(parsed), toolNameMap: reverse };
}

/**
 * Convert a tool name to Claude-Code-style PascalCase. Handles snake_case,
 * camelCase, and lowercase. Disambiguates collisions by appending a digit.
 */
function toClaudeCodeToolName(name: string, taken: Set<string>): string {
  // snake_case or kebab-case → PascalCase
  let pascal = name
    .split(/[_\-]/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  // already-camelCase: just uppercase the first letter
  if (pascal === name && name.length > 0) {
    pascal = name.charAt(0).toUpperCase() + name.slice(1);
  }
  // collision: append a digit
  let candidate = pascal;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${pascal}${n}`;
    n++;
  }
  return candidate;
}

/**
 * Rewrite tool_use block names in a non-streaming Anthropic Messages JSON
 * response, translating Claude-Code-style aliases back to the upstream
 * framework's original names.
 *
 * The SSE rewriter (createToolNameSSERewriter) only handles streaming
 * responses where each `data: <json>\n\n` frame contains one event. When the
 * caller requests `stream: false`, Anthropic returns the full Messages object
 * as a single JSON body — no SSE framing. This helper is the JSON-body
 * counterpart, used by the bridge when Content-Type is application/json.
 *
 * Walks the top-level `content[]` array and rewrites any `tool_use` block's
 * `name` field via the alias→original map. Empty map → identity passthrough.
 * Unparseable JSON → identity passthrough (the bridge would fail elsewhere).
 */
export function rewriteToolNamesInJSONBody(
  body: string,
  toolNameMap: Record<string, string>,
): string {
  if (Object.keys(toolNameMap).length === 0) return body;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return body;
  }
  const content = parsed.content;
  if (!Array.isArray(content)) return body;
  let mutated = false;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; name?: unknown };
    if (b.type === 'tool_use' && typeof b.name === 'string' && toolNameMap[b.name]) {
      (b as { name: string }).name = toolNameMap[b.name];
      mutated = true;
    }
  }
  return mutated ? JSON.stringify(parsed) : body;
}

/**
 * Stateful rewriter for an Anthropic SSE response stream that translates
 * `tool_use` block names from Claude-Code-style aliases back to the upstream
 * framework's original names.
 *
 * Use:
 *   const r = createToolNameSSERewriter(map);
 *   for each chunk: emit(r.process(chunk));
 *   on stream end:  emit(r.flush());
 *
 * Empty map → identity passthrough (no buffering, no parsing).
 */
export function createToolNameSSERewriter(
  toolNameMap: Record<string, string>,
): { process: (chunk: string) => string; flush: () => string } {
  if (Object.keys(toolNameMap).length === 0) {
    return {
      process: (chunk) => chunk,
      flush: () => '',
    };
  }
  let buffer = '';
  return {
    process: (chunk: string): string => {
      buffer += chunk;
      let out = '';
      let idx: number;
      // SSE frames are terminated by \n\n
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx + 2);
        buffer = buffer.slice(idx + 2);
        out += rewriteSSEFrame(frame, toolNameMap);
      }
      return out;
    },
    flush: (): string => {
      const leftover = buffer;
      buffer = '';
      return leftover;
    },
  };
}

/**
 * Rewrite a single complete SSE frame. If the frame is a content_block_start
 * with a tool_use block, rewrite its name using the alias→original map.
 */
function rewriteSSEFrame(frame: string, toolNameMap: Record<string, string>): string {
  // Frame format: "event: <type>\ndata: <json>\n\n"
  const dataMatch = /^data: (.+)$/m.exec(frame);
  if (!dataMatch) return frame;
  const dataLine = dataMatch[1];
  try {
    const data = JSON.parse(dataLine);
    if (
      data?.type === 'content_block_start' &&
      data?.content_block?.type === 'tool_use' &&
      typeof data.content_block.name === 'string' &&
      toolNameMap[data.content_block.name]
    ) {
      data.content_block.name = toolNameMap[data.content_block.name];
      const rewrittenData = JSON.stringify(data);
      return frame.replace(dataLine, rewrittenData);
    }
  } catch {
    // not JSON or unexpected shape — pass through
  }
  return frame;
}

