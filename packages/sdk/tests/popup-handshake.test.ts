// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The SDK routes BYOKY_* messages — which carry the session key and the full
 * request body — to `window.parent` when it is running inside the extension
 * popup. Deciding that from the URL hash alone was exploitable: any site
 * could frame a Byoky app with `#byoky-in-popup`, be treated as the wallet,
 * read every prompt, and forge every response.
 *
 * These tests pin the replacement rule: only a parent that identifies itself
 * from a real extension origin is trusted, and messages are addressed to
 * that exact origin rather than '*'.
 */

const EXTENSION_ORIGIN = 'chrome-extension://igjohldpldlahcjmefdhlnbcpldlgmon';

let fakeParent: Window;

/** Pretend this document is framed, with `parent` a window we control. */
function makeFramed(): void {
  fakeParent = { postMessage: vi.fn() } as unknown as Window;
  Object.defineProperty(window, 'parent', {
    value: fakeParent,
    writable: true,
    configurable: true,
  });
}

function setHash(hash: string): void {
  window.location.hash = hash;
}

/** Deliver a message as if it came from `origin`. */
function deliver(data: unknown, origin: string, source: unknown = fakeParent): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as MessageEventSource }));
}

/** Fresh module instance — the trusted-origin state is module-level. */
async function loadDetect() {
  vi.resetModules();
  return import('../src/detect.js');
}

beforeEach(() => {
  makeFramed();
  setHash('');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('popup handshake', () => {
  it('trusts a parent that says hello from an extension origin', async () => {
    const detect = await loadDetect();
    setHash('#byoky-in-popup=1');

    deliver({ type: 'BYOKY_POPUP_HELLO' }, EXTENSION_ORIGIN);

    expect(detect.isInByokyPopup()).toBe(true);
    const { target, origin } = await detect.resolveMessageTarget();
    expect(target).toBe(fakeParent);
    // Addressed to the extension specifically — never '*', which would let
    // any frame in the chain read the session key.
    expect(origin).toBe(EXTENSION_ORIGIN);
  });

  it('ignores a hello from a web origin even with the popup hash set', async () => {
    const detect = await loadDetect();
    setHash('#byoky-in-popup=1');

    // The attack: evil.com frames the app with the popup hash and answers
    // the handshake itself.
    deliver({ type: 'BYOKY_POPUP_HELLO' }, 'https://evil.example');

    expect(detect.isInByokyPopup()).toBe(false);
  });

  it('does not route to the parent when only the hash claims popup', async () => {
    vi.useFakeTimers();
    const detect = await loadDetect();
    setHash('#byoky-in-popup=1');

    const pending = detect.resolveMessageTarget();
    await vi.advanceTimersByTimeAsync(4000); // past POPUP_HELLO_TIMEOUT_MS
    const { target } = await pending;

    // Falls back to self (the content-script route) rather than trusting
    // whoever framed us.
    expect(target).toBe(window);
    expect(detect.isInByokyPopup()).toBe(false);
  });

  it('ignores a hello that did not come from the parent frame', async () => {
    const detect = await loadDetect();
    setHash('#byoky-in-popup=1');

    // Right origin, wrong sender — e.g. a sibling frame.
    deliver({ type: 'BYOKY_POPUP_HELLO' }, EXTENSION_ORIGIN, { postMessage: vi.fn() });

    expect(detect.isInByokyPopup()).toBe(false);
  });

  it('routes to self on an ordinary page', async () => {
    const detect = await loadDetect();

    const { target, origin } = await detect.resolveMessageTarget();
    expect(target).toBe(window);
    expect(origin).toBe(window.location.origin);
  });
});
