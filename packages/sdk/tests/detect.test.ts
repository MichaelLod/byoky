// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isExtensionInstalled, getStoreUrl } from '../src/detect.js';

describe('isExtensionInstalled', () => {
  afterEach(() => {
    delete (window as Record<string, unknown>).__byoky__;
  });

  it('returns false when __byoky__ is not on window', () => {
    expect(isExtensionInstalled()).toBe(false);
  });

  it('returns true when __byoky__ is on window', () => {
    (window as Record<string, unknown>).__byoky__ = { version: '0.1.0' };
    expect(isExtensionInstalled()).toBe(true);
  });
});

describe('getStoreUrl', () => {
  const realUA = navigator.userAgent;

  function mockUserAgent(ua: string) {
    Object.defineProperty(navigator, 'userAgent', {
      value: ua,
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: realUA,
      writable: true,
      configurable: true,
    });
  });

  it('returns Chrome Web Store URL for Chrome', () => {
    mockUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    const url = getStoreUrl();
    expect(url).toContain('chrome.google.com/webstore');
  });

  it('returns Firefox Add-ons URL for Firefox', () => {
    mockUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
    );
    const url = getStoreUrl();
    expect(url).toContain('addons.mozilla.org');
  });

  it('returns App Store URL for Safari', () => {
    mockUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    );
    const url = getStoreUrl();
    expect(url).toContain('apps.apple.com');
  });

  it('does not return Chrome store for Edge', () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    );
    const url = getStoreUrl();
    expect(url).toBeNull();
  });
});
