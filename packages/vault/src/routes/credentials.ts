import { Hono } from 'hono';
import { maskKey, getProvider } from '@byoky/core';
import {
  getCredentialsByUser,
  getCredentialsForSync,
  createCredential,
  getCredentialById,
  deleteCredential,
  updateCredentialLabel,
  updateCredentialKey,
} from '../db/index.js';
import { getCachedKey, recoverCachedKey } from '../session-keys.js';
import { encryptWithKey, decryptWithKey } from '../crypto.js';
import { authMiddleware } from '../middleware/auth.js';

const credentials = new Hono();

credentials.use('/*', authMiddleware);

credentials.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await getCredentialsByUser(userId);
  const cryptoKey = getCachedKey(userId) ?? await recoverCachedKey(userId);

  const result = await Promise.all(rows.map(async (row) => {
    let maskedKey: string | undefined;
    if (cryptoKey) {
      try {
        const plainKey = await decryptWithKey(row.encryptedKey, cryptoKey);
        maskedKey = maskKey(plainKey);
      } catch {
        maskedKey = '****';
      }
    }

    return {
      id: row.id,
      providerId: row.providerId,
      label: row.label,
      authMethod: row.authMethod,
      maskedKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt,
    };
  }));

  return c.json({ credentials: result });
});

// Sync endpoint — returns plaintext keys + tombstones so clients can mirror
// server state into their local (master-password-encrypted) store. `since`
// (ms epoch) filters to rows whose updatedAt is >= the value; omit to get a
// full snapshot. Includes soft-deleted rows so other devices learn about
// deletions.
//
// The server stores credentials encrypted with a session-cached key derived
// from the user's vault password. Clients re-encrypt with their local
// master password after receiving, so apiKey is returned in plaintext here
// (over TLS) rather than as server ciphertext the client can't decrypt.
credentials.get('/sync', async (c) => {
  const userId = c.get('userId');
  const sinceParam = c.req.query('since');
  const since = sinceParam ? parseInt(sinceParam, 10) : 0;
  if (Number.isNaN(since) || since < 0) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'since must be a non-negative integer' } }, 400);
  }

  const cryptoKey = getCachedKey(userId) ?? await recoverCachedKey(userId);
  if (!cryptoKey) {
    return c.json({ error: { code: 'SESSION_KEY_EXPIRED', message: 'Encryption key expired. Please log in again.' } }, 401);
  }

  const rows = await getCredentialsForSync(userId, since);
  const serverTime = Date.now();

  const result = await Promise.all(rows.map(async (row) => {
    // Tombstones don't need plaintext — the client only uses id + deletedAt.
    if (row.deletedAt) {
      return {
        id: row.id,
        providerId: row.providerId,
        label: row.label,
        authMethod: row.authMethod,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      };
    }
    let apiKey: string | undefined;
    try {
      apiKey = await decryptWithKey(row.encryptedKey, cryptoKey);
    } catch {
      // Corrupt row — surface id so the client can skip it without
      // poisoning its local state.
      apiKey = undefined;
    }
    return {
      id: row.id,
      providerId: row.providerId,
      label: row.label,
      authMethod: row.authMethod,
      apiKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: null,
    };
  }));

  return c.json({ serverTime, credentials: result });
});

credentials.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    providerId?: string;
    label?: string;
    authMethod?: string;
    apiKey?: string;
  }>();

  const { providerId, label, authMethod, apiKey } = body;

  if (!providerId || !apiKey) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'providerId and apiKey are required' } }, 400);
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: { code: 'INVALID_PROVIDER', message: `Unknown provider: ${providerId}` } }, 400);
  }

  const method = authMethod ?? 'api_key';
  if (!provider.authMethods.includes(method as 'api_key' | 'oauth')) {
    return c.json({ error: { code: 'INVALID_AUTH_METHOD', message: `Provider ${providerId} does not support auth method: ${method}` } }, 400);
  }

  const cryptoKey = getCachedKey(userId) ?? await recoverCachedKey(userId);
  if (!cryptoKey) {
    return c.json({ error: { code: 'SESSION_KEY_EXPIRED', message: 'Encryption key expired. Please log in again.' } }, 401);
  }

  const encryptedKey = await encryptWithKey(apiKey, cryptoKey);
  const credLabel = label ?? `${provider.name} key`;

  const row = await createCredential(userId, providerId, credLabel, method, encryptedKey);

  return c.json({
    credential: {
      id: row.id,
      providerId: row.providerId,
      label: row.label,
      authMethod: row.authMethod,
      maskedKey: maskKey(apiKey),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  }, 201);
});

credentials.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const credentialId = c.req.param('id');
  const body = await c.req.json<{ label?: string; apiKey?: string }>();
  const label = body.label?.trim();
  const apiKey = body.apiKey;

  if (!label && !apiKey) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'label or apiKey is required' } }, 400);
  }

  const credential = await getCredentialById(userId, credentialId);
  if (!credential) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Credential not found' } }, 404);
  }

  if (label) {
    await updateCredentialLabel(userId, credentialId, label);
  }
  if (apiKey) {
    const cryptoKey = getCachedKey(userId) ?? await recoverCachedKey(userId);
    if (!cryptoKey) {
      return c.json({ error: { code: 'SESSION_KEY_EXPIRED', message: 'Encryption key expired. Please log in again.' } }, 401);
    }
    const encryptedKey = await encryptWithKey(apiKey, cryptoKey);
    await updateCredentialKey(userId, credentialId, encryptedKey);
  }

  // Re-read to return the fresh updatedAt so clients can track LWW meta
  // without a separate sync round-trip.
  const updated = await getCredentialById(userId, credentialId);
  return c.json({ ok: true, updatedAt: updated?.updatedAt ?? Date.now() });
});

credentials.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const credentialId = c.req.param('id');

  const credential = await getCredentialById(userId, credentialId);
  if (!credential) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Credential not found' } }, 404);
  }

  await deleteCredential(userId, credentialId);
  // updatedAt is set to deletedAt by deleteCredential; return it so callers
  // can stamp their local tombstone meta with the same value.
  return c.json({ ok: true, deletedAt: Date.now() });
});

export { credentials };
