/**
 * PII / secret redaction for prompt capture. When a budget/policy opts into
 * `log_prompts`, the gateway stores a SHORT, REDACTED preview of the prompt —
 * never the raw content — so observability doesn't become a data-exfiltration
 * or compliance liability. Pure + tested.
 */

const PATTERNS: [RegExp, string][] = [
  // Provider / API keys and tokens (do these first, before generic patterns).
  [/\b(sk|pk|rk|byk)[-_](?:live|test|proj|ant|or)?[-_a-z0-9]{16,}\b/gi, '[REDACTED_KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\bBearer\s+[A-Za-z0-9._\-]{16,}/gi, 'Bearer [REDACTED]'],
  [/\bghp_[A-Za-z0-9]{20,}\b/g, '[REDACTED_TOKEN]'],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, '[REDACTED_JWT]'],
  // Emails.
  [/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]'],
  // Credit-card-like (13–16 digits, optional separators).
  [/\b(?:\d[ \-]?){13,16}\b/g, '[REDACTED_CARD]'],
  // US SSN.
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]'],
  // Phone numbers (loose).
  [/\b\+?\d{1,3}[ \-.]?\(?\d{2,4}\)?[ \-.]?\d{3,4}[ \-.]?\d{3,4}\b/g, '[REDACTED_PHONE]'],
];

/**
 * Redact secrets/PII from `text` and truncate to `maxLen` (default 200).
 * Returns undefined for empty input.
 */
export function redactText(text: string | undefined, maxLen = 200): string | undefined {
  if (!text) return undefined;
  let out = text;
  for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  if (out.length > maxLen) out = out.slice(0, maxLen) + '…';
  return out;
}

/**
 * Build a redacted preview from an OpenAI/Anthropic-style message body — takes
 * the last user message (the salient prompt), redacts + truncates it.
 */
export function redactedPromptPreview(body: unknown, maxLen = 200): string | undefined {
  const b = body as { messages?: { role?: string; content?: unknown }[] } | undefined;
  const msgs = Array.isArray(b?.messages) ? b!.messages : [];
  const last = [...msgs].reverse().find((m) => m.role === 'user') ?? msgs[msgs.length - 1];
  const content = typeof last?.content === 'string' ? last.content
    : Array.isArray(last?.content) ? last.content.map((p) => (typeof p === 'object' && p && 'text' in p ? (p as { text?: string }).text : '')).join(' ')
    : '';
  return redactText(content, maxLen);
}
