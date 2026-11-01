// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getRedirectUrl,
  getRewrittenUrl,
  isRewrite,
  unstable_doesMiddlewareMatch,
} from 'next/experimental/testing/server';
import { config, middleware } from '../middleware';

function request(url: string): NextRequest {
  return new NextRequest(url, { headers: { host: new URL(url).host } });
}

function csp(url = 'https://byoky.com/'): string {
  const value = middleware(request(url)).headers.get('content-security-policy');
  expect(value).toBeTruthy();
  return value!;
}

function nonceOf(policy: string): string {
  const match = /'nonce-([^']+)'/.exec(policy);
  expect(match).not.toBeNull();
  return match![1];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('demo.byoky.com', () => {
  it.each(['https://demo.byoky.com/', 'https://demo.byoky.com/anything?x=1'])('%s redirects permanently to byoky.com/demo', (url) => {
    const res = middleware(request(url));
    expect(res.status).toBe(301);
    expect(getRedirectUrl(res)).toMatch(/^https:\/\/byoky\.com\/demo(\?|$)/);
  });
});

describe('chat.byoky.com', () => {
  it.each([
    ['https://chat.byoky.com/', 'https://chat.byoky.com/chat'],
    ['https://chat.byoky.com/foo', 'https://chat.byoky.com/chat/foo'],
    ['https://chat.byoky.com/foo/bar', 'https://chat.byoky.com/chat/foo/bar'],
  ])('%s is served from %s, keeping the chat host', (url, rewritten) => {
    const res = middleware(request(url));
    expect(isRewrite(res)).toBe(true);
    expect(getRewrittenUrl(res)).toBe(rewritten);
  });

  // 9bfaa9e: rewriting these to /chat/versions.json broke the version badge.
  it.each(['/versions.json', '/logo.svg', '/byoky_logo.svg', '/icon-512.png'])('serves the public file %s as it is', (path) => {
    const res = middleware(request(`https://chat.byoky.com${path}`));
    expect(isRewrite(res)).toBe(false);
    expect(getRedirectUrl(res)).toBeNull();
  });

  it('still sets the CSP on the rewritten page', () => {
    expect(csp('https://chat.byoky.com/')).toContain("frame-ancestors 'none'");
  });
});

describe('byoky.com', () => {
  it.each(['https://byoky.com/', 'https://byoky.com/docs', 'https://www.byoky.com/chat'])('%s passes through', (url) => {
    const res = middleware(request(url));
    expect(res.status).toBe(200);
    expect(isRewrite(res)).toBe(false);
    expect(getRedirectUrl(res)).toBeNull();
  });
});

describe('Content-Security-Policy', () => {
  it('has this directive list (nonce aside)', () => {
    expect(csp().replace(/'nonce-[^']+'/, "'nonce-NONCE'").split('; ')).toEqual([
      "default-src 'self'",
      "script-src 'self' 'nonce-NONCE'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://avatars.githubusercontent.com https://unpkg.com https://api.producthunt.com",
      "connect-src 'self' https://api.github.com",
      "frame-ancestors 'none';",
    ]);
  });

  it('never allows inline or eval script', () => {
    const scriptSrc = csp().split('; ').find((d) => d.startsWith('script-src '));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('uses a fresh 128-bit nonce for every response', () => {
    const nonces = new Set(Array.from({ length: 20 }, () => nonceOf(csp())));
    expect(nonces.size).toBe(20);
    for (const nonce of nonces) {
      expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
    }
  });

  it('hands the same policy to the page render, so Next.js can nonce its inline scripts', () => {
    const res = middleware(request('https://byoky.com/'));
    const policy = res.headers.get('content-security-policy');
    expect(res.headers.get('x-middleware-override-headers')?.split(',')).toContain('content-security-policy');
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  });

  it('is not set in development (React Refresh needs eval)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const res = middleware(request('https://byoky.com/'));
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBeNull();
  });
});

describe('matcher', () => {
  it.each(['/', '/docs', '/chat', '/versions.json', '/demo'])('runs on %s', (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true);
  });

  it.each(['/api/x', '/_next/static/chunks/main.js', '/_next/image', '/favicon.ico', '/favicon-32x32.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest'])(
    'skips %s',
    (path) => {
      expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(false);
    },
  );
});
