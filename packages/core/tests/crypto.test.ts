import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
  maskKey,
} from '../src/crypto.js';

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
});

describe('hashPassword / verifyPassword', () => {
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

  it('returns a base64 string', async () => {
    const hash = await hashPassword('test');
    expect(() => atob(hash)).not.toThrow();
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
