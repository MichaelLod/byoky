import Stripe from 'stripe';

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    stripe = new Stripe(key);
  }
  return stripe;
}

// --- Customers ---

export async function createCustomer(userId: string, email?: string): Promise<string> {
  const customer = await getStripe().customers.create({
    metadata: { byoky_user_id: userId },
    ...(email ? { email } : {}),
  });
  return customer.id;
}

// --- Payment Methods ---

export async function attachPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<Stripe.PaymentMethod> {
  const pm = await getStripe().paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });
  // Set as default for future charges
  await getStripe().customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  return pm;
}

export async function detachPaymentMethod(paymentMethodId: string): Promise<void> {
  await getStripe().paymentMethods.detach(paymentMethodId);
}

export async function listPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
  const result = await getStripe().paymentMethods.list({
    customer: customerId,
    type: 'card',
  });
  return result.data;
}

// --- Charges (for top-ups and pay-as-you-go batch charges) ---

export async function chargeCustomer(
  customerId: string,
  amountCents: number,
  paymentMethodId?: string,
  metadata?: Record<string, string>,
): Promise<Stripe.PaymentIntent> {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: metadata ?? {},
  };
  if (paymentMethodId) {
    params.payment_method = paymentMethodId;
  }
  return getStripe().paymentIntents.create(params);
}

// --- Stripe Connect (for developer payouts) ---

export async function createConnectAccount(
  developerId: string,
  email: string,
): Promise<Stripe.Account> {
  return getStripe().accounts.create({
    type: 'express',
    email,
    metadata: { byoky_developer_id: developerId },
    capabilities: {
      transfers: { requested: true },
    },
  });
}

export async function createConnectOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const link = await getStripe().accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return link.url;
}

export async function transferToConnectedAccount(
  accountId: string,
  amountCents: number,
  metadata?: Record<string, string>,
): Promise<Stripe.Transfer> {
  return getStripe().transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination: accountId,
    metadata: metadata ?? {},
  });
}

export async function getConnectAccountStatus(accountId: string): Promise<{
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}> {
  const account = await getStripe().accounts.retrieve(accountId);
  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  };
}

// --- Setup Intents (for adding cards without immediate charge) ---

export async function createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
  return getStripe().setupIntents.create({
    customer: customerId,
    automatic_payment_methods: { enabled: true },
  });
}

// --- Webhook verification ---

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  return getStripe().webhooks.constructEvent(payload, signature, secret);
}
