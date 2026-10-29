import { NextRequest, NextResponse } from 'next/server';

/**
 * Content-Security-Policy, set here rather than in next.config so each
 * response gets its own script nonce: scripts must be same-origin or carry
 * it. Next.js reads the nonce from the request's CSP header and adds it to
 * the inline scripts it renders (the RSC payload), which is why pages render
 * per request (app/layout.tsx). Dev mode needs 'unsafe-eval' for React
 * Refresh, so it gets no CSP.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com https://unpkg.com https://api.producthunt.com",
    "connect-src 'self' https://api.github.com",
    "frame-ancestors 'none'",
  ].join('; ') + ';';
}

function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? '';

  // Redirect demo.byoky.com to byoky.com/demo
  if (hostname.startsWith('demo.')) {
    const url = request.nextUrl.clone();
    url.host = hostname.replace('demo.', '');
    url.pathname = '/demo';
    return NextResponse.redirect(url, 301);
  }

  const csp = process.env.NODE_ENV === 'development' ? null : contentSecurityPolicy(newNonce());
  const requestHeaders = new Headers(request.headers);
  if (csp) requestHeaders.set('Content-Security-Policy', csp);

  // Rewrite chat.byoky.com to /chat (URL stays as chat.byoky.com). Files
  // from public/ (versions.json, logo.svg) are served as they are.
  let response: NextResponse;
  if (hostname.startsWith('chat.') && !/\.[a-z0-9]+$/i.test(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/chat' + url.pathname.replace(/^\/$/, '');
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (csp) response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/', '/((?!api|_next/static|_next/image|favicon|icon|apple-touch-icon|manifest).*)'],
};
