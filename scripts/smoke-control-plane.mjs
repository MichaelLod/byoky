#!/usr/bin/env node
/**
 * End-to-end smoke test for the Byoky enterprise control plane.
 *
 * Exercises the whole system against a running local stack:
 *   vault (:3111) + LiteLLM (:4000, mock models) + Redis + Postgres.
 * Prerequisites (see docs/CONTROL-PLANE.md): infra up, vault running with
 * DATABASE_URL/JWT_SECRET/VAULT_WRAP_SECRET/REDIS_URL/LITELLM_BASE_URL, and the
 * LiteLLM config carrying the mock-echo / mock-cheap / mock-claude / gemini
 * mock models. Prices for mock-echo/mock-cheap should be seeded in price_cache.
 *
 * Usage:  node scripts/smoke-control-plane.mjs [baseUrl]
 * Exit code 0 = all pass.
 */

const B = process.argv[2] ?? 'http://127.0.0.1:3111';
const N = Date.now(); // per-run nonce so requests are fresh (avoid stale response cache)
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) process.exitCode = 1; };

async function call(path, { token, body, method } = {}) {
  const res = await fetch(B + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
  return { status: res.status, json };
}
const gw = (key, path, body) => call(path, { token: key, body });

async function main() {
  console.log(`\nByoky control-plane smoke test → ${B}\n`);

  // ── Identity + KMS ──
  console.log('Identity, KMS, RBAC');
  const org = (await call('/orgs', { body: { name: `Smoke-${Date.now()}`, ownerEmail: 'cfo@smoke.co' } })).json;
  ok('org bootstrap + owner console token', !!org.token && org.role === 'owner');
  const A = org.token;
  for (const p of ['openai', 'anthropic', 'gemini']) {
    const r = await call('/orgs/credentials', { token: A, body: { providerId: p, apiKey: `key-${p}` } });
    ok(`KMS-seal ${p} credential`, r.status === 201);
  }
  const creds = (await call('/orgs/credentials', { token: A })).json.credentials;
  ok('credentials listed masked (no key field)', creds.length === 3 && !('apiKey' in creds[0]) && !('encKey' in creds[0]));

  // invite + RBAC
  const inv = (await call('/orgs/invites', { token: A, body: { email: 'analyst@smoke.co', role: 'finance' } })).json;
  const F = (await call('/orgs/invites/accept', { body: { token: inv.inviteToken } })).json.token;
  ok('invite + accept → finance console token', !!F);
  const rbac = await call('/orgs/teams', { token: F, body: { name: 'x' } });
  ok('RBAC: finance blocked from owner-only route', rbac.status === 403);

  // ── byk keys + gateway routing ──
  console.log('Gateway — byk keys + multi-provider routing');
  const key = (await call('/console/keys', { token: A, body: { name: 'smoke', scopes: { providers: ['openai', 'anthropic', 'gemini'] } } })).json.key;
  ok('mint byk_ key', key?.startsWith('byk_live_'));
  const oa = await gw(key, '/v1/chat/completions', { model: 'mock-echo', messages: [{ role: 'user', content: 'hi' }] });
  ok('OpenAI /v1/chat/completions', oa.status === 200 && /mock/i.test(oa.json.choices?.[0]?.message?.content ?? ''));
  const an = await gw(key, '/v1/messages', { model: 'mock-claude', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] });
  ok('Anthropic /v1/messages (native)', an.status === 200 && /Anthropic/i.test(an.json.content?.[0]?.text ?? ''));
  const ge = await gw(key, '/v1/chat/completions', { model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }] });
  ok('Gemini routing (by model → gemini cred)', ge.status === 200 && /Gemini/i.test(ge.json.choices?.[0]?.message?.content ?? ''));

  // scope enforcement
  const scoped = (await call('/console/keys', { token: A, body: { scopes: { providers: ['openai'], models: ['mock-echo'] } } })).json.key;
  const denyModel = await gw(scoped, '/v1/chat/completions', { model: 'gemini-2.5-pro', messages: [] });
  ok('key scope: out-of-scope model → 403', denyModel.status === 403);

  // ── streaming ──
  console.log('Streaming');
  const sres = await fetch(B + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'mock-echo', messages: [{ role: 'user', content: 's' }], stream: true }) });
  const sbody = await sres.text();
  ok('SSE stream returned (data: chunks)', sres.headers.get('content-type')?.includes('text/event-stream') && sbody.includes('data: '));

  // ── policy ──
  console.log('Policy engine');
  await call('/console/policies', { token: A, body: { scope: 'org', name: 'deny-opus', rules: { modelDeny: ['mock-claude'] } } });
  const blocked = await gw(key, '/v1/messages', { model: 'mock-claude', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] });
  ok('policy: denied model → 403', blocked.status === 403);

  // ── budget ──
  console.log('Budgets (Redis enforcement)');
  const agentId = (await call('/orgs/agents', { token: A, body: { name: 'bot' } })).json.agentId;
  const bkey = (await call('/console/keys', { token: A, body: { agentId, scopes: { providers: ['openai'] } } })).json.key;
  // cap $0.12; each mock-echo reserves ~$0.05 (max_tokens=20 → exact). 1st+2nd
  // fit ($0.05, $0.10); 3rd reservation ($0.15) exceeds the cap → blocked.
  await call('/console/budgets', { token: A, body: { scope: 'agent', scopeId: agentId, capUsd: 0.12, period: 'month' } });
  const mt = { max_tokens: 20 };
  const b1 = await gw(bkey, '/v1/chat/completions', { model: 'mock-echo', ...mt, messages: [{ role: 'user', content: 'b1-' + N }] });
  const b2 = await gw(bkey, '/v1/chat/completions', { model: 'mock-echo', ...mt, messages: [{ role: 'user', content: 'b2-' + N }] });
  const over = await gw(bkey, '/v1/chat/completions', { model: 'mock-echo', ...mt, messages: [{ role: 'user', content: 'b3-' + N }] });
  ok('budget: reservation blocks at cap → 402', over.status === 402, `b1=${b1.status} b2=${b2.status} b3=${over.status}`);

  // ── optimization: arbitrage + cache ──
  console.log('Optimization (arbitrage + cache)');
  await call('/console/equivalence', { token: A, body: { model: 'mock-echo', cheaperEquivalents: ['mock-cheap'] } });
  await call('/console/policies', { token: A, body: { scope: 'org', name: 'opt', rules: { cheaperEquivalent: true } } });
  const arbKey = (await call('/console/keys', { token: A, body: { scopes: { providers: ['openai'] } } })).json.key;
  const arb = await gw(arbKey, '/v1/chat/completions', { model: 'mock-echo', messages: [{ role: 'user', content: 'arb-' + N }] });
  ok('arbitrage: routed to cheaper model', /cheaper/i.test(arb.json.choices?.[0]?.message?.content ?? ''));
  const c1 = await gw(arbKey, '/v1/chat/completions', { model: 'mock-echo', messages: [{ role: 'user', content: 'cache-' + N }] });
  const c2res = await fetch(B + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${arbKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'mock-echo', messages: [{ role: 'user', content: 'cache-' + N }] }) });
  ok('cache: identical request → x-byoky-cache hit', c2res.headers.get('x-byoky-cache') === 'hit', `(first status ${c1.status})`);

  // ── self-serve access + eligibility + approvals + notifications ──
  console.log('Self-serve access, eligibility, approvals, notifications');
  await call('/console/access/catalog', { token: A, body: { itemType: 'model', item: 'mock-echo', autoApprove: true, defaultBudgetCapUsd: 25, defaultBudgetPeriod: 'month' } });
  await call('/console/access/catalog', { token: A, body: { itemType: 'model', item: 'gemini-2.5-pro', autoApprove: false, defaultBudgetCapUsd: 100, defaultBudgetPeriod: 'month', eligibility: { roles: ['finance'] } } });
  const M = (await call('/orgs/invites/accept', { body: { token: (await call('/orgs/invites', { token: A, body: { email: 'designer@smoke.co', role: 'member' } })).json.inviteToken } })).json.token;
  const auto = (await call('/console/access/requests', { token: M, body: { itemType: 'model', item: 'mock-echo', justification: 'campaign' } })).json;
  ok('auto-approve request → instant working key', auto.status === 'approved' && auto.key?.startsWith('byk_live_'));
  const memberUse = await gw(auto.key, '/v1/chat/completions', { model: 'mock-echo', messages: [{ role: 'user', content: 'as-member' }] });
  ok('member uses their granted key', memberUse.status === 200);
  const notEligible = await call('/console/access/requests', { token: M, body: { itemType: 'model', item: 'gemini-2.5-pro' } });
  ok('eligibility: member blocked from finance-only item → 403', notEligible.status === 403);
  const pend = (await call('/console/access/requests', { token: F, body: { itemType: 'model', item: 'gemini-2.5-pro', justification: 'need it' } })).json;
  ok('finance member: eligible → routed for approval', pend.status === 'pending' && pend.routedTo >= 1);
  const notif = (await call('/console/notifications', { token: A })).json;
  ok('CFO notified of pending request', notif.unread >= 1 && notif.notifications.some((n) => n.type === 'access.request'));
  await call(`/console/access/requests/${pend.requestId}/decide`, { token: A, body: { decision: 'approved' } });
  const fNotif = (await call('/console/notifications', { token: F })).json;
  ok('requester notified of approval', fNotif.notifications.some((n) => n.type === 'access.approved'));

  // budget visibility
  const my = (await call('/console/access/my', { token: M })).json;
  ok('My Access shows budget remaining', my.grants.some((g) => g.budget && g.budget.remainingUsd > 0));

  // ── offboarding ──
  console.log('Offboarding (JML leaver)');
  const leaverInv = (await call('/orgs/invites', { token: A, body: { email: 'leaver@smoke.co', role: 'member' } })).json.inviteToken;
  const L = (await call('/orgs/invites/accept', { body: { token: leaverInv } })).json.token;
  const lkey = (await call('/console/access/requests', { token: L, body: { itemType: 'model', item: 'mock-echo' } })).json.key;
  const before = await gw(lkey, '/v1/chat/completions', { model: 'mock-echo', messages: [{ role: 'user', content: 'before' }] });
  const leaverId = (await call('/orgs/members', { token: A })).json.members.find((m) => m.email === 'leaver@smoke.co').id;
  const off = await call(`/orgs/members/${leaverId}`, { token: A, method: 'DELETE' });
  const after = await gw(lkey, '/v1/chat/completions', { model: 'mock-echo', messages: [{ role: 'user', content: 'after' }] });
  ok('offboard revokes access instantly (200 before → 401 after)', before.status === 200 && off.json.keysRevoked >= 1 && after.status === 401);

  // ── observability + billing + audit ──
  console.log('Observability, billing, audit');
  await new Promise((r) => setTimeout(r, 1500)); // let the outbox consumer + writes settle
  const rollup = (await call('/console/usage/rollup', { token: A })).json.rollup;
  ok('observability rollup has spend + attribution', rollup.length > 0 && rollup.some((r) => r.costUsd > 0));
  const bill = (await call('/console/billing/run', { token: A, method: 'POST' })).json;
  // Fee model: 2% of managed spend, nothing else (no seat/platform fee).
  const expectedFee = bill.managedSpendUsd * 0.02;
  ok('billing = 2% of managed spend, no platform/seat fee',
     bill.managedSpendUsd > 0 && bill.platformFeeUsd === 0 && Math.abs(bill.managedSpendFeeUsd - expectedFee) < 1e-9,
     `managed=$${bill.managedSpendUsd} fee=$${bill.managedSpendFeeUsd} (2%=$${expectedFee.toFixed(6)}) platform=$${bill.platformFeeUsd}`);
  const audit = (await call('/orgs/audit', { token: A })).json.audit;
  ok('audit log captured control-plane changes', audit.length >= 8 && audit.some((a) => a.action === 'member.offboard'));

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
}

main().catch((e) => { console.error('smoke test crashed:', e); process.exit(1); });
