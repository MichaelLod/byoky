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

// Cohere's v2 chat API isn't OpenAI-shaped: it takes `max_tokens`, streams
// `content-delta` events and returns the reply as `message.content[]`.

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

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
