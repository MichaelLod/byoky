import type { ProviderId } from '../types.js';
import type { ModelFamily } from '../models.js';
import { PROVIDERS } from '../providers.js';
import { getAdapter, hasAdapter } from './adapter.js';

/**
 * Translation family detection.
 *
 * The translation layer reasons about provider *families* — sets of providers
 * that speak the same API dialect. Two providers in the same family can
 * substitute for each other byte-for-byte (modulo auth). Two providers in
 * different families need translation in between.
 *
 * All four supported families are wired in: anthropic, openai, gemini, cohere.
 * Adding a new provider that speaks an existing dialect is a one-line change
 * to the relevant provider set; adding a new family requires writing an
 * adapter (see adapter.ts) and appending it here.
 */

const FAMILY_PROVIDERS: Record<ModelFamily, ReadonlySet<ProviderId>> = {
  anthropic: new Set<ProviderId>(['anthropic']),
  openai: new Set<ProviderId>([
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
  ]),
  gemini: new Set<ProviderId>(['gemini']),
  cohere: new Set<ProviderId>(['cohere']),
};

/**
 * Map a provider id to its translation family. Returns null for providers
 * outside any known family — translation cannot be performed when either
 * side returns null.
 */
export function familyOf(providerId: ProviderId): ModelFamily | null {
  for (const family of Object.keys(FAMILY_PROVIDERS) as ModelFamily[]) {
    if (FAMILY_PROVIDERS[family].has(providerId)) return family;
  }
  return null;
}

/**
 * Should the request from `srcProviderId` to `dstProviderId` be translated?
 *
 * True iff:
 *  - both providers are in known families
 *  - both families have registered adapters
 *  - the families differ (same family = pass-through)
 */
export function shouldTranslate(
  srcProviderId: ProviderId,
  dstProviderId: ProviderId,
): boolean {
  const src = familyOf(srcProviderId);
  if (!src || !hasAdapter(src)) return false;
  const dst = familyOf(dstProviderId);
  if (!dst || !hasAdapter(dst)) return false;
  return src !== dst;
}

/**
 * True iff both providers are in a known family AND share the same family.
 *
 * Used by the routing resolver to detect *same-family swaps* — two providers
 * with the same wire format but different endpoints/credentials (e.g. the app
 * SDK targets Groq, the user's group routes to OpenAI). Same-family swaps
 * skip translation entirely and only need: URL rewrite, credential swap,
 * body model substitution.
 */
export function sameFamily(
  srcProviderId: ProviderId,
  dstProviderId: ProviderId,
): boolean {
  const src = familyOf(srcProviderId);
  if (!src) return false;
  return src === familyOf(dstProviderId);
}

/**
 * Check whether a URL targets the canonical chat endpoint for the given
 * family. Translation only handles the chat surface — embeddings, audio,
 * file uploads, etc. cannot be translated and should hard-fail rather than
 * silently route somewhere broken.
 */
export function isChatCompletionsEndpoint(family: ModelFamily, url: string): boolean {
  if (!hasAdapter(family)) return false;
  return getAdapter(family).matchesChatEndpoint(url);
}

/**
 * Rewrite a proxy request URL to target the destination provider's canonical
 * chat endpoint. The source URL was constructed by the SDK against the source
 * provider's base URL; we replace it with a destination URL built from the
 * destination adapter's own rules (which for gemini means putting the model
 * in the path and switching the method on `stream`).
 *
 * Returns null if the destination provider isn't registered, its family has
 * no adapter, or the family can't build a URL for the given inputs.
 */
export function rewriteProxyUrl(
  dstProviderId: ProviderId,
  model: string,
  stream: boolean,
  overrideBaseUrl?: string,
): string | null {
  const provider = PROVIDERS[dstProviderId];
  if (!provider) return null;
  const family = familyOf(dstProviderId);
  if (!family || !hasAdapter(family)) return null;

  // Providers without a fixed host (Azure OpenAI) can only be targeted if
  // the caller hands in the real tenant baseUrl from the credential row.
  if (provider.requiresCustomBaseUrl && !overrideBaseUrl) return null;

  const rawBase = overrideBaseUrl ?? provider.baseUrl;
  const base = rawBase.replace(/\/$/, '');
  // Providers that diverge from the openai adapter's default chat path
  // (`/v1/chat/completions`) declare the real path via chatPath — e.g. groq
  // uses `/openai/v1/chat/completions`, fireworks uses `/inference/v1/...`.
  if (provider.chatPath) {
    return `${base}${provider.chatPath}`;
  }
  return getAdapter(family).buildChatUrl(base, model, stream);
}
