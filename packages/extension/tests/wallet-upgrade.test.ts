import { describe, it, expect } from 'vitest';
import {
  encrypt,
  hashPassword,
  isBoundCiphertext,
  isLegacyPasswordHash,
  verifyPassword,
  deriveWalletMacKey,
  type Credential,
} from '@byoky/core';
import { CREDENTIAL_SECRET_FIELDS, openCredentialSecret, upgradeWallet, type WalletStorage } from '../lib/wallet-upgrade';
import { readTrustState } from '../lib/trust-state';
import fixture from './fixtures/wallet-1.1.1.json';

const { PASSWORD } = fixture;

/** browser.storage.local stand-in; values are copied in and out, like the real one. */
function memoryStorage(initial: Record<string, unknown>, failSetAt?: number) {
  const data: Record<string, unknown> = structuredClone(initial);
  let sets = 0;
  const storage: WalletStorage & { data: Record<string, unknown> } = {
    data,
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(items) {
      sets++;
      if (sets === failSetAt) throw new Error('storage write failed');
      Object.assign(data, structuredClone(items));
    },
  };
  return storage;
}

function creds(storage: { data: Record<string, unknown> }): Credential[] {
  return storage.data.credentials as Credential[];
}

async function secret(cred: Credential, allowUnbound: boolean): Promise<string> {
  return cred.authMethod === 'api_key'
    ? openCredentialSecret(cred, 'encryptedKey', cred.encryptedKey, PASSWORD, allowUnbound)
    : openCredentialSecret(cred, 'encryptedAccessToken', cred.encryptedAccessToken, PASSWORD, allowUnbound);
}

describe('wallet upgrade from 1.1.1', () => {
  it('reads 1.1.1 credentials until the upgrade, and only while unbound ones are allowed', async () => {
    const [anthropic] = fixture.storage.credentials as Credential[];
    expect(await secret(anthropic, true)).toBe('sk-ant-api03-fixture-key');
    await expect(secret(anthropic, false)).rejects.toThrow('not bound to its record');
  });

  it('rebinds every secret, rewrites the hash and signs the trusted sites', async () => {
    const storage = memoryStorage(fixture.storage);
    const result = await upgradeWallet(storage, PASSWORD);
    expect(result).not.toBeNull();
    expect(result!.rebound).toBe(4);
    expect(result!.unreadable).toBe(0);

    // Password hash: format 2, same password.
    const hash = storage.data.passwordHash as string;
    expect(isLegacyPasswordHash(hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);

    // Credentials: same records, secrets bound, nothing else touched.
    const after = creds(storage);
    const before = fixture.storage.credentials as Array<Record<string, unknown>>;
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
    const meta = (c: object) => Object.fromEntries(
      Object.entries(c).filter(([k]) => !(CREDENTIAL_SECRET_FIELDS as readonly string[]).includes(k)),
    );
    expect(after.map(meta)).toEqual(before.map(meta));
    for (const cred of after as unknown as Array<Record<string, string | undefined>>) {
      for (const field of CREDENTIAL_SECRET_FIELDS) {
        if (cred[field]) expect(isBoundCiphertext(cred[field])).toBe(true);
      }
    }
    expect(await Promise.all(after.map((c) => secret(c, false)))).toEqual([
      'sk-ant-api03-fixture-key',
      'sk-ant-oat01-fixture-token',
      'azure-fixture-key',
      '',
    ]);
    const oauth = after[1] as Extract<Credential, { authMethod: 'oauth' }>;
    expect(await openCredentialSecret(oauth, 'encryptedRefreshToken', oauth.encryptedRefreshToken!, PASSWORD, false))
      .toBe('fixture-refresh-token');

    // Trusted sites: kept as they were, now verifiable with the new key.
    const read = await readTrustState(storage.data, result!.macKey);
    expect(read).toEqual({ sites: fixture.storage.trustedSites, revoked: [], intact: true });
    const derived = await deriveWalletMacKey(PASSWORD, hash);
    expect((await readTrustState(storage.data, derived!)).intact).toBe(true);
  }, 60_000);

  it('runs once: an upgraded wallet is left alone', async () => {
    const storage = memoryStorage(fixture.storage);
    await upgradeWallet(storage, PASSWORD);
    const snapshot = structuredClone(storage.data);
    expect(await upgradeWallet(storage, PASSWORD)).toBeNull();
    expect(storage.data).toEqual(snapshot);
  }, 60_000);

  it('refuses a secret moved into another record, or a record repointed, once upgraded', async () => {
    const storage = memoryStorage(fixture.storage);
    await upgradeWallet(storage, PASSWORD);
    const [anthropic, , azure] = creds(storage) as Array<Extract<Credential, { authMethod: 'api_key' }>>;

    // The Anthropic key's blob planted in the Azure record.
    await expect(secret({ ...azure, encryptedKey: anthropic.encryptedKey }, false)).rejects.toThrow();
    // The Azure record pointed at another host, or turned into another provider.
    await expect(secret({ ...azure, baseUrl: 'https://evil.openai.azure.com' }, false)).rejects.toThrow();
    await expect(secret({ ...anthropic, providerId: 'openai' }, false)).rejects.toThrow();
    // A record given another record's id.
    await expect(secret({ ...anthropic, id: azure.id }, false)).rejects.toThrow();
    // An unbound blob planted after the upgrade (e.g. copied from an old backup).
    const [old] = fixture.storage.credentials as Array<Extract<Credential, { authMethod: 'api_key' }>>;
    await expect(secret({ ...azure, encryptedKey: old.encryptedKey }, false)).rejects.toThrow();
    // Untouched records still decrypt.
    expect(await secret(azure, false)).toBe('azure-fixture-key');
  }, 60_000);

  it('resumes after an interrupted upgrade', async () => {
    // The second write (hash + trusted sites) fails: the wallet stays at format 1.
    const storage = memoryStorage(fixture.storage, 2);
    await expect(upgradeWallet(storage, PASSWORD)).rejects.toThrow('storage write failed');
    expect(isLegacyPasswordHash(storage.data.passwordHash as string)).toBe(true);
    expect(storage.data.trustMac).toBeUndefined();
    // Credentials already rebound still decrypt in the meantime.
    expect(await Promise.all(creds(storage).map((c) => secret(c, true)))).toHaveLength(4);

    const result = await upgradeWallet(storage, PASSWORD);
    expect(result!.rebound).toBe(0);
    expect(isLegacyPasswordHash(storage.data.passwordHash as string)).toBe(false);
    expect(await Promise.all(creds(storage).map((c) => secret(c, false)))).toContain('azure-fixture-key');
    expect((await readTrustState(storage.data, result!.macKey)).sites).toHaveLength(2);
  }, 60_000);

  it('keeps a credential added while it ran', async () => {
    const storage = memoryStorage(fixture.storage);
    const added = { id: 'added-meanwhile', providerId: 'openai', label: 'New', authMethod: 'api_key', createdAt: 1, encryptedKey: '' };
    const get = storage.get.bind(storage);
    let reads = 0;
    storage.get = async (keys) => {
      // The merge re-reads the credentials; by then the user added one.
      if (keys.length === 1 && keys[0] === 'credentials' && ++reads === 1) {
        (storage.data.credentials as unknown[]).push(added);
      }
      return get(keys);
    };
    await upgradeWallet(storage, PASSWORD);
    expect(creds(storage).map((c) => c.id)).toContain('added-meanwhile');
    expect(await secret(creds(storage)[0], false)).toBe('sk-ant-api03-fixture-key');
  }, 60_000);

  it('stops when another run (after a quick lock and unlock) finished first', async () => {
    const storage = memoryStorage(fixture.storage);
    const theirs = await hashPassword(PASSWORD);
    let sections = 0;
    // The other run writes its hash just before this run's last write.
    const exclusive = <T>(fn: () => Promise<T>) => {
      if (++sections === 2) storage.data.passwordHash = theirs;
      return fn();
    };
    expect(await upgradeWallet(storage, PASSWORD, { exclusive })).toBeNull();
    expect(storage.data.passwordHash).toBe(theirs);
    expect(storage.data.trustMac).toBeUndefined();
  }, 60_000);

  it('writes nothing into a wallet reset while it ran', async () => {
    const storage = memoryStorage(fixture.storage);
    const exclusive = <T>(fn: () => Promise<T>) => {
      for (const k of Object.keys(storage.data)) delete storage.data[k];
      return fn();
    };
    expect(await upgradeWallet(storage, PASSWORD, { exclusive })).toBeNull();
    expect(storage.data).toEqual({});
  }, 60_000);

  it('leaves an unreadable secret as it was and drops a malformed trusted-sites list', async () => {
    const foreign = await encrypt('sk-foreign', 'some other wallet password');
    const storage = memoryStorage({
      ...fixture.storage,
      credentials: [{ id: 'x', providerId: 'openai', label: 'X', authMethod: 'api_key', createdAt: 1, encryptedKey: foreign }],
      trustedSites: { origin: 'https://not-a-list.example' },
    });
    const result = await upgradeWallet(storage, PASSWORD);
    expect(result).toMatchObject({ rebound: 0, unreadable: 1 });
    expect((creds(storage)[0] as { encryptedKey: string }).encryptedKey).toBe(foreign);
    expect(storage.data.trustedSites).toEqual([]);
    expect(storage.data.trustResetNotice).toBe(true);
  }, 60_000);

  it('refuses to bind under a wrong password and changes nothing', async () => {
    const storage = memoryStorage(fixture.storage);
    await expect(upgradeWallet(storage, 'not the password')).rejects.toThrow('Wrong password');
    expect(storage.data).toEqual(fixture.storage);
  }, 60_000);
});
