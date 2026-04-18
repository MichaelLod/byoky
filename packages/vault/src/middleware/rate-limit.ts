import type { Context, Next } from 'hono';

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 60;

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

export function startRateLimitCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now > entry.resetAt) windows.delete(key);
    }
  }, WINDOW_MS);
  cleanupTimer.unref();
}

export function stopRateLimitCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

/**
 * Treat `X-Forwarded-For` as trusted only when running behind a known proxy.
 * `TRUST_PROXY=1` (set on Railway / fly / render) opts in. Without it, XFF
 * is attacker-controlled — every request can rotate the rate-limit key by
 * spoofing the header — so we ignore it and key on the socket address.
 */
function trustProxy(): boolean {
  return process.env.TRUST_PROXY === '1';
}

/**
 * Pre-auth (IP-keyed) limiter. Mounted globally so /auth/login etc. have a
 * brute-force ceiling. Authenticated requests carry their own user-keyed
 * limiter mounted INSIDE protected routers (see `userRateLimitMiddleware`)
 * — the global IP key is always present too, but the per-user counter is
 * the one that actually matters once we know who the caller is.
 */
function getIpKey(c: Context): string {
  if (trustProxy()) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return `ip:${first}`;
    }
  }
  return 'unknown';
}

function consume(key: string, c: Context): Response | undefined {
  const now = Date.now();
  let entry = windows.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    windows.set(key, entry);
  }
  entry.count++;
  if (entry.count > MAX_REQUESTS) {
    c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429);
  }
  return undefined;
}

export async function rateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  const blocked = consume(getIpKey(c), c);
  if (blocked) return blocked;
  await next();
}

/**
 * Post-auth (user-keyed) limiter. Mount AFTER `authMiddleware` /
 * `appAuthMiddleware` so the right context var is set. Reads `userId`
 * (user-session paths) or `appSessionUserId` (proxy path) and falls back to
 * the IP key if neither is present (defense — should never happen since the
 * caller already passed auth).
 */
export async function userRateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  const userId = c.get('userId') ?? c.get('appSessionUserId');
  const key = userId ? `u:${userId}` : getIpKey(c);
  const blocked = consume(key, c);
  if (blocked) return blocked;
  await next();
}
