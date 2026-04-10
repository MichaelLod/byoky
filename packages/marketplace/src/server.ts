import { serve } from '@hono/node-server';
import { app } from './app.js';

const PORT = parseInt(process.env.PORT ?? '3200', 10);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Byoky Marketplace running on http://localhost:${info.port}`);
});
