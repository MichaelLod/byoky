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
// Encrypts the raw CryptoKey bytes with a server-derived AES-GCM key so the
// encryption key can be persisted in the user_sessions table and recovered
// after the in-memory idle cache evicts it.
//
// Wrapped-blob format:
//   v0 (legacy): [iv (12 bytes)][ciphertext]               — base64
//                Server key: SHA-256(JWT_SECRET || "session-key-wrap")
//   v1 (current): [0x01][iv (12 bytes)][ciphertext]        — base64
//                Server key: HKDF-SHA-256(IKM=VAULT_WRAP_SECRET || JWT_SECRET,
//                                         salt="byoky-vault-v1",
//                                         info="session-key-wrap")
//
// New writes use v1. Reads detect the version by inspecting the first byte:
// if it equals 0x01 we use the v1 key; otherwise the blob is treated as v0
// and decrypted with the legacy key. This keeps every existing session valid
// across the rollout while letting operators rotate by setting
// VAULT_WRAP_SECRET independently of JWT_SECRET.

const IV_LENGTH = 12;
const WRAP_VERSION_V1 = 0x01;
const HKDF_SALT = Buffer.from('byoky-vault-v1');
const HKDF_INFO = Buffer.from('session-key-wrap');

let serverKeyV0: CryptoKey | undefined;
let serverKeyV1: CryptoKey | undefined;

function getIkm(): Buffer {
  // Prefer a dedicated wrap secret so it can be rotated independently of
  // JWT_SECRET (rotating JWT_SECRET would otherwise brick every wrapped key).
  // Fall back to JWT_SECRET so existing deployments don't need a new env var.
  const wrap = process.env.VAULT_WRAP_SECRET;
  const jwt = process.env.JWT_SECRET;
  const ikm = (wrap && wrap.length >= 32) ? wrap : jwt;
  if (!ikm) throw new Error('VAULT_WRAP_SECRET or JWT_SECRET env var required');
  return Buffer.from(ikm);
}

async function getServerKeyV1(): Promise<CryptoKey> {
  if (serverKeyV1) return serverKeyV1;
  const ikm = getIkm();
  const raw = crypto.hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, 32);
  serverKeyV1 = await crypto.subtle.importKey('raw', new Uint8Array(raw as ArrayBuffer), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return serverKeyV1;
}

async function getServerKeyV0(): Promise<CryptoKey> {
  if (serverKeyV0) return serverKeyV0;
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var required for legacy wrapped-key decryption');
  const raw = crypto.createHash('sha256').update(secret).update('session-key-wrap').digest();
  serverKeyV0 = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return serverKeyV0;
}

/** Export + encrypt a CryptoKey for storage in the DB. Always writes v1. */
export async function wrapKey(key: CryptoKey): Promise<string> {
  const sk = await getServerKeyV1();
  const raw = await crypto.subtle.exportKey('raw', key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sk, raw));
  const combined = new Uint8Array(1 + iv.length + ciphertext.length);
  combined[0] = WRAP_VERSION_V1;
  combined.set(iv, 1);
  combined.set(ciphertext, 1 + iv.length);
  return Buffer.from(combined).toString('base64');
}

/** Decrypt + import a CryptoKey from DB storage (v0 or v1). */
async function unwrapKey(wrapped: string): Promise<CryptoKey> {
  const combined = Buffer.from(wrapped, 'base64');
  if (combined.length < IV_LENGTH + 16) {
    throw new Error('wrapped key is too short');
  }

  let sk: CryptoKey;
  let iv: Buffer;
  let ciphertext: Buffer;

  if (combined[0] === WRAP_VERSION_V1) {
    sk = await getServerKeyV1();
    iv = combined.subarray(1, 1 + IV_LENGTH);
    ciphertext = combined.subarray(1 + IV_LENGTH);
  } else {
    // Legacy v0 blobs have no version byte: the whole buffer is [iv|ct].
    sk = await getServerKeyV0();
    iv = combined.subarray(0, IV_LENGTH);
    ciphertext = combined.subarray(IV_LENGTH);
  }

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
