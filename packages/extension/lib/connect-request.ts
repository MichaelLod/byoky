import type { ProviderRequirement } from '@byoky/core';

/**
 * A page's connect request is untrusted input: any page can send one
 * through the content script. Its provider list goes into the approval the
 * popup renders and, once approved, into the signed trust state, so a
 * malformed list must stop here.
 */

/** No real request names more providers than the registry has, by far. */
export const MAX_REQUESTED_PROVIDERS = 32;

const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * The providers a connect request asks for: absent (undefined or null)
 * means none named, i.e. []. Otherwise an array of at most
 * MAX_REQUESTED_PROVIDERS objects, each with a provider-id-shaped string
 * `id` and an optional boolean `required`. Returned normalized to
 * {id, required} with duplicates merged (required if any copy was); null
 * when the input is anything else.
 */
export function parseProviderRequirements(raw: unknown): ProviderRequirement[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_REQUESTED_PROVIDERS) return null;
  const byId = new Map<string, ProviderRequirement>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { id, required } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !PROVIDER_ID.test(id)) return null;
    if (required !== undefined && typeof required !== 'boolean') return null;
    const seen = byId.get(id);
    if (seen) seen.required ||= required === true;
    else byId.set(id, { id, required: required === true });
  }
  return [...byId.values()];
}

/** A trusted site's allowed providers as stored: provider-id strings only. */
export function isProviderIdList(raw: unknown): raw is string[] {
  return Array.isArray(raw) && raw.length <= MAX_REQUESTED_PROVIDERS
    && raw.every((id) => typeof id === 'string' && PROVIDER_ID.test(id));
}
