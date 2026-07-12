import type { ReactNode } from 'react';
import { FadeIn } from './components/FadeIn';
import { AnimatedCounter } from './components/AnimatedCounter';
import { ProviderMarquee } from './components/ProviderMarquee';
import { GitHubStarButton } from './components/GitHubStarButton';
import { InstallWalletButton } from './components/InstallWalletButton';

// The hosted console (self-serve signup). Single source of truth so it's easy to
// repoint if the app domain changes.
const APP_URL = 'https://app.byoky.com';

export default function Home() {
  return (
    <main>
      <Hero />
      <StatStrip />
      <Outcomes />
      <Integration />
      <FeatureShowcase />
      <RoiSection />
      <AccessSection />
      <Governance />
      <Comparison />
      <Providers />
      <TrustBand />
      <PricingTeaser />
      <Wedge />
      <ClosingStrip />
      <Footer />
    </main>
  );
}

/* ─── Hero ─────────────────────────────────────── */
function Hero() {
  return (
    <section className="hero">
      <div className="hero-glow" />
      <div className="hero-glow-secondary" />
      <div className="container">
        <FadeIn delay={0.1}>
          <h1>
            <span className="hero-gradient">See and control every AI dollar<br />your company spends.</span>
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p>
            Byoky sits between your apps and every AI provider — cap every team, route to
            cheaper models automatically, and attribute every request. For humans and agents,
            on the provider keys you already have.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="hero-actions">
            <a href={APP_URL} className="btn btn-primary">Start free →</a>
            <a href="/pricing" className="btn btn-secondary">See pricing</a>
          </div>
          <div className="hero-also">
            Okta + Ramp, for AI · works with OpenAI, Anthropic, Gemini &amp; 10 more · SSO · self-hostable
          </div>
        </FadeIn>
        <FadeIn delay={0.35}>
          <div className="hero-trust-bar">
            <div className="hero-trust-item"><LinkIcon /><span>Every provider, one endpoint</span></div>
            <div className="hero-trust-item"><LockIcon /><span>SSO &amp; RBAC</span></div>
            <div className="hero-trust-item"><GaugeIcon /><span>Budgets &amp; policy</span></div>
            <div className="hero-trust-item"><ShieldIcon /><span>Immutable audit</span></div>
          </div>
        </FadeIn>
        <FadeIn delay={0.45}><SpendMeter /></FadeIn>
      </div>
    </section>
  );
}

function SpendMeter() {
  return (
    <div className="spendmeter">
      <div className="sm-head">
        <span>managed spend · this month</span>
        <span className="sm-live"><span className="dot" /> metering</span>
      </div>
      <div className="sm-figures">
        <div><span className="sm-num">$128,400</span><span className="sm-cap">would-be spend</span></div>
        <div className="sm-saved"><span className="sm-num">−$41,900</span><span className="sm-cap">cut by Byoky · 33%</span></div>
      </div>
      <div className="sm-bar">
        <div className="sm-bar-spend" style={{ width: '67%' }} />
        <div className="sm-bar-saved" style={{ width: '33%' }} />
      </div>
      <div className="sm-stamps"><span>budget</span><span>policy</span><span>routed cheaper</span><span>metered</span></div>
    </div>
  );
}

/* ─── Stat strip ───────────────────────────────── */
function StatStrip() {
  return (
    <section className="zero-cost-section" style={{ paddingTop: 0 }}>
      <div className="container">
        <div className="zero-cost-grid">
          <FadeIn delay={0.05}><div className="zero-cost-card">
            <span className="zero-cost-stat">2%</span>
            <span className="zero-cost-label">of managed spend — our only fee. No seats, no flat fee.</span>
          </div></FadeIn>
          <FadeIn delay={0.1}><div className="zero-cost-card">
            <span className="zero-cost-stat"><AnimatedCounter value={10} />min</span>
            <span className="zero-cost-label">from connect a key to your first governed request</span>
          </div></FadeIn>
          <FadeIn delay={0.15}><div className="zero-cost-card">
            <span className="zero-cost-stat"><AnimatedCounter value={13} /></span>
            <span className="zero-cost-label">providers behind a single OpenAI-compatible endpoint</span>
          </div></FadeIn>
          <FadeIn delay={0.2}><div className="zero-cost-card">
            <span className="zero-cost-stat">20–40%</span>
            <span className="zero-cost-label">typical AI spend cut from routing, caching &amp; caps</span>
          </div></FadeIn>
        </div>
      </div>
    </section>
  );
}

/* ─── Outcomes band (the two promises) ─────────── */
function Outcomes() {
  return (
    <section className="outcomes">
      <div className="container">
        <div className="outcomes-grid">
          <FadeIn><div className="outcome">
            <div className="outcome-stat">20–40%</div>
            <h3>Off your AI bill — measurably.</h3>
            <p><strong>Opt-in</strong> cheaper-model routing (you approve each swap; pinned models are
              never downgraded), response caching, and hard budget caps. The dashboard shows savings
              against a real no-Byoky baseline — so it&apos;s proven, not promised.</p>
          </div></FadeIn>
          <div className="outcomes-divider" />
          <FadeIn delay={0.1}><div className="outcome">
            <div className="outcome-stat">&lt;10 min</div>
            <h3>To live in production.</h3>
            <p>Connect a provider key, point your SDK at Byoky, watch the spend. No migration and no
              new keys to buy — it runs on the accounts and discounts you already have.</p>
          </div></FadeIn>
        </div>
      </div>
    </section>
  );
}

/* ─── Feature showcase (real console examples) ─── */
function FeatureShowcase() {
  return (
    <section className="feature-section">
      <div className="container">
        <FadeIn><div className="section-head">
          <span className="section-eyebrow">One control plane</span>
          <h2>Everything runs through it — and you can see it.</h2>
        </div></FadeIn>

        <FeatureRow eyebrow="Budgets" title="Spend caps, like corporate cards." flip
          body="Issue a monthly cap to any team, app, or agent. Alert at a threshold, hard-stop with a 402 at the limit. No more surprise invoices."
          bullets={['Per team / app / agent', 'Alert → then block (402)', 'Live spend, not month-end']}
          mock={<BudgetMock />} />

        <FeatureRow eyebrow="Policy" title="Guardrails that enforce themselves."
          body="Model allow/deny lists, auto-stop when spend spikes, and a loop kill-switch that pauses a runaway agent — every request gets a verdict."
          bullets={['Model allow / deny', 'Auto-stop on spend spikes', 'Loop kill-switch for agents']}
          mock={<PolicyMock />} />

        <FeatureRow eyebrow="Observability" title="Every request, attributable." flip
          body="Break spend down by user, app, model, tokens, cost, latency, and policy verdict — searchable, without handing any app a raw provider key."
          bullets={['Attributed to who / what / which model', 'Cost + latency on every call', 'Opt-in, PII-redacted prompt capture']}
          mock={<ObsMock />} />

        <FeatureRow eyebrow="Kill-switch" title="Stop a runaway agent cold."
          body="Pause any agent instantly — or let auto-stop do it on a spend spike or loop — and your team gets pinged. Resume with one click when it&apos;s fixed."
          bullets={['Instant 403 at the gateway', 'Fires automatically + alerts', 'One-click resume']}
          mock={<KillMock />} />
      </div>
    </section>
  );
}

function FeatureRow({ eyebrow, title, body, bullets, mock, flip }: { eyebrow: string; title: string; body: string; bullets: string[]; mock: ReactNode; flip?: boolean }) {
  return (
    <div className={`frow ${flip ? 'flip' : ''}`}>
      <FadeIn><div className="frow-copy">
        <span className="section-eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{body}</p>
        <ul className="roi-list">{bullets.map((b) => <li key={b}><CheckIcon /> {b}</li>)}</ul>
      </div></FadeIn>
      <FadeIn delay={0.1}><div className="frow-mock">{mock}</div></FadeIn>
    </div>
  );
}

/* Realistic console mini-mocks (illustrative data) */
function BudgetMock() {
  const rows = [
    { name: 'Marketing', used: 1840, cap: 2000, tag: 'alert' },
    { name: 'Engineering', used: 5400, cap: 12000, tag: 'ok' },
    { name: 'Support', used: 300, cap: 300, tag: 'block' },
  ];
  return (
    <div className="mock">
      <div className="mock-head">Budgets <span className="mock-sub">this month</span></div>
      {rows.map((r) => {
        const pct = Math.min(100, (r.used / r.cap) * 100);
        return (
          <div key={r.name} className="mrow">
            <div className="mrow-top"><span>{r.name}</span><b>${r.used.toLocaleString()} / ${r.cap.toLocaleString()}</b></div>
            <div className="mbar"><div className={`mbar-fill ${r.tag}`} style={{ width: `${pct}%` }} /></div>
            {r.tag === 'block' && <span className="mtag block">at cap · new requests get 402</span>}
            {r.tag === 'alert' && <span className="mtag alert">92% — alert sent</span>}
          </div>
        );
      })}
    </div>
  );
}
function PolicyMock() {
  const rows = [
    { m: 'gpt-5.5', v: 'allow', d: 'Engineering' },
    { m: 'claude-opus-4-7', v: 'block', d: 'not in allowlist' },
    { m: 'support-bot', v: 'stop', d: 'auto-stop · $6.20/min spike' },
  ];
  return (
    <div className="mock">
      <div className="mock-head">Policy verdicts <span className="mock-sub">live</span></div>
      {rows.map((r, i) => (
        <div key={i} className="mrow flat">
          <span className="mono">{r.m}</span>
          <span className="mrow-mid muted">{r.d}</span>
          <span className={`mpill ${r.v === 'allow' ? 'ok' : r.v === 'block' ? 'block' : 'alert'}`}>{r.v === 'stop' ? 'auto-stopped' : r.v}</span>
        </div>
      ))}
    </div>
  );
}
function ObsMock() {
  const rows = [
    ['eng-copilot', 'gpt-5.5', '$0.42', '1.2s', 'allow'],
    ['marketing-gen', 'claude-sonnet', '$0.18', '2.0s', 'allow'],
    ['data-pipeline', 'gemini-flash', '$0.03', '0.6s', 'alert'],
  ];
  return (
    <div className="mock">
      <div className="mock-head">Recent requests</div>
      <div className="mtable">
        <div className="mtr mth"><span>Agent</span><span>Model</span><span>Cost</span><span>Latency</span><span>Verdict</span></div>
        {rows.map((r, i) => (
          <div key={i} className="mtr">
            <span className="mono">{r[0]}</span><span>{r[1]}</span><span>{r[2]}</span><span className="muted">{r[3]}</span>
            <span className={`mpill ${r[4] === 'allow' ? 'ok' : 'alert'}`}>{r[4]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function KillMock() {
  return (
    <div className="mock">
      <div className="mock-head">Agents <span className="mock-sub">kill-switch</span></div>
      <div className="mrow flat"><span className="mono">support-bot</span><span className="mrow-mid muted">auto-stopped on loop</span><span className="mpill block">⏸ paused</span></div>
      <div className="mrow flat"><span className="mono">eng-copilot</span><span className="mrow-mid muted">$16.25 · 1,686 req</span><span className="mpill ok">● active</span></div>
      <div className="mrow flat"><span className="mono">marketing-gen</span><span className="mrow-mid muted">$93.09 · 905 req</span><span className="mpill ok">● active</span></div>
      <div className="mock-note">🛑 “support-bot” auto-paused — your team was alerted.</div>
    </div>
  );
}

/* ─── ROI / savings ────────────────────────────── */
function RoiSection() {
  return (
    <section className="roi-section">
      <div className="container roi-inner">
        <FadeIn><div className="roi-copy">
          <span className="section-eyebrow">The easy yes for finance</span>
          <h2>Byoky pays for itself on day one.</h2>
          <p>
            You see exactly where the money goes — then Byoky tells you where it&apos;s being
            wasted and fixes it. Over-powered models, uncached traffic, agents burning loops,
            uncapped teams. Every recommendation is a real dollar figure, computed from your
            actual usage. Apply the fix in one click.
          </p>
          <ul className="roi-list">
            <li><CheckIcon /> Savings measured against a real no-Byoky baseline — no vanity math.</li>
            <li><CheckIcon /> Routing is opt-in and reversible — you approve each model swap, and a pinned model is never silently downgraded.</li>
            <li><CheckIcon /> One-click apply: enable a cheaper route or set a cap, right from the alert.</li>
          </ul>
          <a href={APP_URL} className="btn btn-primary">See your savings →</a>
        </div></FadeIn>
        <FadeIn delay={0.15}><div className="roi-card">
          <div className="roi-card-head">
            <span>💡 Opportunities</span><span className="roi-opp">$93,000 more to save</span>
          </div>
          <div className="roi-rec high"><span>⚡</span><div><b>Route claude-opus → claude-sonnet</b><span className="roi-save">save $75,800</span><em>80% of these calls don&apos;t need a frontier model.</em></div></div>
          <div className="roi-rec med"><span>🛡️</span><div><b>Uncapped agent: marketing-gen</b><em>$93k ran through it with no budget cap.</em></div></div>
          <div className="roi-rec med"><span>⚡</span><div><b>Route gpt-5.5 → gpt-5.4-mini</b><span className="roi-save">save $11,400</span><em>Same task, cheaper equivalent.</em></div></div>
          <div className="roi-note">Illustrative — figures come from your real traffic.</div>
        </div></FadeIn>
      </div>
    </section>
  );
}

/* ─── Integration (the URL swap — elevated) ────── */
function Integration() {
  return (
    <section className="feature-section alt">
      <div className="container">
        <FadeIn><div className="section-head">
          <span className="section-eyebrow">The whole integration</span>
          <h2>Change one line. Route through Byoky.</h2>
          <p className="section-sub">Point any OpenAI-compatible client at our URL with a scoped <code>byk_</code> key. Every request now flows through budgets, policy, and optimization — no rewrite, no migration.</p>
        </div></FadeIn>

        <FadeIn delay={0.1}><pre className="diff-block">
{`  import OpenAI from 'openai';

  const client = new OpenAI({
`}<span className="diff-del">{`-   baseURL: 'https://api.openai.com/v1',   // straight to the provider
`}</span><span className="diff-add">{`+   baseURL: 'https://api.byoky.com/v1',    // route through Byoky
`}</span>{`    apiKey:  process.env.BYOKY_KEY,          // a byk_ key, not the raw one
  });`}
        </pre></FadeIn>

        <FadeIn delay={0.2}><div className="flow-diagram">
          <div className="flow-node app">Your app<span>or agent</span></div>
          <div className="flow-arrow">▶</div>
          <div className="flow-node byoky">
            <b>api.byoky.com</b>
            <div className="flow-chips"><span>budget</span><span>policy</span><span>optimize</span><span>meter</span></div>
          </div>
          <div className="flow-arrow">▶</div>
          <div className="flow-node prov">OpenAI · Anthropic<br />Gemini · +10</div>
        </div></FadeIn>

        <FadeIn delay={0.25}><p className="flow-note">
          Works with the OpenAI &amp; Anthropic SDKs, LangChain, the Vercel AI SDK, or curl. Your real
          provider keys stay sealed server-side. And if Byoky is ever unreachable, the SDK{' '}
          <strong>fails open straight to the provider</strong> — so it&apos;s a reliability upgrade, never a new point of failure.
        </p></FadeIn>
      </div>
    </section>
  );
}

/* ─── Access management ────────────────────────── */
const ACCESS_STEPS = [
  { n: '1', t: 'Request', d: 'Any employee browses the model/app catalog and requests access — in the console or Slack.' },
  { n: '2', t: 'Approve', d: 'Routed to the right approver by role. Auto-approve the safe stuff instantly.' },
  { n: '3', t: 'Granted', d: 'A scoped key is minted inside their team’s budget and policy — working in seconds.' },
  { n: '4', t: 'Lifecycle', d: 'Auto-provision on hire via your IdP; revoke every key, grant, and budget on offboard.' },
];
function AccessSection() {
  return (
    <section className="feature-section">
      <div className="container">
        <FadeIn><div className="section-head">
          <span className="section-eyebrow">Okta for AI access</span>
          <h2>Every employee gets AI. You keep control.</h2>
          <p className="section-sub">Not just a developer gateway — a company-wide access rail for humans and agents, on every provider and device.</p>
        </div></FadeIn>
        <div className="steps-grid">
          {ACCESS_STEPS.map((s, i) => (
            <FadeIn key={s.n} delay={0.05 * i}><div className="step-card">
              <span className="step-num">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div></FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Governance / security ────────────────────── */
const GOV = [
  { icon: <LockIcon />, t: 'SSO & RBAC', d: 'OIDC login (Google/Microsoft/Okta) with scoped roles — owner, admin, finance, security, member.' },
  { icon: <ShieldIcon />, t: 'Tenant isolation', d: 'Postgres row-level security enforces org boundaries at the database, not just in app code.' },
  { icon: <KeyIcon />, t: 'Sealed credentials', d: 'Provider keys are KMS-envelope encrypted per org. Apps carry scoped byk_ keys, never the real thing.' },
  { icon: <EyeIcon />, t: 'Immutable audit', d: 'Every budget, policy, key, and access change logged — who, when, what. Prompt capture is opt-in and PII-redacted.' },
  { icon: <CloudOffIcon />, t: 'Fail-open', d: 'On an outage, requests degrade straight to the provider. Byoky is a reliability upgrade, never a single point of failure.' },
  { icon: <CheckIcon />, t: 'Kill-switch', d: 'Pause any agent instantly — or let auto-stop do it on a spend spike or loop, and alert your team.' },
];
function Governance() {
  return (
    <section className="feature-section alt">
      <div className="container">
        <FadeIn><div className="section-head">
          <span className="section-eyebrow">Enterprise by architecture</span>
          <h2>The controls security and IT ask for — already built in.</h2>
        </div></FadeIn>
        <div className="feature-grid three">
          {GOV.map((g, i) => (
            <FadeIn key={g.t} delay={0.04 * i}><div className="feature-card sm">
              <div className="feature-icon sm">{g.icon}</div>
              <h3>{g.t}</h3>
              <p>{g.d}</p>
            </div></FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Comparison ───────────────────────────────── */
const CMP_ROWS: { label: string; byoky: boolean | string; gateways: boolean | string; finops: boolean | string }[] = [
  { label: 'OpenAI-compatible gateway', byoky: true, gateways: true, finops: false },
  { label: 'Budgets that hard-stop spend', byoky: true, gateways: 'partial', finops: 'read-only' },
  { label: 'Policy + auto-stop + agent kill-switch', byoky: true, gateways: 'partial', finops: false },
  { label: 'Company-wide access management (SSO, requests, JML)', byoky: true, gateways: false, finops: false },
  { label: 'Cost optimization + one-click fixes', byoky: true, gateways: 'partial', finops: 'insights only' },
  { label: 'Keys sealed server-side (KMS), never in your app', byoky: true, gateways: 'partial', finops: false },
  { label: 'Fails open — never a new point of failure', byoky: true, gateways: false, finops: 'n/a' },
  { label: 'Fee model', byoky: '2% of spend', gateways: 'per-seat / token markup', finops: 'per-seat' },
  { label: 'Self-hostable + open source', byoky: true, gateways: 'partial', finops: false },
];
function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <span className="cmp-yes">✓</span>;
  if (v === false) return <span className="cmp-no">—</span>;
  return <span className="cmp-part">{v}</span>;
}
function Comparison() {
  return (
    <section className="feature-section">
      <div className="container">
        <FadeIn><div className="section-head">
          <span className="section-eyebrow">Why Byoky</span>
          <h2>A gateway shows you spend. Byoky controls it.</h2>
          <p className="section-sub">Most tools are either an LLM gateway (routing + logs) or a FinOps dashboard (read-only reports). Byoky is the control plane that does both — and enforces.</p>
        </div></FadeIn>
        <FadeIn delay={0.1}><div className="cmp-wrap">
          <table className="cmp-table">
            <thead><tr><th></th><th className="cmp-me">Byoky</th><th>LLM gateways</th><th>FinOps dashboards</th></tr></thead>
            <tbody>
              {CMP_ROWS.map((r) => (
                <tr key={r.label}>
                  <td className="cmp-label">{r.label}</td>
                  <td className="cmp-me"><Cell v={r.byoky} /></td>
                  <td><Cell v={r.gateways} /></td>
                  <td><Cell v={r.finops} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></FadeIn>
        <FadeIn delay={0.2}><p className="flow-note">Comparison reflects common capabilities in each category, not any single named product. Bring your own shortlist — we&apos;ll map it honestly.</p></FadeIn>
      </div>
    </section>
  );
}

/* ─── Trust band (real signals, not logos) ─────── */
const TRUST = [
  { t: 'Open source', d: 'The full stack is on GitHub, MIT-licensed. Read the code that touches your keys.' },
  { t: 'Self-hostable', d: 'Run it in your own cloud with your own KMS and IdP. Your data never has to leave.' },
  { t: 'Your keys, your accounts', d: 'You keep paying providers directly on your own committed-use discounts. We never resell tokens.' },
  { t: 'Fails open', d: 'If Byoky is down, requests go straight to the provider. Adopting it can’t make you less reliable.' },
];
function TrustBand() {
  return (
    <section className="feature-section alt">
      <div className="container">
        <FadeIn><div className="section-head">
          <span className="section-eyebrow">Earn the trust, don’t claim it</span>
          <h2>No lock-in. No black box. No new SPOF.</h2>
        </div></FadeIn>
        <div className="feature-grid">
          {TRUST.map((x, i) => (
            <FadeIn key={x.t} delay={0.04 * i}><div className="feature-card sm">
              <h3>{x.t}</h3>
              <p>{x.d}</p>
            </div></FadeIn>
          ))}
        </div>
        <FadeIn delay={0.2}><div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
          <a href="/security" className="btn btn-secondary">Read the security overview →</a>
        </div></FadeIn>
      </div>
    </section>
  );
}

/* ─── Providers ────────────────────────────────── */
function Providers() {
  return (
    <section className="feature-section">
      <div className="container">
        <FadeIn><div className="section-head">
          <span className="section-eyebrow">Bring your own keys</span>
          <h2>One rail across every provider.</h2>
        </div></FadeIn>
      </div>
      <ProviderMarquee />
    </section>
  );
}

/* ─── Pricing teaser ───────────────────────────── */
function PricingTeaser() {
  return (
    <section className="pricing-teaser">
      <div className="container">
        <FadeIn><div className="pricing-teaser-inner">
          <span className="section-eyebrow">Pricing</span>
          <h2>2% of managed spend. Nothing else.</h2>
          <p>No seats. No flat fee. No per-token markup. We only make money on the spend that flows through us — and the console proves you saved far more than the fee. Every feature included.</p>
          <div className="hero-actions" style={{ justifyContent: 'center' }}>
            <a href={APP_URL} className="btn btn-primary">Start free →</a>
            <a href="/pricing" className="btn btn-secondary">See the math</a>
          </div>
        </div></FadeIn>
      </div>
    </section>
  );
}

/* ─── Consumer wedge (bottoms-up) ──────────────── */
function Wedge() {
  return (
    <section className="feature-section alt">
      <div className="container wedge-inner">
        <FadeIn><div>
          <span className="section-eyebrow">Prefer to start small?</span>
          <h2 style={{ marginBottom: 8 }}>The free on-device wallet.</h2>
          <p className="section-sub" style={{ margin: '0 0 16px' }}>
            Individuals and side projects can start bottoms-up: a keys-never-leave-device wallet
            for Chrome, Firefox, iOS, and Android. When your team&apos;s ready, upgrade to the control plane.
          </p>
          <InstallWalletButton className="btn btn-secondary"><DownloadIcon /> Install the wallet</InstallWalletButton>
        </div></FadeIn>
      </div>
    </section>
  );
}

/* ─── Closing ──────────────────────────────────── */
function ClosingStrip() {
  return (
    <section className="closing-strip">
      <div className="container">
        <div className="closing-strip-inner">
          <span className="closing-strip-label">Take control of your AI spend — today.</span>
          <div className="closing-strip-actions">
            <a href={APP_URL} className="btn btn-primary btn-sm">Start free</a>
            <GitHubStarButton repo="MichaelLod/byoky" />
            <a href="/docs" className="closing-strip-link">Read the docs</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ───────────────────────────────────── */
function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-col">
            <span className="footer-brand">Byoky</span>
            <span className="footer-note">The control layer for AI spend.</span>
          </div>
          <div className="footer-col">
            <span className="footer-col-title">Product</span>
            <a href={APP_URL}>Console</a>
            <a href="/pricing">Pricing</a>
            <a href="/docs">Docs</a>
            <a href="/demo">Demo</a>
          </div>
          <div className="footer-col">
            <span className="footer-col-title">Resources</span>
            <a href="https://github.com/MichaelLod/byoky" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="/blog">Blog</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </div>
          <div className="footer-col">
            <span className="footer-col-title">Get the wallet</span>
            <a href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon" target="_blank" rel="noopener noreferrer">Chrome</a>
            <a href="https://addons.mozilla.org/en-US/firefox/addon/byoky/" target="_blank" rel="noopener noreferrer">Firefox</a>
            <a href="https://apps.apple.com/app/byoky/id6760779919" target="_blank" rel="noopener noreferrer">iOS</a>
            <a href="https://play.google.com/store/apps/details?id=com.byoky.app" target="_blank" rel="noopener noreferrer">Android</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── Icons (inline SVG) ───────────────────────── */
const ico = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function GaugeIcon() { return <svg {...ico}><path d="M12 15l3-3" /><path d="M3 12a9 9 0 1 1 18 0" /><path d="M3 12h2M19 12h2M12 3v2" /></svg>; }
function ShieldIcon() { return <svg {...ico}><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" /><path d="M9 12l2 2 4-4" /></svg>; }
function EyeIcon() { return <svg {...ico}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>; }
function ShuffleIcon() { return <svg {...ico}><path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6M4 4l5 5" /></svg>; }
function LinkIcon() { return <svg {...ico}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>; }
function LockIcon() { return <svg {...ico}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>; }
function KeyIcon() { return <svg {...ico}><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M17 6l2 2M15 8l2 2" /></svg>; }
function CheckIcon() { return <svg {...ico}><path d="M20 6L9 17l-5-5" /></svg>; }
function CloudOffIcon() { return <svg {...ico}><path d="M18 10a4 4 0 0 0-4-4M4 4l16 16" /><path d="M6 10a4 4 0 0 0 0 8h11" /></svg>; }
function DownloadIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>; }
