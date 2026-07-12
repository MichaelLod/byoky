import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security',
  description: 'How Byoky protects your provider keys, prompts, and spend data — KMS-sealed credentials, database-enforced tenant isolation, SSO, audit, and fail-open reliability.',
};

const CONTROLS = [
  { t: 'Sealed credentials', d: 'Provider keys are KMS-envelope encrypted with a per-org data key. They are decrypted in memory only to forward a request; apps and agents carry scoped byk_ keys and never see the raw key.' },
  { t: 'Database-enforced tenant isolation', d: 'Every org’s data is separated with Postgres row-level security — the boundary is enforced at the database, not just in application code, so a missing WHERE clause can’t leak across tenants.' },
  { t: 'SSO & RBAC', d: 'Sign in with OIDC (Google / Microsoft / Okta). Five scoped roles — owner, admin, finance, security, member — gate every action.' },
  { t: 'Immutable audit log', d: 'Every budget, policy, key, member, and access change is recorded append-only: who, when, what, before/after.' },
  { t: 'Opt-in, redacted prompt capture', d: 'Metadata (model, tokens, cost, latency, verdict) is captured by default. Full prompt capture is off unless a budget opts in — and even then only a short, PII/secret-redacted preview is stored, never the raw prompt.' },
  { t: 'Fail-open by design', d: 'If Byoky is unreachable, the SDK degrades straight to the provider. Adopting Byoky cannot make your AI less reliable — it is an upgrade, never a new single point of failure.' },
];

export default function Security() {
  return (
    <main>
      <section className="hero" style={{ paddingBottom: 32 }}>
        <div className="hero-glow" />
        <div className="container">
          <div className="hero-badge"><span className="hero-badge-dot" />Security</div>
          <h1><span className="hero-gradient">Built to be trusted with your keys.</span></h1>
          <p>Byoky sits on the path of every AI request, so security is the architecture — not a
            feature bolted on. Here’s exactly how your credentials, prompts, and spend data are handled.</p>
        </div>
      </section>

      <section className="feature-section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="feature-grid three">
            {CONTROLS.map((c) => (
              <div key={c.t} className="feature-card sm"><h3>{c.t}</h3><p>{c.d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="feature-section alt">
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="section-head"><span className="section-eyebrow">Data handling</span>
            <h2>What we store — and what we don’t.</h2></div>
          <div className="sec-block">
            <h3>Provider keys</h3>
            <p>Stored only as KMS-sealed ciphertext, scoped to your org. Never logged, never returned by an API, never visible to any app.</p>
          </div>
          <div className="sec-block">
            <h3>Prompts &amp; responses</h3>
            <p>Not stored by default. If you explicitly enable prompt logging on a budget, we keep a truncated, redacted preview for observability — API keys, emails, cards, and SSNs are stripped before anything is written.</p>
          </div>
          <div className="sec-block">
            <h3>Spend &amp; usage</h3>
            <p>We record request metadata (model, tokens, cost, latency, policy verdict, attribution) to power budgets, dashboards, and the ledger. This is your data — exportable, and deletable on request.</p>
          </div>
          <div className="sec-block">
            <h3>Payments</h3>
            <p>You keep paying your providers directly on your own accounts and discounts. Byoky meters and invoices its own fee — we do not hold or resell your provider spend.</p>
          </div>
        </div>
      </section>

      <section className="feature-section">
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="section-head"><span className="section-eyebrow">Deployment &amp; sub-processors</span>
            <h2>Run it your way.</h2></div>
          <div className="sec-block">
            <h3>Self-hostable</h3>
            <p>The full stack ships as Docker/Helm. Run it in your own cloud with your own KMS and IdP so provider keys and prompt data never leave your boundary. The code is open source (MIT) — audit exactly what touches your keys.</p>
          </div>
          <div className="sec-block">
            <h3>Sub-processors (managed offering)</h3>
            <p>The forwarding engine (LiteLLM) runs stateless in the same private region and holds no keys — they’re injected per request and never persisted there. Your chosen model providers receive the requests you send. A current sub-processor list is available on request.</p>
          </div>
        </div>
      </section>

      <section className="feature-section alt">
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="section-head"><span className="section-eyebrow">Compliance</span>
            <h2>Where we are — stated plainly.</h2></div>
          <div className="sec-block">
            <p><strong>SOC 2 Type I is in progress.</strong> We’re not going to claim a certification we don’t hold. In the meantime, the architecture above — KMS custody, RLS isolation, RBAC, immutable audit, self-hosting — is designed to meet those controls, and we’re happy to walk your security team through it.</p>
          </div>
          <div className="sec-block">
            <h3>Report a vulnerability</h3>
            <p>Found something? Email <a href="mailto:security@byoky.com" style={{ color: 'var(--teal-dark)' }}>security@byoky.com</a>. We read every report and respond quickly.</p>
          </div>
        </div>
      </section>

      <section className="pricing-teaser">
        <div className="container"><div className="pricing-teaser-inner">
          <h2>Questions from your security team?</h2>
          <p>We’ll get on a call and answer them directly — no gated whitepaper.</p>
          <div className="hero-actions" style={{ justifyContent: 'center' }}>
            <a href="https://app.byoky.com" className="btn btn-primary">Start free →</a>
            <a href="/docs" className="btn btn-secondary">Read the docs</a>
          </div>
        </div></div>
      </section>
    </main>
  );
}
