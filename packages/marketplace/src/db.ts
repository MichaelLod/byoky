import postgres from 'postgres';

let sql: postgres.Sql;

export function initDb(databaseUrl: string) {
  sql = postgres(databaseUrl);
}

export function getDb() {
  return sql;
}

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS marketplace_gifts (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      gifter_name TEXT NOT NULL DEFAULT 'Anonymous',
      gift_link TEXT NOT NULL,
      relay_url TEXT NOT NULL,
      token_budget INTEGER NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      expires_at BIGINT NOT NULL,
      listed_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      last_seen_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      unlisted BOOLEAN NOT NULL DEFAULT FALSE
    )
  `;
}

export interface PublicGift {
  id: string;
  providerId: string;
  gifterName: string;
  giftLink: string;
  relayUrl: string;
  tokenBudget: number;
  tokensUsed: number;
  expiresAt: number;
  listedAt: number;
  lastSeenAt: number;
}

export async function listGifts(): Promise<PublicGift[]> {
  const rows = await sql`
    SELECT id, provider_id, gifter_name, gift_link, relay_url,
           token_budget, tokens_used, expires_at, listed_at, last_seen_at
    FROM marketplace_gifts
    WHERE unlisted = FALSE
    ORDER BY listed_at DESC
  `;
  return rows.map(toPublicGift);
}

export async function addGift(gift: {
  id: string;
  providerId: string;
  gifterName: string;
  giftLink: string;
  relayUrl: string;
  tokenBudget: number;
  expiresAt: number;
}): Promise<void> {
  await sql`
    INSERT INTO marketplace_gifts (id, provider_id, gifter_name, gift_link, relay_url, token_budget, expires_at)
    VALUES (${gift.id}, ${gift.providerId}, ${gift.gifterName}, ${gift.giftLink}, ${gift.relayUrl}, ${gift.tokenBudget}, ${gift.expiresAt})
  `;
}

export async function removeGift(id: string): Promise<boolean> {
  const result = await sql`UPDATE marketplace_gifts SET unlisted = TRUE WHERE id = ${id}`;
  return result.count > 0;
}

export async function updateGiftUsage(id: string, tokensUsed: number): Promise<boolean> {
  const result = await sql`UPDATE marketplace_gifts SET tokens_used = ${tokensUsed} WHERE id = ${id}`;
  return result.count > 0;
}

export async function heartbeat(id: string): Promise<boolean> {
  const now = Date.now();
  const result = await sql`UPDATE marketplace_gifts SET last_seen_at = ${now} WHERE id = ${id}`;
  return result.count > 0;
}

function toPublicGift(row: Record<string, unknown>): PublicGift {
  return {
    id: row.id as string,
    providerId: row.provider_id as string,
    gifterName: row.gifter_name as string,
    giftLink: row.gift_link as string,
    relayUrl: row.relay_url as string,
    tokenBudget: Number(row.token_budget),
    tokensUsed: Number(row.tokens_used),
    expiresAt: Number(row.expires_at),
    listedAt: Number(row.listed_at),
    lastSeenAt: Number(row.last_seen_at),
  };
}
