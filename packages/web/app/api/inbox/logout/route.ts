import { NextResponse } from 'next/server';
import { INBOX_COOKIE, noStore } from '@/lib/inbox-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = noStore(NextResponse.json({ ok: true }));
  res.cookies.set(INBOX_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}
