#!/usr/bin/env node
/**
 * Seeds a realistic DEMO workspace so the console reads like a real customer
 * (multiple teams/agents/models, ~a month of history, thousands of requests)
 * and the recommendations engine has material to work with.
 *
 * Identity (orgs/teams/agents/budgets) is created through the real API; the
 * ~request volume is inserted straight into request_log (you can't make 4k live
 * calls) with realistic token/cost/latency distributions and real prices.
 * The data is clearly a demo — a distinct org you can delete.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/seed-demo.mjs            → seed, print owner token
 *   … --name "Acme (demo)"                                 → custom workspace name
 *   … --requests 8000                                      → volume of history
 *   … --clean                                              → remove prior demo orgs first
 *   … --url http://127.0.0.1:3111                          → vault base URL
 * Or via pnpm:  pnpm seed:demo -- --clean --requests 6000
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postgres = require('/Users/m/byokyv2/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/cjs/src/index.js');

// ── flags ──
const ARGV = process.argv.slice(2);
const flag = (name, def) => { const i = ARGV.indexOf(`--${name}`); return i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--') ? ARGV[i + 1] : def; };
const has = (name) => ARGV.includes(`--${name}`);
const ORG_NAME = flag('name', 'Northwind AI (demo)');
const N = Math.max(50, Number(flag('requests', '4200')));
const CLEAN = has('clean');
const B = flag('url', 'http://127.0.0.1:3111');
// Deterministic PRNG so re-running is stable (no Math.random needed).
let seed = 1234567;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => Math.floor(lo + rnd() * (hi - lo));

const PRICE = { // per-Mtok in/out — mirrors core fallback so numbers are coherent
  'gpt-5.5': [1.25, 10], 'gpt-5.4-mini': [0.25, 2],
  'claude-opus-4-7': [15, 75], 'claude-sonnet-4-6': [3, 15],
  'gemini-2.5-pro': [1.25, 10], 'gemini-2.5-flash': [0.3, 2.5],
};
const cost = (m, i, o) => (i * PRICE[m][0] + o * PRICE[m][1]) / 1_000_000;

async function call(path, { token, body } = {}) {
  const r = await fetch(B + path, { method: body !== undefined ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { _raw: t }; }
  if (r.status >= 400) throw new Error(`${path} → ${r.status} ${t.slice(0, 120)}`);
  return j;
}

async function main() {
  const nowMs = Date.now(); // one wall-clock read, threaded through
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  console.log('\nSeeding demo workspace…\n');

  if (CLEAN) {
    const stale = await sql`select id from orgs where name = ${ORG_NAME}`;
    if (stale.length) {
      const ids = stale.map((r) => r.id);
      for (const tbl of ['request_log', 'budgets', 'policies', 'model_equivalence', 'agents', 'teams', 'members', 'invites', 'org_credentials', 'audit_log']) {
        await sql`delete from ${sql(tbl)} where org_id in ${sql(ids)}`.catch(() => {});
      }
      await sql`delete from orgs where id in ${sql(ids)}`;
      console.log(`--clean: removed ${ids.length} prior "${ORG_NAME}" org(s).`);
    }
  }

  const org = await call('/orgs', { body: { name: ORG_NAME, ownerEmail: 'cfo@northwind.example' } });
  const A = org.token, orgId = org.orgId;

  // Teams + agents.
  const teams = {};
  for (const name of ['Engineering', 'Marketing', 'Support', 'Data']) teams[name] = (await call('/orgs/teams', { token: A, body: { name } })).teamId;
  const agents = {};
  for (const [name] of Object.entries({ 'eng-copilot': 1, 'marketing-gen': 1, 'support-bot': 1, 'data-pipeline': 1 })) agents[name] = (await call('/orgs/agents', { token: A, body: { name } })).agentId;

  // Budgets on SOME scopes — leave marketing-gen + data-pipeline UNCAPPED (→ a
  // recommendation), and set support-bot's cap low so it reads near-exhausted.
  await call('/console/budgets', { token: A, body: { scope: 'team', scopeId: teams.Engineering, name: 'Engineering', capUsd: 4000, period: 'month', alertPct: 80 } });
  await call('/console/budgets', { token: A, body: { scope: 'agent', scopeId: agents['support-bot'], name: 'Support bot', capUsd: 300, period: 'month', alertPct: 80 } });

  // Traffic profile: model, agent, team, weight, token ranges, routed?, cache?
  const PROFILE = [
    { model: 'gpt-5.5', agent: 'eng-copilot', team: 'Engineering', w: 30, in: [400, 3000], out: [200, 1600], routed: 0.15, cache: 0.05 },
    { model: 'claude-opus-4-7', agent: 'marketing-gen', team: 'Marketing', w: 22, in: [300, 1500], out: [400, 2000], routed: 0.0, cache: 0.02 }, // over-powered + uncapped
    { model: 'gpt-5.5', agent: 'support-bot', team: 'Support', w: 20, in: [200, 900], out: [80, 500], routed: 0.1, cache: 0.2 },
    { model: 'gemini-2.5-pro', agent: 'data-pipeline', team: 'Data', w: 18, in: [1000, 6000], out: [200, 1200], routed: 0.05, cache: 0.35 }, // uncapped
    { model: 'claude-sonnet-4-6', agent: 'eng-copilot', team: 'Engineering', w: 10, in: [300, 1800], out: [200, 1000], routed: 0.4, cache: 0.1 },
  ];
  const totalW = PROFILE.reduce((s, p) => s + p.w, 0);
  const DAY = 86_400_000;

  const rows = [];
  for (let i = 0; i < N; i++) {
    // weighted profile pick
    let r = rnd() * totalW, prof = PROFILE[0];
    for (const p of PROFILE) { r -= p.w; if (r <= 0) { prof = p; break; } }
    const inTok = between(prof.in[0], prof.in[1]);
    const outTok = between(prof.out[0], prof.out[1]);
    const routed = rnd() < prof.routed;
    const cacheHit = !routed && rnd() < prof.cache;
    const blocked = !cacheHit && !routed && rnd() < 0.015;
    const sibling = { 'gpt-5.5': 'gpt-5.4-mini', 'claude-opus-4-7': 'claude-sonnet-4-6', 'gemini-2.5-pro': 'gemini-2.5-flash' }[prof.model];
    const effModel = routed && sibling ? sibling : prof.model;
    const c = blocked ? 0 : cacheHit ? 0 : cost(effModel, inTok, outTok);
    const saved = routed && sibling ? Math.max(0, cost(prof.model, inTok, outTok) - c) : cacheHit ? cost(prof.model, inTok, outTok) : 0;
    const ts = nowMs - Math.floor(rnd() * 27 * DAY); // spread across ~last 4 weeks
    rows.push({
      id: `demo-${org.orgId.slice(0, 6)}-${i}`, userId: `agent:${agents[prof.agent]}`,
      providerId: prof.model.startsWith('claude') ? 'anthropic' : prof.model.startsWith('gemini') ? 'gemini' : 'openai',
      model: prof.model, actualModel: effModel, url: '/v1/chat/completions', method: 'POST',
      status: blocked ? 402 : 200, ts, inTok: blocked ? null : inTok, outTok: blocked ? null : outTok,
      costUsd: c, latencyMs: between(300, 5200), verdict: blocked ? 'block' : 'allow',
      routedFrom: routed && sibling ? prof.model : null, routedTo: routed && sibling ? effModel : null,
      cacheHit, savedUsd: saved, orgId, teamId: teams[prof.team], agentId: agents[prof.agent],
    });
  }

  // Bulk insert in chunks.
  console.log(`Inserting ${rows.length} request_log rows…`);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`insert into request_log ${sql(chunk.map((r) => ({
      id: r.id, user_id: r.userId, provider_id: r.providerId, model: r.model, actual_model: r.actualModel,
      url: r.url, method: r.method, status: r.status, timestamp: r.ts, input_tokens: r.inTok, output_tokens: r.outTok,
      cost_usd: r.costUsd, latency_ms: r.latencyMs, policy_verdict: r.verdict, routed_from: r.routedFrom, routed_to: r.routedTo,
      cache_hit: r.cacheHit, saved_usd: r.savedUsd, org_id: r.orgId, team_id: r.teamId, agent_id: r.agentId,
    })))}`;
  }

  const [agg] = await sql`select count(*)::int n, sum(cost_usd)::float spend, sum(saved_usd)::float saved from request_log where org_id=${orgId}`;
  await sql.end();
  console.log(`\n✅ Seeded "${ORG_NAME}" — ${agg.n} requests, $${agg.spend.toFixed(2)} spend, $${agg.saved.toFixed(2)} already saved.`);
  console.log('\nTo view: open the console (pnpm --filter @byoky/console dev → http://localhost:3200) and run in the browser devtools:');
  console.log(`  localStorage.setItem('byoky_console_token', '${A}'); location.reload();`);
  console.log('\nOWNER_TOKEN:\n' + A + '\n');
}
main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
