import { signMac, verifyMac, type TrustedSite } from '@byoky/core';
import { isInsecureOrigin } from './origin';

/**
 * Integrity of the wallet's trust state, which decides who may connect
 * without an approval prompt. It sits in browser.storage.local as
 *
 *   trustedSites     TrustedSite[]  origins that connect without a prompt
 *   revokedOrigins   string[]       origins whose session the user revoked:
 *                                   their next connect needs a manual approval
 *                                   even if they're trusted
 *   trustEpoch       number         write counter, raised by every write
 *   trustMac         base64 HMAC-SHA256 of macInput(epoch, both lists)
 *
 * keyed with the wallet MAC key (deriveWalletMacKey), which exists only
 * while the wallet is unlocked. So:
 *   - While locked nothing is trusted. Connect requests queue for approval
 *     as before, and on unlock are checked against the verified state.
 *   - A state that fails verification (either list edited, deleted or
 *     malformed, or unsigned on an upgraded wallet) is dropped whole and
 *     TRUST_RESET_NOTICE_KEY is raised, so the popup can say why. Dropping
 *     fails closed: with the revocations unknown, no site keeps its trust,
 *     so a deleted revocation can't let a trusted site reconnect silently.
 *     The sites need a manual approval again, as revoked ones do.
 *   - Unsigned lists from before 1.1.2 are signed once, by the wallet
 *     upgrade on the first unlock (wallet-upgrade.ts). After that, the
 *     format-2 password hash marks the wallet as upgraded, so stripping the
 *     MAC doesn't get either list re-adopted.
 * A wallet that never stored any trust state (both lists absent or empty,
 * no MAC) trusts nothing and needs no MAC.
 *
 * The MAC input starts with a version tag. Tag 3 also says that the
 * wallet's routing state is signed (routing-state.ts): a state signed
 * under tag 1 or 2 (beforeRouting) comes from a 1.1.2 build that didn't
 * sign it yet, whose unsigned routing state is adopted once, and the
 * trust state re-signed under tag 3 in the same write. Stripping the
 * routing MAC later doesn't get it adopted again: that takes a tag-2
 * state, which only the wallet key can sign.
 *
 * The MAC alone can't tell a current state from an older one signed under
 * the same key, so whoever can read storage once and write it later could
 * put back a snapshot from before a site was removed or revoked. The epoch
 * catches that within a browser session: the background remembers the
 * highest epoch it has seen (in memory and storage.session, which content
 * scripts can't reach) and refuses an older one, or an unsigned empty
 * state, as it refuses a forged one. Across a browser restart nothing
 * local can tell a rolled-back storage from a current one.
 */
export const TRUSTED_SITES_KEY = 'trustedSites';
export const REVOKED_ORIGINS_KEY = 'revokedOrigins';
export const TRUST_MAC_KEY = 'trustMac';
export const TRUST_EPOCH_KEY = 'trustEpoch';
/** Set when a dropped trust state should be explained to the user. Just a flag. */
export const TRUST_RESET_NOTICE_KEY = 'trustResetNotice';
export const TRUST_STATE_KEYS = [TRUSTED_SITES_KEY, REVOKED_ORIGINS_KEY, TRUST_EPOCH_KEY, TRUST_MAC_KEY];

export interface TrustState {
  sites: TrustedSite[];
  revoked: string[];
}

export interface TrustStateRead extends TrustState {
  /** False when the stored state was refused; the caller drops it. */
  intact: boolean;
  /**
   * The state's epoch: 0 when none was stored (no state at all, or one
   * signed before epochs, which the caller re-signs) or when refused.
   */
  epoch: number;
  /**
   * Set on an intact state signed under tag 1 or 2, before routing state
   * was signed: the caller re-signs it (and adopts the routing state).
   */
  beforeRouting?: true;
}

/** A new, empty state: nothing trusted, nothing revoked. */
export function emptyTrustState(): TrustState {
  return { sites: [], revoked: [] };
}

/** The stored trusted sites, or null if they aren't a well-formed TrustedSite[]. */
export function parseTrustedSites(raw: unknown): TrustedSite[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const sites: TrustedSite[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const { origin, trustedAt, allowedProviders } = entry as Record<string, unknown>;
    if (typeof origin !== 'string' || typeof trustedAt !== 'number' || !Number.isFinite(trustedAt)) return null;
    if (allowedProviders !== undefined
      && !(Array.isArray(allowedProviders) && allowedProviders.every((p) => typeof p === 'string'))) return null;
    sites.push(allowedProviders === undefined ? { origin, trustedAt } : { origin, trustedAt, allowedProviders });
  }
  return sites;
}

/** The stored revoked origins, or null if they aren't a string[]. */
export function parseRevokedOrigins(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((o) => typeof o === 'string')) return null;
  return raw;
}

/**
 * The trusted entry under which `origin` may connect without a prompt: one
 * with providers in scope, for an origin not revoked since. Undefined
 * otherwise, including for every origin of a dropped (empty) state.
 */
export function silentTrustFor(state: TrustState, origin: string): TrustedSite | undefined {
  // 'unknown' stands for an opaque origin (a sandboxed frame anywhere), never a site.
  if (origin === 'unknown' || state.revoked.includes(origin)) return undefined;
  // Anyone on the network path can be a plain-http page, so it always asks.
  // An entry stored before this rule stays in the signed list (and its MAC)
  // but no longer counts.
  if (isInsecureOrigin(origin)) return undefined;
  const site = state.sites.find((s) => s.origin === origin);
  return site?.allowedProviders?.length ? site : undefined;
}

/**
 * What the MAC covers: the version tag, the epoch, and every field of every
 * entry of both lists, in order. Tag 2 is what 1.1.2 signed before the
 * routing state was signed too; tag 3 since.
 */
function macInput(state: TrustState, epoch: number, tag: 2 | 3 = 3): string {
  return JSON.stringify([
    `byoky:trust:${tag}`,
    epoch,
    state.sites.map((s) => [s.origin, s.trustedAt, s.allowedProviders ?? null]),
    state.revoked,
  ]);
}

/** The MAC input of states signed before the epoch was added. */
function macInputV1(state: TrustState): string {
  return JSON.stringify([
    'byoky:trust:1',
    state.sites.map((s) => [s.origin, s.trustedAt, s.allowedProviders ?? null]),
    state.revoked,
  ]);
}

/** The storage entries for `state` at `epoch` (a positive integer), MAC included. */
export async function signTrustState(state: TrustState, key: CryptoKey, epoch: number): Promise<Record<string, unknown>> {
  return {
    [TRUSTED_SITES_KEY]: state.sites,
    [REVOKED_ORIGINS_KEY]: state.revoked,
    [TRUST_EPOCH_KEY]: epoch,
    [TRUST_MAC_KEY]: await signMac(key, macInput(state, epoch)),
  };
}

/** The storage write that drops a refused state: both lists emptied, notice raised. */
export async function droppedTrustState(key: CryptoKey, epoch: number): Promise<Record<string, unknown>> {
  return { ...(await signTrustState(emptyTrustState(), key, epoch)), [TRUST_RESET_NOTICE_KEY]: true };
}

/**
 * Verify the stored state (the storage entries above) against `key`. A
 * state older than `minEpoch`, the highest epoch the caller has seen, is
 * refused like a forged one: it is a snapshot put back. So is a missing
 * state once the caller has seen one.
 */
export async function readTrustState(stored: Record<string, unknown>, key: CryptoKey, minEpoch = 0): Promise<TrustStateRead> {
  const refused: TrustStateRead = { sites: [], revoked: [], intact: false, epoch: 0 };
  const sites = parseTrustedSites(stored[TRUSTED_SITES_KEY]);
  const revoked = parseRevokedOrigins(stored[REVOKED_ORIGINS_KEY]);
  if (!sites || !revoked) return refused;
  const mac = stored[TRUST_MAC_KEY];
  const epoch = stored[TRUST_EPOCH_KEY];
  if (epoch === undefined) {
    if (minEpoch > 0) return refused;
    if (mac === undefined && sites.length === 0 && revoked.length === 0) return { sites, revoked, intact: true, epoch: 0 };
    if (typeof mac !== 'string' || !(await verifyMac(key, macInputV1({ sites, revoked }), mac))) return refused;
    return { sites, revoked, intact: true, epoch: 0, beforeRouting: true };
  }
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) return refused;
  if (typeof mac !== 'string') return refused;
  let beforeRouting = false;
  if (!(await verifyMac(key, macInput({ sites, revoked }, epoch), mac))) {
    if (!(await verifyMac(key, macInput({ sites, revoked }, epoch, 2), mac))) return refused;
    beforeRouting = true;
  }
  if (epoch < minEpoch) return refused;
  return { sites, revoked, intact: true, epoch, ...(beforeRouting ? { beforeRouting: true as const } : {}) };
}

/**
 * The pre-1.1.2 unsigned lists, as the wallet upgrade signs them in. A
 * malformed trusted list is dropped; so is the trusted list when the
 * revocations are malformed, since the revoked sites are unknown then.
 * `dropped` says whether any trust was lost that way.
 */
export function adoptLegacyTrustState(stored: Record<string, unknown>): { state: TrustState; dropped: boolean } {
  const sites = parseTrustedSites(stored[TRUSTED_SITES_KEY]);
  const revoked = parseRevokedOrigins(stored[REVOKED_ORIGINS_KEY]);
  if (!sites) return { state: emptyTrustState(), dropped: true };
  if (!revoked) return { state: emptyTrustState(), dropped: sites.length > 0 };
  return { state: { sites, revoked }, dropped: false };
}
