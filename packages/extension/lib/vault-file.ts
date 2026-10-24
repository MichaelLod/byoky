import {
  encrypt as coreEncrypt,
  decrypt as coreDecrypt,
  PROVIDERS,
  resolveProviderBaseUrl,
  type AuthMethod,
  type Credential,
} from '@byoky/core';

/**
 * The `.byoky` backup file: the portable format for moving credentials
 * between wallets (extension, iOS, Android).
 *
 * File contents = encrypt(JSON.stringify(payload), exportPassword), using
 * @byoky/core's password-based AES-256-GCM: PBKDF2-SHA256 with 600,000
 * iterations, serialized as base64(salt[16] ‖ iv[12] ‖ ciphertext+tag).
 *
 *   payload = { version: 2, exportedAt: number, credentials: VaultFileCredential[] }
 *
 * Credential metadata sits in the clear inside the outer envelope. Each
 * secret is additionally encrypted on its own under the export password,
 * with the same scheme:
 *   encryptedKey           api_key credentials ('' for keyless local providers)
 *   encryptedAccessToken   oauth credentials (setup token or access token)
 *   encryptedRefreshToken  oauth credentials, optional
 *
 * `baseUrl` is only written for providers without a fixed host (Azure
 * OpenAI, Ollama, LM Studio). Files written before this module may also
 * carry `lastUsedAt`, `gifts` and `giftedCredentials`; importers ignore them.
 *
 * An imported file is untrusted input. On import:
 *   - more than MAX_VAULT_FILE_CREDENTIALS entries, a structurally malformed
 *     entry, or a key/access token that won't decrypt rejects the whole file;
 *   - an entry for an unknown provider, or for a custom-host provider whose
 *     baseUrl isn't https (or http to loopback, for local providers), is
 *     skipped;
 *   - `baseUrl` is dropped for fixed-host providers, `createdAt` is capped at
 *     now, and labels are trimmed to MAX_LABEL_LENGTH.
 */
export const VAULT_FILE_VERSION = 2;

/** Decrypted payload size cap, guarding JSON.parse against huge inputs. */
export const MAX_VAULT_FILE_JSON_LENGTH = 10_485_760;

/** Files with more credentials than this are rejected outright. */
export const MAX_VAULT_FILE_CREDENTIALS = 500;

const MAX_LABEL_LENGTH = 200;

export interface VaultFileCredential {
  id: string;
  providerId: string;
  label: string;
  authMethod: AuthMethod;
  createdAt: number;
  /** Only for providers without a fixed host. */
  baseUrl?: string;
  /** oauth only: access-token expiry, epoch ms. */
  expiresAt?: number;
  encryptedKey?: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
}

export interface VaultFilePayload {
  version: number;
  exportedAt: number;
  credentials: VaultFileCredential[];
}

export interface VaultFileCrypto {
  encrypt(plaintext: string, password: string): Promise<string>;
  decrypt(ciphertext: string, password: string): Promise<string>;
}

const defaultCrypto: VaultFileCrypto = { encrypt: coreEncrypt, decrypt: coreDecrypt };

export type VaultImportResult =
  /**
   * `skipped` counts every entry not added; `rejected` is the subset skipped
   * for failing validation (the rest were duplicates).
   */
  | { ok: true; added: Credential[]; skipped: number; rejected: number }
  | { ok: false; error: string };

/**
 * Serialize `credentials` (secrets encrypted under `masterPassword`) into
 * the contents of a `.byoky` file, re-encrypting every secret under
 * `exportPassword`. Throws if an API key or access token can't be
 * decrypted.
 */
export async function exportVaultFile(
  credentials: Credential[],
  masterPassword: string,
  exportPassword: string,
  cipher: VaultFileCrypto = defaultCrypto,
): Promise<string> {
  const exported = await Promise.all(credentials.map(async (cred): Promise<VaultFileCredential> => {
    const out: VaultFileCredential = {
      id: cred.id,
      providerId: cred.providerId,
      label: cred.label,
      authMethod: cred.authMethod,
      createdAt: cred.createdAt,
    };
    const baseUrl = customBaseUrl(cred.providerId, cred.baseUrl);
    if (baseUrl) out.baseUrl = baseUrl;
    if (cred.authMethod === 'api_key') {
      out.encryptedKey = await reencrypt(cred.encryptedKey, masterPassword, exportPassword, cipher);
    } else {
      out.encryptedAccessToken = await reencrypt(cred.encryptedAccessToken, masterPassword, exportPassword, cipher);
      if (cred.expiresAt !== undefined) out.expiresAt = cred.expiresAt;
      const refresh = await reencryptOptional(cred.encryptedRefreshToken, masterPassword, exportPassword, cipher);
      if (refresh) out.encryptedRefreshToken = refresh;
    }
    return out;
  }));
  const payload: VaultFilePayload = {
    version: VAULT_FILE_VERSION,
    exportedAt: Date.now(),
    credentials: exported,
  };
  return cipher.encrypt(JSON.stringify(payload), exportPassword);
}

/**
 * Decrypt a `.byoky` file and work out which of its credentials to add to a
 * wallet that already holds `existing`. Nothing in the wallet is replaced:
 * file credentials get fresh ids, and ones that duplicate a credential
 * already present (same provider, same secret, same baseUrl) are skipped.
 * See the module comment for which entries are skipped or rejected.
 *
 * A refresh token that won't decrypt is dropped and the credential kept:
 * older exports left it encrypted under the exporting wallet's master
 * password.
 */
export async function importVaultFile(
  fileContents: string,
  importPassword: string,
  existing: Credential[],
  masterPassword: string,
  cipher: VaultFileCrypto = defaultCrypto,
): Promise<VaultImportResult> {
  let json: string;
  try {
    json = await cipher.decrypt(fileContents.trim(), importPassword);
  } catch {
    return { ok: false, error: 'Wrong password or corrupted file' };
  }
  if (json.length > MAX_VAULT_FILE_JSON_LENGTH) {
    return { ok: false, error: 'Vault file too large' };
  }
  let payload: { version?: unknown; credentials?: unknown };
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid vault file format' };
  }
  if (!payload || typeof payload.version !== 'number' || payload.version < 1 || !Array.isArray(payload.credentials)) {
    return { ok: false, error: 'Invalid vault file format' };
  }
  if (payload.credentials.length > MAX_VAULT_FILE_CREDENTIALS) {
    return { ok: false, error: `Vault file has more than ${MAX_VAULT_FILE_CREDENTIALS} credentials` };
  }

  const now = Date.now();
  const fileCreds: VaultFileCredential[] = [];
  let rejected = 0;
  for (const raw of payload.credentials) {
    const parsed = parseFileCredential(raw, now);
    if (parsed === 'malformed') return { ok: false, error: 'Invalid vault file format' };
    if (parsed === 'rejected') {
      rejected++;
      continue;
    }
    fileCreds.push(parsed);
  }

  // Decrypt each file secret before touching anything, so a bad entry fails
  // the whole import.
  const fileSecrets: string[] = [];
  for (const cred of fileCreds) {
    const encrypted = cred.authMethod === 'api_key' ? cred.encryptedKey : cred.encryptedAccessToken;
    try {
      fileSecrets.push(await decryptSecret(encrypted, importPassword, cipher));
    } catch {
      return { ok: false, error: 'Could not decrypt a credential in the file' };
    }
  }

  const seen = new Set<string>();
  for (const cred of existing) {
    const encrypted = cred.authMethod === 'api_key' ? cred.encryptedKey : cred.encryptedAccessToken;
    try {
      const secret = await decryptSecret(encrypted, masterPassword, cipher);
      seen.add(duplicateKey(cred.providerId, secret, customBaseUrl(cred.providerId, cred.baseUrl)));
    } catch {
      // An unreadable stored credential can't be matched; it doesn't block the import.
    }
  }

  const added: Credential[] = [];
  let duplicates = 0;
  for (let i = 0; i < fileCreds.length; i++) {
    const cred = fileCreds[i];
    const secret = fileSecrets[i];
    const key = duplicateKey(cred.providerId, secret, cred.baseUrl);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);

    const base = {
      id: crypto.randomUUID(),
      providerId: cred.providerId,
      label: cred.label,
      createdAt: cred.createdAt,
      ...(cred.baseUrl ? { baseUrl: cred.baseUrl } : {}),
    };
    const encryptedSecret = secret ? await cipher.encrypt(secret, masterPassword) : '';
    if (cred.authMethod === 'api_key') {
      added.push({ ...base, authMethod: 'api_key', encryptedKey: encryptedSecret });
    } else {
      const encryptedRefreshToken = await reencryptOptional(cred.encryptedRefreshToken, importPassword, masterPassword, cipher);
      added.push({
        ...base,
        authMethod: 'oauth',
        encryptedAccessToken: encryptedSecret,
        ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
        ...(cred.expiresAt !== undefined ? { expiresAt: cred.expiresAt } : {}),
      });
    }
  }

  return { ok: true, added, skipped: duplicates + rejected, rejected };
}

/**
 * 'malformed' means the file is corrupt and the import should stop;
 * 'rejected' means this entry is refused but the rest can still go in.
 */
function parseFileCredential(raw: unknown, now: number): VaultFileCredential | 'malformed' | 'rejected' {
  if (!raw || typeof raw !== 'object') return 'malformed';
  const c = raw as Record<string, unknown>;
  if (typeof c.providerId !== 'string' || !c.providerId) return 'malformed';
  if (c.authMethod !== 'api_key' && c.authMethod !== 'oauth') return 'malformed';
  if (c.authMethod === 'oauth' && (typeof c.encryptedAccessToken !== 'string' || !c.encryptedAccessToken)) return 'malformed';
  if (c.authMethod === 'api_key' && c.encryptedKey !== undefined && typeof c.encryptedKey !== 'string') return 'malformed';

  const provider = PROVIDERS[c.providerId];
  if (!provider) return 'rejected';
  let baseUrl: string | undefined;
  if (provider.requiresCustomBaseUrl) {
    const resolved = typeof c.baseUrl === 'string' ? resolveProviderBaseUrl(c.providerId, c.baseUrl) : null;
    if (!resolved) return 'rejected';
    baseUrl = resolved;
  }

  const label = typeof c.label === 'string' ? c.label.trim().slice(0, MAX_LABEL_LENGTH) : '';
  const createdAt = typeof c.createdAt === 'number' && Number.isFinite(c.createdAt) && c.createdAt > 0
    ? Math.min(c.createdAt, now)
    : now;
  return {
    id: typeof c.id === 'string' ? c.id : '',
    providerId: c.providerId,
    label: label || provider.name,
    authMethod: c.authMethod,
    createdAt,
    baseUrl,
    expiresAt: c.authMethod === 'oauth' && typeof c.expiresAt === 'number' && Number.isFinite(c.expiresAt) ? c.expiresAt : undefined,
    encryptedKey: typeof c.encryptedKey === 'string' ? c.encryptedKey : undefined,
    encryptedAccessToken: typeof c.encryptedAccessToken === 'string' ? c.encryptedAccessToken : undefined,
    encryptedRefreshToken: typeof c.encryptedRefreshToken === 'string' ? c.encryptedRefreshToken : undefined,
  };
}

/** A credential's baseUrl only means something for providers without a fixed host. */
function customBaseUrl(providerId: string, baseUrl: string | undefined): string | undefined {
  return baseUrl && PROVIDERS[providerId]?.requiresCustomBaseUrl ? baseUrl : undefined;
}

function duplicateKey(providerId: string, secret: string, baseUrl: string | undefined): string {
  return JSON.stringify([providerId, secret, baseUrl ?? '']);
}

/** Keyless local-provider credentials store '' rather than ciphertext. */
async function decryptSecret(encrypted: string | undefined, password: string, cipher: VaultFileCrypto): Promise<string> {
  if (!encrypted) return '';
  return cipher.decrypt(encrypted, password);
}

async function reencrypt(encrypted: string | undefined, from: string, to: string, cipher: VaultFileCrypto): Promise<string> {
  const plain = await decryptSecret(encrypted, from, cipher);
  return plain ? cipher.encrypt(plain, to) : '';
}

/**
 * For refresh tokens: one that won't decrypt is already useless (see
 * importVaultFile), so it is dropped rather than failing the export.
 */
async function reencryptOptional(encrypted: string | undefined, from: string, to: string, cipher: VaultFileCrypto): Promise<string | undefined> {
  if (!encrypted) return undefined;
  let plain: string;
  try {
    plain = await cipher.decrypt(encrypted, from);
  } catch {
    return undefined;
  }
  return cipher.encrypt(plain, to);
}
