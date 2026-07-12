'use client';
import { useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken, VAULT_URL } from '../lib/api';
import type { RollupRow, RequestRow, Budget, Policy, AgentKey, AccessRequest, BillingRollup, Member, AuditRow, CatalogItem, Grant, Notification, Savings, Recommendation, DayPoint, AgentStatus } from '../lib/api';

const ADMIN_TABS = ['Overview', 'Observability', 'Agents', 'Budgets', 'Policies', 'Keys', 'Access', 'Billing', 'Members', 'Audit', 'My Access'] as const;
const MEMBER_TABS = ['My Access'] as const;
type Tab = typeof ADMIN_TABS[number];
const isAdminRole = (r: string) => ['owner', 'admin', 'finance', 'security'].includes(r);

export default function Console() {
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<string>('member');
  const [org, setOrg] = useState<string>('');
  const [tab, setTab] = useState<Tab>('Overview');
  useEffect(() => {
    if (!getToken()) return;
    api.me().then((m) => { setRole(m.member.role); setOrg(m.org.name); setAuthed(true); if (!isAdminRole(m.member.role)) setTab('My Access'); })
      .catch(() => { clearToken(); setAuthed(false); });
  }, []);

  if (!authed) return <Login onAuthed={() => location.reload()} />;
  const tabs = isAdminRole(role) ? ADMIN_TABS : MEMBER_TABS;

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="brand"><span className="logo">β</span> Byoky <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>· {org || 'Control Plane'}</span></div>
        <div className="row"><Bell /><span className="pill ok">{role}</span><button className="ghost" onClick={() => { clearToken(); location.reload(); }}>Sign out</button></div>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Overview' && <Overview />}
      {tab === 'Observability' && <Observability />}
      {tab === 'Agents' && <Agents />}
      {tab === 'Budgets' && <Budgets />}
      {tab === 'Policies' && <Policies />}
      {tab === 'Keys' && <Keys />}
      {tab === 'Access' && <Access />}
      {tab === 'Billing' && <Billing />}
      {tab === 'Members' && <Members />}
      {tab === 'Audit' && <Audit />}
      {tab === 'My Access' && <MyAccess />}
    </div>
  );
}

function Bell() {
  const [open, setOpen] = useState(false);
  const [data, reload] = useData(() => api.notifications());
  const notes: Notification[] = data?.notifications ?? [];
  const unread = data?.unread ?? 0;
  return (
    <div style={{ position: 'relative' }}>
      <button className="ghost" onClick={async () => { const n = !open; setOpen(n); if (n && unread > 0) { await api.markNotificationsRead(); reload(); } }}>
        🔔{unread > 0 && <span className="pill block" style={{ marginLeft: 4 }}>{unread}</span>}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 42, width: 340, zIndex: 10, maxHeight: 380, overflow: 'auto' }}>
          <h2>Notifications</h2>
          {notes.length === 0 && <p className="muted">Nothing yet.</p>}
          {notes.map((n) => (
            <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
              {n.body && <div className="muted" style={{ fontSize: 12 }}>{n.body}</div>}
              <div className="muted" style={{ fontSize: 11 }}>{new Date(n.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Login({ onAuthed }: { onAuthed: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="wrap" style={{ maxWidth: 460, marginTop: 80 }}>
      <div className="brand" style={{ justifyContent: 'center', fontSize: 28 }}><span className="logo">β</span> Byoky</div>
      <p className="muted" style={{ textAlign: 'center' }}>The control layer for AI spend.</p>
      <div className="card">
        <h2>Create a workspace</h2>
        <div className="row"><input placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} /></div>
        <div className="row" style={{ marginTop: 8 }}><input placeholder="Your email (owner)" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1 }} /></div>
        <button className="primary" style={{ marginTop: 12 }} onClick={async () => {
          try { const r = await api.createOrg(name, email); setToken(r.token); onAuthed(); } catch (e) { setErr(String(e)); }
        }}>Create workspace →</button>
      </div>
      <div className="card">
        <h2>Have an invite?</h2>
        <div className="row"><input placeholder="Invite token" value={invite} onChange={(e) => setInvite(e.target.value)} style={{ flex: 1 }} /></div>
        <button className="ghost" style={{ marginTop: 10 }} onClick={async () => {
          try { const r = await api.acceptInvite(invite); setToken(r.token); onAuthed(); } catch (e) { setErr(String(e)); }
        }}>Accept invite</button>
      </div>
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
}

function useData<T>(fn: () => Promise<T>, deps: unknown[] = []): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const reload = () => { fn().then(setData).catch(() => setData(null)); };
  useEffect(reload, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, reload];
}

// Adaptive money formatting: big figures read like a CFO expects ($1,240),
// token-scale costs keep precision ($0.0019). Thousands-separated throughout.
const usd = (n: number | null | undefined) => {
  const v = n ?? 0; const a = Math.abs(v);
  const dp = a >= 100 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : a > 0 ? 6 : 2;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(n >= 10 ? 0 : 1)}%`;

function Ring({ value, label }: { value: number; label: string }) {
  const r = 46, c = 2 * Math.PI * r, clamped = Math.min(100, Math.max(0, value));
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" style={{ flexShrink: 0 }}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="13" />
      <circle cx="64" cy="64" r={r} fill="none" stroke="#ff8a3d" strokeWidth="13" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)} transform="rotate(-90 64 64)" />
      <text x="64" y="60" textAnchor="middle" fontSize="27" fontWeight="800" fill="#fff">{value.toFixed(0)}%</text>
      <text x="64" y="80" textAnchor="middle" fontSize="10.5" fill="#c9bdb2" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</text>
    </svg>
  );
}

function Kpi({ k, v, s, accent }: { k: string; v: string; s?: string; accent?: string }) {
  return <div className="kpi"><div className="k">{k}</div><div className="v" style={accent ? { color: accent } : undefined}>{v}</div>{s && <div className="s">{s}</div>}</div>;
}

function SavingsBar({ label, amount, total, color, note }: { label: string; amount: number; total: number; color: string; note: string }) {
  const w = total > 0 ? Math.max(2, (amount / total) * 100) : 0;
  return (
    <div className="sbar">
      <div className="top"><span>{label}</span><b>{usd(amount)}</b></div>
      <div className="track"><div className="fill" style={{ width: `${w}%`, background: color }} /></div>
      <div className="note">{note}</div>
    </div>
  );
}

function SpendChart() {
  const [td] = useData(() => api.timeseries(30));
  const series: DayPoint[] = td?.series ?? [];
  if (!td) return null;
  if (series.length === 0) return null;
  const W = 720, H = 180, PAD = 8;
  const max = Math.max(...series.map((d) => d.spendUsd + d.savedUsd), 0.0001);
  const bw = (W - PAD * 2) / series.length;
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const totalSpend = series.reduce((s, d) => s + d.spendUsd, 0);
  const totalSaved = series.reduce((s, d) => s + d.savedUsd, 0);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Spend over time <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· last 30 days</span></h2>
        <div className="muted" style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--black)', fontWeight: 700 }}>{usd(totalSpend)}</span> spent ·{' '}
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>{usd(totalSaved)}</span> saved
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ marginTop: 10, display: 'block' }} preserveAspectRatio="none">
        {series.map((d, i) => {
          const x = PAD + i * bw + 1, w = Math.max(1, bw - 2);
          const spendTop = y(d.spendUsd), savedTop = y(d.spendUsd + d.savedUsd);
          return (
            <g key={d.day}>
              <rect x={x} y={savedTop} width={w} height={Math.max(0, spendTop - savedTop)} fill="var(--green)" opacity="0.85" />
              <rect x={x} y={spendTop} width={w} height={Math.max(0, H - PAD - spendTop)} fill="var(--orange)" opacity="0.9" />
              {d.blocked > 0 && <circle cx={x + w / 2} cy={H - PAD + 4} r="1.6" fill="var(--red)" />}
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <span className="muted" style={{ fontSize: 11 }}>{series[0]?.day}</span>
        <span style={{ fontSize: 11 }}><span style={{ color: 'var(--orange)' }}>■</span> spend <span style={{ color: 'var(--green)' }}>■</span> saved <span style={{ color: 'var(--red)' }}>•</span> blocks</span>
        <span className="muted" style={{ fontSize: 11 }}>{series[series.length - 1]?.day}</span>
      </div>
    </div>
  );
}

const REC_ICON: Record<string, string> = { optimize: '⚡', uncapped: '🛡️', 'budget-risk': '⏰', concentration: '📊', cache: '💾' };

function Opportunities() {
  const [rd, reload] = useData(() => api.recommendations());
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const recs: Recommendation[] = rd?.recommendations ?? [];
  const opp = rd?.totalOpportunityUsd ?? 0;
  if (!rd) return null;
  const apply = async (r: Recommendation) => {
    setBusy(r.id);
    try { const res = await api.applyRecommendation(r.id); setDone({ ...done, [r.id]: res.applied }); setTimeout(reload, 900); }
    catch (e) { setDone({ ...done, [r.id]: `Failed: ${e instanceof Error ? e.message : e}` }); }
    finally { setBusy(null); }
  };
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>💡 Opportunities</h2>
        {opp > 0 && <div className="oppsum"><b>{usd(opp)}</b> more to save</div>}
      </div>
      {recs.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>Nothing to flag — budgets set, spend optimized. 🎉</p>}
      <div style={{ marginTop: 12 }}>
        {recs.map((r) => (
          <div key={r.id} className={`rec ${r.severity}`}>
            <div className="rec-ico">{REC_ICON[r.kind] ?? '•'}</div>
            <div style={{ flex: 1 }}>
              <div className="rec-title">{r.title}{r.estSavingUsd ? <span className="rec-save">save {usd(r.estSavingUsd)}</span> : null}</div>
              <div className="rec-detail">{r.detail}</div>
              {done[r.id]
                ? <div className="rec-done">✓ {done[r.id]}</div>
                : r.action && <div className="rec-action">→ {r.action}</div>}
            </div>
            {r.applyable && !done[r.id]
              ? <button className="primary" style={{ padding: '7px 12px', fontSize: 13, whiteSpace: 'nowrap' }} disabled={busy === r.id} onClick={() => apply(r)}>{busy === r.id ? 'Applying…' : (r.applyLabel ?? 'Apply')}</button>
              : <span className={`pill ${r.severity === 'high' ? 'block' : r.severity === 'medium' ? 'alert' : 'ok'}`}>{r.severity}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', hint: 'sk-…' },
  { id: 'anthropic', name: 'Anthropic', hint: 'sk-ant-…' },
  { id: 'gemini', name: 'Google Gemini', hint: 'AIza… / AQ.…' },
];

function GetStarted() {
  const [creds, reloadCreds] = useData(() => api.credentials());
  const [keys, reloadKeys] = useData(() => api.keys());
  const [sd] = useData(() => api.savings());
  const [dismissed, setDismissed] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [minted, setMinted] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');

  if (!creds || !keys || !sd) return null;
  const hasCred = (creds.credentials?.length ?? 0) > 0;
  const hasKey = (keys.keys?.length ?? 0) > 0 || !!minted;
  const hasUsage = (sd.savings?.requests ?? 0) > 0;
  const done = [hasCred, hasKey, hasUsage].filter(Boolean).length;
  if (dismissed || done === 3) return null;

  const connect = async () => {
    setErr(''); setConnecting(true);
    try { await api.addCredential(provider, apiKey.trim()); setApiKey(''); reloadCreds(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setConnecting(false); }
  };
  const mint = async () => {
    try { const r = await api.mintKey({ name: 'first-key' }); setMinted(r.key); reloadKeys(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const keyForSnippet = minted || 'byk_live_…';
  const snippet = `curl ${VAULT_URL}/v1/chat/completions \\
  -H "authorization: Bearer ${keyForSnippet}" \\
  -H "content-type: application/json" \\
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}'`;

  return (
    <div className="card getstarted">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>🚀 Get started <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· live in under 10 minutes</span></h2>
        <div className="row" style={{ gap: 10 }}>
          <span className="muted" style={{ fontSize: 13 }}>{done}/3 done</span>
          <button className="ghost" onClick={() => setDismissed(true)}>Dismiss</button>
        </div>
      </div>
      <div className="gs-track"><div className="gs-fill" style={{ width: `${(done / 3) * 100}%` }} /></div>

      {/* Step 1 — connect provider key */}
      <div className={`gs-step ${hasCred ? 'ok' : ''}`}>
        <div className="gs-num">{hasCred ? '✓' : '1'}</div>
        <div style={{ flex: 1 }}>
          <div className="gs-title">Connect a provider key</div>
          {hasCred
            ? <div className="muted" style={{ fontSize: 13 }}>Connected: {creds.credentials.map((c) => c.providerId).join(', ')}. Sealed server-side — apps never see it.</div>
            : <>
                <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Paste your own provider key once. It&apos;s KMS-encrypted; your apps use a scoped <span className="mono">byk_</span> key instead.</div>
                <div className="row">
                  <select value={provider} onChange={(e) => setProvider(e.target.value)}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <input type="password" placeholder={PROVIDERS.find((p) => p.id === provider)?.hint} value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
                  <button className="primary" disabled={connecting || !apiKey.trim()} onClick={connect}>{connecting ? 'Connecting…' : 'Connect'}</button>
                </div>
              </>}
        </div>
      </div>

      {/* Step 2 — mint a byk_ key */}
      <div className={`gs-step ${hasKey ? 'ok' : ''}`}>
        <div className="gs-num">{hasKey ? '✓' : '2'}</div>
        <div style={{ flex: 1 }}>
          <div className="gs-title">Create your first API key</div>
          {minted
            ? <div className="keybox" style={{ marginTop: 6, fontSize: 12 }}>{minted}<div style={{ color: '#888', marginTop: 6 }}>Copy now — shown once.</div></div>
            : hasKey
              ? <div className="muted" style={{ fontSize: 13 }}>You have a <span className="mono">byk_</span> key. Manage keys in the Keys tab.</div>
              : <div className="row" style={{ alignItems: 'center' }}><span className="muted" style={{ fontSize: 13 }}>A scoped key your apps carry instead of the raw provider key.</span><button className="primary" onClick={mint} disabled={!hasCred}>Mint byk_ key</button>{!hasCred && <span className="muted" style={{ fontSize: 12 }}>connect a provider first</span>}</div>}
        </div>
      </div>

      {/* Step 3 — first request */}
      <div className={`gs-step ${hasUsage ? 'ok' : ''}`}>
        <div className="gs-num">{hasUsage ? '✓' : '3'}</div>
        <div style={{ flex: 1 }}>
          <div className="gs-title">Make your first governed request</div>
          {hasUsage
            ? <div className="muted" style={{ fontSize: 13 }}>First request metered — spend is flowing into your dashboard below. 🎉</div>
            : <>
                <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Point any OpenAI-compatible client at Byoky. One base URL, one key.</div>
                <pre className="gs-code">{snippet}</pre>
                <button className="ghost" style={{ marginTop: 6 }} onClick={() => { navigator.clipboard?.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied ✓' : 'Copy'}</button>
              </>}
        </div>
      </div>
      {err && <p style={{ color: 'var(--red)', fontSize: 13 }}>{err}</p>}
    </div>
  );
}

function Overview() {
  const [sd] = useData(() => api.savings());
  const s: Savings | undefined = sd?.savings;
  if (!s) return <div className="card muted">Loading…</div>;
  const spend = s.managedSpendUsd, saved = s.savedUsd, wouldHave = spend + saved;
  const cut = wouldHave > 0 ? (saved / wouldHave) * 100 : 0;
  const windowDays = Math.max(1, (s.lastTs - s.firstTs) / 86_400_000);
  const annualized = (saved / windowDays) * 365;
  const cacheRate = s.requests > 0 ? (s.cacheHits / s.requests) * 100 : 0;
  const effRate = wouldHave > 0 ? (spend / wouldHave) : 1; // $ paid per $ you'd have paid
  return (
    <>
      <GetStarted />
      <div className="hero">
        <div className="hero-main">
          <div className="hero-label">Saved with Byoky</div>
          <div className="hero-num">{usd(saved)}</div>
          <div className="hero-sub">{pct(cut)} of AI spend eliminated · ≈ {usd(annualized)}/yr at this run-rate</div>
        </div>
        <Ring value={cut} label="waste cut" />
      </div>

      <div className="kpis">
        <Kpi k="Managed spend" v={usd(spend)} s={`${s.requests.toLocaleString()} requests governed`} />
        <Kpi k="Cost without Byoky" v={usd(wouldHave)} s="same requests, unoptimized" />
        <Kpi k="Effective price" v={`${(effRate * 100).toFixed(0)}¢`} s="paid per $1 of unoptimized spend" accent="var(--green)" />
      </div>

      <SpendChart />

      <Opportunities />

      <div className="card">
        <h2>Where the savings come from</h2>
        <SavingsBar label="Cheaper-model routing" amount={s.savedFromRoutingUsd} total={saved} color="var(--orange)" note="same task, routed to a cheaper equivalent" />
        <SavingsBar label="Response cache" amount={s.savedFromCacheUsd} total={saved} color="var(--green)" note={`${s.cacheHits.toLocaleString()} cache hits · ${pct(cacheRate)} hit rate`} />
        <div className="gov">
          <b>{s.blocked.toLocaleString()}</b> request{s.blocked === 1 ? '' : 's'} blocked at a budget or policy — runaway agent spend stopped before it happened.
        </div>
      </div>
    </>
  );
}

function Observability() {
  const [roll] = useData(() => api.usageRollup());
  const [feed] = useData(() => api.usage());
  const rows: RollupRow[] = roll?.rollup ?? [];
  const reqs: RequestRow[] = feed?.requests ?? [];
  const totalCost = rows.reduce((s, r) => s + (r.costUsd || 0), 0);
  const totalSaved = rows.reduce((s, r) => s + (r.savedUsd || 0), 0);
  const totalReq = rows.reduce((s, r) => s + r.requests, 0);
  return (
    <>
      <div className="card"><div className="stat">
        <div><div className="n">{usd(totalCost)}</div><div className="l">Managed spend</div></div>
        <div><div className="n">{usd(totalSaved)}</div><div className="l">Saved vs baseline</div></div>
        <div><div className="n">{totalReq}</div><div className="l">Requests</div></div>
      </div></div>
      <div className="card">
        <h2>Attribution — tokens, prompts & spend</h2>
        <table><thead><tr><th>Agent</th><th>Model</th><th>Requests</th><th>Tokens</th><th>Cost</th><th>Avg latency</th><th>Blocks</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}><td className="mono">{(r.agentId ?? r.appOrigin ?? 'org').slice(0, 10)}</td><td>{r.model}</td><td>{r.requests}</td>
              <td>{Number(r.inputTokens) + Number(r.outputTokens)}</td><td>{usd(r.costUsd)}</td><td>{r.avgLatencyMs}ms</td>
              <td>{r.blocks > 0 ? <span className="pill block">{r.blocks}</span> : '0'}</td></tr>
          ))}{rows.length === 0 && <tr><td colSpan={7} className="muted">No usage yet.</td></tr>}</tbody>
        </table>
      </div>
      <div className="card">
        <h2>Recent requests</h2>
        <table><thead><tr><th>Model</th><th>Tokens</th><th>Cost</th><th>Latency</th><th>Policy</th><th>Cache</th><th>Routed</th></tr></thead>
          <tbody>{reqs.slice(0, 20).map((r) => (
            <tr key={r.id}><td>{r.model}</td><td>{(r.inputTokens ?? 0) + (r.outputTokens ?? 0)}</td><td>{usd(r.costUsd)}</td><td>{r.latencyMs ?? 0}ms</td>
              <td><span className={`pill ${r.policyVerdict === 'block' ? 'block' : r.policyVerdict === 'alert' ? 'alert' : 'ok'}`}>{r.policyVerdict ?? 'ok'}</span></td>
              <td>{r.cacheHit ? '⚡ hit' : ''}</td><td className="muted mono">{r.routedFrom ? `${r.routedFrom}→${r.routedTo}` : ''}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

function Agents() {
  const [data, reload] = useData(() => api.agents());
  const [busy, setBusy] = useState<string | null>(null);
  const list: AgentStatus[] = data?.agents ?? [];
  const toggle = async (a: AgentStatus) => {
    setBusy(a.id);
    try { a.paused ? await api.resumeAgent(a.id) : await api.killAgent(a.id); reload(); }
    finally { setBusy(null); }
  };
  const pausedCount = list.filter((a) => a.paused).length;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Agents <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· kill-switch</span></h2>
        {pausedCount > 0 && <span className="pill block">{pausedCount} paused</span>}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Pause an agent to instantly stop all its requests at the gateway (returns 403) until you resume it. Runaway spend or loops trip this automatically.</p>
      <table style={{ marginTop: 8 }}><thead><tr><th>Agent</th><th>Spend</th><th>Requests</th><th>Status</th><th></th></tr></thead>
        <tbody>{list.map((a) => (
          <tr key={a.id}>
            <td>{a.name ?? a.id.slice(0, 12)}</td>
            <td>{usd(a.costUsd)}</td>
            <td>{a.requests.toLocaleString()}</td>
            <td>{a.paused ? <span className="pill block">⏸ paused</span> : <span className="pill ok">● active</span>}</td>
            <td><button className={a.paused ? 'primary' : 'ghost'} disabled={busy === a.id} onClick={() => toggle(a)}
              style={a.paused ? undefined : { color: 'var(--red)' }}>{busy === a.id ? '…' : a.paused ? 'Resume' : 'Pause'}</button></td>
          </tr>
        ))}{list.length === 0 && <tr><td colSpan={5} className="muted">No agents yet.</td></tr>}</tbody></table>
    </div>
  );
}

function Budgets() {
  const [data, reload] = useData(() => api.budgets());
  const [f, setF] = useState({ scope: 'agent', scopeId: '', name: '', capUsd: '', period: 'month', alertPct: '80' });
  const list: Budget[] = data?.budgets ?? [];
  return (
    <>
      <div className="card"><h2>New budget</h2>
        <div className="row">
          <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option>agent</option><option>team</option><option>app</option></select>
          <input placeholder="scope id (agent/team id or app origin)" value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })} style={{ flex: 1 }} />
          <input placeholder="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="cap USD" value={f.capUsd} onChange={(e) => setF({ ...f, capUsd: e.target.value })} style={{ width: 100 }} />
          <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option>month</option><option>day</option><option>project</option></select>
          <input placeholder="alert %" value={f.alertPct} onChange={(e) => setF({ ...f, alertPct: e.target.value })} style={{ width: 80 }} />
          <button className="primary" onClick={async () => { await api.createBudget({ ...f, capUsd: Number(f.capUsd), alertPct: Number(f.alertPct) }); reload(); }}>Add</button>
        </div>
      </div>
      <div className="card"><h2>Budgets</h2>
        <table><thead><tr><th>Name</th><th>Scope</th><th>Cap</th><th>Period</th><th>Alert</th></tr></thead>
          <tbody>{list.map((b) => (<tr key={b.id}><td>{b.name}</td><td>{b.scope}:{b.scopeId.slice(0, 8)}</td><td>{usd(b.capUsd)}</td><td>{b.period}</td><td>{b.alertPct}%</td></tr>))}
          {list.length === 0 && <tr><td colSpan={5} className="muted">No budgets.</td></tr>}</tbody></table>
      </div>
    </>
  );
}

const POLICY_PRESETS: { label: string; rules: Record<string, unknown> }[] = [
  { label: 'No frontier models', rules: { modelDeny: ['claude-opus-4-7', 'gpt-5.5'] } },
  { label: 'Coding models only', rules: { modelAllow: ['gpt-5.4', 'claude-sonnet-4-6'] } },
  { label: 'Auto-stop on spike', rules: { autoStop: { maxSpendRateUsdPerMin: 5 } } },
  { label: 'Cost optimizer (arbitrage)', rules: { cheaperEquivalent: true } },
];

function Policies() {
  const [data, reload] = useData(() => api.policies());
  const [f, setF] = useState({ name: '', modelDeny: '', modelAllow: '', autoStop: '', loopMax: '', cheaper: false });
  const list: Policy[] = data?.policies ?? [];
  const buildRules = () => {
    const r: Record<string, unknown> = {};
    if (f.modelDeny.trim()) r.modelDeny = f.modelDeny.split(',').map((s) => s.trim()).filter(Boolean);
    if (f.modelAllow.trim()) r.modelAllow = f.modelAllow.split(',').map((s) => s.trim()).filter(Boolean);
    if (f.autoStop.trim()) r.autoStop = { maxSpendRateUsdPerMin: Number(f.autoStop) };
    if (f.loopMax.trim()) r.loopDetect = { max: Number(f.loopMax) };
    if (f.cheaper) r.cheaperEquivalent = true;
    return r;
  };
  const summarize = (rules: string) => {
    const r = JSON.parse(rules) as Record<string, unknown>;
    const parts: string[] = [];
    if (r.modelDeny) parts.push(`deny ${(r.modelDeny as string[]).join(', ')}`);
    if (r.modelAllow) parts.push(`allow only ${(r.modelAllow as string[]).join(', ')}`);
    if (r.autoStop) parts.push(`auto-stop > $${(r.autoStop as { maxSpendRateUsdPerMin: number }).maxSpendRateUsdPerMin}/min`);
    if (r.loopDetect) parts.push(`block loops ≥ ${(r.loopDetect as { max: number }).max}`);
    if (r.cheaperEquivalent) parts.push('route to cheaper equivalent');
    return parts.join(' · ') || '—';
  };
  return (
    <>
      <div className="card"><h2>New policy</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          {POLICY_PRESETS.map((p) => (
            <button key={p.label} className="ghost" onClick={async () => { await api.createPolicy({ scope: 'org', name: p.label, rules: p.rules }); reload(); }}>+ {p.label}</button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Or build a custom rule:</p>
        <div className="row">
          <input placeholder="policy name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="deny models (comma-sep)" value={f.modelDeny} onChange={(e) => setF({ ...f, modelDeny: e.target.value })} />
          <input placeholder="allow-only models" value={f.modelAllow} onChange={(e) => setF({ ...f, modelAllow: e.target.value })} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="muted" style={{ fontSize: 13 }}>Auto-stop $/min <input style={{ width: 80 }} value={f.autoStop} onChange={(e) => setF({ ...f, autoStop: e.target.value })} /></label>
          <label className="muted" style={{ fontSize: 13 }}>Loop max <input style={{ width: 70 }} value={f.loopMax} onChange={(e) => setF({ ...f, loopMax: e.target.value })} /></label>
          <label className="muted" style={{ fontSize: 13 }}><input type="checkbox" checked={f.cheaper} onChange={(e) => setF({ ...f, cheaper: e.target.checked })} /> route to cheaper equivalent</label>
          <button className="primary" onClick={async () => { await api.createPolicy({ scope: 'org', name: f.name || 'custom', rules: buildRules() }); reload(); }}>Add policy</button>
        </div>
      </div>
      <div className="card"><h2>Active policies</h2>
        <table><thead><tr><th>Name</th><th>Scope</th><th>What it does</th></tr></thead>
          <tbody>{list.map((p) => (<tr key={p.id}><td>{p.name ?? '—'}</td><td>{p.scope}</td><td>{summarize(p.rules)}</td></tr>))}
          {list.length === 0 && <tr><td colSpan={3} className="muted">No policies.</td></tr>}</tbody></table>
      </div>
    </>
  );
}

function Keys() {
  const [data, reload] = useData(() => api.keys());
  const [name, setName] = useState('');
  const [minted, setMinted] = useState('');
  const list: AgentKey[] = data?.keys ?? [];
  return (
    <>
      <div className="card"><h2>Mint agent key</h2>
        <div className="row"><input placeholder="key name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" onClick={async () => { const r = await api.mintKey({ name }); setMinted(r.key); reload(); }}>Mint byk_ key</button></div>
        {minted && <div className="keybox" style={{ marginTop: 12 }}>{minted}<div style={{ color: '#888', marginTop: 6 }}>Copy now — shown once.</div></div>}
      </div>
      <div className="card"><h2>Keys</h2>
        <table><thead><tr><th>Name</th><th>Key</th><th>Last used</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.map((k) => (<tr key={k.id}><td>{k.name}</td><td className="mono">{k.shorthand}</td>
            <td className="muted">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}</td>
            <td>{k.revokedAt ? <span className="pill block">revoked</span> : <span className="pill ok">active</span>}</td>
            <td>{!k.revokedAt && <button className="ghost" onClick={async () => { await api.revokeKey(k.id); reload(); }}>Revoke</button>}</td></tr>))}
          {list.length === 0 && <tr><td colSpan={5} className="muted">No keys.</td></tr>}</tbody></table>
      </div>
    </>
  );
}

function Access() {
  const [data, reload] = useData(() => api.accessRequests());
  const [cat, reloadCat] = useData(() => api.catalog());
  const [f, setF] = useState({ item: '', autoApprove: true, budget: '5', period: 'month', roles: '' });
  const list: AccessRequest[] = data?.requests ?? [];
  const items: CatalogItem[] = cat?.catalog ?? [];
  return (
    <>
      <div className="card"><h2>Access catalog <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>— what employees can request</span></h2>
        <div className="row">
          <input placeholder="model id (e.g. gpt-5.5)" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} />
          <label className="muted" style={{ fontSize: 13 }}>Default budget $<input style={{ width: 70 }} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></label>
          <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option>month</option><option>day</option></select>
          <input placeholder="restrict to roles (optional, comma-sep)" value={f.roles} onChange={(e) => setF({ ...f, roles: e.target.value })} style={{ width: 220 }} />
          <label className="muted" style={{ fontSize: 13 }}><input type="checkbox" checked={f.autoApprove} onChange={(e) => setF({ ...f, autoApprove: e.target.checked })} /> auto-approve</label>
          <button className="primary" onClick={async () => {
            const roles = f.roles.split(',').map((s) => s.trim()).filter(Boolean);
            await api.addCatalogItem({ itemType: 'model', item: f.item, autoApprove: f.autoApprove, defaultBudgetCapUsd: Number(f.budget), defaultBudgetPeriod: f.period, ...(roles.length ? { eligibility: { roles } } : {}) });
            reloadCat();
          }}>Publish</button>
        </div>
        <table style={{ marginTop: 12 }}><thead><tr><th>Item</th><th>Approval</th><th>Default budget</th><th>Eligibility</th></tr></thead>
          <tbody>{items.map((i) => (<tr key={i.id}><td>{i.item}</td><td>{i.autoApprove ? <span className="pill ok">auto</span> : <span className="pill alert">needs approval</span>}</td>
            <td>{i.defaultBudgetCapUsd ? `$${i.defaultBudgetCapUsd}/${i.defaultBudgetPeriod}` : '—'}</td>
            <td className="muted">{i.eligibility ? (JSON.parse(i.eligibility).roles ?? []).join(', ') || 'all' : 'all'}</td></tr>))}
          {items.length === 0 && <tr><td colSpan={4} className="muted">No catalog items yet.</td></tr>}</tbody></table>
      </div>
      <div className="card"><h2>Access requests</h2>
        <table><thead><tr><th>Member</th><th>Item</th><th>Justification</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.map((r) => (<tr key={r.id}><td className="mono">{r.requesterMemberId.slice(0, 8)}</td><td>{r.itemType}:{r.item}</td><td className="muted">{r.justification}</td>
            <td><span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'denied' ? 'block' : 'alert'}`}>{r.status}</span></td>
            <td>{r.status === 'pending' && <div className="row"><button className="primary" onClick={async () => { await api.decideAccess(r.id, 'approved'); reload(); }}>Approve</button>
              <button className="ghost" onClick={async () => { await api.decideAccess(r.id, 'denied'); reload(); }}>Deny</button></div>}</td></tr>))}
          {list.length === 0 && <tr><td colSpan={5} className="muted">No requests.</td></tr>}</tbody></table>
      </div>
    </>
  );
}

function MyAccess() {
  const [data, reload] = useData(() => api.myAccess());
  const [justif, setJustif] = useState('');
  const [issued, setIssued] = useState<Record<string, string>>({});
  const catalog: CatalogItem[] = data?.catalog ?? [];
  const grants: Grant[] = data?.grants ?? [];
  const keys: AgentKey[] = data?.keys ?? [];
  const grantedItems = new Set(grants.map((g) => g.item));
  return (
    <>
      <div className="card"><h2>Request AI access</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Browse the models your company offers and request the ones you need. Auto-approved items work instantly.</p>
        <div className="row"><input placeholder="Why do you need this? (optional)" value={justif} onChange={(e) => setJustif(e.target.value)} style={{ flex: 1 }} /></div>
        <div className="row" style={{ marginTop: 12, gap: 12 }}>
          {catalog.map((i) => (
            <div key={i.id} className="card" style={{ margin: 0, width: 220 }}>
              <div style={{ fontWeight: 700 }}>{i.item}</div>
              <div className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>{i.autoApprove ? '⚡ instant access' : 'needs approval'}{i.defaultBudgetCapUsd ? ` · $${i.defaultBudgetCapUsd}/${i.defaultBudgetPeriod}` : ''}</div>
              {grantedItems.has(i.item)
                ? <span className="pill ok">granted</span>
                : <button className="primary" onClick={async () => { const r = await api.requestAccess({ itemType: 'model', item: i.item, justification: justif }); if (r.key) setIssued({ ...issued, [i.item]: r.key }); reload(); }}>Request</button>}
              {issued[i.item] && <div className="keybox" style={{ marginTop: 8, fontSize: 11 }}>{issued[i.item]}</div>}
            </div>
          ))}
          {catalog.length === 0 && <p className="muted">Nothing published yet — ask your admin.</p>}
        </div>
      </div>
      <div className="card"><h2>My access</h2>
        <table><thead><tr><th>Model</th><th style={{ width: 260 }}>Budget used</th><th>Key</th></tr></thead>
          <tbody>{grants.map((gr) => {
            const k = keys.find((x) => x.scopes?.includes(gr.item));
            const b = gr.budget;
            const pct = b && b.capUsd > 0 ? Math.min(100, (b.spentUsd / b.capUsd) * 100) : 0;
            return (<tr key={gr.id}><td>{gr.item}</td>
              <td>{b ? (<div>
                <div style={{ background: '#eee', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--amber)' : 'var(--green)' }} /></div>
                <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>${b.spentUsd.toFixed(2)} of ${b.capUsd.toFixed(0)} · ${b.remainingUsd.toFixed(2)} left / {b.period}</div>
              </div>) : <span className="muted">—</span>}</td>
              <td>{k ? <span className="mono">{k.shorthand}</span> : issued[gr.item] ? <span className="mono">{issued[gr.item].slice(0, 16)}…</span>
                : <button className="ghost" onClick={async () => { const r = await api.materializeKey(gr.id); setIssued({ ...issued, [gr.item]: r.key }); reload(); }}>Get my key</button>}</td></tr>);
          })}{grants.length === 0 && <tr><td colSpan={3} className="muted">No access yet — request above.</td></tr>}</tbody></table>
      </div>
    </>
  );
}

function Billing() {
  const [data, reload] = useData(() => api.billing());
  const list: BillingRollup[] = data?.rollups ?? [];
  const latest = list[0];
  const netBenefit = latest ? latest.savedUsd - latest.managedSpendFeeUsd : 0;
  return (
    <>
      <div className="card">
        <h2>Billing <button className="ghost" style={{ marginLeft: 10 }} onClick={async () => { await api.runBilling(); reload(); }}>Run current month</button></h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Byoky charges <b>2% of managed spend</b> — nothing else. No seats, no platform fee. You only pay a slice of what you actually run through us, and the savings you see below dwarf it.
        </p>
        {latest && (
          <div className="kpis" style={{ marginTop: 4, gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Kpi k="Managed spend" v={usd(latest.managedSpendUsd)} s={latest.periodKey} />
            <Kpi k="Byoky fee (2%)" v={usd(latest.managedSpendFeeUsd)} s="of actual spend" />
            <Kpi k="You saved" v={usd(latest.savedUsd)} s="via routing + cache" accent="var(--green)" />
            <Kpi k="Net benefit" v={usd(netBenefit)} s="savings after our fee" accent={netBenefit >= 0 ? 'var(--green)' : 'var(--red)'} />
          </div>
        )}
      </div>
      <div className="card"><h2>History</h2>
        <table><thead><tr><th>Period</th><th>Managed spend</th><th>Byoky fee (2%)</th><th>Saved</th><th>Net benefit</th></tr></thead>
          <tbody>{list.map((r) => (<tr key={r.periodKey}><td>{r.periodKey}</td><td>{usd(r.managedSpendUsd)}</td><td>{usd(r.managedSpendFeeUsd)}</td>
            <td className="mono" style={{ color: 'var(--green)' }}>{usd(r.savedUsd)}</td><td><b>{usd(r.savedUsd - r.managedSpendFeeUsd)}</b></td></tr>))}
          {list.length === 0 && <tr><td colSpan={5} className="muted">No rollups — run one.</td></tr>}</tbody></table>
      </div>
    </>
  );
}

function Members() {
  const [data, reload] = useData(() => api.members());
  const [f, setF] = useState({ email: '', role: 'member' });
  const [invite, setInvite] = useState('');
  const list: Member[] = data?.members ?? [];
  return (
    <>
      <div className="card"><h2>Invite member</h2>
        <div className="row"><input placeholder="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option>member</option><option>admin</option><option>finance</option><option>security</option></select>
          <button className="primary" onClick={async () => { const r = await api.invite(f.email, f.role); setInvite(r.inviteToken); reload(); }}>Invite</button></div>
        {invite && <div className="keybox" style={{ marginTop: 12 }}>{invite}<div style={{ color: '#888', marginTop: 6 }}>Send this invite token to the member.</div></div>}
      </div>
      <div className="card"><h2>Members</h2>
        <table><thead><tr><th>Email</th><th>Role</th><th></th></tr></thead>
          <tbody>{list.map((m) => (<tr key={m.id}><td>{m.email}</td><td><span className="pill ok">{m.role}</span></td>
            <td>{m.role !== 'owner' && <button className="ghost" onClick={async () => { const r = await api.offboard(m.id); alert(`Offboarded: revoked ${r.keysRevoked} key(s), ${r.grantsRevoked} grant(s)`); reload(); }}>Offboard</button>}</td></tr>))}</tbody></table>
      </div>
    </>
  );
}

function Audit() {
  const [data] = useData(() => api.audit());
  const list: AuditRow[] = data?.audit ?? [];
  return (
    <div className="card"><h2>Audit log</h2>
      <table><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Actor</th></tr></thead>
        <tbody>{list.map((a, i) => (<tr key={i}><td className="muted">{new Date(a.ts).toLocaleString()}</td><td className="mono">{a.action}</td>
          <td className="mono muted">{(a.target ?? '').slice(0, 12)}</td><td className="mono muted">{(a.actorMemberId ?? '').slice(0, 8)}</td></tr>))}</tbody></table>
    </div>
  );
}
