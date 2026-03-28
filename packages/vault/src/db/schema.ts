import { pgTable, text, integer, bigint, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  encryptionSalt: text('encryption_salt').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const credentials = pgTable('credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  label: text('label').notNull(),
  authMethod: text('auth_method').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }),
}, (t) => [
  index('idx_credentials_user').on(t.userId),
]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').unique().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  lastActivityAt: bigint('last_activity_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_sessions_user').on(t.userId),
  uniqueIndex('idx_sessions_token_hash').on(t.tokenHash),
]);

export const requestLog = pgTable('request_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  providerId: text('provider_id').notNull(),
  url: text('url').notNull(),
  method: text('method').notNull(),
  status: integer('status').notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  model: text('model'),
}, (t) => [
  index('idx_request_log_user').on(t.userId),
]);
