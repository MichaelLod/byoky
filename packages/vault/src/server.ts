import { serve } from '@hono/node-server';
import { app } from './app.js';
import { initDb } from './db/index.js';
import { startIdleSweep } from './session-keys.js';
import { startRateLimitCleanup } from './middleware/rate-limit.js';
import { deleteExpiredSessions } from './db/index.js';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const DB_PATH = process.env.DB_PATH ?? 'vault.db';

initDb(DB_PATH);
startIdleSweep();
startRateLimitCleanup();

// Clean up expired sessions periodically
const sessionCleanupInterval = setInterval(() => {
  deleteExpiredSessions();
}, 60 * 60 * 1000); // every hour
sessionCleanupInterval.unref();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Byoky Vault running on http://localhost:${info.port}`);
});
