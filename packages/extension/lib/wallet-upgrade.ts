import {
  encrypt,
  decrypt,
  credentialAad,
  isBoundCiphertext,
  hashPassword,
  verifyPassword,
  isLegacyPasswordHash,
  deriveWalletMacKey,
  type Credential,
  type CredentialSecretField,
} from '@byoky/core';
import { TRUST_STATE_KEYS, adoptLegacyTrustState, signTrustState } from './trust-state';

/**
 * Storage format since 1.1.2, and the one-time upgrade from earlier ones.
 *
 * Every credential secret is encrypted under the master password with its
 * record bound in as additional authenticated data (credentialAad), and the
 * trust state (trusted sites and revoked origins) carries a MAC
 * (trust-state.ts) keyed from a format-2 password hash. Wallets written
 * before 1.1.2 have neither. upgradeWallet converts one on the first unlock:
 *
 *   1. rebinds every unbound credential secret, and writes the credentials;
 *   2. writes the format-2 password hash together with the signed trust
 *      state, in one storage write.
 *
 * The format-1 hash is the marker of a wallet not yet upgraded. Until step 2
 * replaces it, unbound secrets still decrypt (openCredentialSecret), so
 * requests keep working mid-upgrade and an interrupted upgrade simply runs
 * again on the next unlock. After it, unbound secrets are refused and an
 * unsigned list is dropped: neither can be planted to get adopted. Putting
 * the hash back to format 1 takes the user's own format-1 hash, i.e. a copy
 * of storage from before the upgrade, and replaying such a copy is beyond
 * what local storage alone can rule out.
 */
export const CREDENTIAL_SECRET_FIELDS: readonly CredentialSecretField[] = [
  'encryptedKey',
  'encryptedAccessToken',
  'encryptedRefreshToken',
];

/** The subset of browser.storage.local the upgrade uses. */
export interface WalletStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface WalletUpgradeOptions {
  /**
   * Runs each read-modify-write of the upgrade exclusively of the caller's
   * own writes to the same keys (the background passes serializedStorage).
   * Without it, a credential saved from a stale read could put unbound
   * secrets back just before the hash marks them as refused.
   */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface WalletUpgradeResult {
  /** The wallet MAC key under the new password hash. */
  macKey: CryptoKey;
  /** Secrets re-encrypted with their record bound in. */
  rebound: number;
  /** Unbound secrets that didn't decrypt; left as they were, unusable. */
  unreadable: number;
}

/**
 * Decrypt one stored secret, checking it belongs to `credential`. Unbound
 * ciphertext is accepted only with `allowUnbound`, i.e. while the wallet
 * still has its format-1 hash. Keyless local credentials store ''.
 */
export async function openCredentialSecret(
  credential: Pick<Credential, 'id' | 'providerId' | 'baseUrl'>,
  field: CredentialSecretField,
  encrypted: string,
  password: string,
  allowUnbound: boolean,
): Promise<string> {
  if (!encrypted) return '';
  if (isBoundCiphertext(encrypted)) return decrypt(encrypted, password, credentialAad(credential, field));
  if (!allowUnbound) throw new Error('Credential secret is not bound to its record');
  return decrypt(encrypted, password);
}

/**
 * Upgrade a wallet written before 1.1.2, if this one is. `password` must be
 * the verified master password. Returns null when there is nothing to do,
 * including when another run finished first or the wallet was reset
 * meanwhile. Throws if a storage write fails; the wallet then stays at
 * format 1 and the next call picks up where this one stopped.
 */
export async function upgradeWallet(
  storage: WalletStorage,
  password: string,
  { exclusive = (fn) => fn() }: WalletUpgradeOptions = {},
): Promise<WalletUpgradeResult | null> {
  const { passwordHash, credentials } = await storage.get(['passwordHash', 'credentials']);
  if (typeof passwordHash !== 'string' || !isLegacyPasswordHash(passwordHash)) return null;
  // Binding under a wrong password would make every secret unreadable.
  if (!(await verifyPassword(password, passwordHash))) throw new Error('Wrong password');

  // 1. Rebind credential secrets, in parallel: each is two PBKDF2 runs.
  const original = Array.isArray(credentials) ? (credentials as Array<Record<string, unknown>>) : [];
  let unreadable = 0;
  const rebound = new Map<string, Partial<Record<CredentialSecretField, { from: string; to: string }>>>();
  await Promise.all(original.map(async (cred) => {
    if (typeof cred?.id !== 'string' || typeof cred.providerId !== 'string') return;
    const record = { id: cred.id, providerId: cred.providerId, baseUrl: typeof cred.baseUrl === 'string' ? cred.baseUrl : undefined };
    for (const field of CREDENTIAL_SECRET_FIELDS) {
      const value = cred[field];
      if (typeof value !== 'string' || !value || isBoundCiphertext(value)) continue;
      let plaintext: string;
      try {
        plaintext = await decrypt(value, password);
      } catch {
        unreadable++;
        continue;
      }
      const entry = rebound.get(record.id) ?? {};
      entry[field] = { from: value, to: await encrypt(plaintext, password, credentialAad(record, field)) };
      rebound.set(record.id, entry);
    }
  }));

  // Each write first checks the hash is still the one this run started
  // from; if not, another run got there first or the wallet was reset.
  const unchanged = async () => (await storage.get(['passwordHash'])).passwordHash === passwordHash;

  let count = 0;
  if (rebound.size > 0) {
    const wrote = await exclusive(async () => {
      if (!(await unchanged())) return false;
      // Merge into what is stored now, so a credential added, renamed or
      // removed meanwhile isn't undone. A secret is only replaced where the
      // record still holds the ciphertext it was made from, for the same
      // provider and base URL it was bound to.
      const latest = await storage.get(['credentials']);
      const current = Array.isArray(latest.credentials) ? (latest.credentials as Array<Record<string, unknown>>) : [];
      const before = new Map(original.map((c) => [c?.id, c]));
      const merged = current.map((cred) => {
        const entry = rebound.get(cred?.id as string);
        const was = before.get(cred?.id);
        if (!entry || !was || cred.providerId !== was.providerId || cred.baseUrl !== was.baseUrl) return cred;
        const next = { ...cred };
        for (const field of CREDENTIAL_SECRET_FIELDS) {
          const change = entry[field];
          if (change && next[field] === change.from) {
            next[field] = change.to;
            count++;
          }
        }
        return next;
      });
      await storage.set({ credentials: merged });
      return true;
    });
    if (!wrote) return null;
  }

  // 2. New password hash and the signed trust state, together. Malformed
  // stored lists are dropped rather than signed (adoptLegacyTrustState).
  const newHash = await hashPassword(password);
  const macKey = await deriveWalletMacKey(password, newHash);
  if (!macKey) throw new Error('Could not derive the wallet key');
  const wrote = await exclusive(async () => {
    if (!(await unchanged())) return false;
    const state = adoptLegacyTrustState(await storage.get(TRUST_STATE_KEYS));
    await storage.set({ passwordHash: newHash, ...(await signTrustState(state, macKey)) });
    return true;
  });
  return wrote ? { macKey, rebound: count, unreadable } : null;
}
