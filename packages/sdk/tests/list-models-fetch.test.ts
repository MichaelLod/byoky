import { describe, it, expect } from 'vitest';
import { ByokyErrorCode } from '@byoky/core';
import { fetchModelsList } from '../src/list-models-fetch.js';

function answering(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

describe('fetchModelsList failures', () => {
  it.each([
    ['the wallet has no credential (extension)', 403, { error: { code: 'PROVIDER_UNAVAILABLE', message: 'No openai credential in this wallet' } }, ByokyErrorCode.PROVIDER_UNAVAILABLE],
    ['the wallet has no credential (mobile)', 403, { error: { code: 'NO_CREDENTIAL', message: 'No credential for openai' } }, ByokyErrorCode.PROVIDER_UNAVAILABLE],
    ['the wallet is locked', 423, { error: { code: 'WALLET_LOCKED', message: 'Wallet is locked' } }, ByokyErrorCode.WALLET_LOCKED],
    ['the URL is not the provider\'s', 403, { error: { code: 'INVALID_URL', message: 'Request URL does not match' } }, ByokyErrorCode.INVALID_URL],
    ['the app\'s allowance is used up', 429, { error: { code: 'QUOTA_EXCEEDED', message: 'Token limit reached' } }, ByokyErrorCode.QUOTA_EXCEEDED],
    ['the provider rejects the key', 401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }, ByokyErrorCode.INVALID_KEY],
    ['the provider rate-limits', 429, { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }, ByokyErrorCode.RATE_LIMITED],
  ])('reports %s correctly', async (_label, status, body, code) => {
    await expect(fetchModelsList(answering(status, body), 'openai')).rejects.toMatchObject({ code });
  });

  it('keeps the wallet\'s message', async () => {
    await expect(fetchModelsList(answering(403, { error: { code: 'PROVIDER_UNAVAILABLE', message: 'No openai credential in this wallet' } }), 'openai'))
      .rejects.toMatchObject({ message: expect.stringContaining('No openai credential in this wallet') });
  });
});
