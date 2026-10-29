import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  isBoundCiphertext,
  credentialAad,
  hashPassword,
  verifyPassword,
  isLegacyPasswordHash,
  deriveWalletMacKey,
  signMac,
  verifyMac,
  maskKey,
} from '../src/crypto.js';

// Written by byoky 1.1.1 (see packages/extension/tests/fixtures/wallet-1.1.1.json).
const V1_PASSWORD = 'fixture master password 1.1.1';
const V1_PASSWORD_HASH = 'LCZBsLE0ZSRzGue4HyzLzeMVIhGHD0i8DRIIjXGGwJwe1AicyZQkAcomFMbUdVG7';
const V1_CIPHERTEXT = 'f9YOBbU2ksbonwd9Yai52GSDBiv0KyHNcPNZx58sup5NwILYp9PnAeyH/kPTlfImnrq/ZNoupqmcVKZ/Lf5LCEhvWjU=';

/** The salt ‖ verifier bytes of a format-2 hash. */
function hashBytes(hash: string): Uint8Array {
  return Uint8Array.from(atob(hash.slice('v2:'.length)), (c) => c.charCodeAt(0));
}

describe('encrypt / decrypt', () => {
  it('round-trips a simple string', async () => {
    const plaintext = 'sk-test-key-12345';
    const password = 'master-password';

    const encrypted = await encrypt(plaintext, password);
    const decrypted = await decrypt(encrypted, password);

    expect(decrypted).toBe(plaintext);
  });

  it('round-trips an empty string', async () => {
    const encrypted = await encrypt('', 'pw');
    const decrypted = await decrypt(encrypted, 'pw');
    expect(decrypted).toBe('');
  });

  it('round-trips unicode content', async () => {
    const plaintext = '🔐 API キー 密钥';
    const encrypted = await encrypt(plaintext, 'password');
    const decrypted = await decrypt(encrypted, 'password');
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips a long key', async () => {
    const plaintext = 'x'.repeat(10_000);
    const encrypted = await encrypt(plaintext, 'pw');
    const decrypted = await decrypt(encrypted, 'pw');
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time (random salt/iv)', async () => {
    const plaintext = 'same-input';
    const password = 'same-password';

    const a = await encrypt(plaintext, password);
    const b = await encrypt(plaintext, password);

    expect(a).not.toBe(b);
  });

  it('fails to decrypt with the wrong password', async () => {
    const encrypted = await encrypt('secret', 'correct-password');

    await expect(decrypt(encrypted, 'wrong-password')).rejects.toThrow();
  });

  it('fails on tampered ciphertext', async () => {
    const encrypted = await encrypt('secret', 'password');
    // Flip a character in the middle of the base64 string
    const tampered =
      encrypted.slice(0, 20) +
      (encrypted[20] === 'A' ? 'B' : 'A') +
      encrypted.slice(21);

    await expect(decrypt(tampered, 'password')).rejects.toThrow();
  });

  it('returns a base64 string', async () => {
    const encrypted = await encrypt('test', 'pw');
    expect(() => atob(encrypted)).not.toThrow();
  });

  it('still decrypts ciphertext written by 1.1.1', async () => {
    expect(await decrypt(V1_CIPHERTEXT, V1_PASSWORD)).toBe('sk-ant-api03-fixture-key');
  });
});

describe('encrypt / decrypt with additional authenticated data', () => {
  const aad = credentialAad({ id: 'c1', providerId: 'anthropic' }, 'encryptedKey');

  it('round-trips and marks the result as bound', async () => {
    const encrypted = await encrypt('sk-test', 'pw', aad);
    expect(encrypted.startsWith('v2:')).toBe(true);
    expect(isBoundCiphertext(encrypted)).toBe(true);
    expect(() => atob(encrypted.slice(3))).not.toThrow();
    expect(await decrypt(encrypted, 'pw', aad)).toBe('sk-test');
  });

  it('fails with different data, a different password, or no data', async () => {
    const encrypted = await encrypt('sk-test', 'pw', aad);
    const other = credentialAad({ id: 'c1', providerId: 'openai' }, 'encryptedKey');
    await expect(decrypt(encrypted, 'pw', other)).rejects.toThrow();
    await expect(decrypt(encrypted, 'wrong', aad)).rejects.toThrow();
    await expect(decrypt(encrypted, 'pw')).rejects.toThrow('bound to data that was not supplied');
  });

  it('fails when the marker is stripped to pass the ciphertext off as unbound', async () => {
    const encrypted = await encrypt('sk-test', 'pw', aad);
    await expect(decrypt(encrypted.slice(3), 'pw')).rejects.toThrow();
  });

  it('refuses unbound ciphertext where bound is expected', async () => {
    expect(isBoundCiphertext(V1_CIPHERTEXT)).toBe(false);
    await expect(decrypt(V1_CIPHERTEXT, V1_PASSWORD, aad)).rejects.toThrow('not bound to the supplied data');
  });
});

describe('credentialAad', () => {
  const cred = { id: 'c1', providerId: 'azure_openai', baseUrl: 'https://a.openai.azure.com' };

  it('is a fixed, versioned encoding of the record', () => {
    expect(credentialAad(cred, 'encryptedKey')).toBe(
      '["byoky:credential:1","c1","azure_openai","https://a.openai.azure.com","encryptedKey"]',
    );
    expect(credentialAad({ id: 'c2', providerId: 'openai' }, 'encryptedAccessToken')).toBe(
      '["byoky:credential:1","c2","openai","","encryptedAccessToken"]',
    );
  });

  it('changes with every bound field', () => {
    const base = credentialAad(cred, 'encryptedKey');
    expect(credentialAad({ ...cred, id: 'c2' }, 'encryptedKey')).not.toBe(base);
    expect(credentialAad({ ...cred, providerId: 'openai' }, 'encryptedKey')).not.toBe(base);
    expect(credentialAad({ ...cred, baseUrl: 'https://evil.example' }, 'encryptedKey')).not.toBe(base);
    expect(credentialAad({ id: 'c1', providerId: 'azure_openai' }, 'encryptedKey')).not.toBe(base);
    expect(credentialAad(cred, 'encryptedRefreshToken')).not.toBe(base);
  });

  it('cannot be forged by moving separators between fields', () => {
    expect(credentialAad({ id: 'a","b', providerId: 'c' }, 'encryptedKey'))
      .not.toBe(credentialAad({ id: 'a', providerId: 'b","c' }, 'encryptedKey'));
  });
});

describe('hashPassword / verifyPassword', () => {
  it('writes format 2', async () => {
    const hash = await hashPassword('my-password');
    expect(hash.startsWith('v2:')).toBe(true);
    expect(isLegacyPasswordHash(hash)).toBe(false);
    expect(hashBytes(hash)).toHaveLength(48);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('my-password');
    const valid = await verifyPassword('my-password', hash);
    expect(valid).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('my-password');
    const valid = await verifyPassword('wrong-password', hash);
    expect(valid).toBe(false);
  });

  it('produces different hashes each time (random salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('rejects when hash length is tampered (shorter)', async () => {
    const hash = await hashPassword('my-password');
    const truncated = 'v2:' + btoa(String.fromCharCode(...hashBytes(hash).slice(0, 10)));
    const valid = await verifyPassword('my-password', truncated);
    expect(valid).toBe(false);
  });

  it('rejects when hash bytes are all wrong', async () => {
    const hash = await hashPassword('my-password');
    const combined = hashBytes(hash);
    // Keep salt (first 16 bytes), corrupt all hash bytes
    for (let i = 16; i < combined.length; i++) {
      combined[i] = combined[i] ^ 0xff;
    }
    const corrupted = 'v2:' + btoa(String.fromCharCode(...combined));
    const valid = await verifyPassword('my-password', corrupted);
    expect(valid).toBe(false);
  });

  it('rejects a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('my-password', 'v2:not base64!')).toBe(false);
    expect(await verifyPassword('my-password', '')).toBe(false);
  });

  it('still verifies a format-1 hash written by 1.1.1', async () => {
    expect(isLegacyPasswordHash(V1_PASSWORD_HASH)).toBe(true);
    expect(await verifyPassword(V1_PASSWORD, V1_PASSWORD_HASH)).toBe(true);
    expect(await verifyPassword('wrong-password', V1_PASSWORD_HASH)).toBe(false);
  });

  it('does not accept a format-2 hash passed off as format 1', async () => {
    // Without the marker the verifier bytes would be compared to K directly.
    const hash = await hashPassword('my-password');
    expect(await verifyPassword('my-password', hash.slice(3))).toBe(false);
  });
});

describe('deriveWalletMacKey / signMac / verifyMac', () => {
  it('derives a key that signs and verifies', async () => {
    const hash = await hashPassword('pw');
    const key = await deriveWalletMacKey('pw', hash);
    expect(key).not.toBeNull();
    const mac = await signMac(key!, 'data');
    expect(await verifyMac(key!, 'data', mac)).toBe(true);
    expect(await verifyMac(key!, 'Data', mac)).toBe(false);
    expect(await verifyMac(key!, 'data', mac.slice(0, -4) + 'AAA=')).toBe(false);
    expect(await verifyMac(key!, 'data', 'not base64!')).toBe(false);
  });

  it('is the same key for the same hash and a different one for another', async () => {
    const hash = await hashPassword('pw');
    const mac = await signMac((await deriveWalletMacKey('pw', hash))!, 'data');
    expect(await verifyMac((await deriveWalletMacKey('pw', hash))!, 'data', mac)).toBe(true);
    const rehashed = await hashPassword('pw');
    expect(await verifyMac((await deriveWalletMacKey('pw', rehashed))!, 'data', mac)).toBe(false);
  });

  it('is withheld for a wrong password and for format-1 hashes', async () => {
    expect(await deriveWalletMacKey('wrong', await hashPassword('pw'))).toBeNull();
    // Format 1 stores K, so a key derived from it would be public.
    expect(await deriveWalletMacKey(V1_PASSWORD, V1_PASSWORD_HASH)).toBeNull();
  });
});

describe('maskKey', () => {
  it('masks a long key showing first 4 and last 4', () => {
    expect(maskKey('sk-1234567890abcdef')).toBe('sk-1...cdef');
  });

  it('masks a short key as ****', () => {
    expect(maskKey('short')).toBe('****');
  });

  it('masks an 8-char key as ****', () => {
    expect(maskKey('12345678')).toBe('****');
  });

  it('shows partial mask for 9+ char keys', () => {
    expect(maskKey('123456789')).toBe('1234...6789');
  });
});
