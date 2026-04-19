const IOS_STORE = 'https://apps.apple.com/app/byoky/id6760779919';
const ANDROID_STORE = 'https://play.google.com/store/apps/details?id=com.byoky.app';

export type MobilePlatform = 'ios' | 'android' | null;

export function detectMobilePlatform(): MobilePlatform {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
}

export function extractGiftEncoded(giftLink: string): string | null {
  try {
    const u = new URL(giftLink);
    if (u.hash.startsWith('#') && u.hash.length > 1) {
      return decodeURIComponent(u.hash.slice(1));
    }
    const p = u.pathname.replace(/\/+$/, '');
    if (p.startsWith('/gift/')) {
      const seg = p.slice('/gift/'.length);
      if (seg) return decodeURIComponent(seg);
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function openGiftInApp(giftLink: string): boolean {
  const platform = detectMobilePlatform();
  if (!platform) return false;
  const encoded = extractGiftEncoded(giftLink);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return false;

  if (platform === 'android') {
    const fallback = encodeURIComponent(ANDROID_STORE);
    window.location.href = `intent://gift/${encoded}#Intent;scheme=byoky;package=com.byoky.app;S.browser_fallback_url=${fallback};end`;
    return true;
  }

  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearTimeout(timer);
  };
  const onVisibility = () => {
    if (document.hidden) cleanup();
  };
  const timer = window.setTimeout(() => {
    cleanup();
    if (document.hidden) return;
    window.location.href = IOS_STORE;
  }, 1500);
  document.addEventListener('visibilitychange', onVisibility);
  window.location.href = `byoky://gift/${encoded}`;
  return true;
}
