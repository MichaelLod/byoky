import {
  DEFAULT_GROUP_ID,
  signMac,
  verifyMac,
  type AppGroups,
  type Group,
  type TokenAllowance,
} from '@byoky/core';

/**
 * Integrity of the state that decides where an app's requests go and how
 * much it may spend. Like the trust state (trust-state.ts), it sits in
 * browser.storage.local and carries an HMAC under the wallet MAC key, which
 * exists only while the wallet is unlocked. It comes in two parts:
 *
 *   Routing and limits, changed from the popup:
 *     groups           Group[]           provider, key pin and model per group
 *     appGroups        AppGroups         origin → group id
 *     tokenAllowances  TokenAllowance[]  per-app token limits
 *     limitsHold       LimitsHold        set while apps are paused (below)
 *     routingEpoch     number            write counter
 *     routingMac       base64 HMAC-SHA256 of routingMacInput(...)
 *
 *   Usage, rewritten after every request, so its write costs one HMAC
 *   over the totals rather than over everything:
 *     usageTotals      UsageTotals       lifetime tokens per app and provider
 *     usageEpoch, usageMac
 *
 * The key is the trust state's; each MAC input starts with its own tag
 * ('byoky:routing:1', 'byoky:usage:1'), so no MAC passes for another kind.
 * Epochs work as for the trust state: every write raises them, and the
 * background refuses one older than the newest it has seen this browser
 * session (a snapshot put back). Across a browser restart nothing local can
 * tell a rolled-back storage from a current one.
 *
 * A part that fails verification is replaced by its safe state, which never
 * lifts a limit:
 *   - Routing and limits: groups and app assignments go back to the default
 *     group alone, which routes nowhere (every app uses a key of the
 *     provider it asks for). The limits can't be trusted either way, since
 *     an edit may have raised or deleted one, so every app is paused
 *     (limitsHold 'settings'); the stored limits are kept for the user to
 *     check.
 *   - Usage: the stored totals are kept, but may have been lowered, so apps
 *     are paused the same way (limitsHold 'usage').
 * While limitsHold is set, the wallet refuses every app request until the
 * user checks limits and usage in the popup and resumes apps. Dropping the
 * limits instead, or counting from totals that may have been lowered, would
 * hand the edit what it was after.
 *
 * Unsigned state is adopted (signed as it is) only where it can't have been
 * planted:
 *   - by the upgrade of a wallet from before 1.1.2 (wallet-upgrade.ts), in
 *     the same write as its format-2 password hash;
 *   - in a wallet whose trust state is still signed under a pre-routing tag
 *     (trust-state.ts, beforeRouting): an earlier 1.1.2 build signed the
 *     trust state but not this. The trust state is re-signed in the same
 *     write, so this happens once;
 *   - in a wallet with nothing in it yet (isEmptyWallet): a new one.
 * Anywhere else, unsigned state was stripped of its MAC and is refused.
 */
export const GROUPS_KEY = 'groups';
export const APP_GROUPS_KEY = 'appGroups';
export const ALLOWANCES_KEY = 'tokenAllowances';
export const LIMITS_HOLD_KEY = 'limitsHold';
export const ROUTING_EPOCH_KEY = 'routingEpoch';
export const ROUTING_MAC_KEY = 'routingMac';
export const USAGE_KEY = 'usageTotals';
export const USAGE_EPOCH_KEY = 'usageEpoch';
export const USAGE_MAC_KEY = 'usageMac';
export const ROUTING_STATE_KEYS = [GROUPS_KEY, APP_GROUPS_KEY, ALLOWANCES_KEY, LIMITS_HOLD_KEY, ROUTING_EPOCH_KEY, ROUTING_MAC_KEY];
export const USAGE_STATE_KEYS = [USAGE_KEY, USAGE_EPOCH_KEY, USAGE_MAC_KEY];

/** Lifetime tokens per app origin and provider, which allowances are checked against. */
export type UsageTotals = Record<string, Record<string, number>>;

/**
 * Why apps are paused: the routing and limits ('settings') or the usage
 * totals ('usage') failed verification. 'settings' covers 'usage'.
 */
export type LimitsHold = 'settings' | 'usage';

export interface RoutingState {
  groups: Group[];
  appGroups: AppGroups;
  allowances: TokenAllowance[];
  hold?: LimitsHold;
}

export interface RoutingStateRead {
  /** The verified state; the safe state (droppedRoutingState) when refused. */
  state: RoutingState;
  /** False when the stored state was refused; the caller writes `state` back. */
  intact: boolean;
  /** The stored epoch, 0 when refused. */
  epoch: number;
}

export interface UsageStateRead {
  /** The verified totals; what a refused state keeps (salvageUsageTotals) otherwise. */
  totals: UsageTotals;
  /** False when the stored totals were refused; the caller holds the limits. */
  intact: boolean;
  /** The stored epoch, 0 when refused. */
  epoch: number;
}

/** The default group: where apps without a binding land. It routes nowhere. */
export function defaultGroup(createdAt = Date.now()): Group {
  return { id: DEFAULT_GROUP_ID, name: 'Default', providerId: '', createdAt };
}

export function emptyRoutingState(): RoutingState {
  return { groups: [], appGroups: {}, allowances: [] };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

function isCount(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0;
}

/**
 * The most tokens a usage count holds. Counts stop growing here rather than
 * overflow to Infinity, which storage would give back as null; this many is
 * past any limit anyone sets.
 */
export const MAX_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;

/** A usage count as the wallet stores it: a whole number from 0 to MAX_TOKEN_COUNT. */
function isTokenCount(raw: unknown): raw is number {
  return Number.isSafeInteger(raw) && (raw as number) >= 0;
}

/**
 * `raw` as a usage count: a finite number of 0 or more, rounded up and
 * capped at MAX_TOKEN_COUNT. Undefined for anything else (NaN, Infinity,
 * a negative number, not a number).
 */
export function toTokenCount(raw: unknown): number | undefined {
  return isCount(raw) ? Math.min(Math.ceil(raw), MAX_TOKEN_COUNT) : undefined;
}

/** A string field that may be absent (undefined or null), or null if it is something else. */
function optionalString(raw: unknown): string | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  return typeof raw === 'string' ? raw : null;
}

/**
 * The stored groups, or null if they aren't a well-formed Group[]. Fields
 * the wallet no longer uses (a 1.0 gift pin) are left out.
 */
export function parseGroups(raw: unknown): Group[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const groups: Group[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const { id, name, providerId, createdAt } = entry;
    const credentialId = optionalString(entry.credentialId);
    const model = optionalString(entry.model);
    if (typeof id !== 'string' || typeof name !== 'string' || typeof providerId !== 'string') return null;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
    if (credentialId === null || model === null) return null;
    groups.push({
      id,
      name,
      providerId,
      ...(credentialId !== undefined ? { credentialId } : {}),
      ...(model !== undefined ? { model } : {}),
      createdAt,
    });
  }
  return groups;
}

/** The stored app → group bindings, or null if they aren't a string → string map. */
export function parseAppGroups(raw: unknown): AppGroups | null {
  if (raw === undefined) return {};
  if (!isRecord(raw)) return null;
  const entries = Object.entries(raw);
  if (!entries.every(([, groupId]) => typeof groupId === 'string')) return null;
  return Object.fromEntries(entries) as AppGroups;
}

/** One allowance, or null if it isn't well formed. Also checks what the popup sends. */
export function parseAllowance(raw: unknown): TokenAllowance | null {
  if (!isRecord(raw) || typeof raw.origin !== 'string' || !raw.origin) return null;
  const allowance: TokenAllowance = { origin: raw.origin };
  if (raw.totalLimit !== undefined && raw.totalLimit !== null) {
    if (!isCount(raw.totalLimit)) return null;
    allowance.totalLimit = raw.totalLimit;
  }
  if (raw.providerLimits !== undefined && raw.providerLimits !== null) {
    if (!isRecord(raw.providerLimits)) return null;
    const limits = Object.entries(raw.providerLimits);
    if (!limits.every(([, limit]) => isCount(limit))) return null;
    allowance.providerLimits = Object.fromEntries(limits) as Record<string, number>;
  }
  return allowance;
}

/** The stored allowances, or null if any of them isn't well formed. */
export function parseAllowances(raw: unknown): TokenAllowance[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const allowances: TokenAllowance[] = [];
  for (const entry of raw) {
    const allowance = parseAllowance(entry);
    if (!allowance) return null;
    allowances.push(allowance);
  }
  return allowances;
}

/**
 * The stored usage totals, or null if they aren't origin → provider → token
 * count, every count a whole number (isTokenCount). What the wallet signs
 * always is (UsageCounter).
 */
export function parseUsageTotals(raw: unknown): UsageTotals | null {
  if (raw === undefined) return {};
  if (!isRecord(raw)) return null;
  const apps: Array<[string, Record<string, number>]> = [];
  for (const [origin, byProvider] of Object.entries(raw)) {
    if (!isRecord(byProvider)) return null;
    const entries = Object.entries(byProvider);
    if (!entries.every(([, tokens]) => isTokenCount(tokens))) return null;
    apps.push([origin, Object.fromEntries(entries) as Record<string, number>]);
  }
  return Object.fromEntries(apps);
}

/**
 * Usage totals read as far as they go: every count toTokenCount takes, the
 * rest left out, so one app's malformed count (a null, say: Infinity after a
 * trip through storage) costs no other app its usage. `complete` is false
 * when a count or an app was left out; a fraction rounded up isn't.
 */
export function salvageUsage(raw: unknown): { totals: UsageTotals; complete: boolean } {
  const totals = new UsageCounter();
  if (raw === undefined) return { totals: {}, complete: true };
  if (!isRecord(raw)) return { totals: {}, complete: false };
  let complete = true;
  for (const [origin, byProvider] of Object.entries(raw)) {
    if (!isRecord(byProvider)) {
      complete = false;
      continue;
    }
    for (const [providerId, tokens] of Object.entries(byProvider)) {
      if (isCount(tokens)) totals.add(origin, providerId, tokens);
      else complete = false;
    }
  }
  return { totals: totals.toTotals(), complete };
}

function parseHold(raw: unknown): LimitsHold | undefined | null {
  if (raw === undefined) return undefined;
  return raw === 'settings' || raw === 'usage' ? raw : null;
}

/** Map entries in a fixed order, so the MAC doesn't depend on key order in storage. */
function sortedEntries<T>(map: Record<string, T>): Array<[string, T]> {
  return Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** What the routing MAC covers: the epoch and every field the wallet uses, in order. */
function routingMacInput(state: RoutingState, epoch: number): string {
  return JSON.stringify([
    'byoky:routing:1',
    epoch,
    state.groups.map((g) => [g.id, g.name, g.providerId, g.credentialId ?? null, g.model ?? null, g.createdAt]),
    sortedEntries(state.appGroups),
    state.allowances.map((a) => [a.origin, a.totalLimit ?? null, a.providerLimits ? sortedEntries(a.providerLimits) : null]),
    state.hold ?? null,
  ]);
}

/** What the usage MAC covers: the epoch and every count. */
function usageMacInput(totals: UsageTotals, epoch: number): string {
  return JSON.stringify([
    'byoky:usage:1',
    epoch,
    sortedEntries(totals).map(([origin, byProvider]) => [origin, sortedEntries(byProvider)]),
  ]);
}

// The last input each key signed or verified, per kind of state. Reading back
// what was just written, which every request does, then costs no HMAC: the
// input is compared instead. Forgotten with the key.
const knownMacs = new WeakMap<CryptoKey, Map<string, string>>();

function remember(key: CryptoKey, kind: string, input: string, mac: string) {
  let known = knownMacs.get(key);
  if (!known) knownMacs.set(key, (known = new Map()));
  known.set(kind, `${mac}\n${input}`);
}

async function signRemembered(key: CryptoKey, kind: string, input: string): Promise<string> {
  const mac = await signMac(key, input);
  remember(key, kind, input, mac);
  return mac;
}

async function verifyRemembered(key: CryptoKey, kind: string, input: string, mac: unknown): Promise<boolean> {
  if (typeof mac !== 'string') return false;
  if (knownMacs.get(key)?.get(kind) === `${mac}\n${input}`) return true;
  if (!(await verifyMac(key, input, mac))) return false;
  remember(key, kind, input, mac);
  return true;
}

function validEpoch(epoch: unknown): epoch is number {
  return typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch >= 1;
}

/**
 * `value` parsed as it is and as storage gives it back (JSON, without
 * undefined fields), or null if either fails: NaN, say, would come back
 * as null, which reads as no limit at all.
 */
function asStored<T>(value: unknown, parse: (raw: unknown) => T | null): T | null {
  return parse(value) === null ? null : parse(JSON.parse(JSON.stringify(value) ?? 'null'));
}

/**
 * The storage entries for `state` at `epoch` (a positive integer), MAC
 * included. They are what parsing them gives back, so a state that wouldn't
 * read back as signed (and so be refused) throws instead.
 */
export async function signRoutingState(state: RoutingState, key: CryptoKey, epoch: number): Promise<Record<string, unknown>> {
  const groups = asStored(state.groups, parseGroups);
  const appGroups = asStored(state.appGroups, parseAppGroups);
  const allowances = asStored(state.allowances, parseAllowances);
  const hold = parseHold(state.hold);
  if (!groups || !appGroups || !allowances || hold === null || !validEpoch(epoch)) throw new Error('Malformed routing state');
  const normalized: RoutingState = { groups, appGroups, allowances, ...(hold ? { hold } : {}) };
  return {
    [GROUPS_KEY]: groups,
    [APP_GROUPS_KEY]: appGroups,
    [ALLOWANCES_KEY]: allowances,
    // undefined would leave an earlier value in place, so a cleared hold is written as null.
    [LIMITS_HOLD_KEY]: hold ?? null,
    [ROUTING_EPOCH_KEY]: epoch,
    [ROUTING_MAC_KEY]: await signRemembered(key, 'routing', routingMacInput(normalized, epoch)),
  };
}

/** The storage entries for `totals` at `epoch` (a positive integer), MAC included; see signRoutingState. */
export async function signUsageState(totals: UsageTotals, key: CryptoKey, epoch: number): Promise<Record<string, unknown>> {
  const normalized = asStored(totals, parseUsageTotals);
  if (!normalized || !validEpoch(epoch)) throw new Error('Malformed usage totals');
  return {
    [USAGE_KEY]: normalized,
    [USAGE_EPOCH_KEY]: epoch,
    [USAGE_MAC_KEY]: await signRemembered(key, 'usage', usageMacInput(normalized, epoch)),
  };
}

/**
 * What replaces a refused routing state: the default group alone, no app
 * bindings, the stored limits kept as far as they parse, and every app
 * paused until the user resumes them.
 */
export function droppedRoutingState(stored: Record<string, unknown>): RoutingState {
  return {
    groups: [defaultGroup()],
    appGroups: {},
    allowances: parseAllowances(stored[ALLOWANCES_KEY]) ?? [],
    hold: 'settings',
  };
}

/** What a refused usage state keeps: the stored totals as far as they parse (salvageUsage). */
export function salvageUsageTotals(stored: Record<string, unknown>): UsageTotals {
  return salvageUsage(stored[USAGE_KEY]).totals;
}

/** `state` with apps paused for `reason`; 'settings' outranks 'usage'. */
export function withHold(state: RoutingState, reason: LimitsHold): RoutingState {
  return state.hold === 'settings' || state.hold === reason ? state : { ...state, hold: reason };
}

/**
 * Verify the stored routing state against `key`. A state older than
 * `minEpoch`, the highest epoch the caller has seen, is refused like a
 * forged one, and so is a missing or partial one: absent state is adopted
 * before it is ever read (see the module comment).
 */
export async function readRoutingState(stored: Record<string, unknown>, key: CryptoKey, minEpoch = 0): Promise<RoutingStateRead> {
  const refused = (): RoutingStateRead => ({ state: droppedRoutingState(stored), intact: false, epoch: 0 });
  const groups = parseGroups(stored[GROUPS_KEY]);
  const appGroups = parseAppGroups(stored[APP_GROUPS_KEY]);
  const allowances = parseAllowances(stored[ALLOWANCES_KEY]);
  // A cleared hold is stored as null.
  const hold = parseHold(stored[LIMITS_HOLD_KEY] ?? undefined);
  const epoch = stored[ROUTING_EPOCH_KEY];
  if (!groups || !appGroups || !allowances || hold === null || !validEpoch(epoch)) return refused();
  const state: RoutingState = { groups, appGroups, allowances, ...(hold ? { hold } : {}) };
  if (!(await verifyRemembered(key, 'routing', routingMacInput(state, epoch), stored[ROUTING_MAC_KEY]))) return refused();
  if (epoch < minEpoch) return refused();
  return { state, intact: true, epoch };
}

/** Verify the stored usage totals against `key`, as readRoutingState does. */
export async function readUsageState(stored: Record<string, unknown>, key: CryptoKey, minEpoch = 0): Promise<UsageStateRead> {
  const refused = (): UsageStateRead => ({ totals: salvageUsageTotals(stored), intact: false, epoch: 0 });
  const totals = parseUsageTotals(stored[USAGE_KEY]);
  const epoch = stored[USAGE_EPOCH_KEY];
  if (!totals || !validEpoch(epoch)) return refused();
  if (!(await verifyRemembered(key, 'usage', usageMacInput(totals, epoch), stored[USAGE_MAC_KEY]))) return refused();
  if (epoch < minEpoch) return refused();
  return { totals, intact: true, epoch };
}

/** Whether any part of the stored routing or usage state carries a MAC or an epoch. */
export function hasSignedRoutingState(stored: Record<string, unknown>): boolean {
  return [ROUTING_EPOCH_KEY, ROUTING_MAC_KEY, USAGE_EPOCH_KEY, USAGE_MAC_KEY].some((k) => stored[k] !== undefined);
}

/**
 * Whether the wallet holds nothing yet: no credentials, no routing, limits
 * or usage, no trust state. Its first unlock signs the empty state. (Planting
 * this takes deleting every key in the wallet, which its owner sees.)
 */
export function isEmptyWallet(stored: Record<string, unknown>): boolean {
  const empty = (v: unknown) => v === undefined || (Array.isArray(v) && v.length === 0) || (isRecord(v) && Object.keys(v).length === 0);
  return ['credentials', GROUPS_KEY, APP_GROUPS_KEY, ALLOWANCES_KEY, USAGE_KEY, 'trustedSites', 'revokedOrigins'].every((k) => empty(stored[k]))
    && ['trustMac', 'trustEpoch', LIMITS_HOLD_KEY].every((k) => stored[k] === undefined);
}

/**
 * Token counts keyed in Maps, so an origin or provider id read from storage
 * (say "__proto__") is only ever a key. Every count it gives back is one
 * parseUsageTotals accepts: what toTokenCount doesn't take is left out, and
 * a sum stops at MAX_TOKEN_COUNT. So totals built here always sign, and a
 * bad count from one app can't keep the others' from being written.
 */
class UsageCounter {
  private readonly apps = new Map<string, Map<string, number>>();

  add(origin: string, providerId: string, tokens: number) {
    const count = toTokenCount(tokens);
    if (count === undefined) return;
    let app = this.apps.get(origin);
    if (!app) this.apps.set(origin, (app = new Map()));
    app.set(providerId, Math.min((app.get(providerId) ?? 0) + count, MAX_TOKEN_COUNT));
  }

  addTotals(totals: UsageTotals) {
    for (const [origin, byProvider] of Object.entries(totals)) {
      for (const [providerId, tokens] of Object.entries(byProvider)) this.add(origin, providerId, tokens);
    }
  }

  toTotals(): UsageTotals {
    return Object.fromEntries([...this.apps].map(([origin, app]) => [origin, Object.fromEntries(app)]));
  }
}

/** Usage totals rebuilt from the request log, as 1.1.1 seeded them on its first run. */
export function usageFromLog(log: unknown): UsageTotals {
  const totals = new UsageCounter();
  if (!Array.isArray(log)) return totals.toTotals();
  for (const e of log as unknown[]) {
    if (!isRecord(e) || typeof e.appOrigin !== 'string' || typeof e.providerId !== 'string') continue;
    const tokens = (isCount(e.inputTokens) ? e.inputTokens : 0) + (isCount(e.outputTokens) ? e.outputTokens : 0);
    if (typeof e.status !== 'number' || e.status >= 400 || tokens <= 0) continue;
    totals.add(e.appOrigin, e.providerId, tokens);
  }
  return totals.toTotals();
}

/**
 * Unsigned routing and usage state, as a wallet adopts it (see the module
 * comment): kept as it is where it parses. If it doesn't, it is replaced
 * as a refused signed state is (droppedRoutingState, apps paused). Usage
 * totals keep what parses (salvageUsage: 1.1.1 could store a fraction, or
 * null for a count that had become Infinity), and apps are paused if any
 * count was left out. Missing totals are seeded from the request log
 * (`stored.requestLog`).
 */
export function adoptLegacyRoutingState(stored: Record<string, unknown>): { routing: RoutingState; usage: UsageTotals } {
  const groups = parseGroups(stored[GROUPS_KEY]);
  const appGroups = parseAppGroups(stored[APP_GROUPS_KEY]);
  const allowances = parseAllowances(stored[ALLOWANCES_KEY]);
  const usage = stored[USAGE_KEY] === undefined
    ? { totals: usageFromLog(stored.requestLog), complete: true }
    : salvageUsage(stored[USAGE_KEY]);
  let routing: RoutingState = groups && appGroups && allowances ? { groups, appGroups, allowances } : droppedRoutingState(stored);
  if (!usage.complete) routing = withHold(routing, 'usage');
  return { routing, usage: usage.totals };
}

/** The sum of `totals`, as a new object. */
export function addUsageTotals(...totals: UsageTotals[]): UsageTotals {
  const sum = new UsageCounter();
  for (const t of totals) sum.addTotals(t);
  return sum.toTotals();
}

/** `totals` with `tokens` more for `origin` and `providerId`, as a new object. */
export function withUsage(totals: UsageTotals, origin: string, providerId: string, tokens: number): UsageTotals {
  const sum = new UsageCounter();
  sum.addTotals(totals);
  sum.add(origin, providerId, tokens);
  return sum.toTotals();
}
