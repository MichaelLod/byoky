/**
 * Pure policy evaluation for the enterprise gateway.
 *
 * The vault supplies runtime signals (spend rate, loop count) computed from
 * Redis; this module is a deterministic verdict function so it can be unit
 * tested and reused. Verdict precedence: block > alert > allow.
 */

export interface PolicyRules {
  /** Only these models allowed (exact or date-normalized match). */
  modelAllow?: string[];
  /** These models blocked. */
  modelDeny?: string[];
  /** Auto-stop when spend rate exceeds this (USD/min). */
  autoStop?: { maxSpendRateUsdPerMin: number };
  /** Block when the same request repeats too often (loop). */
  loopDetect?: { max: number };
}

export interface PolicyContext {
  model?: string;
  /** Signal: recent spend rate for this scope (USD/min), from the vault. */
  spendRateUsdPerMin?: number;
  /** Signal: near-duplicate request count in the loop window, from the vault. */
  loopCount?: number;
}

export type PolicyDecision = 'allow' | 'alert' | 'block';
/** What triggered a block — lets the gateway escalate runaway spend/loops to a
 *  kill-switch while leaving per-request model rules as a plain 403. */
export type PolicyBlockKind = 'model' | 'autoStop' | 'loop';
export interface PolicyVerdict {
  decision: PolicyDecision;
  reason?: string;
  kind?: PolicyBlockKind;
}

function normModel(m: string): string {
  return m.replace(/-\d{6,8}$/, '');
}

function modelMatches(model: string, list: string[]): boolean {
  const n = normModel(model);
  return list.some((e) => e === model || normModel(e) === n);
}

/**
 * Evaluate a set of policies (org/team/agent scopes merged) against a request.
 * Any blocking rule blocks. Returns the most severe verdict.
 */
export function evaluatePolicy(policies: PolicyRules[], ctx: PolicyContext): PolicyVerdict {
  let alert: PolicyVerdict | undefined;

  for (const p of policies) {
    if (ctx.model && p.modelDeny && modelMatches(ctx.model, p.modelDeny)) {
      return { decision: 'block', reason: `model ${ctx.model} is denied by policy`, kind: 'model' };
    }
    if (ctx.model && p.modelAllow && p.modelAllow.length > 0 && !modelMatches(ctx.model, p.modelAllow)) {
      return { decision: 'block', reason: `model ${ctx.model} not in allowlist`, kind: 'model' };
    }
    if (p.autoStop && ctx.spendRateUsdPerMin != null &&
        ctx.spendRateUsdPerMin > p.autoStop.maxSpendRateUsdPerMin) {
      return { decision: 'block', reason: `auto-stop: spend rate $${ctx.spendRateUsdPerMin.toFixed(2)}/min exceeds cap`, kind: 'autoStop' };
    }
    if (p.loopDetect && ctx.loopCount != null && ctx.loopCount >= p.loopDetect.max) {
      return { decision: 'block', reason: `repeat loop detected (${ctx.loopCount} near-duplicate requests)`, kind: 'loop' };
    }
  }
  return alert ?? { decision: 'allow' };
}
