import { BYOKY_PROVIDER_KEY } from '@byoky/core';

/** Detect pages loaded as iframes inside the Byoky browser extension popup.
 * Popup-hosted apps auto-connect via a parent-window bridge (matches the iOS
 * WebView bridge semantics), so the SDK must route messages accordingly. */
export function isInByokyPopup(): boolean {
  return typeof window !== 'undefined'
    && window.parent !== window
    && window.location.hash.includes('byoky-in-popup');
}

export function isExtensionInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  if (BYOKY_PROVIDER_KEY in window) return true;
  // Popup-hosted iframe: the extension IS the parent, even if content scripts
  // haven't injected the provider marker into this frame.
  return isInByokyPopup();
}

/** Target for BYOKY_* postMessage calls. In a popup-hosted iframe, messages
 * go to the parent (the extension popup bridges them); otherwise to self
 * (the content script relays them). */
export function getMessageTarget(): { target: Window; origin: string } {
  if (isInByokyPopup()) {
    return { target: window.parent, origin: '*' };
  }
  return { target: window, origin: window.location.origin };
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
