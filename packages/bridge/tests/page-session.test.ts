import { describe, it, expect } from 'vitest';
import type { ProviderRequirement } from '@byoky/core';
import { connectCovering } from '../src/page-session.js';
import { FakeWallet } from './helpers/fake-wallet.js';

const req = (...ids: string[]) => ({
  providers: ids.map((id): ProviderRequirement => ({ id, required: true })),
  modal: true,
});

describe('connectCovering', () => {
  it('asks an older wallet again when it hands back a session without the requested provider', async () => {
    const wallet = new FakeWallet({ kind: 'reuses-any-session', keys: ['anthropic', 'openai'] });
    const first = await connectCovering(wallet, req('anthropic'));
    const retried: string[][] = [];

    const session = await connectCovering(wallet, req('openai'), { onRetry: (m) => retried.push(m) });

    expect(retried).toEqual([['openai']]);
    expect(wallet.disconnects).toBe(1);
    // The user is asked about the new provider and the one the bridge served.
    expect(wallet.prompts).toEqual([['anthropic'], ['openai', 'anthropic']]);
    expect(session.sessionKey).not.toBe(first.sessionKey);
    expect(session.providers).toEqual({
      openai: { available: true, authMethod: 'api_key' },
      anthropic: { available: true, authMethod: 'api_key' },
    });
  });

  it('connects again only once the wallet has dropped the old session', async () => {
    // The fake drops it 40 ms after disconnect(); connecting sooner would get
    // the old session back.
    const wallet = new FakeWallet({ kind: 'reuses-any-session', keys: ['anthropic', 'openai'] });
    await connectCovering(wallet, req('anthropic'));
    const session = await connectCovering(wallet, req('openai'));
    expect(wallet.connects).toEqual([['anthropic'], ['openai'], ['openai', 'anthropic']]);
    expect(Object.keys(session.providers)).toContain('openai');
  });

  it('leaves a wallet that widens the session itself to it', async () => {
    const wallet = new FakeWallet({ kind: 'widens-session', keys: ['anthropic', 'openai'] });
    const first = await connectCovering(wallet, req('anthropic'));
    const session = await connectCovering(wallet, req('openai'));
    expect(wallet.disconnects).toBe(0);
    expect(wallet.connects).toEqual([['anthropic'], ['openai']]);
    expect(wallet.prompts).toEqual([['anthropic'], ['anthropic', 'openai']]);
    expect(session.sessionKey).toBe(first.sessionKey);
  });

  it('keeps a session that lists the provider as unavailable', async () => {
    const wallet = new FakeWallet({ kind: 'widens-session', keys: ['anthropic'] });
    const session = await connectCovering(wallet, req('openai'));
    expect(session.providers.openai).toEqual({ available: false, authMethod: 'api_key' });
    expect(wallet.connects).toHaveLength(1);
    expect(wallet.disconnects).toBe(0);
  });

  it('reuses an older wallet\'s session that covers the request', async () => {
    const wallet = new FakeWallet({ kind: 'reuses-any-session', keys: ['anthropic', 'openai'] });
    const first = await connectCovering(wallet, req('anthropic', 'openai'));
    const session = await connectCovering(wallet, req('openai'));
    expect(session.sessionKey).toBe(first.sessionKey);
    expect(wallet.disconnects).toBe(0);
    expect(wallet.prompts).toHaveLength(1);
  });

  it('says what to do when the wallet keeps the old session', async () => {
    const wallet = new FakeWallet({ kind: 'reuses-any-session', keys: ['anthropic', 'openai'], ignoresDisconnect: true });
    await connectCovering(wallet, req('anthropic'));
    const started = Date.now();
    await expect(connectCovering(wallet, req('openai'), { dropTimeoutMs: 300 }))
      .rejects.toThrow('Your Byoky wallet kept its earlier session for this page, which lacks openai. Disconnect it in the wallet and try again.');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('passes the user\'s cancel of the second prompt through', async () => {
    let asked = 0;
    const wallet = new FakeWallet({ kind: 'reuses-any-session', keys: ['anthropic', 'openai'], approve: () => ++asked === 1 });
    await connectCovering(wallet, req('anthropic'));
    await expect(connectCovering(wallet, req('openai'))).rejects.toThrow('User cancelled');
  });
});
