import { Hono } from 'hono';
import { getProvider } from '@byoky/core';
import { getCredentialsByUser } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';

const connect = new Hono();

connect.use('/*', authMiddleware);

connect.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = getCredentialsByUser(userId);

  const providers: Record<string, { available: boolean; authMethod: string }> = {};
  for (const row of rows) {
    const provider = getProvider(row.provider_id);
    if (!provider) continue;
    if (!providers[row.provider_id]) {
      providers[row.provider_id] = {
        available: true,
        authMethod: row.auth_method,
      };
    }
  }

  return c.json({ providers });
});

export { connect };
