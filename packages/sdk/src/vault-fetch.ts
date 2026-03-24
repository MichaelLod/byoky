export function createVaultFetch(
  vaultUrl: string,
  token: string,
  providerId: string,
): typeof fetch {
  const proxyUrl = `${vaultUrl.replace(/\/$/, '')}/proxy`;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.toString()
      : (input as Request).url;

    const method = init?.method ?? 'POST';
    const headers = init?.headers
      ? Object.fromEntries(new Headers(init.headers).entries())
      : {};
    const body = init?.body
      ? typeof init.body === 'string' ? init.body : await new Response(init.body).text()
      : undefined;

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ providerId, url, method, headers, body }),
    });

    return response;
  };
}
