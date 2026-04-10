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

  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
