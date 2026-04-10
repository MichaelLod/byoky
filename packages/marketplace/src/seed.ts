import { initDb, migrate, getDb, hashToken } from './db.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required');
  process.exit(1);
}

initDb(DATABASE_URL);
await migrate();

const sql = getDb();
const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const seeds = [
  // Active gifts
  { id: 'gift-demo-anthropic', provider_id: 'anthropic', gifter_name: 'Claude Fan', gift_link: 'https://byoky.com/gift#demo-anthropic', relay_url: 'wss://relay.byoky.com', token_budget: 500_000, tokens_used: 123_400, expires_at: now + 5 * DAY, listed_at: now - 2 * DAY, last_seen_at: now - 30_000 },
  { id: 'gift-demo-openai', provider_id: 'openai', gifter_name: 'GPT Giver', gift_link: 'https://byoky.com/gift#demo-openai', relay_url: 'wss://relay.byoky.com', token_budget: 1_000_000, tokens_used: 45_200, expires_at: now + 12 * DAY, listed_at: now - 5 * DAY, last_seen_at: now - 2 * 60_000 },
  { id: 'gift-demo-gemini', provider_id: 'gemini', gifter_name: 'Anonymous', gift_link: 'https://byoky.com/gift#demo-gemini', relay_url: 'wss://relay.byoky.com', token_budget: 100_000, tokens_used: 8_700, expires_at: now + 1 * DAY, listed_at: now - 8 * HOUR, last_seen_at: now - 10 * 60_000 },
  { id: 'gift-demo-mistral', provider_id: 'mistral', gifter_name: 'Le Chatelier', gift_link: 'https://byoky.com/gift#demo-mistral', relay_url: 'wss://relay.byoky.com', token_budget: 250_000, tokens_used: 0, expires_at: now + 3 * DAY, listed_at: now - 1 * HOUR, last_seen_at: now - 15_000 },
  // Expired gifts
  { id: 'gift-expired-1', provider_id: 'anthropic', gifter_name: 'Early Adopter', gift_link: 'https://byoky.com/gift#expired1', relay_url: 'wss://relay.byoky.com', token_budget: 200_000, tokens_used: 200_000, expires_at: now - 2 * DAY, listed_at: now - 10 * DAY, last_seen_at: now - 3 * DAY },
  { id: 'gift-expired-2', provider_id: 'openai', gifter_name: 'Token Santa', gift_link: 'https://byoky.com/gift#expired2', relay_url: 'wss://relay.byoky.com', token_budget: 500_000, tokens_used: 487_300, expires_at: now - 12 * HOUR, listed_at: now - 7 * DAY, last_seen_at: now - 1 * DAY },
  { id: 'gift-expired-3', provider_id: 'gemini', gifter_name: 'Anonymous', gift_link: 'https://byoky.com/gift#expired3', relay_url: 'wss://relay.byoky.com', token_budget: 50_000, tokens_used: 50_000, expires_at: now - 5 * DAY, listed_at: now - 14 * DAY, last_seen_at: now - 6 * DAY },
  { id: 'gift-expired-4', provider_id: 'cohere', gifter_name: 'Coral Builder', gift_link: 'https://byoky.com/gift#expired4', relay_url: 'wss://relay.byoky.com', token_budget: 300_000, tokens_used: 156_800, expires_at: now - 1 * DAY, listed_at: now - 8 * DAY, last_seen_at: now - 2 * DAY },
  { id: 'gift-expired-5', provider_id: 'deepseek', gifter_name: 'Deep Thinker', gift_link: 'https://byoky.com/gift#expired5', relay_url: 'wss://relay.byoky.com', token_budget: 1_000_000, tokens_used: 999_100, expires_at: now - 3 * HOUR, listed_at: now - 4 * DAY, last_seen_at: now - 4 * HOUR },
  { id: 'gift-expired-6', provider_id: 'xai', gifter_name: 'Grok Guru', gift_link: 'https://byoky.com/gift#expired6', relay_url: 'wss://relay.byoky.com', token_budget: 100_000, tokens_used: 72_400, expires_at: now - 6 * DAY, listed_at: now - 20 * DAY, last_seen_at: now - 7 * DAY },
];

const seedMgmtHash = hashToken('seed-management-token');

for (const g of seeds) {
  await sql`
    INSERT INTO marketplace_gifts (id, provider_id, gifter_name, gift_link, relay_url, token_budget, tokens_used, expires_at, listed_at, last_seen_at, mgmt_token_hash)
    VALUES (${g.id}, ${g.provider_id}, ${g.gifter_name}, ${g.gift_link}, ${g.relay_url}, ${g.token_budget}, ${g.tokens_used}, ${g.expires_at}, ${g.listed_at}, ${g.last_seen_at}, ${seedMgmtHash})
    ON CONFLICT (id) DO UPDATE SET
      tokens_used = ${g.tokens_used},
      expires_at = ${g.expires_at},
      last_seen_at = ${g.last_seen_at}
  `;
}

console.log(`Seeded ${seeds.length} gifts`);
await sql.end();
