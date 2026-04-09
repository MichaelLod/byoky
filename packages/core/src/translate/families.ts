import type { ProviderId } from '../types.js';
import type { ModelFamily } from '../models.js';
import { PROVIDERS } from '../providers.js';

/**
 * Translation family detection.
 *
 * The translation layer reasons about provider *families* — sets of providers
 * that speak the same API dialect. Two providers in the same family can
 * substitute for each other byte-for-byte (modulo auth). Two providers in
 * different families need translation in between.
 *
 * Only families with a defined translator pair are listed. Providers not in
 * either set (gemini, cohere, replicate, huggingface) cannot be the source or
 * destination of a translated request — they still work for pass-through.
 */

const ANTHROPIC_FAMILY: ReadonlySet<ProviderId> = new Set<ProviderId>([
  'anthropic',
]);

/**
 * The OpenAI Chat Completions family.
 *
 * These providers all expose a `/v1/chat/completions`-compatible endpoint
 * with OpenAI-style request/response shapes. The OpenAI translator works
 * against any of them as a destination.
 *
 * Notably absent: gemini (Google's own dialect), cohere (Cohere v2 chat
 * format), replicate (model-specific shapes), huggingface (model-specific).
 */
const OPENAI_FAMILY: ReadonlySet<ProviderId> = new Set<ProviderId>([
  'openai',
  'azure_openai',
  'groq',
  'together',
  'deepseek',
  'xai',
  'perplexity',
  'fireworks',
  'openrouter',
  'mistral',
]);

/**
 * Map a provider id to its translation family. Returns null for providers
 * outside the translatable families — translation cannot be performed when
 * either side returns null.
 */
export function familyOf(providerId: ProviderId): ModelFamily | null {
  if (ANTHROPIC_FAMILY.has(providerId)) return 'anthropic';
  if (OPENAI_FAMILY.has(providerId)) return 'openai';
  return null;
}

/**
 * Should the request from `srcProviderId` to `dstProviderId` be translated?
 *
 * True iff:
 *  - both providers are in known families
 *  - the families differ (same family = pass-through)
 *
 * Used at proxy entry to decide whether to invoke the translation pipeline
 * or run the existing identity path.
 */
export function shouldTranslate(
  srcProviderId: ProviderId,
  dstProviderId: ProviderId,
): boolean {
  const src = familyOf(srcProviderId);
  if (!src) return false;
  const dst = familyOf(dstProviderId);
  if (!dst) return false;
  return src !== dst;
}

/**
 * The canonical chat-completions endpoint path for a family. Used to rewrite
 * the request URL when routing across families: the SDK's URL targets the
 * source family's endpoint, but the actual fetch needs to hit the destination
 * family's endpoint.
 */
export function canonicalChatEndpoint(family: ModelFamily): string {
  switch (family) {
    case 'anthropic':
      return '/v1/messages';
    case 'openai':
      return '/v1/chat/completions';
  }
}

/**
 * Check whether a URL targets the canonical chat endpoint for the given
 * family. Translation only handles the chat surface — embeddings, audio,
 * file uploads, etc. cannot be translated and should hard-fail rather than
 * silently route somewhere broken.
 */
export function isChatCompletionsEndpoint(family: ModelFamily, url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === canonicalChatEndpoint(family) || u.pathname.endsWith(canonicalChatEndpoint(family));
  } catch {
    return false;
  }
}

/**
 * Rewrite a proxy request URL to target the destination provider's canonical
 * chat endpoint. The source URL was constructed by the SDK against the source
 * provider's base URL; we replace the origin and path with the destination's
 * equivalents.
 *
 * Returns null if the destination provider isn't registered or its family
 * has no canonical chat endpoint — translation should not proceed in either
 * case.
 */
export function rewriteProxyUrl(dstProviderId: ProviderId): string | null {
  const provider = PROVIDERS[dstProviderId];
  if (!provider) return null;
  const family = familyOf(dstProviderId);
  if (!family) return null;
  const base = provider.baseUrl.replace(/\/$/, '');
  return `${base}${canonicalChatEndpoint(family)}`;
}
