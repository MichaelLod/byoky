import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, lt, desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { users, credentials, sessions, requestLog } from './schema.js';

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

export async function createUser(email: string, passwordHash: string, encryptionSalt: string) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const [row] = await getDb().insert(users).values({
    id, email, passwordHash, encryptionSalt, createdAt: now,
  }).returning();
  return row;
}

export async function getUserByEmail(email: string) {
  const [row] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
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
) {
  const id = crypto.randomUUID();
  await getDb().insert(requestLog).values({
    id, userId, sessionId, providerId, url, method, status,
    timestamp: Date.now(),
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
    model: model ?? null,
  });
}
