import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, type Credential } from '@byoky/core';
import {
  exportVaultFile,
  importVaultFile,
  VAULT_FILE_VERSION,
  MAX_VAULT_FILE_CREDENTIALS,
  type VaultFileCrypto,
} from '../lib/vault-file';

// Reversible stand-in for the 600k-iteration PBKDF2 scheme, so the merge
// logic can be exercised quickly. Decrypting with the wrong password throws,
// like AES-GCM does.
const fake: VaultFileCrypto = {
  async encrypt(plain, pw) {
    return `enc(${pw}):${encodeURIComponent(plain)}`;
  },
  async decrypt(ct, pw) {
    const prefix = `enc(${pw}):`;
    if (!ct.startsWith(prefix)) throw new Error('decrypt failed');
    return decodeURIComponent(ct.slice(prefix.length));
  },
};

const MASTER_A = 'master-password-A';
const MASTER_B = 'master-password-B';
const EXPORT_PW = 'export-password';

async function apiKeyCred(id: string, providerId: string, key: string, pw: string, cipher: VaultFileCrypto, baseUrl?: string): Promise<Credential> {
  return {
    id,
    providerId,
    label: `${providerId} ${id}`,
    authMethod: 'api_key',
    createdAt: 1_700_000_000_000,
    encryptedKey: key ? await cipher.encrypt(key, pw) : '',
    ...(baseUrl ? { baseUrl } : {}),
  };
}

async function oauthCred(id: string, access: string, refresh: string | undefined, pw: string, cipher: VaultFileCrypto): Promise<Credential> {
  return {
    id,
    providerId: 'gemini',
    label: `gemini ${id}`,
    authMethod: 'oauth',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_800_000_000_000,
    encryptedAccessToken: await cipher.encrypt(access, pw),
    ...(refresh ? { encryptedRefreshToken: await cipher.encrypt(refresh, pw) } : {}),
  };
}

async function secretOf(cred: Credential, pw: string, cipher: VaultFileCrypto): Promise<string> {
  const enc = cred.authMethod === 'api_key' ? cred.encryptedKey : cred.encryptedAccessToken;
  return enc ? cipher.decrypt(enc, pw) : '';
}

/** Build a file by hand, the way an older wallet (or another platform) would. */
async function fileFrom(payload: unknown, pw: string, cipher: VaultFileCrypto): Promise<string> {
  return cipher.encrypt(JSON.stringify(payload), pw);
}

describe('.byoky vault file', () => {
  it('round-trips every secret between wallets with real crypto', async () => {
    const walletA: Credential[] = [
      await apiKeyCred('a1', 'anthropic', 'sk-ant-api03-test', MASTER_A, { encrypt, decrypt }),
      await oauthCred('a2', 'ya29.access', '1//refresh', MASTER_A, { encrypt, decrypt }),
      await apiKeyCred('a3', 'ollama', '', MASTER_A, { encrypt, decrypt }, 'http://localhost:11434'),
    ];

    const file = await exportVaultFile(walletA, MASTER_A, EXPORT_PW);

    // Payload shape: outer envelope under the export password, secrets
    // individually encrypted under the export password, no gift fields.
    const payload = JSON.parse(await decrypt(file, EXPORT_PW));
    expect(Object.keys(payload).sort()).toEqual(['credentials', 'exportedAt', 'version']);
    expect(payload.version).toBe(VAULT_FILE_VERSION);
    expect(payload.credentials).toHaveLength(3);
    expect(await decrypt(payload.credentials[0].encryptedKey, EXPORT_PW)).toBe('sk-ant-api03-test');
    expect(await decrypt(payload.credentials[1].encryptedRefreshToken, EXPORT_PW)).toBe('1//refresh');
    expect(payload.credentials[2].encryptedKey).toBe('');

    const result = await importVaultFile(file, EXPORT_PW, [], MASTER_B);
    if (!result.ok) throw new Error(result.error);
    expect(result.skipped).toBe(0);
    const [anthropic, gemini, ollama] = result.added;
    expect(await decrypt((anthropic as { encryptedKey: string }).encryptedKey, MASTER_B)).toBe('sk-ant-api03-test');
    const g = gemini as { encryptedAccessToken: string; encryptedRefreshToken: string; expiresAt: number };
    expect(await decrypt(g.encryptedAccessToken, MASTER_B)).toBe('ya29.access');
    expect(await decrypt(g.encryptedRefreshToken, MASTER_B)).toBe('1//refresh');
    expect(g.expiresAt).toBe(1_800_000_000_000);
    expect(ollama).toMatchObject({ providerId: 'ollama', encryptedKey: '', baseUrl: 'http://localhost:11434' });
  }, 60_000);

  it('merges into an existing wallet: keeps what is there, skips exact duplicates', async () => {
    const existing = [
      await apiKeyCred('b1', 'openai', 'sk-shared', MASTER_B, fake),
      await apiKeyCred('b2', 'anthropic', 'sk-only-in-b', MASTER_B, fake),
    ];
    const file = await exportVaultFile([
      await apiKeyCred('a1', 'openai', 'sk-shared', MASTER_A, fake),      // duplicate of b1
      await apiKeyCred('a2', 'openai', 'sk-new', MASTER_A, fake),         // new key, same provider
      await apiKeyCred('a3', 'mistral', 'sk-shared', MASTER_A, fake),     // same secret, other provider
    ], MASTER_A, EXPORT_PW, fake);

    const result = await importVaultFile(file, EXPORT_PW, existing, MASTER_B, fake);
    if (!result.ok) throw new Error(result.error);
    expect(result.skipped).toBe(1);
    expect(result.added.map((c) => c.providerId)).toEqual(['openai', 'mistral']);
    expect(await Promise.all(result.added.map((c) => secretOf(c, MASTER_B, fake)))).toEqual(['sk-new', 'sk-shared']);
    // Fresh ids, never colliding with stored or file ids.
    for (const c of result.added) {
      expect(['a1', 'a2', 'a3', 'b1', 'b2']).not.toContain(c.id);
    }
  });

  it('treats a different baseUrl as a different credential, and dedupes within the file', async () => {
    const file = await exportVaultFile([
      await apiKeyCred('a1', 'ollama', '', MASTER_A, fake, 'http://localhost:11434'),
      await apiKeyCred('a2', 'ollama', '', MASTER_A, fake, 'http://localhost:11435'),
      await apiKeyCred('a3', 'ollama', '', MASTER_A, fake, 'http://localhost:11434'),
    ], MASTER_A, EXPORT_PW, fake);

    const result = await importVaultFile(file, EXPORT_PW, [], MASTER_B, fake);
    if (!result.ok) throw new Error(result.error);
    expect(result.added.map((c) => c.baseUrl)).toEqual(['http://localhost:11434', 'http://localhost:11435']);
    expect(result.skipped).toBe(1);
    expect(result.rejected).toBe(0);
  });

  it('imports legacy files: ignores gift fields, drops a refresh token it cannot decrypt', async () => {
    const legacy = await fileFrom({
      version: 2,
      exportedAt: 1_700_000_000_000,
      credentials: [
        {
          id: 'old-1',
          providerId: 'gemini',
          label: 'Old Gemini',
          authMethod: 'oauth',
          createdAt: 1_600_000_000_000,
          encryptedAccessToken: await fake.encrypt('ya29.old', EXPORT_PW),
          // Older exports left this under the exporting wallet's master password.
          encryptedRefreshToken: await fake.encrypt('1//old-refresh', 'some-other-master'),
        },
      ],
      gifts: [{ id: 'g1', authToken: 'x' }],
      giftedCredentials: [{ id: 'gc1', authToken: 'y' }],
    }, EXPORT_PW, fake);

    const result = await importVaultFile(legacy, EXPORT_PW, [], MASTER_B, fake);
    if (!result.ok) throw new Error(result.error);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ providerId: 'gemini', label: 'Old Gemini', authMethod: 'oauth' });
    expect(result.added[0]).not.toHaveProperty('encryptedRefreshToken');
    expect(await secretOf(result.added[0], MASTER_B, fake)).toBe('ya29.old');
  });

  it('rejects a wrong password, malformed entries and undecryptable keys without adding anything', async () => {
    const good = await exportVaultFile([await apiKeyCred('a1', 'openai', 'sk-1', MASTER_A, fake)], MASTER_A, EXPORT_PW, fake);
    expect(await importVaultFile(good, 'wrong', [], MASTER_B, fake)).toEqual({ ok: false, error: 'Wrong password or corrupted file' });

    const malformed = await fileFrom({ version: 2, credentials: [{ providerId: 'openai', authMethod: 'magic' }] }, EXPORT_PW, fake);
    expect(await importVaultFile(malformed, EXPORT_PW, [], MASTER_B, fake)).toEqual({ ok: false, error: 'Invalid vault file format' });

    const noVersion = await fileFrom({ credentials: [] }, EXPORT_PW, fake);
    expect(await importVaultFile(noVersion, EXPORT_PW, [], MASTER_B, fake)).toEqual({ ok: false, error: 'Invalid vault file format' });

    const badKey = await fileFrom({
      version: 2,
      credentials: [
        { id: 'x', providerId: 'openai', label: 'ok', authMethod: 'api_key', createdAt: 1, encryptedKey: await fake.encrypt('sk-ok', EXPORT_PW) },
        { id: 'y', providerId: 'openai', label: 'bad', authMethod: 'api_key', createdAt: 1, encryptedKey: await fake.encrypt('sk-bad', 'elsewhere') },
      ],
    }, EXPORT_PW, fake);
    expect(await importVaultFile(badKey, EXPORT_PW, [], MASTER_B, fake)).toEqual({ ok: false, error: 'Could not decrypt a credential in the file' });
  });

  it('sanitizes untrusted entries: baseUrl, provider, timestamps', async () => {
    const enc = (v: string) => fake.encrypt(v, EXPORT_PW);
    const future = Date.now() + 365 * 24 * 60 * 60 * 1000;
    const file = await fileFrom({
      version: 2,
      credentials: [
        // Fixed-host provider: a baseUrl would redirect the key. Dropped.
        { providerId: 'anthropic', label: 'A', authMethod: 'api_key', createdAt: future, lastUsedAt: future, baseUrl: 'https://evil.example', encryptedKey: await enc('sk-a') },
        // Custom-host providers need a safe baseUrl; these entries are skipped.
        { providerId: 'azure_openai', label: 'B', authMethod: 'api_key', createdAt: 1, baseUrl: 'http://myres.openai.azure.com', encryptedKey: await enc('sk-b') },
        { providerId: 'ollama', label: 'C', authMethod: 'api_key', createdAt: 1, baseUrl: 'http://192.168.1.5:11434', encryptedKey: '' },
        { providerId: 'lm_studio', label: 'D', authMethod: 'api_key', createdAt: 1, encryptedKey: '' },
        // Unknown provider: skipped.
        { providerId: 'made-up', label: 'E', authMethod: 'api_key', createdAt: 1, encryptedKey: await enc('sk-e') },
        // Valid custom-host entry.
        { providerId: 'azure_openai', label: 'F', authMethod: 'api_key', createdAt: 1, baseUrl: 'https://myres.openai.azure.com', encryptedKey: await enc('sk-f') },
      ],
    }, EXPORT_PW, fake);

    const before = Date.now();
    const result = await importVaultFile(file, EXPORT_PW, [], MASTER_B, fake);
    if (!result.ok) throw new Error(result.error);
    expect(result.rejected).toBe(4);
    expect(result.skipped).toBe(4);
    expect(result.added.map((c) => c.label)).toEqual(['A', 'F']);

    const [anthropic, azure] = result.added;
    expect(anthropic).not.toHaveProperty('baseUrl');
    expect(anthropic).not.toHaveProperty('lastUsedAt');
    expect(anthropic.createdAt).toBeGreaterThanOrEqual(before);
    expect(anthropic.createdAt).toBeLessThanOrEqual(Date.now());
    expect(azure.baseUrl).toBe('https://myres.openai.azure.com');
    expect(azure.createdAt).toBe(1);
  });

  it(`rejects files with more than ${MAX_VAULT_FILE_CREDENTIALS} credentials`, async () => {
    const entry = { providerId: 'openai', label: 'x', authMethod: 'api_key', createdAt: 1, encryptedKey: '' };
    const file = await fileFrom({
      version: 2,
      credentials: Array.from({ length: MAX_VAULT_FILE_CREDENTIALS + 1 }, () => entry),
    }, EXPORT_PW, fake);
    const result = await importVaultFile(file, EXPORT_PW, [], MASTER_B, fake);
    expect(result).toEqual({ ok: false, error: `Vault file has more than ${MAX_VAULT_FILE_CREDENTIALS} credentials` });
  });

  it('does not export a baseUrl for fixed-host providers', async () => {
    const cred = await apiKeyCred('a1', 'openai', 'sk-1', MASTER_A, fake, 'https://evil.example');
    const payload = JSON.parse(await fake.decrypt(await exportVaultFile([cred], MASTER_A, EXPORT_PW, fake), EXPORT_PW));
    expect(payload.credentials[0]).not.toHaveProperty('baseUrl');
  });

  it('exports a credential whose stored refresh token is unreadable, minus that token', async () => {
    const cred = await oauthCred('a1', 'ya29.access', undefined, MASTER_A, fake);
    (cred as { encryptedRefreshToken?: string }).encryptedRefreshToken = await fake.encrypt('1//foreign', 'some-other-master');

    const payload = JSON.parse(await fake.decrypt(await exportVaultFile([cred], MASTER_A, EXPORT_PW, fake), EXPORT_PW));
    expect(payload.credentials[0]).not.toHaveProperty('encryptedRefreshToken');
    expect(await fake.decrypt(payload.credentials[0].encryptedAccessToken, EXPORT_PW)).toBe('ya29.access');

    const broken = await apiKeyCred('a2', 'openai', 'sk-1', 'not-the-master', fake);
    await expect(exportVaultFile([broken], MASTER_A, EXPORT_PW, fake)).rejects.toThrow();
  });
});
