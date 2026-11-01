import { useEffect, useRef, useState } from 'react';

/**
 * Seconds left in a password lockout that ends at `lockedUntil` (epoch ms),
 * re-rendering once a second while it runs; 0 when there is none. `onExpire`
 * runs once when it reaches 0.
 */
export function useLockoutCountdown(lockedUntil: number | null, onExpire?: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!lockedUntil) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        clearInterval(timer);
        onExpireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  return lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
}

/** "Too many attempts. Try again in 45s" (or "in 3m 05s"). */
export function lockoutMessage(seconds: number): string {
  const wait = seconds <= 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `Too many attempts. Try again in ${wait}`;
}

/** The end of the lockout a background reply reports, if it is still running. */
export function lockedUntilFrom(result: Record<string, unknown>): number | null {
  const until = result.lockedUntil;
  return typeof until === 'number' && until > Date.now() ? until : null;
}
