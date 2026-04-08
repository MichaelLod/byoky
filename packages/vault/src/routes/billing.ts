import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { balances, transactions, paymentMethods } from '../db/billing-schema.js';
import {
  getBalance,
  topUpBalance,
  updateAutoTopUp,
} from '../billing/ledger.js';
import {
  createSetupIntent,
  attachPaymentMethod,
  detachPaymentMethod,
  chargeCustomer,
  constructWebhookEvent,
} from '../billing/stripe.js';
import crypto from 'node:crypto';

const billing = new Hono();

// All routes except webhooks require auth
billing.use('/*', async (c, next) => {
  if (c.req.path.endsWith('/webhooks')) return next();
  return authMiddleware(c, next);
});

// --- Balance ---

billing.get('/balance', async (c) => {
  const userId = c.get('userId');
  const balance = await getBalance(userId);
  if (!balance) {
    return c.json({ amountCents: 0, currency: 'usd', autoTopUp: false });
  }
  return c.json({
    amountCents: balance.amountCents,
    currency: balance.currency,
    autoTopUp: balance.autoTopUp,
    autoTopUpAmountCents: balance.autoTopUpAmountCents,
    autoTopUpThresholdCents: balance.autoTopUpThresholdCents,
  });
});

// --- Transactions ---

billing.get('/transactions', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const rows = await getDb()
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ transactions: rows });
});

// --- Payment Methods ---

billing.get('/payment-methods', async (c) => {
  const userId = c.get('userId');
  const rows = await getDb()
    .select({
      id: paymentMethods.id,
      last4: paymentMethods.last4,
      brand: paymentMethods.brand,
      isDefault: paymentMethods.isDefault,
      createdAt: paymentMethods.createdAt,
    })
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId));

  return c.json({ paymentMethods: rows });
});

billing.post('/payment-methods', async (c) => {
  const userId = c.get('userId');
  const { stripePaymentMethodId } = await c.req.json<{ stripePaymentMethodId: string }>();
  if (!stripePaymentMethodId) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'stripePaymentMethodId required' } }, 400);
  }

  const [balance] = await getDb()
    .select()
    .from(balances)
    .where(eq(balances.userId, userId))
    .limit(1);

  if (!balance?.stripeCustomerId) {
    return c.json({ error: { code: 'NO_CUSTOMER', message: 'Billing not set up' } }, 400);
  }

  const pm = await attachPaymentMethod(balance.stripeCustomerId, stripePaymentMethodId);
  const card = pm.card;

  // Check if this is the first payment method
  const existing = await getDb()
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId));

  const id = crypto.randomUUID();
  const isFirst = existing.length === 0;

  await getDb().insert(paymentMethods).values({
    id,
    userId,
    stripePaymentMethodId,
    last4: card?.last4 ?? '****',
    brand: card?.brand ?? 'unknown',
    isDefault: isFirst,
    createdAt: Date.now(),
  });

  return c.json({
    id,
    last4: card?.last4 ?? '****',
    brand: card?.brand ?? 'unknown',
    isDefault: isFirst,
  });
});

billing.delete('/payment-methods/:id', async (c) => {
  const userId = c.get('userId');
  const pmId = c.req.param('id');

  const [pm] = await getDb()
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.id, pmId))
    .limit(1);

  if (!pm || pm.userId !== userId) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Payment method not found' } }, 404);
  }

  await detachPaymentMethod(pm.stripePaymentMethodId);
  await getDb().delete(paymentMethods).where(eq(paymentMethods.id, pmId));

  return c.json({ success: true });
});

// --- Setup Intent (for Stripe Elements card collection) ---

billing.post('/setup-intent', async (c) => {
  const userId = c.get('userId');

  const [balance] = await getDb()
    .select()
    .from(balances)
    .where(eq(balances.userId, userId))
    .limit(1);

  if (!balance?.stripeCustomerId) {
    return c.json({ error: { code: 'NO_CUSTOMER', message: 'Billing not set up' } }, 400);
  }

  const intent = await createSetupIntent(balance.stripeCustomerId);
  return c.json({ clientSecret: intent.client_secret });
});

// --- Top Up ---

billing.post('/topup', async (c) => {
  const userId = c.get('userId');
  const { amountCents } = await c.req.json<{ amountCents: number }>();

  if (!amountCents || amountCents < 100) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Minimum top-up is $1.00' } }, 400);
  }
  if (amountCents > 50_000) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Maximum top-up is $500.00' } }, 400);
  }

  const [balance] = await getDb()
    .select()
    .from(balances)
    .where(eq(balances.userId, userId))
    .limit(1);

  if (!balance?.stripeCustomerId) {
    return c.json({ error: { code: 'NO_CUSTOMER', message: 'Billing not set up' } }, 400);
  }

  // Find default payment method
  const [defaultPm] = await getDb()
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId))
    .limit(1);

  if (!defaultPm) {
    return c.json({ error: { code: 'NO_PAYMENT_METHOD', message: 'No payment method on file. Add a card first.' } }, 400);
  }

  const intent = await chargeCustomer(
    balance.stripeCustomerId,
    amountCents,
    defaultPm.stripePaymentMethodId,
    { byoky_user_id: userId, type: 'manual_topup' },
  );

  const result = await topUpBalance(userId, amountCents, intent.id);
  return c.json({
    newBalanceCents: result.newBalanceCents,
    transactionId: result.transactionId,
  });
});

// --- Auto Top-Up Settings ---

billing.post('/auto-topup', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    enabled: boolean;
    amountCents?: number;
    thresholdCents?: number;
  }>();

  if (body.amountCents !== undefined && body.amountCents < 100) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Minimum auto top-up is $1.00' } }, 400);
  }

  await updateAutoTopUp(userId, body.enabled, body.amountCents, body.thresholdCents);
  return c.json({ success: true });
});

// --- Stripe Webhooks ---

billing.post('/webhooks', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  const rawBody = await c.req.text();
  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch {
    return c.json({ error: 'Webhook signature verification failed' }, 400);
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      // Already handled synchronously in topup/charge flows
      break;
    }
    case 'payment_intent.payment_failed': {
      // Log failure — balance may be negative
      const intent = event.data.object;
      console.error(`Payment failed for customer ${intent.customer}:`, intent.last_payment_error?.message);
      break;
    }
  }

  return c.json({ received: true });
});

export { billing };
