import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? '';

  // demo.byoky.com → serve the /demo page at /
  if (hostname.startsWith('demo.')) {
    const url = request.nextUrl.clone();
    if (url.pathname === '/') {
      url.pathname = '/demo';
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
