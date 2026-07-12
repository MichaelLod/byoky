#!/usr/bin/env node
/**
 * Verifies opt-in prompt capture with PII/secret redaction:
 *  - a budget WITHOUT log_prompts → request_log.prompt_preview stays NULL
 *  - a budget WITH log_prompts → prompt_preview is populated, REDACTED
 *    (no raw email/key/SSN), and truncated.
 *
 * Requires the running local stack (vault :3111 + LiteLLM + Redis + Postgres)
 * and a DATABASE_URL to read back the ledger row. Run from repo root.
 *
 * Usage: DATABASE_URL=... node scripts/test-prompt-redaction.mjs [baseUrl]
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postgres = require('/Users/m/byokyv2/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/cjs/src/index.js');

const B = process.argv[2] ?? 'http://127.0.0.1:3111';
const N = Date.now();
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

const SECRET_PROMPT = `email me at leak@secret.co my key is sk-live-abcdefghij1234567890 ssn 123-45-6789`;

async function main() {
  console.log(`\nPrompt-redaction e2e → ${B}\n`);
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  const org = (await call('/orgs', { body: { name: `Redact-${N}`, ownerEmail: 'cfo@redact.co' } })).json;
  const A = org.token;
  await call('/orgs/credentials', { token: A, body: { providerId: 'openai', apiKey: 'key-openai' } });

  // Two agents: one budget WITHOUT log_prompts, one WITH.
  const agentOff = (await call('/orgs/agents', { token: A, body: { name: 'off' } })).json.agentId;
  const agentOn = (await call('/orgs/agents', { token: A, body: { name: 'on' } })).json.agentId;
  await call('/console/budgets', { token: A, body: { scope: 'agent', scopeId: agentOff, capUsd: 100, period: 'month' } });
  await call('/console/budgets', { token: A, body: { scope: 'agent', scopeId: agentOn, capUsd: 100, period: 'month', logPrompts: true } });
  const keyOff = (await call('/console/keys', { token: A, body: { agentId: agentOff, scopes: { providers: ['openai'] } } })).json.key;
  const keyOn = (await call('/console/keys', { token: A, body: { agentId: agentOn, scopes: { providers: ['openai'] } } })).json.key;

  // Fire a request through each with the same secret-laden prompt.
  // Alpha-only tags — a long digit run would (correctly) be redacted as a card.
  const nonce = N.toString(36);
  const tagOff = `offZ${nonce}`, tagOn = `onZ${nonce}`;
  await call('/v1/chat/completions', { token: keyOff, body: { model: 'mock-echo', max_tokens: 20, messages: [{ role: 'user', content: `${tagOff} ${SECRET_PROMPT}` }] } });
  await call('/v1/chat/completions', { token: keyOn, body: { model: 'mock-echo', max_tokens: 20, messages: [{ role: 'user', content: `${tagOn} ${SECRET_PROMPT}` }] } });

  // Give the async ledger write a moment.
  await new Promise((r) => setTimeout(r, 500));

  const [rowOff] = await sql`select prompt_preview from request_log where agent_id = ${agentOff} order by timestamp desc limit 1`;
  const [rowOn] = await sql`select prompt_preview from request_log where agent_id = ${agentOn} order by timestamp desc limit 1`;

  ok('log_prompts OFF → prompt_preview is NULL', rowOff !== undefined && rowOff.prompt_preview == null, `got=${JSON.stringify(rowOff?.prompt_preview)}`);

  const p = rowOn?.prompt_preview ?? '';
  ok('log_prompts ON → prompt_preview populated', !!p, `got=${JSON.stringify(p)}`);
  ok('preview keeps non-sensitive text', p.includes(tagOn), `got=${JSON.stringify(p)}`);
  ok('preview redacts email', !p.includes('leak@secret.co') && p.includes('[REDACTED_EMAIL]'));
  ok('preview redacts API key', !/sk-live-abcdefghij1234567890/.test(p) && p.includes('[REDACTED_KEY]'));
  ok('preview redacts SSN', !p.includes('123-45-6789') && p.includes('[REDACTED_SSN]'));

  await sql.end();
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
