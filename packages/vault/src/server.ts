import { serve } from '@hono/node-server';
import { app } from './app.js';
import { initDb, backfillCredentialUpdatedAt } from './db/index.js';
import { startIdleSweep } from './session-keys.js';
import { startRateLimitCleanup } from './middleware/rate-limit.js';
import { deleteExpiredUserSessions, deleteExpiredAppSessions } from './db/index.js';
import { startGiftRelay } from './gift-relay.js';
import { initUpstreamProxy } from './upstream-proxy.js';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required');
  process.exit(1);
}

initDb(DATABASE_URL);
initUpstreamProxy();
startIdleSweep();
startRateLimitCleanup();

await backfillCredentialUpdatedAt().catch((err) => {
  console.error('credentials.updated_at backfill failed:', err);
});

// Clean up expired sessions periodically (both user and app sessions).
const sessionCleanupInterval = setInterval(() => {
  deleteExpiredUserSessions();
  deleteExpiredAppSessions();
}, 60 * 60 * 1000); // every hour
sessionCleanupInterval.unref();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Byoky Vault running on http://localhost:${info.port}`);
  startGiftRelay();
});
