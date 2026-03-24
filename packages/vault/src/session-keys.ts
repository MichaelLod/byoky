const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const SWEEP_INTERVAL_MS = 60 * 1000; // 60 seconds

interface CachedKey {
  key: CryptoKey;
  lastActivity: number;
}

const cache = new Map<string, CachedKey>();

let sweepTimer: ReturnType<typeof setInterval> | undefined;

export function startIdleSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [userId, entry] of cache) {
      if (now - entry.lastActivity > IDLE_TIMEOUT_MS) {
        cache.delete(userId);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

export function stopIdleSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
}

export function cacheKey(userId: string, key: CryptoKey): void {
  cache.set(userId, { key, lastActivity: Date.now() });
}

export function getCachedKey(userId: string): CryptoKey | undefined {
  const entry = cache.get(userId);
  if (!entry) return undefined;
  entry.lastActivity = Date.now();
  return entry.key;
}

export function evictKey(userId: string): void {
  cache.delete(userId);
}

export function evictAll(): void {
  cache.clear();
}
