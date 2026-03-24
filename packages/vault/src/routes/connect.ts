import { Hono } from 'hono';
import { getProvider } from '@byoky/core';
import { getCredentialsByUser } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';

const connect = new Hono();

connect.use('/*', authMiddleware);

connect.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await getCredentialsByUser(userId);

  const providers: Record<string, { available: boolean; authMethod: string }> = {};
  for (const row of rows) {
    const provider = getProvider(row.providerId);
    if (!provider) continue;
    if (!providers[row.providerId]) {
      providers[row.providerId] = {
        available: true,
        authMethod: row.authMethod,
      };
    }
  }

  return c.json({ providers });
});

export { connect };
