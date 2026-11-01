/**
 * Shared helper for `session.listModels()`. Used by the extension and mock
 * session paths so they share one parser layer + one URL map (defined in
 * @byoky/core).
 */

import {
  ByokyError,
  ByokyErrorCode,
  getListModelsEndpoint,
  getProvider,
  getStaticModelsList,
  isByokyErrorCode,
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
    let code: unknown;
    try {
      const errBody = (await response.json()) as { error?: { message?: unknown; code?: unknown } };
      const msg = errBody?.error?.message;
      if (typeof msg === 'string' && msg) detail = ` — ${msg}`;
      code = errBody?.error?.code;
    } catch {
      // body wasn't JSON; ignore
    }
    // The wallet answers for itself (no credential for this provider, the
    // wallet locked, a quota) with its own code; only an answer without one
    // came from the provider. A 403 from the wallet is not a rejected key.
    if (code === 'NO_CREDENTIAL') {
      // The mobile wallets' name for PROVIDER_UNAVAILABLE.
      throw new ByokyError(
        ByokyErrorCode.PROVIDER_UNAVAILABLE,
        `No ${providerId} credential in the wallet${detail}`,
      );
    }
    if (isByokyErrorCode(code)) {
      throw new ByokyError(code, `Could not list models for ${providerId}${detail}`);
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
