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
import { decryptWithKey } from '../crypto.js';
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

// Sync endpoint — returns the stored ciphertext so clients can re-encrypt
// with their local master password for offline use. `since` (ms epoch)
// filters to rows whose updatedAt is >= the value; omit to get a full
// snapshot. Includes soft-deleted rows so other devices learn about
// deletions.
//
// Both client and server derive the same AES-GCM key from
// (vault password, encryptionSalt), so the server-stored ciphertext is
// directly decryptable by the client without re-encryption over the wire.
credentials.get('/sync', async (c) => {
  const userId = c.get('userId');
  const sinceParam = c.req.query('since');
  const since = sinceParam ? parseInt(sinceParam, 10) : 0;
  if (Number.isNaN(since) || since < 0) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'since must be a non-negative integer' } }, 400);
  }

  const rows = await getCredentialsForSync(userId, since);
  const serverTime = Date.now();

  const result = rows.map((row) => {
    // Tombstones don't need the key — the client only uses id + deletedAt.
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
    return {
      id: row.id,
      providerId: row.providerId,
      label: row.label,
      authMethod: row.authMethod,
      encryptedApiKey: row.encryptedKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: null,
    };
  });

  return c.json({ serverTime, credentials: result });
});

credentials.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    providerId?: string;
    label?: string;
    authMethod?: string;
    encryptedApiKey?: string;
  }>();

  const { providerId, label, authMethod, encryptedApiKey } = body;

  if (!providerId || !encryptedApiKey) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'providerId and encryptedApiKey are required' } }, 400);
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ error: { code: 'INVALID_PROVIDER', message: `Unknown provider: ${providerId}` } }, 400);
  }

  const method = authMethod ?? 'api_key';
  if (!provider.authMethods.includes(method as 'api_key' | 'oauth')) {
    return c.json({ error: { code: 'INVALID_AUTH_METHOD', message: `Provider ${providerId} does not support auth method: ${method}` } }, 400);
  }

  const credLabel = label ?? `${provider.name} key`;
  const row = await createCredential(userId, providerId, credLabel, method, encryptedApiKey);

  return c.json({
    credential: {
      id: row.id,
      providerId: row.providerId,
      label: row.label,
      authMethod: row.authMethod,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  }, 201);
});

credentials.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const credentialId = c.req.param('id');
  const body = await c.req.json<{ label?: string; encryptedApiKey?: string }>();
  const label = body.label?.trim();
  const encryptedApiKey = body.encryptedApiKey;

  if (!label && !encryptedApiKey) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'label or encryptedApiKey is required' } }, 400);
  }

  const credential = await getCredentialById(userId, credentialId);
  if (!credential) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Credential not found' } }, 404);
  }

  if (label) {
    await updateCredentialLabel(userId, credentialId, label);
  }
  if (encryptedApiKey) {
    await updateCredentialKey(userId, credentialId, encryptedApiKey);
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
