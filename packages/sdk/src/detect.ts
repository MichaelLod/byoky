import { BYOKY_PROVIDER_KEY } from '@byoky/core';

export function isExtensionInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return BYOKY_PROVIDER_KEY in window;
}

/**
 * Target for BYOKY_* postMessage calls: always this window, where the
 * extension's content script (or the mobile in-wallet browser's injected
 * bridge) picks them up.
 *
 * Never the parent frame. These messages carry the session key and full
 * request bodies, so a page that framed us must not be able to read them.
 * Byoky no longer hosts apps inside its own pages, so there is no trusted
 * parent to talk to.
 *
 * A sandboxed frame has an opaque origin, which serializes to "null" and
 * would never match as a targetOrigin, so '*' is used there. That is safe
 * because the target is this same window: any script that could read the
 * message already runs here.
 */
export async function resolveMessageTarget(): Promise<{ target: Window; origin: string }> {
  const selfOrigin = window.location.origin;
  return {
    target: window,
    origin: selfOrigin && selfOrigin !== 'null' ? selfOrigin : '*',
  };
}

export function getStoreUrl(): string | null {
  if (typeof navigator === 'undefined') return null;

  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes('android')) {
    return 'https://play.google.com/store/apps/details?id=com.byoky.app';
  }
  if (ua.includes('chrome') && !ua.includes('edg')) {
    return 'https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon';
  }
  if (ua.includes('firefox')) {
    return 'https://addons.mozilla.org/en-US/firefox/addon/byoky/';
  }
  if (ua.includes('safari') && !ua.includes('chrome')) {
    return 'https://apps.apple.com/app/byoky/id6760779919';
  }
  return null;
}
