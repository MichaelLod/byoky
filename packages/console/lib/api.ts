// Thin client for the Byoky vault control-plane API. The console is a pure
// client — the member's console token lives in localStorage and is sent as a
// bearer on every call.

const VAULT = process.env.NEXT_PUBLIC_VAULT_URL ?? 'http://localhost:3111';
export const VAULT_URL = VAULT; // exposed for the get-started code snippet

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('byoky_console_token');
}
export function setToken(t: string) { localStorage.setItem('byoky_console_token', t); }
export function clearToken() { localStorage.removeItem('byoky_console_token'); }

async function req(path: string, init?: RequestInit): Promise<unknown> {
  const token = getToken();
  const res = await fetch(`${VAULT}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body;
}

export const api = {
  createOrg: (name: string, ownerEmail: string) =>
    req('/orgs', { method: 'POST', body: JSON.stringify({ name, ownerEmail }) }) as Promise<{ token: string; orgId: string; role: string }>,
  acceptInvite: (token: string) =>
    req('/orgs/invites/accept', { method: 'POST', body: JSON.stringify({ token }) }) as Promise<{ token: string; role: string }>,
  me: () => req('/orgs/me') as Promise<{ member: Member; org: { name: string } }>,
  // provider credentials (connect once; sealed server-side)
  credentials: () => req('/orgs/credentials') as Promise<{ credentials: { id: string; providerId: string; label: string | null }[] }>,
  addCredential: (providerId: string, apiKey: string) => req('/orgs/credentials', { method: 'POST', body: JSON.stringify({ providerId, apiKey }) }),
  // observability
  usageRollup: () => req('/console/usage/rollup') as Promise<{ rollup: RollupRow[] }>,
  usage: () => req('/console/usage') as Promise<{ requests: RequestRow[] }>,
  savings: () => req('/console/savings') as Promise<{ savings: Savings }>,
  recommendations: () => req('/console/recommendations') as Promise<{ recommendations: Recommendation[]; totalOpportunityUsd: number }>,
  applyRecommendation: (id: string) => req('/console/recommendations/apply', { method: 'POST', body: JSON.stringify({ id }) }) as Promise<{ ok: boolean; applied: string }>,
  timeseries: (days = 30) => req(`/console/timeseries?days=${days}`) as Promise<{ series: DayPoint[] }>,
  agents: () => req('/console/agents') as Promise<{ agents: AgentStatus[] }>,
  killAgent: (id: string) => req(`/console/agents/${id}/kill`, { method: 'POST' }) as Promise<{ paused: boolean }>,
  resumeAgent: (id: string) => req(`/console/agents/${id}/resume`, { method: 'POST' }) as Promise<{ paused: boolean }>,
  // budgets
  budgets: () => req('/console/budgets') as Promise<{ budgets: Budget[] }>,
  createBudget: (b: unknown) => req('/console/budgets', { method: 'POST', body: JSON.stringify(b) }),
  // policies
  policies: () => req('/console/policies') as Promise<{ policies: Policy[] }>,
  createPolicy: (p: unknown) => req('/console/policies', { method: 'POST', body: JSON.stringify(p) }),
  // keys
  keys: () => req('/console/keys') as Promise<{ keys: AgentKey[] }>,
  mintKey: (k: unknown) => req('/console/keys', { method: 'POST', body: JSON.stringify(k) }) as Promise<{ key: string; keyId: string }>,
  revokeKey: (id: string) => req(`/console/keys/${id}/revoke`, { method: 'POST' }),
  // access — admin
  accessRequests: () => req('/console/access/requests') as Promise<{ requests: AccessRequest[] }>,
  decideAccess: (id: string, decision: 'approved' | 'denied') => req(`/console/access/requests/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision }) }),
  catalog: () => req('/console/access/catalog') as Promise<{ catalog: CatalogItem[] }>,
  addCatalogItem: (i: unknown) => req('/console/access/catalog', { method: 'POST', body: JSON.stringify(i) }),
  // access — employee self-serve
  myAccess: () => req('/console/access/my') as Promise<{ grants: Grant[]; keys: AgentKey[]; catalog: CatalogItem[] }>,
  requestAccess: (r: unknown) => req('/console/access/requests', { method: 'POST', body: JSON.stringify(r) }) as Promise<{ status: string; key?: string; routedTo?: number }>,
  materializeKey: (grantId: string) => req(`/console/access/grants/${grantId}/key`, { method: 'POST' }) as Promise<{ key: string }>,
  // notifications
  notifications: () => req('/console/notifications') as Promise<{ notifications: Notification[]; unread: number }>,
  markNotificationsRead: () => req('/console/notifications/read', { method: 'POST' }),
  // billing
  billing: () => req('/console/billing') as Promise<{ rollups: BillingRollup[] }>,
  runBilling: () => req('/console/billing/run', { method: 'POST' }),
  // members / audit
  members: () => req('/orgs/members') as Promise<{ members: Member[] }>,
  invite: (email: string, role: string) => req('/orgs/invites', { method: 'POST', body: JSON.stringify({ email, role }) }) as Promise<{ inviteToken: string }>,
  offboard: (memberId: string) => req(`/orgs/members/${memberId}`, { method: 'DELETE' }) as Promise<{ keysRevoked: number; grantsRevoked: number }>,
  audit: () => req('/orgs/audit') as Promise<{ audit: AuditRow[] }>,
};

export interface RollupRow { agentId: string | null; teamId: string | null; appOrigin: string | null; model: string | null; requests: number; inputTokens: number; outputTokens: number; costUsd: number; savedUsd: number; avgLatencyMs: number; blocks: number }
export interface RequestRow { id: string; agentId: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; latencyMs: number | null; policyVerdict: string | null; verdictReason: string | null; status: number; cacheHit: boolean | null; routedFrom: string | null; routedTo: string | null; timestamp: number }
export interface Budget { id: string; scope: string; scopeId: string; name: string | null; capUsd: number; alertPct: number | null; period: string }
export interface Policy { id: string; scope: string; name: string | null; rules: string }
export interface AgentKey { id: string; name: string | null; shorthand: string | null; agentId: string | null; scopes: string | null; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }
export interface AccessRequest { id: string; requesterMemberId: string; itemType: string; item: string; justification: string | null; status: string; createdAt: number }
// Byoky's only fee = a % of managed spend (managedSpendFeeUsd). platformFeeUsd is
// a retired, always-zero column kept for backward compatibility.
export interface BillingRollup { periodKey: string; managedSpendUsd: number; savedUsd: number; seats: number; platformFeeUsd: number; managedSpendFeeUsd: number }
export interface Savings { managedSpendUsd: number; savedUsd: number; savedFromCacheUsd: number; savedFromRoutingUsd: number; requests: number; cacheHits: number; blocked: number; firstTs: number; lastTs: number }
export interface Recommendation { id: string; kind: 'optimize' | 'uncapped' | 'budget-risk' | 'concentration' | 'cache'; severity: 'high' | 'medium' | 'low'; title: string; detail: string; estSavingUsd?: number; action?: string; applyable?: boolean; applyLabel?: string; suggestedCapUsd?: number }
export interface DayPoint { day: string; spendUsd: number; savedUsd: number; requests: number; blocked: number }
export interface AgentStatus { id: string; name: string | null; teamId: string | null; paused: boolean; costUsd: number; requests: number }
export interface Member { id: string; email: string; role: string }
export interface AuditRow { action: string; target: string | null; ts: number; actorMemberId: string | null }
export interface CatalogItem { id: string; itemType: string; item: string; autoApprove: boolean; defaultBudgetCapUsd: number | null; defaultBudgetPeriod: string | null; eligibility: string | null }
export interface Grant { id: string; itemType: string; item: string; budgetId: string | null; keyId: string | null; createdAt: number; budget: { capUsd: number; spentUsd: number; remainingUsd: number; period: string } | null }
export interface Notification { id: string; type: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: number }
