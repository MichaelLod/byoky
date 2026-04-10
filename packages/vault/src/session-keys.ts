import crypto from 'node:crypto';
import { getEncryptedKeyForUser } from './db/index.js';

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

// ─── Server-side key wrapping ────────────────────────────────────────────
// Encrypts the raw CryptoKey bytes with a key derived from JWT_SECRET so
// the encryption key can be persisted in the user_sessions table and
// recovered after the in-memory idle cache evicts it.

const IV_LENGTH = 12;

let serverKey: CryptoKey | undefined;

async function getServerKey(): Promise<CryptoKey> {
  if (serverKey) return serverKey;
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var required');
  const raw = crypto.createHash('sha256').update(secret).update('session-key-wrap').digest();
  serverKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return serverKey;
}

/** Export + encrypt a CryptoKey for storage in the DB. */
export async function wrapKey(key: CryptoKey): Promise<string> {
  const sk = await getServerKey();
  const raw = await crypto.subtle.exportKey('raw', key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sk, raw);
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return Buffer.from(combined).toString('base64');
}

/** Decrypt + import a CryptoKey from DB storage. */
async function unwrapKey(wrapped: string): Promise<CryptoKey> {
  const sk = await getServerKey();
  const combined = Buffer.from(wrapped, 'base64');
  const iv = combined.subarray(0, IV_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sk, ciphertext);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/**
 * Try to recover a user's encryption key from the DB when the in-memory
 * cache has evicted it. Returns the key and re-caches it, or undefined if
 * no persisted key exists (pre-migration sessions).
 */
export async function recoverCachedKey(userId: string): Promise<CryptoKey | undefined> {
  const wrapped = await getEncryptedKeyForUser(userId);
  if (!wrapped) return undefined;
  try {
    const key = await unwrapKey(wrapped);
    cacheKey(userId, key);
    return key;
  } catch {
    return undefined;
  }
}
