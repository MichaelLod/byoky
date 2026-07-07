import { NextResponse } from 'next/server';
import {
  INBOX_COOKIE,
  INBOX_SESSION_MAX_AGE,
  issueSessionToken,
  noStore,
  verifyInboxSecret,
} from '@/lib/inbox-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Rate-limit this endpoint at the platform level (Vercel firewall): it is
// the only place the secret is guessed, and serverless has no reliable
// in-memory throttle.
export async function POST(request: Request) {
  if (!process.env.INBOX_SECRET) {
    console.warn('INBOX_SECRET not set — inbox login disabled');
  }

  let body: { secret?: string };
  try {
    body = await request.json();
  } catch {
    return noStore(NextResponse.json({ error: 'Invalid request' }, { status: 400 }));
  }

  const secret = body.secret ?? '';
  const token = secret && verifyInboxSecret(secret) ? issueSessionToken() : null;
  // Uniform 401 whether the secret is wrong or INBOX_SECRET is unconfigured —
  // don't leak config state to unauthenticated callers.
  if (!token) {
    return noStore(NextResponse.json({ error: 'Invalid secret' }, { status: 401 }));
  }

  const res = noStore(NextResponse.json({ ok: true }));
  res.cookies.set(INBOX_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: INBOX_SESSION_MAX_AGE,
  });
  return res;
}
