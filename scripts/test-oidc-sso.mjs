#!/usr/bin/env node
/**
 * End-to-end OIDC/SSO verification against a REAL OpenID provider (Dex).
 *
 * Proves the full enterprise SSO flow:
 *   admin invites alice@corp.com (finance) → Alice logs in via Dex →
 *   Byoky verifies the id_token against Dex's JWKS → auto-provisions the member
 *   with the invited role → issues a console token → RBAC is enforced for that
 *   role → a second SSO login resolves the SAME member by bound IdP subject.
 *
 * Requires: vault :3111 with OIDC_* env pointing at Dex, and Dex :5556 up
 * (infra/dex/config.yaml, user alice@corp.com / password123). Run from repo root.
 */
const VAULT = 'http://127.0.0.1:3111';
const DEX = 'http://127.0.0.1:5556/dex';
const REDIRECT = 'http://127.0.0.1:3111/orgs/oidc/callback';
const CLIENT = 'byoky-console';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) process.exitCode = 1; };

// ── minimal cookie jar (Node fetch doesn't persist cookies) ──
function makeJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb: (res) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } },
  };
}

async function api(path, { token, body, method } = {}) {
  const res = await fetch(VAULT + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await res.text(); let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { _raw: t }; }
  return { status: res.status, json: j };
}

// Drive the Dex authorization-code login headlessly; returns the `code`.
async function ssoLogin(state) {
  const jar = makeJar();
  const get = async (url) => { const r = await fetch(url, { redirect: 'manual', headers: { cookie: jar.header() } }); jar.absorb(r); return r; };

  const authUrl = `${DEX}/auth?response_type=code&client_id=${CLIENT}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent('openid email profile')}&state=${state}`;
  // Follow Dex-internal redirects until we land on the login form (200 HTML).
  let url = authUrl, res, hops = 0;
  for (; hops < 8; hops++) {
    res = await get(url);
    if (res.status === 200) break;
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`no redirect at ${url} (status ${res.status})`);
    url = loc.startsWith('http') ? loc : `${DEX.replace('/dex', '')}${loc}`;
  }
  const html = await res.text();
  const action = html.match(/<form[^>]*action="([^"]*)"/i)?.[1];
  if (!action) throw new Error('login form not found');
  const loginUrl = action.startsWith('http') ? action : `${DEX.replace('/dex', '')}${action.replace(/&amp;/g, '&')}`;

  // POST credentials, then follow through approval to our redirect_uri.
  let r = await fetch(loginUrl, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body: new URLSearchParams({ login: 'alice@corp.com', password: 'password123' }),
  });
  jar.absorb(r);
  for (hops = 0; hops < 8; hops++) {
    const loc = r.headers.get('location');
    if (!loc) throw new Error(`stuck after login (status ${r.status}): ${(await r.text()).slice(0, 200)}`);
    const next = loc.startsWith('http') ? loc : `${DEX.replace('/dex', '')}${loc}`;
    if (next.startsWith(REDIRECT)) { return new URL(next); } // final: ?code=&state=
    r = await get(next);
  }
  throw new Error('never reached redirect_uri');
}

async function main() {
  console.log('\nOIDC/SSO e2e (real Dex provider)\n');

  // 1) Admin bootstraps an org and invites alice as FINANCE.
  const org = (await api('/orgs', { body: { name: `SSO-${Date.now()}`, ownerEmail: 'owner@corp.com' } })).json;
  const A = org.token;
  const inv = await api('/orgs/invites', { token: A, body: { email: 'alice@corp.com', role: 'finance' } });
  ok('admin invited alice@corp.com as finance', inv.status === 201);

  // 2) Alice logs in via Dex (real authorization-code + JWKS id_token verify).
  const S = `st-${Date.now()}`;
  const cbUrl = await ssoLogin(S);
  const code = cbUrl.searchParams.get('code');
  ok('Dex returned an auth code to our redirect_uri', !!code);
  ok('OAuth state round-tripped intact', cbUrl.searchParams.get('state') === S);

  const cb = await api(`/orgs/oidc/callback?code=${encodeURIComponent(code)}&state=${S}`);
  ok('callback verified id_token + provisioned member', cb.status === 200 && !!cb.json.token, `status=${cb.status} ${JSON.stringify(cb.json).slice(0,120)}`);
  ok('member provisioned with the INVITED role (finance)', cb.json.role === 'finance', `role=${cb.json.role}`);
  const aliceToken = cb.json.token, aliceMember = cb.json.memberId;

  // 3) RBAC: the SSO-issued finance token cannot hit an owner-only route.
  const owned = await api('/orgs/teams', { token: aliceToken, body: { name: 'nope' } });
  ok('RBAC enforced on SSO token (finance blocked from owner-only)', owned.status === 403, `status=${owned.status}`);
  // ...but a finance-permitted read works (budget.read allows finance).
  const budgets = await api('/console/budgets', { token: aliceToken });
  ok('finance token can read a permitted route (budgets)', budgets.status === 200, `status=${budgets.status}`);

  // 4) Returning user: a second SSO login resolves the SAME member by bound sub
  //    (no duplicate provisioning).
  const S2 = `st2-${Date.now()}`;
  const cb2Url = await ssoLogin(S2);
  const cb2 = await api(`/orgs/oidc/callback?code=${encodeURIComponent(cb2Url.searchParams.get('code'))}&state=${S2}`);
  ok('second SSO login resolves the same member (idpSub bound)', cb2.status === 200 && cb2.json.memberId === aliceMember, `m1=${aliceMember} m2=${cb2.json.memberId}`);
  ok('returning login keeps the same role', cb2.json.role === 'finance', `role=${cb2.json.role}`);

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed\n`);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
