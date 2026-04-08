import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, lt, lte, desc, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { users, credentials, sessions, requestLog, gifts } from './schema.js';

export type Db = ReturnType<typeof drizzle>;

let db: Db;

export function initDb(connectionString: string): Db {
  const client = postgres(connectionString);
  db = drizzle(client);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// --- Users ---

export async function createUser(username: string, passwordHash: string, encryptionSalt: string) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const [row] = await getDb().insert(users).values({
    id, username, passwordHash, encryptionSalt, createdAt: now,
  }).returning();
  return row;
}

export async function getUserByUsername(username: string) {
  const [row] = await getDb().select().from(users).where(eq(users.username, username)).limit(1);
  return row;
}

export async function getUserById(id: string) {
  const [row] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

// --- Sessions ---

export async function createSession(userId: string, tokenHash: string, expiresAt: number, id?: string) {
  id = id ?? crypto.randomUUID();
  const now = Date.now();
  const [row] = await getDb().insert(sessions).values({
    id, userId, tokenHash, createdAt: now, expiresAt, lastActivityAt: now,
  }).returning();
  return row;
}

export async function getSessionByTokenHash(tokenHash: string) {
  const [row] = await getDb().select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  return row;
}

export async function updateSessionActivity(sessionId: string) {
  await getDb().update(sessions).set({ lastActivityAt: Date.now() }).where(eq(sessions.id, sessionId));
}

export async function deleteSession(sessionId: string) {
  await getDb().delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteExpiredSessions() {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, Date.now()));
}

// --- Credentials ---

export async function createCredential(
  userId: string,
  providerId: string,
  label: string,
  authMethod: string,
  encryptedKey: string,
) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const [row] = await getDb().insert(credentials).values({
    id, userId, providerId, label, authMethod, encryptedKey, createdAt: now,
  }).returning();
  return row;
}

export async function getCredentialsByUser(userId: string) {
  return getDb().select().from(credentials).where(eq(credentials.userId, userId));
}

export async function getCredentialByUserAndProvider(userId: string, providerId: string) {
  const [row] = await getDb().select().from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.providerId, providerId)))
    .orderBy(desc(credentials.lastUsedAt))
    .limit(1);
  return row;
}

export async function getCredentialById(userId: string, credentialId: string) {
  const [row] = await getDb().select().from(credentials)
    .where(and(eq(credentials.id, credentialId), eq(credentials.userId, userId)))
    .limit(1);
  return row;
}

export async function deleteCredential(userId: string, credentialId: string) {
  const result = await getDb().delete(credentials)
    .where(and(eq(credentials.id, credentialId), eq(credentials.userId, userId)));
  return result.length > 0;
}

export async function updateCredentialLastUsed(credentialId: string) {
  await getDb().update(credentials).set({ lastUsedAt: Date.now() }).where(eq(credentials.id, credentialId));
}

// --- Request log ---

export async function logRequest(
  userId: string,
  sessionId: string,
  providerId: string,
  url: string,
  method: string,
  status: number,
  inputTokens?: number,
  outputTokens?: number,
  model?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(requestLog).values({
    id, userId, sessionId, providerId, url, method, status,
    timestamp: Date.now(),
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
    model: model ?? null,
  });
  return id;
}

// --- Gifts ---

export async function createGift(
  id: string,
  userId: string,
  providerId: string,
  authMethod: string,
  encryptedApiKey: string,
  encryptedRelayToken: string,
  relayUrl: string,
  maxTokens: number,
  usedTokens: number,
  expiresAt: number,
) {
  const [row] = await getDb().insert(gifts).values({
    id, userId, providerId, authMethod, encryptedApiKey, encryptedRelayToken,
    relayUrl, maxTokens, usedTokens, expiresAt, createdAt: Date.now(), active: true,
  }).returning();
  return row;
}

export async function getGiftsByUser(userId: string) {
  return getDb().select().from(gifts).where(eq(gifts.userId, userId));
}

export async function getGiftById(userId: string, giftId: string) {
  const [row] = await getDb().select().from(gifts)
    .where(and(eq(gifts.id, giftId), eq(gifts.userId, userId)))
    .limit(1);
  return row;
}

export async function deleteGift(userId: string, giftId: string) {
  await getDb().delete(gifts)
    .where(and(eq(gifts.id, giftId), eq(gifts.userId, userId)));
}

/**
 * Atomically increment usedTokens by delta.
 * Only applies if the new total would not exceed maxTokens.
 * Returns the updated row, or undefined if the update was rejected (over budget).
 */
export async function incrementGiftUsage(giftId: string, delta: number) {
  const [row] = await getDb().update(gifts)
    .set({ usedTokens: sql`${gifts.usedTokens} + ${delta}` })
    .where(and(
      eq(gifts.id, giftId),
      lte(sql`${gifts.usedTokens} + ${delta}`, gifts.maxTokens),
    ))
    .returning({ usedTokens: gifts.usedTokens });
  return row;
}

/** Force-set usedTokens (for recording usage even when over budget). */
export async function forceUpdateGiftUsage(giftId: string, delta: number) {
  await getDb().update(gifts)
    .set({ usedTokens: sql`${gifts.usedTokens} + ${delta}` })
    .where(eq(gifts.id, giftId));
}

export async function getActiveGifts() {
  return getDb().select().from(gifts)
    .where(eq(gifts.active, true));
}

export async function countActiveGiftsByUser(userId: string): Promise<number> {
  const [row] = await getDb().select({ count: sql<number>`count(*)::int` })
    .from(gifts)
    .where(and(eq(gifts.userId, userId), eq(gifts.active, true)));
  return row?.count ?? 0;
}

export async function deleteExpiredGifts() {
  await getDb().delete(gifts).where(lt(gifts.expiresAt, Date.now()));
}
