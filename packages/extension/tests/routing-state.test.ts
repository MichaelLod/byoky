import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { hashPassword, deriveWalletMacKey, type Group } from '@byoky/core';
import {
  ALLOWANCES_KEY,
  APP_GROUPS_KEY,
  GROUPS_KEY,
  LIMITS_HOLD_KEY,
  ROUTING_EPOCH_KEY,
  ROUTING_MAC_KEY,
  USAGE_EPOCH_KEY,
  USAGE_KEY,
  USAGE_MAC_KEY,
  MAX_TOKEN_COUNT,
  addUsageTotals,
  adoptLegacyRoutingState,
  defaultGroup,
  hasSignedRoutingState,
  isEmptyWallet,
  parseAllowance,
  readRoutingState,
  parseUsageTotals,
  readUsageState,
  salvageUsageTotals,
  signRoutingState,
  signUsageState,
  usageFromLog,
  withUsage,
  type RoutingState,
  type UsageTotals,
} from '../lib/routing-state';

const APP = 'https://app.example';
const OTHER = 'https://other.example';
const GROUPS: Group[] = [
  { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
  { id: 'g-cheap', name: 'Cheap', providerId: 'openai', credentialId: 'personal', model: 'gpt-5-mini', createdAt: 2 },
];
const STATE: RoutingState = {
  groups: GROUPS,
  appGroups: { [APP]: 'g-cheap', [OTHER]: 'default' },
  allowances: [{ origin: APP, totalLimit: 1000, providerLimits: { openai: 500 } }],
};
const TOTALS = { [APP]: { openai: 400, anthropic: 10 }, [OTHER]: { groq: 5 } };

let key: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  key = (await deriveWalletMacKey('pw', await hashPassword('pw')))!;
  otherKey = (await deriveWalletMacKey('pw', await hashPassword('pw')))!;
}, 60_000);

afterEach(() => vi.restoreAllMocks());

/** A signed routing state with `edit` applied to the stored entries afterwards, MAC kept. */
async function tamperedRouting(edit: (stored: Record<string, any>) => void): Promise<Record<string, unknown>> {
  const stored = structuredClone(await signRoutingState(STATE, key, 3));
  edit(stored);
  return stored;
}

async function tamperedUsage(edit: (stored: Record<string, any>) => void): Promise<Record<string, unknown>> {
  const stored = structuredClone(await signUsageState(TOTALS, key, 3));
  edit(stored);
  return stored;
}

describe('routing state integrity', () => {
  it('reads back a state it signed', async () => {
    const stored = structuredClone(await signRoutingState(STATE, key, 3));
    expect(await readRoutingState(stored, key)).toEqual({ state: STATE, intact: true, epoch: 3 });
    // Map order in storage doesn't matter.
    stored[APP_GROUPS_KEY] = { [OTHER]: 'default', [APP]: 'g-cheap' };
    expect((await readRoutingState(stored, key)).intact).toBe(true);
  });

  it('falls back to the safe state for every edit: default group only, no bindings, apps paused', async () => {
    const edits: Array<[string, (stored: Record<string, any>) => void]> = [
      ['group pinned to another key', (st) => { st[GROUPS_KEY][1].credentialId = 'work'; }],
      ['group model forced', (st) => { st[GROUPS_KEY][1].model = 'o3-pro'; }],
      ['group provider changed', (st) => { st[GROUPS_KEY][1].providerId = 'anthropic'; }],
      ['default group given a provider', (st) => { st[GROUPS_KEY][0].providerId = 'openai'; }],
      ['group added', (st) => { st[GROUPS_KEY].push({ id: 'x', name: 'X', providerId: 'openai', createdAt: 3 }); }],
      ['app rebound', (st) => { st[APP_GROUPS_KEY][OTHER] = 'g-cheap'; }],
      ['app unbound', (st) => { delete st[APP_GROUPS_KEY][APP]; }],
      ['limit raised', (st) => { st[ALLOWANCES_KEY][0].totalLimit = 1e12; }],
      ['provider limit lifted', (st) => { delete st[ALLOWANCES_KEY][0].providerLimits; }],
      ['allowance deleted', (st) => { st[ALLOWANCES_KEY] = []; }],
      ['allowances key deleted', (st) => { delete st[ALLOWANCES_KEY]; }],
      ['epoch raised', (st) => { st[ROUTING_EPOCH_KEY] = 9; }],
      ['MAC stripped', (st) => { delete st[ROUTING_MAC_KEY]; }],
      ['epoch stripped', (st) => { delete st[ROUTING_EPOCH_KEY]; }],
      ['malformed groups', (st) => { st[GROUPS_KEY] = 'nope'; }],
    ];
    for (const [what, edit] of edits) {
      const read = await readRoutingState(await tamperedRouting(edit), key);
      expect(read.intact, what).toBe(false);
      expect(read.state.groups.map((g) => [g.id, g.providerId]), what).toEqual([['default', '']]);
      expect(read.state.appGroups, what).toEqual({});
      expect(read.state.hold, what).toBe('settings');
    }
  });

  it('keeps the stored limits of a refused state for the user to check, and never fewer than it can parse', async () => {
    const raised = await tamperedRouting((st) => { st[ALLOWANCES_KEY][0].totalLimit = 1e12; });
    expect((await readRoutingState(raised, key)).state.allowances).toEqual([{ origin: APP, totalLimit: 1e12, providerLimits: { openai: 500 } }]);
    const junk = await tamperedRouting((st) => { st[ALLOWANCES_KEY] = 'x'; });
    expect((await readRoutingState(junk, key)).state.allowances).toEqual([]);
  });

  it('refuses a cleared hold', async () => {
    const held = structuredClone(await signRoutingState({ ...STATE, hold: 'usage' }, key, 4));
    expect((await readRoutingState(held, key)).state.hold).toBe('usage');
    for (const cleared of [undefined, null]) {
      const read = await readRoutingState({ ...held, [LIMITS_HOLD_KEY]: cleared }, key);
      expect(read.intact).toBe(false);
      expect(read.state.hold).toBe('settings');
    }
    // A hold the user cleared is stored as null, and reads as none.
    const resumed = structuredClone(await signRoutingState(STATE, key, 5));
    expect(resumed[LIMITS_HOLD_KEY]).toBeNull();
    expect(await readRoutingState(resumed, key)).toEqual({ state: STATE, intact: true, epoch: 5 });
  });

  it('refuses another wallet\'s state, and one older than the newest seen', async () => {
    expect((await readRoutingState(await signRoutingState(STATE, otherKey, 3), key)).intact).toBe(false);
    const before = await signRoutingState(STATE, key, 3);
    const after = await signRoutingState({ ...STATE, allowances: [{ origin: APP, totalLimit: 10 }] }, key, 4);
    expect((await readRoutingState(after, key, 4)).intact).toBe(true);
    expect((await readRoutingState(before, key, 4)).intact).toBe(false);
    expect((await readRoutingState(before, key, 3)).intact).toBe(true);
  });

  it('ignores fields the wallet doesn\'t use, like a 1.0 gift pin', async () => {
    const stored: Record<string, any> = structuredClone(await signRoutingState(STATE, key, 3));
    stored[GROUPS_KEY][1].giftId = 'g1';
    expect(await readRoutingState(stored, key)).toEqual({ state: STATE, intact: true, epoch: 3 });
  });

  it('only signs what reads back the same', async () => {
    const withUndefined = { ...STATE, groups: [{ ...GROUPS[1], credentialId: undefined, model: undefined }] };
    const stored = await signRoutingState(withUndefined, key, 3);
    expect((await readRoutingState(structuredClone(stored), key)).intact).toBe(true);
    await expect(signRoutingState({ ...STATE, allowances: [{ origin: APP, totalLimit: Number.NaN }] }, key, 3)).rejects.toThrow('Malformed');
    await expect(signRoutingState({ ...STATE, groups: [{ ...GROUPS[1], credentialId: 7 as unknown as string }] }, key, 3)).rejects.toThrow('Malformed');
    await expect(signUsageState({ [APP]: { openai: -1 } }, key, 3)).rejects.toThrow('Malformed');
  });

  it('checks allowances from the popup', () => {
    expect(parseAllowance({ origin: APP, totalLimit: 5, providerLimits: { openai: 2 } })).toEqual({ origin: APP, totalLimit: 5, providerLimits: { openai: 2 } });
    expect(parseAllowance({ origin: APP })).toEqual({ origin: APP });
    expect(parseAllowance({ origin: APP, totalLimit: '5' })).toBeNull();
    expect(parseAllowance({ origin: APP, providerLimits: { openai: Infinity } })).toBeNull();
    expect(parseAllowance({ totalLimit: 5 })).toBeNull();
  });
});

describe('usage totals integrity', () => {
  it('reads back totals it signed', async () => {
    expect(await readUsageState(structuredClone(await signUsageState(TOTALS, key, 3)), key)).toEqual({ totals: TOTALS, intact: true, epoch: 3 });
  });

  it('refuses lowered, deleted or unsigned totals, and keeps what parses', async () => {
    const edits: Array<[string, (stored: Record<string, any>) => void]> = [
      ['count lowered', (st) => { st[USAGE_KEY][APP].openai = 0; }],
      ['app deleted', (st) => { delete st[USAGE_KEY][APP]; }],
      ['totals deleted', (st) => { delete st[USAGE_KEY]; }],
      ['MAC stripped', (st) => { delete st[USAGE_MAC_KEY]; }],
      ['epoch raised', (st) => { st[USAGE_EPOCH_KEY] = 99; }],
    ];
    for (const [what, edit] of edits) {
      const stored = await tamperedUsage(edit);
      const read = await readUsageState(stored, key);
      expect(read.intact, what).toBe(false);
      expect(read.totals, what).toEqual(stored[USAGE_KEY] ?? {});
    }
    const read = await readUsageState(await tamperedUsage((st) => { st[USAGE_KEY] = [1]; }), key);
    expect(read).toEqual({ totals: {}, intact: false, epoch: 0 });
  });

  // R3-01: a count of Infinity (an estimate from max_tokens 1e400) made
  // every usage write throw, for every app, and storage turned it into null,
  // which threw away every app's held usage on the next worker restart.
  it('counts only whole, finite tokens, so the totals always sign', async () => {
    let totals: UsageTotals = withUsage(TOTALS, OTHER, 'anthropic', Infinity);
    totals = withUsage(totals, OTHER, 'anthropic', Number.NaN);
    totals = withUsage(totals, OTHER, 'anthropic', -5);
    totals = addUsageTotals(totals, { [OTHER]: { groq: Infinity, mistral: null as unknown as number } });
    expect(totals).toEqual(TOTALS);
    // A fraction is rounded up, never down.
    expect(withUsage(TOTALS, APP, 'openai', 0.25)[APP].openai).toBe(401);
    // A sum stops at MAX_TOKEN_COUNT instead of overflowing.
    const huge = withUsage(withUsage({}, APP, 'openai', 1e308), APP, 'openai', 1e308);
    expect(huge).toEqual({ [APP]: { openai: MAX_TOKEN_COUNT } });
    const stored = structuredClone(await signUsageState(addUsageTotals(totals, huge), key, 3));
    expect(await readUsageState(stored, key)).toMatchObject({ intact: true, totals: { [APP]: { openai: MAX_TOKEN_COUNT, anthropic: 10 } } });
  });

  it('reads only whole counts as signed totals, and salvages the rest app by app', () => {
    expect(parseUsageTotals({ [APP]: { openai: 1.5 } })).toBeNull();
    expect(parseUsageTotals({ [APP]: { openai: null } })).toBeNull();
    expect(parseUsageTotals({ [APP]: { openai: 2 ** 60 } })).toBeNull();
    // A refused state keeps every other app's counts, and rounds fractions up.
    expect(salvageUsageTotals({ [USAGE_KEY]: { [APP]: { openai: null, anthropic: 2.5 }, [OTHER]: { groq: 5 } } }))
      .toEqual({ [APP]: { anthropic: 3 }, [OTHER]: { groq: 5 } });
  });

  it('refuses totals older than the newest seen', async () => {
    const before = await signUsageState(TOTALS, key, 7);
    expect((await readUsageState(before, key, 8)).intact).toBe(false);
  });

  it('costs one HMAC per write: reading back what was written is checked without one', async () => {
    const verify = vi.spyOn(crypto.subtle, 'verify');
    const sign = vi.spyOn(crypto.subtle, 'sign');
    let totals: UsageTotals = TOTALS;
    for (let epoch = 1; epoch <= 5; epoch++) {
      const stored = structuredClone(await signUsageState(totals, key, epoch));
      const read = await readUsageState(stored, key, epoch);
      expect(read.intact).toBe(true);
      totals = addUsageTotals(read.totals, { [APP]: { openai: 1 } });
    }
    expect(sign).toHaveBeenCalledTimes(5);
    expect(verify).not.toHaveBeenCalled();
    // Something it didn't write is verified for real, and refused.
    const forged = { ...(await signUsageState(TOTALS, key, 6)), [USAGE_KEY]: { [APP]: { openai: 1 } } };
    expect((await readUsageState(forged, key)).intact).toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});

describe('adopting unsigned state', () => {
  it('keeps well-formed 1.1.1 state as it is', () => {
    const legacy = { [GROUPS_KEY]: GROUPS, [APP_GROUPS_KEY]: STATE.appGroups, [ALLOWANCES_KEY]: STATE.allowances, [USAGE_KEY]: TOTALS };
    expect(adoptLegacyRoutingState(legacy)).toEqual({ routing: STATE, usage: TOTALS });
    expect(adoptLegacyRoutingState({})).toEqual({ routing: { groups: [], appGroups: {}, allowances: [] }, usage: {} });
  });

  it('seeds missing usage totals from the request log, as 1.1.1 did', () => {
    const requestLog = [
      { appOrigin: APP, providerId: 'openai', status: 200, inputTokens: 3, outputTokens: 4 },
      { appOrigin: APP, providerId: 'openai', status: 200, inputTokens: 1 },
      { appOrigin: APP, providerId: 'openai', status: 500, inputTokens: 100 },
      { appOrigin: OTHER, providerId: 'groq', status: 200, outputTokens: 2 },
    ];
    expect(adoptLegacyRoutingState({ requestLog }).usage).toEqual({ [APP]: { openai: 8 }, [OTHER]: { groq: 2 } });
  });

  it('pauses apps rather than adopt state that doesn\'t parse', () => {
    const bad = adoptLegacyRoutingState({ [GROUPS_KEY]: GROUPS, [ALLOWANCES_KEY]: [{ origin: APP, totalLimit: 'lots' }] });
    expect(bad.routing).toEqual({ groups: [expect.objectContaining({ id: 'default', providerId: '' })], appGroups: {}, allowances: [], hold: 'settings' });
    const badUsage = adoptLegacyRoutingState({ [GROUPS_KEY]: GROUPS, [USAGE_KEY]: { [APP]: 3 } });
    expect(badUsage).toEqual({ routing: { groups: GROUPS, appGroups: {}, allowances: [], hold: 'usage' }, usage: {} });
  });

  it('keeps the usage of every other app when one 1.1.1 count doesn\'t parse, and pauses apps', () => {
    // 1.1.1 stored a count that had become Infinity as null, and could store a fraction.
    const legacy = { [GROUPS_KEY]: GROUPS, [USAGE_KEY]: { [APP]: { anthropic: null, openai: 7 }, [OTHER]: { groq: 5 } } };
    expect(adoptLegacyRoutingState(legacy)).toEqual({
      routing: { groups: GROUPS, appGroups: {}, allowances: [], hold: 'usage' },
      usage: { [APP]: { openai: 7 }, [OTHER]: { groq: 5 } },
    });
    // A fraction is rounded up: nothing was lost, so nothing is paused.
    expect(adoptLegacyRoutingState({ [USAGE_KEY]: { [APP]: { openai: 100.5 } } }))
      .toEqual({ routing: { groups: [], appGroups: {}, allowances: [] }, usage: { [APP]: { openai: 101 } } });
  });

  it('keeps origins from storage as keys, never as prototype access', () => {
    const totals = usageFromLog([{ appOrigin: '__proto__', providerId: 'polluted', status: 200, inputTokens: 1 }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(totals, '__proto__')).toBe(true);
    expect(addUsageTotals(totals, totals)['__proto__']).toEqual({ polluted: 2 });
  });

  it('tells a new, empty wallet from one whose state was stripped', () => {
    expect(isEmptyWallet({ passwordHash: 'v2:x', credentials: [] })).toBe(true);
    expect(isEmptyWallet({ passwordHash: 'v2:x', credentials: [{ id: 'a' }] })).toBe(false);
    expect(isEmptyWallet({ credentials: [], [ALLOWANCES_KEY]: [{ origin: APP }] })).toBe(false);
    expect(isEmptyWallet({ credentials: [], trustMac: 'x' })).toBe(false);
    expect(hasSignedRoutingState({})).toBe(false);
    expect(hasSignedRoutingState({ [USAGE_MAC_KEY]: null })).toBe(true);
  });

  it('makes a routing-neutral default group', () => {
    expect(defaultGroup(5)).toEqual({ id: 'default', name: 'Default', providerId: '', createdAt: 5 });
  });
});
