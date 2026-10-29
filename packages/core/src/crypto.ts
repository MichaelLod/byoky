const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;
const ITERATIONS = 600_000;

/**
 * Marks a ciphertext sealed with additional authenticated data (see
 * `encrypt`). base64 has no ':', so a marked value can't be mistaken for an
 * unmarked one.
 */
const AAD_PREFIX = 'v2:';

/**
 * Marks a format-2 password hash (see `hashPassword`). Format 1 is the bare
 * base64 that wallets before 1.1.2 wrote.
 */
const PASSWORD_HASH_V2_PREFIX = 'v2:';

export async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Password-based AES-256-GCM: PBKDF2-SHA256 with 600,000 iterations and a
 * fresh salt per call, serialized as base64(salt[16] ‖ iv[12] ‖ ciphertext+tag).
 *
 * With `aad`, the UTF-8 bytes of `aad` are authenticated alongside the
 * ciphertext and the result is prefixed 'v2:'. Such a ciphertext only
 * decrypts when the same `aad` is supplied, which binds it to whatever the
 * caller encodes there (see credentialAad).
 */
export async function encrypt(
  plaintext: string,
  password: string,
  aad?: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    aesParams(iv, aad),
    key,
    new TextEncoder().encode(plaintext),
  );

  const combined = new Uint8Array(
    salt.length + iv.length + new Uint8Array(ciphertext).length,
  );
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

  const encoded = btoa(String.fromCharCode(...combined));
  return aad === undefined ? encoded : AAD_PREFIX + encoded;
}

/**
 * Reverse of `encrypt`. A ciphertext made with `aad` needs the same `aad`,
 * and one made without needs none: a mismatch either way throws, so a
 * caller that expects bound data never silently accepts unbound data.
 */
export async function decrypt(
  encrypted: string,
  password: string,
  aad?: string,
): Promise<string> {
  const bound = isBoundCiphertext(encrypted);
  if (bound && aad === undefined) throw new Error('Ciphertext is bound to data that was not supplied');
  if (!bound && aad !== undefined) throw new Error('Ciphertext is not bound to the supplied data');

  const encoded = bound ? encrypted.slice(AAD_PREFIX.length) : encrypted;
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));

  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(password, salt);

  const plaintext = await crypto.subtle.decrypt(
    aesParams(iv, aad),
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

/** Whether `encrypted` was sealed with additional authenticated data. */
export function isBoundCiphertext(encrypted: string): boolean {
  return encrypted.startsWith(AAD_PREFIX);
}

function aesParams(iv: Uint8Array, aad: string | undefined): AesGcmParams {
  return aad === undefined
    ? { name: 'AES-GCM', iv: iv as BufferSource }
    : { name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) };
}

/** The stored fields that hold a credential's encrypted secrets. */
export type CredentialSecretField = 'encryptedKey' | 'encryptedAccessToken' | 'encryptedRefreshToken';

/**
 * Additional authenticated data that binds a stored secret to its
 * credential record: the record id, provider, base URL (empty when the
 * record has none) and the field the secret sits in. A blob moved to another
 * record, or left in place while the record is repointed at another
 * provider or host, then fails to decrypt instead of being sent there.
 */
export function credentialAad(
  credential: { id: string; providerId: string; baseUrl?: string },
  field: CredentialSecretField,
): string {
  return JSON.stringify(['byoky:credential:1', credential.id, credential.providerId, credential.baseUrl ?? '', field]);
}

async function pbkdf2Bits(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH,
  );

  return new Uint8Array(bits);
}

/** HKDF-SHA256 key over the PBKDF2 output, for the subkeys below. */
async function hkdfBase(stretched: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', stretched as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
}

function hkdfParams(info: string): HkdfParams {
  return { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) };
}

async function passwordVerifier(stretched: Uint8Array): Promise<Uint8Array> {
  const base = await hkdfBase(stretched);
  return new Uint8Array(await crypto.subtle.deriveBits(hkdfParams('byoky password verifier'), base, KEY_LENGTH));
}

/**
 * Hash the wallet password for unlock checks. Format 2:
 *
 *   'v2:' + base64(salt[16] ‖ HKDF-SHA256(K, info 'byoky password verifier'))
 *   K = PBKDF2-SHA256(password, salt, 600,000 iterations, 256 bits)
 *
 * Format 1, written before 1.1.2, stored K itself: base64(salt ‖ K). Format
 * 2 keeps K secret, so keys derived from it (deriveWalletMacKey) can't be
 * computed by anyone who can only read storage. verifyPassword accepts both.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const verifier = await passwordVerifier(await pbkdf2Bits(password, salt));

  const combined = new Uint8Array(salt.length + verifier.length);
  combined.set(salt, 0);
  combined.set(verifier, salt.length);

  return PASSWORD_HASH_V2_PREFIX + btoa(String.fromCharCode(...combined));
}

/** Whether `storedHash` is a format-1 hash, from a wallet not yet upgraded. */
export function isLegacyPasswordHash(storedHash: string): boolean {
  return !storedHash.startsWith(PASSWORD_HASH_V2_PREFIX);
}

/**
 * Check `password` against `storedHash`, returning K when it matches. Any
 * malformed hash simply doesn't match.
 */
async function checkPassword(
  password: string,
  storedHash: string,
): Promise<Uint8Array | null> {
  const legacy = isLegacyPasswordHash(storedHash);
  let combined: Uint8Array;
  try {
    const encoded = legacy ? storedHash : storedHash.slice(PASSWORD_HASH_V2_PREFIX.length);
    combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (combined.length <= SALT_LENGTH) return null;
  const salt = combined.slice(0, SALT_LENGTH);
  const expected = combined.slice(SALT_LENGTH);

  const stretched = await pbkdf2Bits(password, salt);
  const actual = legacy ? stretched : await passwordVerifier(stretched);
  return constantTimeEqual(expected, actual) ? stretched : null;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  return (await checkPassword(password, storedHash)) !== null;
}

/**
 * The wallet's HMAC-SHA256 key, for authenticating wallet state that isn't
 * secret but mustn't be edited behind the wallet's back (the trusted-sites
 * list). HKDF-derived from K of a format-2 `storedHash`, so it exists only
 * while the password is known. Null when the password doesn't match, or the
 * hash is format 1, whose K sits in storage.
 */
export async function deriveWalletMacKey(
  password: string,
  storedHash: string,
): Promise<CryptoKey | null> {
  if (isLegacyPasswordHash(storedHash)) return null;
  const stretched = await checkPassword(password, storedHash);
  if (!stretched) return null;
  return crypto.subtle.deriveKey(
    hkdfParams('byoky wallet mac'),
    await hkdfBase(stretched),
    { name: 'HMAC', hash: 'SHA-256', length: KEY_LENGTH },
    false,
    ['sign', 'verify'],
  );
}

/** base64 HMAC of the UTF-8 bytes of `data`. */
export async function signMac(key: CryptoKey, data: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...mac));
}

/** Check a `signMac` result. Malformed input is a mismatch, never a throw. */
export async function verifyMac(key: CryptoKey, data: string, mac: string): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(mac), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', key, bytes as BufferSource, new TextEncoder().encode(data));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
