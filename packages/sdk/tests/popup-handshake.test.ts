// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * BYOKY_* messages carry the session key and the full request body. The SDK
 * must only ever post them to its own window (where the content script or
 * the in-wallet browser bridge picks them up), never to a parent frame:
 * otherwise any site that frames a Byoky app could read every prompt and
 * forge every response.
 *
 * Byoky used to host apps inside its own popup and trusted a parent that
 * identified itself from an extension origin. That path is gone, so these
 * tests pin that no parent is trusted, whatever it claims.
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

/** Deliver a message as if it came from `origin`. */
function deliver(data: unknown, origin: string, source: unknown = fakeParent): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as MessageEventSource }));
}

async function loadDetect() {
  vi.resetModules();
  return import('../src/detect.js');
}

beforeEach(() => {
  makeFramed();
  window.location.hash = '';
});

describe('message target', () => {
  it('routes to self on an ordinary page', async () => {
    const detect = await loadDetect();

    const { target, origin } = await detect.resolveMessageTarget();
    expect(target).toBe(window);
    expect(origin).toBe(window.location.origin);
  });

  it('never routes to a parent, even one claiming an extension origin', async () => {
    const detect = await loadDetect();
    window.location.hash = '#byoky-in-popup=1';

    deliver({ type: 'BYOKY_POPUP_HELLO' }, EXTENSION_ORIGIN);

    const { target, origin } = await detect.resolveMessageTarget();
    expect(target).toBe(window);
    expect(origin).toBe(window.location.origin);
    expect(fakeParent.postMessage).not.toHaveBeenCalled();
  });

  it('does not treat a framing parent as an installed wallet', async () => {
    const detect = await loadDetect();
    deliver({ type: 'BYOKY_POPUP_HELLO' }, EXTENSION_ORIGIN);

    expect(detect.isExtensionInstalled()).toBe(false);
  });
});
