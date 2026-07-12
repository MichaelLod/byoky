#!/usr/bin/env node
/**
 * Tenant-isolation test. Creates two orgs (A, B), seeds data in B, then asserts
 * that A's console token can NEVER see or mutate B's data across every
 * org-scoped surface. This is the guard that a missing WHERE org_id (or a
 * broken RLS policy) would trip. Run against a running vault.
 *
 * Usage: node scripts/test-tenant-isolation.mjs [baseUrl]
 */
const B = process.argv[2] ?? 'http://127.0.0.1:3111';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) process.exitCode = 1; };

async function call(path, { token, body, method } = {}) {
  const res = await fetch(B + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  return { status: res.status, json };
}
const arr = (x) => (Array.isArray(x) ? x : []);

async function main() {
  console.log(`\nTenant-isolation test → ${B}\n`);

  // ── Org B: seed a rich footprint ──
  const B_ = (await call('/orgs', { body: { name: `Tenant-B-${Date.now()}`, ownerEmail: 'b@b.co' } })).json;
  const BT = B_.token, borg = B_.orgId;
  await call('/orgs/credentials', { token: BT, body: { providerId: 'openai', apiKey: 'sk-B-secret' } });
  const bTeam = (await call('/orgs/teams', { token: BT, body: { name: 'B-team' } })).json.teamId;
  const bAgent = (await call('/orgs/agents', { token: BT, body: { name: 'B-agent' } })).json.agentId;
  const bKey = (await call('/console/keys', { token: BT, body: { name: 'B-key' } })).json.keyId;
  const bBudget = (await call('/console/budgets', { token: BT, body: { scope: 'agent', scopeId: bAgent, capUsd: 10, period: 'month' } })).json.budgetId;
  const bPolicy = (await call('/console/policies', { token: BT, body: { scope: 'org', rules: { modelDeny: ['x'] } } })).json.policyId;
  await call('/console/access/catalog', { token: BT, body: { itemType: 'model', item: 'B-secret-model', autoApprove: true, defaultBudgetCapUsd: 5, defaultBudgetPeriod: 'month' } });
  const bInvite = (await call('/orgs/invites', { token: BT, body: { email: 'bmember@b.co', role: 'member' } })).json.inviteToken;
  const bMemberTok = (await call('/orgs/invites/accept', { body: { token: bInvite } })).json.token;
  await call('/console/access/requests', { token: bMemberTok, body: { itemType: 'model', item: 'B-secret-model' } });

  // ── Org A: the attacker ──
  const A_ = (await call('/orgs', { body: { name: `Tenant-A-${Date.now()}`, ownerEmail: 'a@a.co' } })).json;
  const AT = A_.token;

  console.log('A cannot READ B\'s data:');
  ok('members', !arr((await call('/orgs/members', { token: AT })).json.members).some((m) => m.email === 'bmember@b.co'));
  ok('teams', !arr((await call('/orgs/teams', { token: AT })).json.teams).some((t) => t.id === bTeam));
  ok('agents', !arr((await call('/orgs/agents', { token: AT })).json.agents).some((x) => x.id === bAgent));
  ok('credentials', !arr((await call('/orgs/credentials', { token: AT })).json.credentials).some((c) => c.providerId === 'openai' && c.id));
  ok('keys', !arr((await call('/console/keys', { token: AT })).json.keys).some((k) => k.id === bKey));
  ok('budgets', !arr((await call('/console/budgets', { token: AT })).json.budgets).some((x) => x.id === bBudget));
  ok('policies', !arr((await call('/console/policies', { token: AT })).json.policies).some((p) => p.id === bPolicy));
  ok('access catalog', !arr((await call('/console/access/catalog', { token: AT })).json.catalog).some((i) => i.item === 'B-secret-model'));
  ok('access requests', !arr((await call('/console/access/requests', { token: AT })).json.requests).length);
  ok('access grants', !arr((await call('/console/access/grants', { token: AT })).json.grants).length);
  ok('usage rollup', !arr((await call('/console/usage/rollup', { token: AT })).json.rollup).length);
  ok('audit', !arr((await call('/orgs/audit', { token: AT })).json.audit).some((a) => a.action === 'credential.add' && a.orgId === borg));
  ok('billing', !arr((await call('/console/billing', { token: AT })).json.rollups).length);

  console.log('A cannot MUTATE B\'s data:');
  const revoke = await call(`/console/keys/${bKey}/revoke`, { token: AT, method: 'POST' });
  ok('cannot revoke B\'s key (revoke scoped to A\'s org)', (await call('/console/keys', { token: BT })).json.keys.find((k) => k.id === bKey)?.revokedAt == null, `status ${revoke.status}`);
  const offboard = await call(`/orgs/members/${(await call('/orgs/members', { token: BT })).json.members.find((m) => m.email === 'bmember@b.co').id}`, { token: AT, method: 'DELETE' });
  ok('cannot offboard B\'s member', offboard.status === 404 && (await call('/orgs/members', { token: BT })).json.members.some((m) => m.email === 'bmember@b.co'));

  console.log(`\n${fail === 0 ? '✅ ISOLATED' : '❌ LEAK'} — ${pass} passed, ${fail} failed\n`);
}
main().catch((e) => { console.error('crashed:', e); process.exit(1); });
