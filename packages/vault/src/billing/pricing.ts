import { eq, lte, desc } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { pricing, developerApps } from '../db/billing-schema.js';

export interface CostBreakdown {
  /** Total cost in cents before discount */
  grossCents: number;
  /** Developer discount in cents */
  discountCents: number;
  /** Net cost charged to user */
  netCents: number;
  /** Commission Byoky keeps from the developer's share */
  commissionCents: number;
  /** Amount transferred to developer's connected account */
  developerPayoutCents: number;
  /** Pricing used */
  inputPricePer1M: number;
  outputPricePer1M: number;
}

/** Commission tiers by monthly volume (in cents). */
const COMMISSION_TIERS = [
  { threshold: 1_000_00, percent: 10 },  // < $1K/mo → 10%
  { threshold: 10_000_00, percent: 7 },   // < $10K/mo → 7%
  { threshold: Infinity, percent: 5 },     // > $10K/mo → 5%
];

export function getCommissionPercent(monthlyVolumeCents: number): number {
  for (const tier of COMMISSION_TIERS) {
    if (monthlyVolumeCents < tier.threshold) return tier.percent;
  }
  return COMMISSION_TIERS[COMMISSION_TIERS.length - 1].percent;
}

/**
 * Find the best matching price for a provider + model combo.
 * Tries exact model match first, then wildcard '*'.
 */
export async function getPrice(
  providerId: string,
  model?: string,
): Promise<{ inputPricePer1M: number; outputPricePer1M: number } | null> {
  const now = Date.now();
  const rows = await getDb()
    .select()
    .from(pricing)
    .where(eq(pricing.providerId, providerId))
    .orderBy(desc(pricing.effectiveAt));

  // Filter to rows effective now
  const effective = rows.filter((r) => r.effectiveAt <= now);
  if (effective.length === 0) return null;

  // Try exact model match
  if (model) {
    const exact = effective.find((r) => matchModelPattern(r.modelPattern, model));
    if (exact) return { inputPricePer1M: exact.inputPricePer1M, outputPricePer1M: exact.outputPricePer1M };
  }

  // Fallback to wildcard
  const wildcard = effective.find((r) => r.modelPattern === '*');
  if (wildcard) return { inputPricePer1M: wildcard.inputPricePer1M, outputPricePer1M: wildcard.outputPricePer1M };

  return effective[0]
    ? { inputPricePer1M: effective[0].inputPricePer1M, outputPricePer1M: effective[0].outputPricePer1M }
    : null;
}

/**
 * Calculate full cost breakdown for a request.
 */
export async function calculateCost(
  providerId: string,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
  appId?: string,
): Promise<CostBreakdown | null> {
  const price = await getPrice(providerId, model);
  if (!price) return null;

  const grossCents = Math.ceil(
    (inputTokens * price.inputPricePer1M + outputTokens * price.outputPricePer1M) / 1_000_000,
  );

  // Look up developer discount if appId provided
  let discountPercent = 0;
  let app: typeof developerApps.$inferSelect | undefined;
  if (appId) {
    const [row] = await getDb()
      .select()
      .from(developerApps)
      .where(eq(developerApps.id, appId))
      .limit(1);
    app = row;
    if (app) discountPercent = app.discountPercent;
  }

  const discountCents = Math.floor(grossCents * discountPercent / 100);
  const netCents = grossCents - discountCents;

  // Commission: Byoky takes a % of the gross (before discount)
  // Developer covers the discount from their share
  const commissionPercent = app?.commissionPercent ?? 10;
  const commissionCents = Math.ceil(grossCents * commissionPercent / 100);
  const developerPayoutCents = Math.max(0, discountCents > 0
    ? grossCents - netCents - commissionCents // developer absorbs the discount
    : 0);

  return {
    grossCents,
    discountCents,
    netCents,
    commissionCents,
    developerPayoutCents,
    inputPricePer1M: price.inputPricePer1M,
    outputPricePer1M: price.outputPricePer1M,
  };
}

/** Simple glob match: 'claude-*' matches 'claude-3-opus', '*' matches anything. */
function matchModelPattern(pattern: string, model: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === model;
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return regex.test(model);
}
