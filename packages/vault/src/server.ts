import { serve } from '@hono/node-server';
import { app } from './app.js';
import { initDb } from './db/index.js';
import { startIdleSweep } from './session-keys.js';
import { startRateLimitCleanup } from './middleware/rate-limit.js';
import { deleteExpiredSessions } from './db/index.js';
import { startGiftRelay } from './gift-relay.js';
import { seedPricing } from './billing/seed-pricing.js';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required');
  process.exit(1);
}

initDb(DATABASE_URL);
startIdleSweep();
startRateLimitCleanup();

// Clean up expired sessions periodically
const sessionCleanupInterval = setInterval(() => {
  deleteExpiredSessions();
}, 60 * 60 * 1000); // every hour
sessionCleanupInterval.unref();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Byoky Vault running on http://localhost:${info.port}`);
  startGiftRelay();
  // Seed default pricing on startup (no-op if already seeded)
  seedPricing().then((n) => {
    if (n > 0) console.log(`Seeded ${n} pricing rows`);
  }).catch((err) => {
    console.error('Failed to seed pricing:', err);
  });
});
