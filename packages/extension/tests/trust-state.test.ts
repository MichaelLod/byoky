import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword, deriveWalletMacKey, type TrustedSite } from '@byoky/core';
import {
  TRUSTED_SITES_KEY,
  REVOKED_ORIGINS_KEY,
  TRUST_MAC_KEY,
  TRUST_RESET_NOTICE_KEY,
  adoptLegacyTrustState,
  droppedTrustState,
  parseRevokedOrigins,
  parseTrustedSites,
  readTrustState,
  signTrustState,
  silentTrustFor,
  type TrustState,
} from '../lib/trust-state';
import { upgradeWallet, type WalletStorage } from '../lib/wallet-upgrade';
import fixture from './fixtures/wallet-1.1.1.json';

const SITES: TrustedSite[] = [
  { origin: 'https://chat.example.com', trustedAt: 1_760_000_100_000, allowedProviders: ['anthropic'] },
  { origin: 'http://localhost:3000', trustedAt: 1_760_000_200_000, allowedProviders: ['anthropic', 'openai'] },
];
// The user revoked chat.example.com's session; it stays trusted, but its next
// connect must be approved by hand.
const STATE: TrustState = { sites: SITES, revoked: ['https://chat.example.com'] };
const REFUSED = { sites: [], revoked: [], intact: false };

let key: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  key = (await deriveWalletMacKey('pw', await hashPassword('pw')))!;
  otherKey = (await deriveWalletMacKey('pw', await hashPassword('pw')))!;
}, 60_000);

/** A signed state with `edit` applied to the stored entries afterwards, MAC kept. */
async function tampered(edit: (stored: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
  const stored = structuredClone(await signTrustState(STATE, key));
  edit(stored);
  return stored;
}

/** Whether `origin` would connect without a prompt. */
function silentlyTrusted(state: TrustState, origin: string): boolean {
  return silentTrustFor(state, origin) !== undefined;
}

describe('trust state integrity', () => {
  it('trusts silently only scoped, unrevoked sites', () => {
    expect(silentTrustFor(STATE, 'http://localhost:3000')).toBe(SITES[1]);
    expect(silentTrustFor(STATE, 'https://chat.example.com')).toBeUndefined();
    expect(silentTrustFor(STATE, 'https://unknown.example')).toBeUndefined();
    expect(silentTrustFor({ sites: [{ origin: 'https://a.example', trustedAt: 1 }], revoked: [] }, 'https://a.example')).toBeUndefined();
    expect(silentTrustFor({ sites: [{ origin: 'https://a.example', trustedAt: 1, allowedProviders: [] }], revoked: [] }, 'https://a.example')).toBeUndefined();
    // 'unknown' is the background's name for an opaque origin, never a site.
    expect(silentTrustFor({ sites: [{ origin: 'unknown', trustedAt: 1, allowedProviders: ['openai'] }], revoked: [] }, 'unknown')).toBeUndefined();
  });

  it('accepts a state it signed', async () => {
    const stored = await signTrustState(STATE, key);
    expect(Object.keys(stored).sort()).toEqual([REVOKED_ORIGINS_KEY, TRUST_MAC_KEY, TRUSTED_SITES_KEY]);
    const read = await readTrustState(stored, key);
    expect(read).toEqual({ ...STATE, intact: true });
    expect(silentlyTrusted(read, 'https://chat.example.com')).toBe(false);
    expect(silentlyTrusted(read, 'http://localhost:3000')).toBe(true);
  });

  it('rejects an edited trusted list', async () => {
    const edits: Array<(s: TrustedSite[]) => unknown> = [
      // A wider scope for a trusted site.
      (s) => { s[1].allowedProviders!.push('mistral'); return s; },
      // A site added.
      (s) => [...s, { origin: 'https://evil.example', trustedAt: 1, allowedProviders: ['anthropic'] }],
      // A site's origin swapped.
      (s) => { s[1].origin = 'https://evil.example'; return s; },
      // Scope moved from one site to another.
      (s) => { [s[0].allowedProviders, s[1].allowedProviders] = [s[1].allowedProviders, s[0].allowedProviders]; return s; },
      // Reordered, or a site removed: still not what was signed.
      (s) => [s[1], s[0]],
      (s) => [s[1]],
    ];
    for (const edit of edits) {
      const stored = await tampered((st) => { st[TRUSTED_SITES_KEY] = edit(st[TRUSTED_SITES_KEY] as TrustedSite[]); });
      expect(await readTrustState(stored, key)).toEqual(REFUSED);
    }
  });

  it('fails closed when a revocation is deleted: the site does not get silent trust back', async () => {
    const cases: Array<(st: Record<string, unknown>) => void> = [
      (st) => { st[REVOKED_ORIGINS_KEY] = []; },
      (st) => { delete st[REVOKED_ORIGINS_KEY]; },
      (st) => { st[REVOKED_ORIGINS_KEY] = ['https://other.example']; },
      (st) => { st[REVOKED_ORIGINS_KEY] = 'https://chat.example.com'; },
      (st) => { st[REVOKED_ORIGINS_KEY] = [42]; },
    ];
    for (const edit of cases) {
      const read = await readTrustState(await tampered(edit), key);
      expect(read).toEqual(REFUSED);
      // Nothing trusted at all, so neither the revoked site nor any other connects silently.
      expect(silentlyTrusted(read, 'https://chat.example.com')).toBe(false);
      expect(silentlyTrusted(read, 'http://localhost:3000')).toBe(false);
    }
  });

  it('rejects a state without a MAC, with a malformed one, or one from another wallet', async () => {
    const unsigned = { [TRUSTED_SITES_KEY]: SITES, [REVOKED_ORIGINS_KEY]: STATE.revoked };
    expect(await readTrustState(unsigned, key)).toEqual(REFUSED);
    expect(await readTrustState({ ...unsigned, [TRUST_MAC_KEY]: 42 }, key)).toEqual(REFUSED);
    expect(await readTrustState({ ...unsigned, [TRUST_MAC_KEY]: '!!' }, key)).toEqual(REFUSED);
    expect(await readTrustState(await signTrustState(STATE, otherKey), key)).toEqual(REFUSED);
    // Revocations alone, unsigned, aren't a state this wallet wrote either.
    expect(await readTrustState({ [REVOKED_ORIGINS_KEY]: ['https://a.example'] }, key)).toEqual(REFUSED);
  });

  it('rejects malformed lists', async () => {
    for (const raw of [null, {}, 'https://a.example', [null], [{ origin: 1, trustedAt: 1 }], [{ origin: 'a', trustedAt: 'x' }], [{ origin: 'a', trustedAt: 1, allowedProviders: 'anthropic' }], [{ origin: 'a', trustedAt: 1, allowedProviders: [1] }]]) {
      expect(parseTrustedSites(raw)).toBeNull();
      expect((await readTrustState({ [TRUSTED_SITES_KEY]: raw }, key)).intact).toBe(false);
    }
    for (const raw of [null, {}, 'https://a.example', [1], [null]]) {
      expect(parseRevokedOrigins(raw)).toBeNull();
    }
  });

  it('needs no MAC for a wallet that never stored any trust state', async () => {
    expect(await readTrustState({}, key)).toEqual({ sites: [], revoked: [], intact: true });
    expect(await readTrustState({ [TRUSTED_SITES_KEY]: [], [REVOKED_ORIGINS_KEY]: [] }, key))
      .toEqual({ sites: [], revoked: [], intact: true });
    // An emptied state that still carries a MAC was emptied behind the wallet's back.
    const emptied = await tampered((st) => { st[TRUSTED_SITES_KEY] = []; st[REVOKED_ORIGINS_KEY] = []; });
    expect((await readTrustState(emptied, key)).intact).toBe(false);
  });

  it('covers entries without allowedProviders, and ignores extra fields', async () => {
    const legacy = { sites: [{ origin: 'https://old.example', trustedAt: 5 }], revoked: [] };
    const stored = await signTrustState(legacy, key);
    expect(await readTrustState(stored, key)).toEqual({ ...legacy, intact: true });
    const scoped = { ...stored, [TRUSTED_SITES_KEY]: [{ origin: 'https://old.example', trustedAt: 5, allowedProviders: ['anthropic'] }] };
    expect((await readTrustState(scoped, key)).intact).toBe(false);
    const extra = { ...stored, [TRUSTED_SITES_KEY]: [{ origin: 'https://old.example', trustedAt: 5, note: 'x' }] };
    expect(await readTrustState(extra, key)).toEqual({ ...legacy, intact: true });
  });

  it('drops a refused state with a signed empty one and raises the notice flag', async () => {
    const dropped = await droppedTrustState(key);
    expect(dropped[TRUST_RESET_NOTICE_KEY]).toBe(true);
    expect(await readTrustState(dropped, key)).toEqual({ sites: [], revoked: [], intact: true });
  });
});

describe('trust state migration', () => {
  function memoryStorage(initial: Record<string, unknown>): WalletStorage & { data: Record<string, unknown> } {
    const data: Record<string, unknown> = structuredClone(initial);
    return {
      data,
      async get(keys) {
        return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
      },
      async set(items) {
        Object.assign(data, structuredClone(items));
      },
    };
  }

  // 1.1.1 kept revocations unsigned, as a string[] under the same key.
  const legacy = { ...fixture.storage, [REVOKED_ORIGINS_KEY]: ['https://chat.example.com'] };

  it('adopts the 1.1.1 lists, dropping trust when either is malformed', () => {
    expect(adoptLegacyTrustState(legacy)).toEqual({
      state: { sites: fixture.storage.trustedSites, revoked: ['https://chat.example.com'] },
      dropped: false,
    });
    expect(adoptLegacyTrustState({})).toEqual({ state: { sites: [], revoked: [] }, dropped: false });
    expect(adoptLegacyTrustState({ ...legacy, [TRUSTED_SITES_KEY]: 'x' })).toEqual({ state: { sites: [], revoked: [] }, dropped: true });
    // Revocations unreadable: the revoked sites are unknown, so no site keeps its trust.
    expect(adoptLegacyTrustState({ ...legacy, [REVOKED_ORIGINS_KEY]: {} })).toEqual({ state: { sites: [], revoked: [] }, dropped: true });
    // Nothing was trusted, so nothing was lost.
    expect(adoptLegacyTrustState({ [REVOKED_ORIGINS_KEY]: {} })).toEqual({ state: { sites: [], revoked: [] }, dropped: false });
  });

  it('signs both 1.1.1 lists on the first unlock, in the same write as the new hash', async () => {
    const storage = memoryStorage(legacy);
    const writes: Array<Record<string, unknown>> = [];
    const set = storage.set.bind(storage);
    storage.set = async (items) => { writes.push(items); return set(items); };
    const result = await upgradeWallet(storage, fixture.PASSWORD);

    const final = writes.at(-1)!;
    expect(Object.keys(final).sort()).toEqual(['passwordHash', REVOKED_ORIGINS_KEY, TRUST_MAC_KEY, TRUSTED_SITES_KEY]);
    const read = await readTrustState(storage.data, result!.macKey);
    expect(read).toEqual({ sites: fixture.storage.trustedSites, revoked: ['https://chat.example.com'], intact: true });
    expect(silentlyTrusted(read, 'https://chat.example.com')).toBe(false);
    expect(storage.data[TRUST_RESET_NOTICE_KEY]).toBeUndefined();
  }, 60_000);

  it('drops trust and raises the notice when the 1.1.1 revocations are malformed', async () => {
    const storage = memoryStorage({ ...legacy, [REVOKED_ORIGINS_KEY]: 'https://chat.example.com' });
    const result = await upgradeWallet(storage, fixture.PASSWORD);
    expect(await readTrustState(storage.data, result!.macKey)).toEqual({ sites: [], revoked: [], intact: true });
    expect(storage.data[TRUST_RESET_NOTICE_KEY]).toBe(true);
  }, 60_000);

  it('never adopts an unsigned state after the upgrade, nor one with a revocation deleted', async () => {
    const storage = memoryStorage(legacy);
    await upgradeWallet(storage, fixture.PASSWORD);
    const signed = structuredClone(storage.data);
    const keyAfter = (await deriveWalletMacKey(fixture.PASSWORD, storage.data.passwordHash as string))!;

    // Someone with storage access deletes the revocation, MAC kept...
    storage.data[REVOKED_ORIGINS_KEY] = [];
    expect(await readTrustState(storage.data, keyAfter)).toEqual(REFUSED);

    // ...or strips the MAC and writes their own lists. The format-2 hash marks
    // the wallet as upgraded, so nothing re-signs them, and the key refuses them.
    Object.assign(storage.data, structuredClone(signed));
    storage.data[TRUSTED_SITES_KEY] = [{ origin: 'https://evil.example', trustedAt: 1, allowedProviders: ['anthropic'] }];
    storage.data[REVOKED_ORIGINS_KEY] = [];
    delete storage.data[TRUST_MAC_KEY];
    expect(await upgradeWallet(storage, fixture.PASSWORD)).toBeNull();
    expect(storage.data[TRUST_MAC_KEY]).toBeUndefined();
    expect(await readTrustState(storage.data, keyAfter)).toEqual(REFUSED);
  }, 60_000);
});
