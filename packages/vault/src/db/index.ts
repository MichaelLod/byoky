import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, lt, gt, gte, lte, desc, sql, isNull } from 'drizzle-orm';
import crypto from 'node:crypto';
import {
  users,
  credentials,
  userSessions,
  appSessions,
  groups,
  appGroups,
  requestLog,
  gifts,
} from './schema.js';
import { DEFAULT_GROUP_ID } from '@byoky/core';

export type Db = ReturnType<typeof drizzle>;

let db: Db;

export function initDb(connectionString: string): Db {
  const client = postgres(connectionString);
  db = drizzle(client);
  return db;
}

// Idempotent boot-time fix for credentials rows that existed before the
// updated_at column was added. New rows always set updated_at explicitly, so
// after the one-time fill this becomes a zero-row no-op.
export async function backfillCredentialUpdatedAt(): Promise<void> {
  await getDb().execute(sql`
    UPDATE credentials SET updated_at = created_at WHERE updated_at = 0
  `);
}

export function getDb(): Db {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// ─── Users ────────────────────────────────────────────────────────────────

export async function createUser(username: string, passwordHash: string, encryptionSalt: string) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const [row] = await getDb().insert(users).values({
    id, username, passwordHash, encryptionSalt, createdAt: now,
  }).returning();

  // Every new user gets an empty default group. The default group binds
  // nothing — it exists so that the resolver can fall through to direct
  // credential lookup until the user creates a real binding.
  await getDb().insert(groups).values({
    userId: id,
    id: DEFAULT_GROUP_ID,
    name: 'Default',
    providerId: '',
    credentialId: null,
    model: null,
    createdAt: now,
  });

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

export async function deleteUser(id: string) {
  await getDb().delete(users).where(eq(users.id, id));
}

// ─── User sessions ────────────────────────────────────────────────────────

export async function createUserSession(userId: string, tokenHash: string, expiresAt: number, id?: string, encryptedKey?: string) {
  id = id ?? crypto.randomUUID();
  const now = Date.now();
  const [row] = await getDb().insert(userSessions).values({
    id, userId, tokenHash, encryptedKey: encryptedKey ?? null, createdAt: now, expiresAt, lastActivityAt: now,
  }).returning();
  return row;
}

export async function getUserSessionByTokenHash(tokenHash: string) {
  const [row] = await getDb().select().from(userSessions).where(eq(userSessions.tokenHash, tokenHash)).limit(1);
  return row;
}

export async function updateUserSessionActivity(sessionId: string) {
  await getDb().update(userSessions).set({ lastActivityAt: Date.now() }).where(eq(userSessions.id, sessionId));
}

export async function deleteUserSession(sessionId: string) {
  await getDb().delete(userSessions).where(eq(userSessions.id, sessionId));
}

export async function getEncryptedKeyForUser(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ encryptedKey: userSessions.encryptedKey })
    .from(userSessions)
    .where(and(
      eq(userSessions.userId, userId),
      sql`${userSessions.encryptedKey} IS NOT NULL`,
      gt(userSessions.expiresAt, Date.now()),
    ))
    .limit(1);
  return row?.encryptedKey ?? null;
}

export async function deleteExpiredUserSessions() {
  await getDb().delete(userSessions).where(lt(userSessions.expiresAt, Date.now()));
}

// ─── App sessions ─────────────────────────────────────────────────────────

export async function createAppSession(
  userId: string,
  userSessionId: string,
  origin: string,
  tokenHash: string,
  expiresAt: number,
  id?: string,
) {
  // Caller may supply the id when it needs the row id to match a value
  // already embedded in a JWT (the appAuthMiddleware checks payload.sid
  // against this id for defense in depth).
  id = id ?? crypto.randomUUID();
  const now = Date.now();
  const [row] = await getDb().insert(appSessions).values({
    id,
    userId,
    userSessionId,
    origin,
    tokenHash,
    createdAt: now,
    expiresAt,
    lastActivityAt: now,
  }).returning();
  return row;
}

export async function getAppSessionByTokenHash(tokenHash: string) {
  const [row] = await getDb().select().from(appSessions).where(eq(appSessions.tokenHash, tokenHash)).limit(1);
  return row;
}

export async function updateAppSessionActivity(sessionId: string) {
  await getDb().update(appSessions).set({ lastActivityAt: Date.now() }).where(eq(appSessions.id, sessionId));
}

export async function deleteAppSession(sessionId: string) {
  await getDb().delete(appSessions).where(eq(appSessions.id, sessionId));
}

export async function deleteExpiredAppSessions() {
  await getDb().delete(appSessions).where(lt(appSessions.expiresAt, Date.now()));
}

// ─── Credentials ──────────────────────────────────────────────────────────

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
    id, userId, providerId, label, authMethod, encryptedKey,
    createdAt: now, updatedAt: now,
  }).returning();
  return row;
}

// Human-facing list: excludes soft-deleted rows.
export async function getCredentialsByUser(userId: string) {
  return getDb().select().from(credentials)
    .where(and(eq(credentials.userId, userId), isNull(credentials.deletedAt)));
}

// Sync-facing list: includes tombstones (rows with deletedAt set). Clients
// use this to mirror deletions across devices. `since` filters by updatedAt
// for incremental pulls.
export async function getCredentialsForSync(userId: string, since: number = 0) {
  return getDb().select().from(credentials)
    .where(and(eq(credentials.userId, userId), gte(credentials.updatedAt, since)));
}

export async function getCredentialByUserAndProvider(userId: string, providerId: string) {
  const [row] = await getDb().select().from(credentials)
    .where(and(
      eq(credentials.userId, userId),
      eq(credentials.providerId, providerId),
      isNull(credentials.deletedAt),
    ))
    .orderBy(desc(credentials.lastUsedAt))
    .limit(1);
  return row;
}

export async function getCredentialById(userId: string, credentialId: string) {
  const [row] = await getDb().select().from(credentials)
    .where(and(
      eq(credentials.id, credentialId),
      eq(credentials.userId, userId),
      isNull(credentials.deletedAt),
    ))
    .limit(1);
  return row;
}

// Soft-delete: mark the row as deleted so other devices can mirror the
// deletion via the sync endpoint. The row itself stays in the table.
export async function deleteCredential(userId: string, credentialId: string) {
  const now = Date.now();
  const result = await getDb().update(credentials)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(
      eq(credentials.id, credentialId),
      eq(credentials.userId, userId),
      isNull(credentials.deletedAt),
    ));
  return result.length > 0;
}

export async function updateCredentialLabel(userId: string, credentialId: string, label: string) {
  await getDb().update(credentials).set({ label, updatedAt: Date.now() })
    .where(and(eq(credentials.id, credentialId), eq(credentials.userId, userId)));
}

export async function updateCredentialKey(userId: string, credentialId: string, encryptedKey: string) {
  await getDb().update(credentials).set({ encryptedKey, updatedAt: Date.now() })
    .where(and(eq(credentials.id, credentialId), eq(credentials.userId, userId)));
}

export async function updateCredentialLastUsed(credentialId: string) {
  // lastUsedAt is telemetry; it does NOT bump updatedAt so devices won't
  // fight over "I used it most recently" during sync.
  await getDb().update(credentials).set({ lastUsedAt: Date.now() }).where(eq(credentials.id, credentialId));
}

// ─── Groups ───────────────────────────────────────────────────────────────

export async function listGroupsByUser(userId: string) {
  return getDb().select().from(groups).where(eq(groups.userId, userId));
}

export async function getGroupByUserAndId(userId: string, groupId: string) {
  const [row] = await getDb().select().from(groups)
    .where(and(eq(groups.userId, userId), eq(groups.id, groupId)))
    .limit(1);
  return row;
}

export async function upsertGroup(
  userId: string,
  groupId: string,
  name: string,
  providerId: string,
  credentialId: string | null,
  giftId: string | null,
  model: string | null,
) {
  const now = Date.now();
  const existing = await getGroupByUserAndId(userId, groupId);
  if (existing) {
    const [row] = await getDb().update(groups)
      .set({ name, providerId, credentialId, giftId, model })
      .where(and(eq(groups.userId, userId), eq(groups.id, groupId)))
      .returning();
    return row;
  }
  const [row] = await getDb().insert(groups).values({
    userId,
    id: groupId,
    name,
    providerId,
    credentialId,
    giftId,
    model,
    createdAt: now,
  }).returning();
  return row;
}

export async function deleteGroup(userId: string, groupId: string) {
  if (groupId === DEFAULT_GROUP_ID) return false;
  const result = await getDb().delete(groups)
    .where(and(eq(groups.userId, userId), eq(groups.id, groupId)));
  // Any apps that pointed at this group fall back to the default group on
  // next lookup (because their app_groups row is also gone).
  await getDb().delete(appGroups)
    .where(and(eq(appGroups.userId, userId), eq(appGroups.groupId, groupId)));
  return result.length > 0;
}

// ─── App → group bindings ────────────────────────────────────────────────

export async function listAppGroupsByUser(userId: string) {
  return getDb().select().from(appGroups).where(eq(appGroups.userId, userId));
}

export async function getAppGroup(userId: string, origin: string) {
  const [row] = await getDb().select().from(appGroups)
    .where(and(eq(appGroups.userId, userId), eq(appGroups.origin, origin)))
    .limit(1);
  return row;
}

export async function setAppGroup(userId: string, origin: string, groupId: string) {
  const now = Date.now();
  const existing = await getAppGroup(userId, origin);
  if (existing) {
    const [row] = await getDb().update(appGroups)
      .set({ groupId })
      .where(and(eq(appGroups.userId, userId), eq(appGroups.origin, origin)))
      .returning();
    return row;
  }
  const [row] = await getDb().insert(appGroups).values({
    userId, origin, groupId, createdAt: now,
  }).returning();
  return row;
}

export async function deleteAppGroup(userId: string, origin: string) {
  await getDb().delete(appGroups)
    .where(and(eq(appGroups.userId, userId), eq(appGroups.origin, origin)));
}

/**
 * Resolve the group an app belongs to. If the app has no explicit binding,
 * the user's default group is returned. The default group always exists
 * (created at user signup), so this returns undefined only when the user
 * row is gone — i.e. shouldn't happen in normal flow.
 */
export async function resolveGroupForOrigin(userId: string, origin: string) {
  const binding = await getAppGroup(userId, origin);
  const groupId = binding?.groupId ?? DEFAULT_GROUP_ID;
  return getGroupByUserAndId(userId, groupId);
}

// ─── Request log ──────────────────────────────────────────────────────────

export interface RequestLogInput {
  userId: string;
  appSessionId?: string;
  appOrigin?: string;
  providerId: string;
  actualProviderId?: string;
  model?: string;
  actualModel?: string;
  groupId?: string;
  url: string;
  method: string;
  status: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function logRequest(input: RequestLogInput) {
  const id = crypto.randomUUID();
  await getDb().insert(requestLog).values({
    id,
    userId: input.userId,
    appSessionId: input.appSessionId ?? null,
    appOrigin: input.appOrigin ?? null,
    providerId: input.providerId,
    actualProviderId: input.actualProviderId ?? null,
    model: input.model ?? null,
    actualModel: input.actualModel ?? null,
    groupId: input.groupId ?? null,
    url: input.url,
    method: input.method,
    status: input.status,
    timestamp: Date.now(),
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
  });
}

// ─── Gifts ────────────────────────────────────────────────────────────────

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
  encryptedMarketplaceMgmtToken: string | null = null,
) {
  const [row] = await getDb().insert(gifts).values({
    id, userId, providerId, authMethod, encryptedApiKey, encryptedRelayToken,
    relayUrl, maxTokens, usedTokens, expiresAt, createdAt: Date.now(), active: true,
    encryptedMarketplaceMgmtToken,
  }).returning();
  return row;
}

export async function updateGiftMarketplaceToken(
  userId: string,
  giftId: string,
  encryptedMarketplaceMgmtToken: string,
) {
  await getDb().update(gifts)
    .set({ encryptedMarketplaceMgmtToken })
    .where(and(eq(gifts.id, giftId), eq(gifts.userId, userId)));
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
