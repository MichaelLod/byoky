import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword, deriveWalletMacKey, type TrustedSite } from '@byoky/core';
import {
  TRUSTED_SITES_KEY,
  TRUSTED_SITES_MAC_KEY,
  parseTrustedSites,
  readTrustedSites,
  signTrustedSites,
} from '../lib/trusted-sites';
import { upgradeWallet, type WalletStorage } from '../lib/wallet-upgrade';
import fixture from './fixtures/wallet-1.1.1.json';

const SITES: TrustedSite[] = [
  { origin: 'https://chat.example.com', trustedAt: 1_760_000_100_000, allowedProviders: ['anthropic'] },
  { origin: 'http://localhost:3000', trustedAt: 1_760_000_200_000, allowedProviders: ['anthropic', 'openai'] },
];

let key: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  key = (await deriveWalletMacKey('pw', await hashPassword('pw')))!;
  otherKey = (await deriveWalletMacKey('pw', await hashPassword('pw')))!;
}, 60_000);

/** A signed list with `edit` applied to the stored sites afterwards, MAC kept. */
async function tampered(edit: (sites: TrustedSite[]) => unknown): Promise<Record<string, unknown>> {
  const stored = await signTrustedSites(structuredClone(SITES), key);
  return { ...stored, [TRUSTED_SITES_KEY]: edit(stored[TRUSTED_SITES_KEY] as TrustedSite[]) };
}

describe('trusted-sites integrity', () => {
  it('accepts a list it signed', async () => {
    const stored = await signTrustedSites(SITES, key);
    expect(Object.keys(stored).sort()).toEqual([TRUSTED_SITES_KEY, TRUSTED_SITES_MAC_KEY]);
    expect(await readTrustedSites(stored, key)).toEqual({ sites: SITES, intact: true });
  });

  it('rejects an edited list', async () => {
    const edits: Array<(s: TrustedSite[]) => unknown> = [
      // A wider scope for a trusted site.
      (s) => { s[0].allowedProviders!.push('openai'); return s; },
      // A site added.
      (s) => [...s, { origin: 'https://evil.example', trustedAt: 1, allowedProviders: ['anthropic'] }],
      // A site's origin swapped.
      (s) => { s[0].origin = 'https://evil.example'; return s; },
      // Scope moved from one site to another.
      (s) => { [s[0].allowedProviders, s[1].allowedProviders] = [s[1].allowedProviders, s[0].allowedProviders]; return s; },
      // Reordered, or a site removed: still not what was signed.
      (s) => [s[1], s[0]],
      (s) => [s[1]],
    ];
    for (const edit of edits) {
      expect(await readTrustedSites(await tampered(edit), key)).toEqual({ sites: [], intact: false });
    }
  });

  it('rejects a list without a MAC, with a malformed one, or one from another wallet', async () => {
    expect(await readTrustedSites({ [TRUSTED_SITES_KEY]: SITES }, key)).toEqual({ sites: [], intact: false });
    expect(await readTrustedSites({ [TRUSTED_SITES_KEY]: SITES, [TRUSTED_SITES_MAC_KEY]: 42 }, key)).toEqual({ sites: [], intact: false });
    expect(await readTrustedSites({ [TRUSTED_SITES_KEY]: SITES, [TRUSTED_SITES_MAC_KEY]: '!!' }, key)).toEqual({ sites: [], intact: false });
    expect(await readTrustedSites(await signTrustedSites(SITES, otherKey), key)).toEqual({ sites: [], intact: false });
  });

  it('rejects a malformed list', async () => {
    for (const raw of [null, {}, 'https://a.example', [null], [{ origin: 1, trustedAt: 1 }], [{ origin: 'a', trustedAt: 'x' }], [{ origin: 'a', trustedAt: 1, allowedProviders: 'anthropic' }], [{ origin: 'a', trustedAt: 1, allowedProviders: [1] }]]) {
      expect(parseTrustedSites(raw)).toBeNull();
      expect((await readTrustedSites({ [TRUSTED_SITES_KEY]: raw }, key)).intact).toBe(false);
    }
  });

  it('needs no MAC for an absent or empty list, which trusts nothing', async () => {
    expect(await readTrustedSites({}, key)).toEqual({ sites: [], intact: true });
    expect(await readTrustedSites({ [TRUSTED_SITES_KEY]: [] }, key)).toEqual({ sites: [], intact: true });
  });

  it('covers entries without allowedProviders, and ignores extra fields', async () => {
    const legacy = [{ origin: 'https://old.example', trustedAt: 5 }];
    const stored = await signTrustedSites(legacy, key);
    expect(await readTrustedSites(stored, key)).toEqual({ sites: legacy, intact: true });
    const scoped = { ...stored, [TRUSTED_SITES_KEY]: [{ origin: 'https://old.example', trustedAt: 5, allowedProviders: ['anthropic'] }] };
    expect((await readTrustedSites(scoped, key)).intact).toBe(false);
    const extra = { ...stored, [TRUSTED_SITES_KEY]: [{ origin: 'https://old.example', trustedAt: 5, note: 'x' }] };
    expect(await readTrustedSites(extra, key)).toEqual({ sites: legacy, intact: true });
  });
});

describe('trusted-sites migration', () => {
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

  it('signs a 1.1.1 list on the first unlock, and never adopts an unsigned one after', async () => {
    const storage = memoryStorage(fixture.storage);
    const result = await upgradeWallet(storage, fixture.PASSWORD);
    expect((await readTrustedSites(storage.data, result!.macKey)).sites).toEqual(fixture.storage.trustedSites);

    // Someone with storage access strips the MAC and writes their own list.
    storage.data[TRUSTED_SITES_KEY] = [{ origin: 'https://evil.example', trustedAt: 1, allowedProviders: ['anthropic'] }];
    delete storage.data[TRUSTED_SITES_MAC_KEY];

    // The format-2 hash marks the wallet as upgraded, so nothing re-signs it...
    expect(await upgradeWallet(storage, fixture.PASSWORD)).toBeNull();
    expect(storage.data[TRUSTED_SITES_MAC_KEY]).toBeUndefined();
    // ...and the next unlock's key refuses it.
    const key = await deriveWalletMacKey(fixture.PASSWORD, storage.data.passwordHash as string);
    expect(await readTrustedSites(storage.data, key!)).toEqual({ sites: [], intact: false });
  }, 60_000);
});
