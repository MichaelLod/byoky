import { describe, it, expect, afterEach, vi } from 'vitest';
import { deriveWalletMacKey, signMac } from '@byoky/core';
import {
  startBackground,
  walletStorage,
  walletPasswordHash,
  connectApproved,
  PASSWORD,
  type Harness,
} from './helpers/background-harness';
import { TRUST_STATE_KEYS, TRUSTED_SITES_KEY, REVOKED_ORIGINS_KEY, TRUST_MAC_KEY } from '../lib/trust-state';

const EVIL = 'https://evil.example';
const OPENAI = { providers: [{ id: 'openai', required: true }] };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function snapshot(h: Harness): Record<string, unknown> {
  return Object.fromEntries(TRUST_STATE_KEYS.filter((k) => k in h.local.data).map((k) => [k, structuredClone(h.local.data[k])]));
}

async function pendingCount(h: Harness): Promise<number> {
  return (await h.internal('getPendingApprovals')).approvals.length;
}

describe('background: trust state freshness', () => {
  // F084: an older signed snapshot of the trust state, written back, made
  // a removed site trusted again.
  it('refuses a trust state put back from before a site was removed', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
    await h.unlock();
    await connectApproved(h, EVIL, OPENAI, true);
    const trusted = snapshot(h);
    const [session] = (await h.internal('getSessions')).sessions;
    await h.internal('revokeSession', { sessionId: session.id });
    expect(await h.internal('removeTrustedSite', { origin: EVIL })).toEqual({ success: true });

    Object.assign(h.local.data, structuredClone(trusted));
    const { response } = h.connect(EVIL, OPENAI);
    await h.until(async () => (await pendingCount(h)) === 1, 5_000, 'a manual approval');
    const { sites, trustReset } = await h.internal('getTrustedSites');
    expect(sites).toEqual([]);
    expect(trustReset).toBe(true);
    const [approval] = (await h.internal('getPendingApprovals')).approvals;
    await h.internal('rejectConnect', { approvalId: approval.id });
    expect((await response).payload.code).toBe('USER_REJECTED');
  });

  it('remembers the newest epoch across a worker restart', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
    await h.unlock();
    await connectApproved(h, EVIL, OPENAI, true);
    const trusted = snapshot(h);
    await h.internal('removeTrustedSite', { origin: EVIL });
    Object.assign(h.local.data, structuredClone(trusted));
    // Same browser session: the worker restarts with storage.session kept.
    const restarted = await startBackground({ local: h.local.data, session: h.session!.data });
    expect((await restarted.internal('getTrustedSites')).sites).toEqual([]);
  });

  it('re-signs a state from before epochs instead of dropping it', async () => {
    const sites = [{ origin: EVIL, trustedAt: 1, allowedProviders: ['openai'] }];
    const key = (await deriveWalletMacKey(PASSWORD, await walletPasswordHash()))!;
    const v1Mac = await signMac(key, JSON.stringify(['byoky:trust:1', sites.map((s) => [s.origin, s.trustedAt, s.allowedProviders]), []]));
    const h = await startBackground({
      local: await walletStorage([], { [TRUSTED_SITES_KEY]: sites, [REVOKED_ORIGINS_KEY]: [], [TRUST_MAC_KEY]: v1Mac }),
    });
    await h.unlock();
    const read = await h.internal('getTrustedSites');
    expect(read).toEqual({ sites, trustReset: false });
    expect(h.local.data.trustEpoch).toBe(1);
  });
});

describe('background: a plain-http site is never trusted (F035)', () => {
  const INSECURE = 'http://insecure.example';

  /**
   * Whether a connect from `origin` waits for the user: still unanswered,
   * with its approval queued, well after a trusted site would have been
   * approved silently. Rejects it afterwards.
   */
  async function asksFirst(h: Harness, origin: string): Promise<boolean> {
    const { response } = h.connect(origin, OPENAI);
    const first = await Promise.race([response, new Promise((r) => setTimeout(() => r('waiting'), 300))]);
    const approvals = (await h.internal('getPendingApprovals')).approvals;
    if (first !== 'waiting' || approvals.length !== 1) return false;
    await h.internal('rejectConnect', { approvalId: approvals[0].id });
    return (await response).payload.code === 'USER_REJECTED';
  }

  it('approves it with Trust ticked, but doesn\'t trust it', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
    await h.unlock();
    const reply = await connectApproved(h, INSECURE, OPENAI, true);
    expect(reply.payload.sessionKey).toBeTruthy();
    expect((await h.internal('getSessions')).sessions).toHaveLength(1);
    expect((await h.internal('getTrustedSites')).sites).toEqual([]);
  });

  it('refuses to add it as a trusted site, but still trusts https and loopback', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
    await h.unlock();
    expect(await h.internal('addTrustedSite', { origin: INSECURE, allowedProviders: ['openai'] }))
      .toEqual({ error: 'Invalid trusted site' });
    expect(await h.internal('addTrustedSite', { origin: EVIL, allowedProviders: ['openai'] })).toEqual({ success: true });
    expect(await h.internal('addTrustedSite', { origin: 'http://localhost:3000', allowedProviders: ['openai'] }))
      .toEqual({ success: true });
    expect((await h.internal('getTrustedSites')).sites.map((s: { origin: string }) => s.origin))
      .toEqual([EVIL, 'http://localhost:3000']);
  });

  it('no longer connects silently under an entry an older build stored', async () => {
    const sites = [{ origin: INSECURE, trustedAt: 1, allowedProviders: ['openai'] }];
    const key = (await deriveWalletMacKey(PASSWORD, await walletPasswordHash()))!;
    const v1Mac = await signMac(key, JSON.stringify(['byoky:trust:1', sites.map((s) => [s.origin, s.trustedAt, s.allowedProviders]), []]));
    const h = await startBackground({
      local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }], {
        [TRUSTED_SITES_KEY]: sites, [REVOKED_ORIGINS_KEY]: [], [TRUST_MAC_KEY]: v1Mac,
      }),
    });
    await h.unlock();
    // The signed list still verifies and keeps the entry...
    expect(await h.internal('getTrustedSites')).toEqual({ sites, trustReset: false });
    // ...but it no longer approves anything by itself, while an https entry does.
    expect(await asksFirst(h, INSECURE)).toBe(true);
    await h.internal('addTrustedSite', { origin: EVIL, allowedProviders: ['openai'] });
    expect(await asksFirst(h, EVIL)).toBe(false);
  });
});
