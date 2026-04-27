/**
 * Shared helper for `session.listModels()`. Used by extension, vault, relay,
 * and mock session paths so they all share one parser layer + one URL map
 * (defined in @byoky/core).
 */

import {
  ByokyError,
  ByokyErrorCode,
  getListModelsEndpoint,
  getProvider,
  getStaticModelsList,
  parseModelsList,
  type ModelInfo,
} from '@byoky/core';

export async function fetchModelsList(
  fetchFn: typeof fetch,
  providerId: string,
): Promise<ModelInfo[]> {
  // Providers without a discovery endpoint (perplexity) — return the static list.
  const staticList = getStaticModelsList(providerId);
  if (staticList.length > 0) return staticList;

  const endpoint = getListModelsEndpoint(providerId);
  const provider = getProvider(providerId);
  if (!endpoint || !provider) {
    throw new ByokyError(
      ByokyErrorCode.PROVIDER_UNAVAILABLE,
      `Listing models is not supported for provider "${providerId}"`,
    );
  }

  const url = `${provider.baseUrl}${endpoint.path}`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: endpoint.method,
      headers: endpoint.headers,
    });
  } catch (err) {
    throw new ByokyError(
      ByokyErrorCode.PROXY_ERROR,
      `Could not reach the models endpoint for ${providerId}: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      const msg =
        (errBody as { error?: { message?: string } })?.error?.message ?? '';
      if (msg) detail = ` — ${msg}`;
    } catch {
      // body wasn't JSON; ignore
    }
    if (response.status === 401 || response.status === 403) {
      throw new ByokyError(
        ByokyErrorCode.INVALID_KEY,
        `Provider rejected the credential when listing models for ${providerId}${detail}`,
      );
    }
    if (response.status === 404 || response.status === 405) {
      throw new ByokyError(
        ByokyErrorCode.PROVIDER_UNAVAILABLE,
        `Provider ${providerId} does not expose a model-list endpoint${detail}`,
      );
    }
    if (response.status === 429) {
      throw ByokyError.rateLimited();
    }
    throw new ByokyError(
      ByokyErrorCode.PROXY_ERROR,
      `Failed to list models for ${providerId}: HTTP ${response.status}${detail}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new ByokyError(
      ByokyErrorCode.PROXY_ERROR,
      `Provider ${providerId} returned an unparseable models response: ${(err as Error).message}`,
    );
  }

  return parseModelsList(providerId, body);
}
