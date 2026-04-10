import { serve } from '@hono/node-server';
import { app } from './app.js';
import { initDb, migrate } from './db.js';

const PORT = parseInt(process.env.PORT ?? '3200', 10);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required');
  process.exit(1);
}

initDb(DATABASE_URL);

migrate().then(() => {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Byoky Marketplace running on http://localhost:${info.port}`);
  });
});
