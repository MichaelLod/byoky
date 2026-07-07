import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Cookie-based session auth for the admin inbox.
//
// Design goals (security review, open-source repo):
//  - The secret never reaches JavaScript: login sets an httpOnly cookie,
//    so an XSS anywhere on the origin can't read it.
//  - The cookie holds a *signed, expiring session token*, not the master
//    secret itself — a leaked cookie dies on its own and never reveals
//    INBOX_SECRET.
//  - Dedicated INBOX_SECRET, separate from the marketplace ADMIN_SECRET,
//    so the two capabilities have independent blast radius / rotation.

export const INBOX_COOKIE = 'byoky_inbox_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
export const INBOX_SESSION_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

function getSecret(): string | null {
  const s = process.env.INBOX_SECRET;
  return s && s.length > 0 ? s : null;
}

// Constant-time compare that never throws on mismatched byte lengths.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** Verify the human-entered secret against INBOX_SECRET (constant-time). */
export function verifyInboxSecret(provided: string): boolean {
  const secret = getSecret();
  if (!secret) return false;
  return safeEqual(provided, secret);
}

/** Mint a session token "<expiryMs>.<hmac>" signed with INBOX_SECRET. */
export function issueSessionToken(): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const exp = String(Date.now() + SESSION_TTL_MS);
  return `${exp}.${sign(exp, secret)}`;
}

function verifySessionToken(token: string): boolean {
  const secret = getSecret();
  if (!secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  return safeEqual(sig, sign(exp, secret));
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Attach no-store so email content is never cached by any intermediary. */
export function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * Gate for inbox API routes. Returns a 401 NextResponse to short-circuit
 * when there is no valid session cookie, or null when authorized.
 */
export function checkInboxAuth(request: Request): NextResponse | null {
  const token = parseCookie(request.headers.get('cookie') ?? '', INBOX_COOKIE);
  if (!token || !verifySessionToken(token)) {
    return noStore(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }
  return null;
}
