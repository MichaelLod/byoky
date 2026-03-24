import Database from 'better-sqlite3';
import { createTables } from './schema.js';
import crypto from 'node:crypto';

let db: Database.Database;

export function initDb(path: string = 'vault.db'): Database.Database {
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// --- Users ---

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  encryption_salt: string;
  created_at: number;
}

export function createUser(email: string, passwordHash: string, encryptionSalt: string): UserRow {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb().prepare(
    'INSERT INTO users (id, email, password_hash, encryption_salt, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, email, passwordHash, encryptionSalt, now);
  return { id, email, password_hash: passwordHash, encryption_salt: encryptionSalt, created_at: now };
}

export function getUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
}

export function getUserById(id: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

// --- Sessions ---

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  last_activity_at: number;
}

export function createSession(userId: string, tokenHash: string, expiresAt: number): SessionRow {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb().prepare(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, userId, tokenHash, now, expiresAt, now);
  return { id, user_id: userId, token_hash: tokenHash, created_at: now, expires_at: expiresAt, last_activity_at: now };
}

export function getSessionByTokenHash(tokenHash: string): SessionRow | undefined {
  return getDb().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) as SessionRow | undefined;
}

export function updateSessionActivity(sessionId: string): void {
  getDb().prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(Date.now(), sessionId);
}

export function deleteSession(sessionId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteExpiredSessions(): void {
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

// --- Credentials ---

interface CredentialRow {
  id: string;
  user_id: string;
  provider_id: string;
  label: string;
  auth_method: string;
  encrypted_key: string;
  created_at: number;
  last_used_at: number | null;
}

export function createCredential(
  userId: string,
  providerId: string,
  label: string,
  authMethod: string,
  encryptedKey: string,
): CredentialRow {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb().prepare(
    'INSERT INTO credentials (id, user_id, provider_id, label, auth_method, encrypted_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, userId, providerId, label, authMethod, encryptedKey, now);
  return { id, user_id: userId, provider_id: providerId, label, auth_method: authMethod, encrypted_key: encryptedKey, created_at: now, last_used_at: null };
}

export function getCredentialsByUser(userId: string): CredentialRow[] {
  return getDb().prepare('SELECT * FROM credentials WHERE user_id = ?').all(userId) as CredentialRow[];
}

export function getCredentialByUserAndProvider(userId: string, providerId: string): CredentialRow | undefined {
  return getDb().prepare('SELECT * FROM credentials WHERE user_id = ? AND provider_id = ? ORDER BY last_used_at DESC LIMIT 1').get(userId, providerId) as CredentialRow | undefined;
}

export function getCredentialById(userId: string, credentialId: string): CredentialRow | undefined {
  return getDb().prepare('SELECT * FROM credentials WHERE id = ? AND user_id = ?').get(credentialId, userId) as CredentialRow | undefined;
}

export function deleteCredential(userId: string, credentialId: string): boolean {
  const result = getDb().prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').run(credentialId, userId);
  return result.changes > 0;
}

export function updateCredentialLastUsed(credentialId: string): void {
  getDb().prepare('UPDATE credentials SET last_used_at = ? WHERE id = ?').run(Date.now(), credentialId);
}

// --- Request log ---

export function logRequest(
  userId: string,
  sessionId: string,
  providerId: string,
  url: string,
  method: string,
  status: number,
  inputTokens?: number,
  outputTokens?: number,
  model?: string,
): void {
  const id = crypto.randomUUID();
  getDb().prepare(
    'INSERT INTO request_log (id, user_id, session_id, provider_id, url, method, status, timestamp, input_tokens, output_tokens, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, userId, sessionId, providerId, url, method, status, Date.now(), inputTokens ?? null, outputTokens ?? null, model ?? null);
}
