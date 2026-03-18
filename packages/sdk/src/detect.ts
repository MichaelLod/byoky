import { BYOKY_PROVIDER_KEY } from '@byoky/core';

export function isExtensionInstalled(): boolean {
  return typeof window !== 'undefined' && BYOKY_PROVIDER_KEY in window;
}

export function getStoreUrl(): string | null {
  if (typeof navigator === 'undefined') return null;

  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes('chrome') && !ua.includes('edg')) {
    return 'https://chrome.google.com/webstore/detail/byoky/TODO_EXTENSION_ID';
  }
  if (ua.includes('firefox')) {
    return 'https://addons.mozilla.org/en-US/firefox/addon/byoky/';
  }
  if (ua.includes('safari') && !ua.includes('chrome')) {
    return 'https://apps.apple.com/app/byoky/TODO_APP_ID';
  }
  return null;
}
