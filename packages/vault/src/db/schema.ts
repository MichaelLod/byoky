import { pgTable, text, integer, bigint, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Users ────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  encryptionSalt: text('encryption_salt').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// ─── Credentials ──────────────────────────────────────────────────────────

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

// ─── User sessions ────────────────────────────────────────────────────────
// One per login. Not used directly by /proxy — proxy uses app_sessions
// derived via /apps/connect handshake.

export const userSessions = pgTable('user_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').unique().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  lastActivityAt: bigint('last_activity_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_user_sessions_user').on(t.userId),
  uniqueIndex('idx_user_sessions_token_hash').on(t.tokenHash),
]);

// ─── Groups ───────────────────────────────────────────────────────────────
// User-defined routing buckets. Apps land in the 'default' group on first
// contact; users can move them. Each group binds to (provider, optional
// credential pin, optional model). When the bound provider differs from
// what an app requested, the routing resolver kicks in:
//   - same-family swap (no translation, just URL/credential rewrite)
//   - cross-family translation (only if model is set)
//
// (userId, id) is the natural key — id values are user-scoped so the
// reserved 'default' id can repeat across users.

export const groups = pgTable('groups', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  name: text('name').notNull(),
  providerId: text('provider_id').notNull(),
  credentialId: text('credential_id'),
  model: text('model'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => [
  uniqueIndex('idx_groups_user_id').on(t.userId, t.id),
]);

// ─── App → group bindings ────────────────────────────────────────────────
// origin is keyed per-user. Absence means the app belongs to the user's
// default group. Set explicitly when the user moves an app.

export const appGroups = pgTable('app_groups', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  origin: text('origin').notNull(),
  groupId: text('group_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => [
  uniqueIndex('idx_app_groups_user_origin').on(t.userId, t.origin),
]);

// ─── App sessions ────────────────────────────────────────────────────────
// Per-app session derived from a user_session via the /apps/connect
// handshake. Carries the origin so /proxy can resolve routing without
// trusting the request body.
//
// Origin is captured at handshake time (from the browser's CORS Origin
// header, or an explicit body field for Node SDKs) and is immutable for the
// life of the app session.

export const appSessions = pgTable('app_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userSessionId: text('user_session_id').notNull().references(() => userSessions.id, { onDelete: 'cascade' }),
  origin: text('origin').notNull(),
  tokenHash: text('token_hash').unique().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  lastActivityAt: bigint('last_activity_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_app_sessions_user').on(t.userId),
  index('idx_app_sessions_user_session').on(t.userSessionId),
  uniqueIndex('idx_app_sessions_token_hash').on(t.tokenHash),
]);

// ─── Gifts ───────────────────────────────────────────────────────────────

export const gifts = pgTable('gifts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  authMethod: text('auth_method').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  encryptedRelayToken: text('encrypted_relay_token').notNull(),
  relayUrl: text('relay_url').notNull(),
  maxTokens: integer('max_tokens').notNull(),
  usedTokens: integer('used_tokens').notNull().default(0),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [
  index('idx_gifts_user').on(t.userId),
]);

// ─── Request log ──────────────────────────────────────────────────────────
// Records both what the SDK called (providerId/model) and what the vault
// actually called upstream (actualProviderId/actualModel) when routing
// rerouted the request. groupId records which group's binding the resolver
// applied. appOrigin captures the per-app source so logs can be sliced by
// app independent of the app session row's lifetime.

export const requestLog = pgTable('request_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  appSessionId: text('app_session_id'),
  appOrigin: text('app_origin'),
  providerId: text('provider_id').notNull(),
  actualProviderId: text('actual_provider_id'),
  model: text('model'),
  actualModel: text('actual_model'),
  groupId: text('group_id'),
  url: text('url').notNull(),
  method: text('method').notNull(),
  status: integer('status').notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
}, (t) => [
  index('idx_request_log_user').on(t.userId),
  index('idx_request_log_user_origin').on(t.userId, t.appOrigin),
]);
