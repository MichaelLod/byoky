import crypto from 'node:crypto';
import { encryptWithKey, decryptWithKey } from './crypto.js';

const GIFT_KEY_SALT = new TextEncoder().encode('byoky-vault-gift-key-v1');
const PBKDF2_ITERATIONS = 600_000;

let cachedKey: CryptoKey | null = null;

async function getGiftEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET required for gift encryption');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  cachedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: GIFT_KEY_SALT, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  return cachedKey;
}

export async function encryptGiftSecret(plaintext: string): Promise<string> {
  const key = await getGiftEncryptionKey();
  return encryptWithKey(plaintext, key);
}

export async function decryptGiftSecret(encrypted: string): Promise<string> {
  const key = await getGiftEncryptionKey();
  return decryptWithKey(encrypted, key);
}
