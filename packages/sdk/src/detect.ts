import { BYOKY_PROVIDER_KEY } from '@byoky/core';

/**
 * Origins the extension's own pages are served from. `event.origin` is set
 * by the browser and cannot be forged by page script, which is what makes
 * this a usable trust anchor — unlike the URL hash, which anyone embedding
 * us controls.
 */
const EXTENSION_ORIGIN_RE = /^(chrome|moz|safari-web)-extension:\/\/[^/]+$/i;

/** How long to wait for the popup to identify itself before giving up. */
const POPUP_HELLO_TIMEOUT_MS = 3000;
/** Re-ask this often while waiting — the popup may still be wiring up. */
const POPUP_HELLO_RETRY_MS = 150;

/**
 * Set once the parent frame has proven it is an extension page by sending
 * BYOKY_POPUP_HELLO from an extension origin. Until then we have no
 * trusted parent and must not send anything sensitive upwards.
 */
let trustedPopupOrigin: string | null = null;

function startPopupHelloListener(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('message', (event: MessageEvent) => {
    // Only the immediate parent can be the popup host, and only if we are
    // actually framed.
    if (window.parent === window || event.source !== window.parent) return;
    const data = event.data as { type?: unknown } | undefined;
    if (data?.type !== 'BYOKY_POPUP_HELLO') return;
    // The load-bearing check. A page on any origin can send this message;
    // only an extension page can send it *from* an extension origin.
    if (!EXTENSION_ORIGIN_RE.test(event.origin)) return;
    trustedPopupOrigin = event.origin;
  });
}

startPopupHelloListener();

/**
 * True when the parent frame has been *verified* as the Byoky extension
 * popup. Note this is false until the handshake completes; callers that
 * need to wait should use `resolveMessageTarget()`.
 */
export function isInByokyPopup(): boolean {
  return trustedPopupOrigin !== null;
}

/**
 * Await the popup handshake and report whether we are genuinely hosted by
 * the extension. Use this instead of sniffing the URL for a marker: the
 * hash is set by whoever framed the page, so `#byoky-in-popup` on its own
 * proves nothing and must not gate auto-connect or any other privileged
 * behaviour.
 *
 * Resolves false immediately on a page that isn't framed.
 */
export async function isInByokyPopupAsync(): Promise<boolean> {
  if (trustedPopupOrigin) return true;
  if (!looksLikePopupFrame()) return false;
  return (await awaitPopupHello()) !== null;
}

/**
 * Cheap hint that a handshake is worth waiting for. The hash is set by
 * `AppView` when it frames an app, but it is attacker-controllable, so this
 * only decides whether we *wait* — never whether we trust.
 */
function looksLikePopupFrame(): boolean {
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

/**
 * Ask the parent to identify itself and wait for a reply from an extension
 * origin. The request itself carries no secret, so broadcasting it with
 * targetOrigin '*' is safe — a hostile parent learns only that a Byoky SDK
 * is present, and cannot answer with an extension origin.
 */
function awaitPopupHello(): Promise<string | null> {
  return new Promise((resolve) => {
    if (trustedPopupOrigin) {
      resolve(trustedPopupOrigin);
      return;
    }
    const deadline = Date.now() + POPUP_HELLO_TIMEOUT_MS;
    const poll = setInterval(() => {
      if (trustedPopupOrigin) {
        clearInterval(poll);
        resolve(trustedPopupOrigin);
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(poll);
        resolve(null);
        return;
      }
      try {
        window.parent.postMessage({ type: 'BYOKY_POPUP_HELLO_REQUEST' }, '*');
      } catch {
        // Parent went away mid-wait; the deadline will resolve us.
      }
    }, POPUP_HELLO_RETRY_MS);
    try {
      window.parent.postMessage({ type: 'BYOKY_POPUP_HELLO_REQUEST' }, '*');
    } catch { /* handled by the poll above */ }
  });
}

/**
 * Target for BYOKY_* postMessage calls.
 *
 * In a popup-hosted iframe messages go to the parent (the extension popup
 * bridges them to the background); otherwise to self, where the content
 * script relays them.
 *
 * The parent path is only taken against a *verified* extension origin, and
 * messages are addressed to that exact origin. Both matter: these messages
 * carry the session key and full request bodies, so an unverified parent —
 * or a wildcard targetOrigin — would hand a page that framed us the ability
 * to read every prompt and forge every response.
 */
export async function resolveMessageTarget(): Promise<{ target: Window; origin: string }> {
  if (trustedPopupOrigin) {
    return { target: window.parent, origin: trustedPopupOrigin };
  }
  if (looksLikePopupFrame()) {
    const origin = await awaitPopupHello();
    if (origin) return { target: window.parent, origin };
    // The hash claimed popup but nothing ever identified itself as the
    // extension. Fall back to the content-script path instead of trusting
    // whoever framed us.
  }
  // Self-post for the content-script route. A sandboxed frame has an opaque
  // origin, which serializes to "null" and would never match as a
  // targetOrigin — use '*' there. That is safe because the target is this
  // same window: any script that could read the message already runs here.
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
