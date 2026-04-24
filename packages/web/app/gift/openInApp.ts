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

// A gift link can be long-form (`/gift/<encoded>`) or short-form (`/g/<shortId>`).
// Both shapes have matching deep-link hosts that the mobile apps recognize.
type GiftTarget = { host: 'gift' | 'g'; value: string };

function extractGiftTarget(giftLink: string): GiftTarget | null {
  try {
    const u = new URL(giftLink);
    if (u.hash.startsWith('#') && u.hash.length > 1) {
      const v = decodeURIComponent(u.hash.slice(1));
      if (/^[A-Za-z0-9_-]+$/.test(v)) return { host: 'gift', value: v };
    }
    const p = u.pathname.replace(/\/+$/, '');
    if (p.startsWith('/gift/')) {
      const seg = decodeURIComponent(p.slice('/gift/'.length));
      if (/^[A-Za-z0-9_-]+$/.test(seg)) return { host: 'gift', value: seg };
    }
    if (p.startsWith('/g/')) {
      const seg = decodeURIComponent(p.slice('/g/'.length));
      if (/^[A-Za-z0-9]+$/.test(seg)) return { host: 'g', value: seg };
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function openGiftInApp(giftLink: string): boolean {
  const platform = detectMobilePlatform();
  if (!platform) return false;
  const target = extractGiftTarget(giftLink);
  if (!target) return false;

  const deepPath = `${target.host}/${target.value}`;
  const canonical = `byoky://${deepPath}`;

  // Best-effort clipboard stash so the app's clipboard fallback can recover
  // the link if the deep-link redirect doesn't auto-foreground the app
  // (common on repeat redeems — iOS/Android throttle custom-scheme launches).
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(canonical).catch(() => { /* clipboard blocked */ });
  }

  if (platform === 'android') {
    const fallback = encodeURIComponent(ANDROID_STORE);
    window.location.href = `intent://${deepPath}#Intent;scheme=byoky;package=com.byoky.app;S.browser_fallback_url=${fallback};end`;
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
  window.location.href = canonical;
  return true;
}
