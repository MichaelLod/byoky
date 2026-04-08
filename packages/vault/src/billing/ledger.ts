import { eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { balances, transactions, paymentMethods } from '../db/billing-schema.js';
import { chargeCustomer } from './stripe.js';
import type { CostBreakdown } from './pricing.js';

/**
 * Deduct from user balance after a successful API call (post-deduct model).
 * Writes a transaction record. If balance drops below auto-top-up threshold,
 * triggers a background charge.
 *
 * Returns the new balance in cents, or null if deduction failed.
 */
export async function deductBalance(
  userId: string,
  cost: CostBreakdown,
  providerId: string,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
  appId?: string,
  requestLogId?: string,
): Promise<{ newBalanceCents: number; transactionId: string }> {
  const txnId = crypto.randomUUID();
  const now = Date.now();

  // Atomic deduct — allows negative balance (post-deduct model)
  const [updated] = await getDb()
    .update(balances)
    .set({
      amountCents: sql`${balances.amountCents} - ${cost.netCents}`,
      updatedAt: now,
    })
    .where(eq(balances.userId, userId))
    .returning({ amountCents: balances.amountCents, autoTopUp: balances.autoTopUp, autoTopUpThresholdCents: balances.autoTopUpThresholdCents });

  if (!updated) {
    throw new Error('Balance record not found for user');
  }

  // Write transaction
  await getDb().insert(transactions).values({
    id: txnId,
    userId,
    type: 'charge',
    amountCents: cost.netCents,
    providerId,
    model: model ?? null,
    inputTokens,
    outputTokens,
    appId: appId ?? null,
    requestLogId: requestLogId ?? null,
    createdAt: now,
  });

  // Trigger auto-top-up if balance dropped below threshold
  if (updated.autoTopUp && updated.amountCents < updated.autoTopUpThresholdCents) {
    // Fire and forget — don't block the response
    triggerAutoTopUp(userId).catch((err) => {
      console.error(`Auto top-up failed for user ${userId}:`, err);
    });
  }

  return { newBalanceCents: updated.amountCents, transactionId: txnId };
}

/**
 * Add funds to user balance (manual top-up or auto-top-up).
 */
export async function topUpBalance(
  userId: string,
  amountCents: number,
  stripePaymentIntentId?: string,
): Promise<{ newBalanceCents: number; transactionId: string }> {
  const txnId = crypto.randomUUID();
  const now = Date.now();

  const [updated] = await getDb()
    .update(balances)
    .set({
      amountCents: sql`${balances.amountCents} + ${amountCents}`,
      updatedAt: now,
    })
    .where(eq(balances.userId, userId))
    .returning({ amountCents: balances.amountCents });

  if (!updated) {
    throw new Error('Balance record not found for user');
  }

  await getDb().insert(transactions).values({
    id: txnId,
    userId,
    type: 'topup',
    amountCents,
    stripePaymentIntentId: stripePaymentIntentId ?? null,
    createdAt: now,
  });

  return { newBalanceCents: updated.amountCents, transactionId: txnId };
}

/**
 * Charge the user's default card and credit their balance.
 */
async function triggerAutoTopUp(userId: string): Promise<void> {
  const [balance] = await getDb()
    .select()
    .from(balances)
    .where(eq(balances.userId, userId))
    .limit(1);

  if (!balance?.autoTopUp || !balance.stripeCustomerId) return;
  if (balance.amountCents >= balance.autoTopUpThresholdCents) return; // already recovered

  // Find default payment method
  const [defaultPm] = await getDb()
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId))
    .limit(1);

  if (!defaultPm) return;

  const amountCents = balance.autoTopUpAmountCents || 500; // $5 default

  try {
    const intent = await chargeCustomer(
      balance.stripeCustomerId,
      amountCents,
      defaultPm.stripePaymentMethodId,
      { byoky_user_id: userId, type: 'auto_topup' },
    );
    await topUpBalance(userId, amountCents, intent.id);
  } catch (err) {
    console.error(`Auto top-up charge failed for user ${userId}:`, err);
    // Don't throw — user can still use the app with negative balance temporarily
  }
}

/**
 * Initialize a balance record for a new user.
 */
export async function initBalance(userId: string, stripeCustomerId: string): Promise<void> {
  await getDb().insert(balances).values({
    userId,
    amountCents: 0,
    currency: 'usd',
    autoTopUp: false,
    autoTopUpAmountCents: 500,
    autoTopUpThresholdCents: 100,
    stripeCustomerId,
    updatedAt: Date.now(),
  }).onConflictDoNothing();
}

/**
 * Get current balance for a user.
 */
export async function getBalance(userId: string) {
  const [row] = await getDb()
    .select()
    .from(balances)
    .where(eq(balances.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Update auto-top-up settings.
 */
export async function updateAutoTopUp(
  userId: string,
  enabled: boolean,
  amountCents?: number,
  thresholdCents?: number,
): Promise<void> {
  const updates: Partial<typeof balances.$inferInsert> = {
    autoTopUp: enabled,
    updatedAt: Date.now(),
  };
  if (amountCents !== undefined) updates.autoTopUpAmountCents = amountCents;
  if (thresholdCents !== undefined) updates.autoTopUpThresholdCents = thresholdCents;

  await getDb()
    .update(balances)
    .set(updates)
    .where(eq(balances.userId, userId));
}
