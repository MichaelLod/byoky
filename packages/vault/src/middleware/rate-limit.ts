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

function getClientKey(c: Context): string {
  return c.get('userId') ?? c.req.header('x-forwarded-for') ?? 'unknown';
}

export async function rateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  const key = getClientKey(c);
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

  await next();
}
