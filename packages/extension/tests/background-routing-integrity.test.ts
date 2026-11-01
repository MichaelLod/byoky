import { describe, it, expect, afterEach, vi } from 'vitest';
import { hashPassword, signMac } from '@byoky/core';
import {
  startBackground,
  walletStorage,
  walletKey,
  jsonResponse,
  connectApproved,
  PASSWORD,
  type CredentialSpec,
  type Harness,
} from './helpers/background-harness';
import { readTrustState, TRUSTED_SITES_KEY, REVOKED_ORIGINS_KEY, TRUST_EPOCH_KEY, TRUST_MAC_KEY } from '../lib/trust-state';
import { ROUTING_STATE_KEYS, USAGE_STATE_KEYS, ROUTING_MAC_KEY, USAGE_MAC_KEY } from '../lib/routing-state';
import fixture from './fixtures/wallet-1.1.1.json';

// F009 part 3 (R2-13): groups, app bindings, allowances and usage totals
// are signed with the wallet key, like the trust state. Someone who can
// write the profile's storage must not be able to reroute an app to
// another key, force a model, or lift a spending limit.

const APP = 'https://app.example';
const OPENAI_CHAT = 'https://api.openai.com/v1/chat/completions';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 'personal' comes first, so it is the key an app without a group uses.
const KEYS: CredentialSpec[] = [
  { id: 'personal', providerId: 'openai', key: 'sk-PERSONAL' },
  { id: 'work', providerId: 'openai', key: 'sk-WORK' },
];

function group(id: string, providerId: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, providerId, createdAt: 1, ...extra };
}

/** The user's state: APP pinned to the personal key and a cheap model, within a limit. */
const ROUTED = {
  groups: [group('default', ''), group('g-cheap', 'openai', { credentialId: 'personal', model: 'gpt-cheap' })],
  appGroups: { [APP]: 'g-cheap' },
  tokenAllowances: [{ origin: APP, totalLimit: 1000 }],
  usageTotals: { [APP]: { openai: 900 } },
};

function openaiChat(sessionKey: string) {
  return {
    sessionKey,
    providerId: 'openai',
    url: OPENAI_CHAT,
    body: JSON.stringify({ model: 'gpt-app', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  };
}

function okUpstream(h: Harness) {
  h.fetch.mockImplementation(async () => jsonResponse({ usage: { prompt_tokens: 1, completion_tokens: 1 } }));
}

/** The (key, model) of the n-th upstream call. */
function upstream(h: Harness, n = 0) {
  const [, init] = h.fetch.mock.calls[n] as [string, RequestInit];
  return { key: (init.headers as Record<string, string>).authorization, model: JSON.parse(String(init.body)).model };
}

async function unlocked(local: Record<string, unknown>, session?: Record<string, unknown>): Promise<Harness> {
  const h = await startBackground({ local, ...(session ? { session } : {}) });
  expect((await h.unlock()).success).toBe(true);
  return h;
}

/** Connect APP for OpenAI and send one chat request. */
async function request(h: Harness) {
  const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] });
  return h.proxy(APP, openaiChat(payload.sessionKey)).result;
}

async function hold(h: Harness) {
  return (await h.internal('getAllowances')).limitsHold;
}

describe('background: edited routing state falls back to the safe state', () => {
  const edits: Array<[string, (data: Record<string, any>) => void]> = [
    ['group repinned to the work key', (d) => { d.groups[1].credentialId = 'work'; }],
    ['group model forced', (d) => { d.groups[1].model = 'gpt-most-expensive'; }],
    ['app bound to another group', (d) => { d.groups.push(group('g-work', 'openai', { credentialId: 'work' })); d.appGroups[APP] = 'g-work'; }],
    ['limit raised', (d) => { d.tokenAllowances[0].totalLimit = 1e12; }],
    ['limit deleted', (d) => { d.tokenAllowances = []; }],
    ['routing MAC stripped', (d) => { delete d[ROUTING_MAC_KEY]; }],
  ];

  for (const [what, edit] of edits) {
    it(`${what}: default group, apps paused until resumed`, async () => {
      const local = await walletStorage(KEYS, ROUTED);
      edit(local);
      const h = await unlocked(local);
      okUpstream(h);

      const { groups, appGroups } = await h.internal('getGroups');
      expect(groups.map((g: { id: string }) => g.id)).toEqual(['default']);
      expect(appGroups).toEqual({});
      expect(await hold(h)).toBe('settings');

      // Paused: nothing goes upstream, whatever the stored limit says.
      const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] });
      const refused = await h.proxy(APP, openaiChat(payload.sessionKey)).result;
      expect(refused.error.error.code).toBe('QUOTA_EXCEEDED');
      expect(refused.error.error.message).toMatch(/paused/);
      expect(h.fetch).not.toHaveBeenCalled();

      expect(await h.internal('resumeApps')).toEqual({ success: true });
      expect(await hold(h)).toBeNull();
      // Routed as the default group routes: the app's own provider, no pin, no model.
      expect((await h.proxy(APP, openaiChat(payload.sessionKey)).result).done).toBe(true);
      expect(upstream(h)).toEqual({ key: 'Bearer sk-PERSONAL', model: 'gpt-app' });
    });
  }

  it('lowered usage: routing kept, apps paused until resumed', async () => {
    const local = await walletStorage(KEYS, ROUTED);
    (local.usageTotals as any)[APP].openai = 0;
    const h = await unlocked(local);
    okUpstream(h);
    expect(await hold(h)).toBe('usage');
    expect((await h.internal('getGroups')).appGroups).toEqual({ [APP]: 'g-cheap' });
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] });
    expect((await h.proxy(APP, openaiChat(payload.sessionKey)).result).error.error.message).toMatch(/paused/);

    await h.internal('resumeApps');
    // The user checked; the limit applies again, to the usage as stored.
    expect((await h.proxy(APP, openaiChat(payload.sessionKey)).result).done).toBe(true);
    expect(upstream(h)).toEqual({ key: 'Bearer sk-PERSONAL', model: 'gpt-cheap' });
  });

  it('reroutes open sessions when the groups are reset under them', async () => {
    const h = await unlocked(await walletStorage(KEYS, { ...ROUTED, tokenAllowances: [] }));
    okUpstream(h);
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] });
    (h.local.data.groups as any[])[1].credentialId = 'work';
    expect(await hold(h)).toBe('settings');
    await h.until(async () => (await h.internal('getSessions')).sessions[0].providers[0].modelOverride === undefined, 5_000, 'session rerouted');
    await h.internal('resumeApps');
    expect((await h.proxy(APP, openaiChat(payload.sessionKey)).result).done).toBe(true);
    expect(upstream(h)).toEqual({ key: 'Bearer sk-PERSONAL', model: 'gpt-app' });
  });

  it('stripped usage MAC pauses apps too', async () => {
    const local = await walletStorage(KEYS, ROUTED);
    delete local[USAGE_MAC_KEY];
    local.usageTotals = {};
    const h = await unlocked(local);
    expect(await hold(h)).toBe('usage');
  });

  it('keeps apps paused across lock, unlock and a browser restart, until resumed', async () => {
    const local = await walletStorage(KEYS, ROUTED);
    local.tokenAllowances = [];
    const h = await unlocked(local);
    expect(await hold(h)).toBe('settings');
    await h.internal('lock');
    expect(await hold(h)).toBeNull(); // locked: nothing is read at all
    expect((await h.unlock()).success).toBe(true);
    expect(await hold(h)).toBe('settings');
    const restarted = await unlocked(h.local.data);
    expect(await hold(restarted)).toBe('settings');
    await restarted.internal('resumeApps');
    expect(await hold(await unlocked(restarted.local.data))).toBeNull();
  });

  it('refuses a routing state put back from before a limit was lowered', async () => {
    const h = await unlocked(await walletStorage(KEYS, ROUTED));
    const before = Object.fromEntries(ROUTING_STATE_KEYS.map((k) => [k, structuredClone(h.local.data[k])]));
    await h.internal('setAllowance', { allowance: { origin: APP, totalLimit: 901 } });
    Object.assign(h.local.data, before);
    expect(await hold(h)).toBe('settings');
  });

  it('refuses usage totals put back from before a request was counted', async () => {
    const h = await unlocked(await walletStorage(KEYS, { ...ROUTED, tokenAllowances: [] }));
    okUpstream(h);
    const before = Object.fromEntries(USAGE_STATE_KEYS.map((k) => [k, structuredClone(h.local.data[k])]));
    expect((await request(h)).done).toBe(true);
    await h.until(() => (h.local.data.usageTotals as any)[APP].openai === 902, 5_000, 'usage counted');
    Object.assign(h.local.data, before);
    expect(await hold(h)).toBe('usage');
  });
});

describe('background: the popup still edits routing and limits', () => {
  it('signs every change, and a restarted browser reads it back as it was', async () => {
    const h = await unlocked(await walletStorage(KEYS));
    okUpstream(h);
    const created = await h.internal('createGroup', { name: 'Work', providerId: 'openai', credentialId: 'work', model: 'gpt-a' });
    const id = created.group.id;
    expect(await h.internal('setAppGroup', { origin: APP, groupId: id })).toEqual({ success: true });
    expect((await h.internal('updateGroup', { id, patch: { model: 'gpt-b' } })).group).toMatchObject({ credentialId: 'work', model: 'gpt-b' });
    expect(await h.internal('setAllowance', { allowance: { origin: APP, totalLimit: 500, providerLimits: { openai: 400 } } })).toEqual({ success: true });
    expect(await h.internal('setAllowance', { allowance: { origin: APP, totalLimit: 'lots' } })).toEqual({ error: 'Invalid allowance' });

    expect((await request(h)).done).toBe(true);
    expect(upstream(h)).toEqual({ key: 'Bearer sk-WORK', model: 'gpt-b' });
    await h.until(() => (h.local.data.usageTotals as any)?.[APP]?.openai === 2, 5_000, 'usage counted');

    // Lock and unlock: the new key verifies what the old one signed.
    const signed = await h.internal('getAllowances');
    await h.internal('lock');
    expect((await h.unlock()).success).toBe(true);
    expect(await h.internal('getAllowances')).toEqual(signed);

    const restarted = await unlocked(h.local.data);
    expect(await restarted.internal('getAllowances')).toEqual({
      allowances: [{ origin: APP, totalLimit: 500, providerLimits: { openai: 400 } }],
      usage: { [APP]: { openai: 2 } },
      limitsHold: null,
    });
    const { groups, appGroups } = await restarted.internal('getGroups');
    expect(appGroups).toEqual({ [APP]: id });
    expect(groups.find((g: { id: string }) => g.id === id)).toMatchObject({ name: 'Work', credentialId: 'work', model: 'gpt-b' });

    // And the rest of the popup's actions.
    expect(await restarted.internal('resetAppUsage', { origin: APP })).toEqual({ success: true });
    expect(await restarted.internal('removeAllowance', { origin: APP })).toEqual({ success: true });
    expect(await restarted.internal('removeCredential', { id: 'work' })).toEqual({ success: true });
    expect((await restarted.internal('getGroups')).groups.find((g: { id: string }) => g.id === id).credentialId).toBeUndefined();
    expect(await restarted.internal('deleteGroup', { id })).toEqual({ success: true });

    const again = await unlocked(restarted.local.data);
    expect(await again.internal('getAllowances')).toEqual({ allowances: [], usage: {}, limitsHold: null });
    expect(await again.internal('getGroups')).toEqual({ groups: [expect.objectContaining({ id: 'default' })], appGroups: { [APP]: 'default' } });
  });

  it('refuses changes while locked, and writes nothing unsigned', async () => {
    const h = await startBackground({ local: await walletStorage(KEYS, ROUTED) });
    const before = structuredClone(h.local.data);
    expect(await h.internal('setAllowance', { allowance: { origin: APP, totalLimit: 1e12 } })).toEqual({ error: 'Wallet is locked' });
    expect(await h.internal('createGroup', { name: 'X', providerId: 'openai' })).toEqual({ error: 'Wallet is locked' });
    expect(await h.internal('resumeApps')).toEqual({ error: 'Wallet is locked' });
    expect(h.local.data).toEqual(before);
  });

  it('a new wallet signs its empty state on the first unlock', async () => {
    const h = await startBackground();
    expect(await h.internal('setupWallet', { passwordHash: await hashPassword(PASSWORD) })).toEqual({ success: true });
    expect((await h.unlock()).success).toBe(true);
    expect(await hold(h)).toBeNull();
    expect(h.local.data[ROUTING_MAC_KEY]).toEqual(expect.any(String));
    expect((await h.internal('createGroup', { name: 'G', providerId: 'openai' })).group).toBeDefined();
    expect(await hold(await unlocked(h.local.data))).toBeNull();
  }, 30_000);
});

describe('background: wallets from before routing state was signed', () => {
  it('adopts 1.1.1 groups, bindings, limits and usage on the upgrade, unchanged', async () => {
    const ROUTED_111 = {
      groups: [group('default', ''), group('g-a', 'anthropic', { credentialId: fixture.storage.credentials[0].id, model: 'claude-pinned' })],
      appGroups: { [APP]: 'g-a' },
      tokenAllowances: [{ origin: APP, totalLimit: 100 }],
      usageTotals: { [APP]: { anthropic: 100 } },
    };
    const h = await startBackground({ local: { ...fixture.storage, ...ROUTED_111 } });
    expect((await h.unlock(fixture.PASSWORD)).success).toBe(true);
    expect(await h.internal('getAllowances')).toEqual({
      allowances: ROUTED_111.tokenAllowances,
      usage: ROUTED_111.usageTotals,
      limitsHold: null,
    });
    expect(await h.internal('getGroups')).toEqual({ groups: ROUTED_111.groups, appGroups: ROUTED_111.appGroups });
    // The limit is enforced as before: used up, not paused.
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const r = await h.proxy(APP, { sessionKey: payload.sessionKey, providerId: 'anthropic', url: 'https://api.anthropic.com/v1/messages', body: '{"model":"x","max_tokens":1,"messages":[]}' }).result;
    expect(r.error.error.message).toMatch(/allowance exceeded/);
    expect(h.fetch).not.toHaveBeenCalled();

    // After the upgrade, an edit is caught.
    h.local.data.tokenAllowances = [];
    const restarted = await startBackground({ local: h.local.data });
    expect((await restarted.unlock(fixture.PASSWORD)).success).toBe(true);
    expect(await restarted.internal('getAllowances')).toMatchObject({ allowances: [], limitsHold: 'settings' });
  }, 60_000);

  it('adopts the state of a wallet an earlier 1.1.2 build signed only the trust state of, once', async () => {
    const sites = [{ origin: 'https://trusted.example', trustedAt: 1, allowedProviders: ['openai'] }];
    const key = await walletKey();
    const v2Mac = await signMac(key, JSON.stringify(['byoky:trust:2', 1, sites.map((s) => [s.origin, s.trustedAt, s.allowedProviders]), []]));
    const local = await walletStorage(KEYS, {
      ...ROUTED,
      [TRUSTED_SITES_KEY]: sites, [REVOKED_ORIGINS_KEY]: [], [TRUST_EPOCH_KEY]: 1, [TRUST_MAC_KEY]: v2Mac,
    }, { unsignedRouting: true });
    expect(local[ROUTING_MAC_KEY]).toBeUndefined();

    const h = await unlocked(local);
    okUpstream(h);
    expect(await hold(h)).toBeNull();
    expect((await h.internal('getGroups')).appGroups).toEqual(ROUTED.appGroups);
    expect((await h.internal('getTrustedSites')).sites).toEqual(sites);
    expect((await request(h)).done).toBe(true);
    expect(upstream(h)).toEqual({ key: 'Bearer sk-PERSONAL', model: 'gpt-cheap' });
    // The trust state now says the routing state is signed...
    const trust = await readTrustState(h.local.data, key);
    expect(trust).toMatchObject({ intact: true, sites });
    expect(trust.beforeRouting).toBeUndefined();

    // ...so stripping the routing MAC later doesn't get an edit adopted.
    const stripped = structuredClone(h.local.data);
    for (const k of [ROUTING_MAC_KEY, 'routingEpoch', USAGE_MAC_KEY, 'usageEpoch']) delete stripped[k];
    (stripped.groups as any[])[1].credentialId = 'work';
    const after = await unlocked(stripped);
    expect(await hold(after)).toBe('settings');
    expect((await after.internal('getGroups')).groups.map((g: { id: string }) => g.id)).toEqual(['default']);
  });

  it('refuses unsigned routing state in a wallet with keys and no older signed trust state', async () => {
    const h = await unlocked(await walletStorage(KEYS, ROUTED, { unsignedRouting: true }));
    expect(await hold(h)).toBe('settings');
    expect((await h.internal('getGroups')).groups.map((g: { id: string }) => g.id)).toEqual(['default']);
  });
});

describe('background: usage counted while the wallet is locked', () => {
  it('holds tokens of a request that finished after the lock, and counts them on unlock', async () => {
    const h = await unlocked(await walletStorage(KEYS, { tokenAllowances: [{ origin: APP, totalLimit: 1000 }] }));
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] });
    let finish!: () => void;
    h.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      finish = () => resolve(jsonResponse({ usage: { prompt_tokens: 5, completion_tokens: 7 } }));
    }));
    const inFlight = h.proxy(APP, openaiChat(payload.sessionKey));
    await h.until(() => h.fetch.mock.calls.length === 1, 5_000, 'upstream call');
    expect(await h.internal('lock')).toEqual({ success: true });
    finish();
    await inFlight.result;
    await h.until(() => (h.session!.data._pendingUsage as any)?.[APP]?.openai === 12, 5_000, 'usage held');
    expect(h.local.data.usageTotals).toEqual({});

    // The worker restarts while locked; the held tokens survive in storage.session.
    const restarted = await unlocked(h.local.data, h.session!.data);
    await restarted.until(() => (restarted.local.data.usageTotals as any)?.[APP]?.openai === 12, 5_000, 'usage counted');
    expect(await hold(restarted)).toBeNull();
    expect((await restarted.internal('getAllowances')).usage).toEqual({ [APP]: { openai: 12 } });
  });

  it('writes one HMAC per request, and verifies none it wrote itself', async () => {
    const h = await unlocked(await walletStorage(KEYS, ROUTED));
    okUpstream(h);
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] });
    expect((await h.proxy(APP, openaiChat(payload.sessionKey)).result).done).toBe(true);
    await h.until(() => (h.local.data.usageTotals as any)[APP].openai === 902, 5_000, 'usage counted');

    const sign = vi.spyOn(crypto.subtle, 'sign');
    const verify = vi.spyOn(crypto.subtle, 'verify');
    expect((await h.proxy(APP, openaiChat(payload.sessionKey)).result).done).toBe(true);
    await h.until(() => (h.local.data.usageTotals as any)[APP].openai === 904, 5_000, 'usage counted');
    expect(sign).toHaveBeenCalledTimes(1);
    expect(verify).not.toHaveBeenCalled();
  });
});
