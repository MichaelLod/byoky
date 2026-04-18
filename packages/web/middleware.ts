import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? '';

  // Redirect demo.byoky.com to byoky.com/demo
  if (hostname.startsWith('demo.')) {
    const url = request.nextUrl.clone();
    url.host = hostname.replace('demo.', '');
    url.pathname = '/demo';
    return NextResponse.redirect(url, 301);
  }

  // Rewrite chat.byoky.com to /chat (URL stays as chat.byoky.com)
  if (hostname.startsWith('chat.')) {
    const url = request.nextUrl.clone();
    url.pathname = '/chat' + url.pathname.replace(/^\/$/, '');
    return NextResponse.rewrite(url);
  }

  // api.byoky.com — public CLI-facing API. Only explicitly allowlisted
  // endpoints are exposed; everything else 404s so internal admin routes
  // stay on byoky.com.
  if (hostname.startsWith('api.')) {
    const path = request.nextUrl.pathname;
    const target = apiSubdomainTarget(path);
    if (!target) {
      return new NextResponse('Not Found', { status: 404 });
    }
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

function apiSubdomainTarget(path: string): string | null {
  if (path === '/v1/apps/submit') return '/api/apps/submit';
  return null;
}

export const config = {
  // api.byoky.com's paths don't start with /api/, so the byoky.com /api/*
  // exclusion still holds. Host-based routing above runs at edge before
  // hitting these, so api.byoky.com traffic reaches the middleware via
  // non-/api paths (/v1/...).
  matcher: ['/', '/((?!api|_next/static|_next/image|favicon|icon|apple-touch-icon|og-image|manifest).*)'],
};
