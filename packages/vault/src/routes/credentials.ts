import { Hono } from 'hono';
import { maskKey, getProvider } from '@byoky/core';
import {
  getCredentialsByUser,
  createCredential,
  getCredentialById,
  deleteCredential,
} from '../db/index.js';
import { getCachedKey } from '../session-keys.js';
import { encryptWithKey, decryptWithKey } from '../crypto.js';
import { authMiddleware } from '../middleware/auth.js';

const credentials = new Hono();

credentials.use('/*', authMiddleware);

credentials.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = getCredentialsByUser(userId);
  const cryptoKey = getCachedKey(userId);

  const result = await Promise.all(rows.map(async (row) => {
    let maskedKey: string | undefined;
    if (cryptoKey) {
      try {
        const plainKey = await decryptWithKey(row.encrypted_key, cryptoKey);
        maskedKey = maskKey(plainKey);
      } catch {
        maskedKey = '****';
      }
    }

    return {
      id: row.id,
      providerId: row.provider_id,
      label: row.label,
      authMethod: row.auth_method,
      maskedKey,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    };
  }));

  return c.json({ credentials: result });
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

  const cryptoKey = getCachedKey(userId);
  if (!cryptoKey) {
    return c.json({ error: { code: 'SESSION_KEY_EXPIRED', message: 'Encryption key expired. Please log in again.' } }, 401);
  }

  const encryptedKey = await encryptWithKey(apiKey, cryptoKey);
  const credLabel = label ?? `${provider.name} key`;

  const row = createCredential(userId, providerId, credLabel, method, encryptedKey);

  return c.json({
    credential: {
      id: row.id,
      providerId: row.provider_id,
      label: row.label,
      authMethod: row.auth_method,
      maskedKey: maskKey(apiKey),
      createdAt: row.created_at,
    },
  }, 201);
});

credentials.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const credentialId = c.req.param('id');

  const credential = getCredentialById(userId, credentialId);
  if (!credential) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Credential not found' } }, 404);
  }

  deleteCredential(userId, credentialId);
  return c.json({ ok: true });
});

export { credentials };
