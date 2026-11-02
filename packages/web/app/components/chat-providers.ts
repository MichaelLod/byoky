/**
 * Chat endpoint of each provider the /demo Backend Relay tab can call. The
 * wallet only forwards a request whose URL is on the provider's registered
 * origin (core's validateProxyUrl) and answers 403 INVALID_URL otherwise, so
 * these can't be derived from the provider id. Gemini takes the model in the
 * path: append `/{model}:generateContent`.
 */
export const CHAT_ENDPOINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  cohere: 'https://api.cohere.com/v2/chat',
  xai: 'https://api.x.ai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  perplexity: 'https://api.perplexity.ai/chat/completions',
};

/**
 * The field that caps the reply length in an OpenAI-dialect chat request.
 * OpenAI takes `max_completion_tokens` (its reasoning models reject
 * `max_tokens`); the other hosts of the dialect document `max_tokens`, and
 * Mistral rejects any field it doesn't know with a 422. The same rule as
 * core's translator (usesMaxCompletionTokens).
 */
export function outputCapField(providerId: string): 'max_completion_tokens' | 'max_tokens' {
  return providerId === 'openai' ? 'max_completion_tokens' : 'max_tokens';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * The message of a failed OpenAI-dialect call: `error.message` (OpenAI and
 * most hosts, and the wallet's own errors), a plain `error` or `message`
 * string, or the `msg` of a validation error (Mistral's 422 puts it in
 * `message.detail[]`, FastAPI-style hosts in `detail[]`).
 */
export function openAICompatErrorMessage(body: unknown): string | undefined {
  const b = asRecord(body);
  if (!b) return undefined;
  const error = b.error;
  if (typeof error === 'string' && error) return error;
  const errorMessage = asRecord(error)?.message;
  if (typeof errorMessage === 'string' && errorMessage) return errorMessage;
  if (typeof b.message === 'string' && b.message) return b.message;
  for (const detail of [asRecord(b.message)?.detail, b.detail]) {
    if (typeof detail === 'string' && detail) return detail;
    if (!Array.isArray(detail)) continue;
    const msgs = detail
      .map((d) => asRecord(d)?.msg)
      .filter((m): m is string => typeof m === 'string' && m.length > 0);
    if (msgs.length > 0) return msgs.join('; ');
  }
  return undefined;
}

/**
 * The model a chat sends for a provider: the saved pick while `models`
 * still offers it, the first of `models` otherwise. A pick the list no
 * longer has (a retired model) would go out with every request while the
 * model select, which has no option for it, shows the first model.
 */
export function pickModel(models: readonly string[], saved: string | undefined): string {
  return saved && models.includes(saved) ? saved : (models[0] ?? '');
}

/**
 * The saved per-provider model picks (parsed from storage) that `catalog`
 * still offers. Everything else is dropped, so a retired id isn't stored
 * again.
 */
export function offeredModelPicks(
  saved: unknown,
  catalog: Record<string, { models: readonly string[] }>,
): Record<string, string> {
  const picks: Record<string, string> = {};
  const s = asRecord(saved);
  if (!s || Array.isArray(s)) return picks;
  for (const [providerId, model] of Object.entries(s)) {
    if (typeof model !== 'string') continue;
    if (!Object.prototype.hasOwnProperty.call(catalog, providerId)) continue;
    if (catalog[providerId].models.includes(model)) picks[providerId] = model;
  }
  return picks;
}

// Cohere's v2 chat API isn't OpenAI-shaped: it takes `max_tokens`, streams
// `content-delta` events and returns the reply as `message.content[]`.

/** The text a Cohere v2 stream event adds, if it is a `content-delta` with text. */
export function cohereStreamText(event: unknown): string | undefined {
  const e = asRecord(event);
  if (e?.type !== 'content-delta') return undefined;
  const content = asRecord(asRecord(asRecord(e.delta)?.message)?.content);
  return typeof content?.text === 'string' ? content.text : undefined;
}

/** The reply text of a non-streamed Cohere v2 chat response. */
export function cohereResponseText(body: unknown): string | undefined {
  const content = asRecord(asRecord(body)?.message)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      const p = asRecord(part);
      return p?.type === 'text' && typeof p.text === 'string' ? p.text : '';
    })
    .join('');
  return text || undefined;
}

/**
 * The message of a failed Cohere call: Cohere puts it in `message`, the
 * wallet's own errors in `error.message`.
 */
export function cohereErrorMessage(body: unknown): string | undefined {
  const b = asRecord(body);
  const wallet = asRecord(b?.error)?.message;
  if (typeof wallet === 'string' && wallet) return wallet;
  return typeof b?.message === 'string' && b.message ? b.message : undefined;
}
