import { pgTable, text, integer, bigint, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

// Inline users table reference to avoid cross-file import that breaks drizzle-kit CJS resolver.
// The actual users table is defined in schema.ts — this is a lightweight duplicate for FK references only.
const users = pgTable('users', {
  id: text('id').primaryKey(),
});

// --- Balances ---

export const balances = pgTable('balances', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull().default(0),
  currency: text('currency').notNull().default('usd'),
  autoTopUp: boolean('auto_top_up').notNull().default(false),
  autoTopUpAmountCents: integer('auto_top_up_amount_cents').notNull().default(500), // $5 default
  autoTopUpThresholdCents: integer('auto_top_up_threshold_cents').notNull().default(100), // $1 default
  stripeCustomerId: text('stripe_customer_id'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// --- Transactions ---

export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'charge' | 'topup' | 'refund'
  amountCents: integer('amount_cents').notNull(),
  providerId: text('provider_id'),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  appId: text('app_id'),
  requestLogId: text('request_log_id'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_transactions_user').on(t.userId),
  index('idx_transactions_app').on(t.appId),
  index('idx_transactions_created').on(t.createdAt),
]);

// --- Payment Methods ---

export const paymentMethods = pgTable('payment_methods', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stripePaymentMethodId: text('stripe_payment_method_id').notNull(),
  last4: text('last4').notNull(),
  brand: text('brand').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_payment_methods_user').on(t.userId),
]);

// --- Developer Apps ---

export const developerApps = pgTable('developer_apps', {
  id: text('id').primaryKey(),
  developerId: text('developer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull(),
  origins: text('origins').notNull().default('[]'), // JSON array of allowed origins
  discountPercent: integer('discount_percent').notNull().default(0),
  stripeConnectAccountId: text('stripe_connect_account_id'),
  commissionPercent: integer('commission_percent').notNull().default(10),
  description: text('description'),
  iconUrl: text('icon_url'),
  category: text('category'),
  totalUsers: integer('total_users').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_developer_apps_developer').on(t.developerId),
  uniqueIndex('idx_developer_apps_api_key').on(t.apiKeyHash),
]);

// --- Pricing ---

export const pricing = pgTable('pricing', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  modelPattern: text('model_pattern').notNull(), // glob-style: 'claude-*', 'gpt-4o*', '*' for default
  inputPricePer1M: integer('input_price_per_1m').notNull(), // in cents
  outputPricePer1M: integer('output_price_per_1m').notNull(), // in cents
  effectiveAt: bigint('effective_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_pricing_provider').on(t.providerId),
]);

// --- Groups (vault-synced) ---

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  providerId: text('provider_id').notNull(),
  credentialId: text('credential_id'),
  model: text('model'),
  description: text('description'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (t) => [
  index('idx_groups_user').on(t.userId),
]);

export const appGroups = pgTable('app_groups', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  appOrigin: text('app_origin').notNull(),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => [
  index('idx_app_groups_user').on(t.userId),
  uniqueIndex('idx_app_groups_origin').on(t.userId, t.appOrigin),
]);
