import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'marketplace.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS gifts (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        gifter_name TEXT NOT NULL DEFAULT 'Anonymous',
        gift_link TEXT NOT NULL,
        relay_url TEXT NOT NULL,
        token_budget INTEGER NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        listed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        last_seen_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        unlisted INTEGER NOT NULL DEFAULT 0
      )
    `);
  }
  return db;
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

export function listGifts(): PublicGift[] {
  const rows = getDb().prepare(`
    SELECT id, provider_id, gifter_name, gift_link, relay_url,
           token_budget, tokens_used, expires_at, listed_at, last_seen_at
    FROM gifts
    WHERE unlisted = 0
    ORDER BY listed_at DESC
  `).all() as Array<Record<string, unknown>>;

  return rows.map(toPublicGift);
}

export function addGift(gift: {
  id: string;
  providerId: string;
  gifterName: string;
  giftLink: string;
  relayUrl: string;
  tokenBudget: number;
  expiresAt: number;
}): void {
  getDb().prepare(`
    INSERT INTO gifts (id, provider_id, gifter_name, gift_link, relay_url, token_budget, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(gift.id, gift.providerId, gift.gifterName, gift.giftLink, gift.relayUrl, gift.tokenBudget, gift.expiresAt);
}

export function removeGift(id: string): boolean {
  const result = getDb().prepare('UPDATE gifts SET unlisted = 1 WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateGiftUsage(id: string, tokensUsed: number): boolean {
  const result = getDb().prepare('UPDATE gifts SET tokens_used = ? WHERE id = ?').run(tokensUsed, id);
  return result.changes > 0;
}

export function heartbeat(id: string): boolean {
  const result = getDb().prepare('UPDATE gifts SET last_seen_at = ? WHERE id = ?').run(Date.now(), id);
  return result.changes > 0;
}

function toPublicGift(row: Record<string, unknown>): PublicGift {
  return {
    id: row.id as string,
    providerId: row.provider_id as string,
    gifterName: row.gifter_name as string,
    giftLink: row.gift_link as string,
    relayUrl: row.relay_url as string,
    tokenBudget: row.token_budget as number,
    tokensUsed: row.tokens_used as number,
    expiresAt: row.expires_at as number,
    listedAt: row.listed_at as number,
    lastSeenAt: row.last_seen_at as number,
  };
}
