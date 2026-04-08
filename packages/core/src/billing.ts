// --- Billing types shared between vault, SDK, and extension ---

export interface Balance {
  amountCents: number;
  currency: string;
  autoTopUp: boolean;
  autoTopUpAmountCents: number;
  autoTopUpThresholdCents: number;
}

export interface Transaction {
  id: string;
  type: 'charge' | 'topup' | 'refund';
  amountCents: number;
  providerId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  appId?: string;
  createdAt: number;
}

export interface PaymentMethodInfo {
  id: string;
  last4: string;
  brand: string;
  isDefault: boolean;
}

export interface DeveloperAppInfo {
  id: string;
  name: string;
  discountPercent: number;
  description?: string;
  category?: string;
  iconUrl?: string;
  totalUsers: number;
}

export interface PricingInfo {
  providerId: string;
  modelPattern: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
}

/** Format cents to display string, e.g. 150 → "$1.50" */
export function formatBalance(cents: number, currency = 'usd'): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  const symbol = currency === 'usd' ? '$' : currency.toUpperCase() + ' ';
  return `${sign}${symbol}${(abs / 100).toFixed(2)}`;
}

/** Estimate cost in cents for a given token count. */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePer1M: number,
  outputPricePer1M: number,
): number {
  return Math.ceil(
    (inputTokens * inputPricePer1M + outputTokens * outputPricePer1M) / 1_000_000,
  );
}
