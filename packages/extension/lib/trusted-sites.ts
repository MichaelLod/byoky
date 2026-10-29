import { signMac, verifyMac, type TrustedSite } from '@byoky/core';

/**
 * Integrity of the trusted-sites list: origins that connect without an
 * approval prompt. It sits in browser.storage.local as
 *
 *   trustedSites      TrustedSite[]
 *   trustedSitesMac   base64 HMAC-SHA256 of macInput(trustedSites)
 *
 * keyed with the wallet MAC key (deriveWalletMacKey), which exists only
 * while the wallet is unlocked. So:
 *   - While locked nothing is trusted. Connect requests queue for approval
 *     as before, and on unlock are checked against the verified list.
 *   - A list that fails verification (edited, malformed, or unsigned on an
 *     upgraded wallet) is dropped whole. Its sites need a manual approval
 *     again, as revoked sites already do.
 *   - An unsigned list from before 1.1.2 is signed once, by the wallet
 *     upgrade on the first unlock (wallet-upgrade.ts). After that, the
 *     format-2 password hash marks the wallet as upgraded, so stripping
 *     the MAC doesn't get a list re-adopted.
 * An empty list grants nothing and needs no MAC.
 */
export const TRUSTED_SITES_KEY = 'trustedSites';
export const TRUSTED_SITES_MAC_KEY = 'trustedSitesMac';

export interface TrustedSitesRead {
  sites: TrustedSite[];
  /** False when a stored list was refused; the caller drops it. */
  intact: boolean;
}

/** The stored list, or null if it isn't a well-formed TrustedSite[]. */
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

/** What the MAC covers: every field of every entry, in order. */
function macInput(sites: TrustedSite[]): string {
  return JSON.stringify([
    'byoky:trusted-sites:1',
    sites.map((s) => [s.origin, s.trustedAt, s.allowedProviders ?? null]),
  ]);
}

/** The storage entries for `sites`, MAC included. */
export async function signTrustedSites(sites: TrustedSite[], key: CryptoKey): Promise<Record<string, unknown>> {
  return { [TRUSTED_SITES_KEY]: sites, [TRUSTED_SITES_MAC_KEY]: await signMac(key, macInput(sites)) };
}

/** Verify the stored list (the two storage entries above) against `key`. */
export async function readTrustedSites(stored: Record<string, unknown>, key: CryptoKey): Promise<TrustedSitesRead> {
  const sites = parseTrustedSites(stored[TRUSTED_SITES_KEY]);
  if (!sites) return { sites: [], intact: false };
  if (sites.length === 0) return { sites, intact: true };
  const mac = stored[TRUSTED_SITES_MAC_KEY];
  if (typeof mac !== 'string' || !(await verifyMac(key, macInput(sites), mac))) {
    return { sites: [], intact: false };
  }
  return { sites, intact: true };
}
