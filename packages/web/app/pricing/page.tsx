'use client';
import { useState } from 'react';

const APP_URL = 'https://app.byoky.com';
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

const INCLUDED = [
  'Unlimited seats & workspaces', 'Every provider, one endpoint', 'Budgets (team / app / agent)',
  'Policy engine + auto-stop', 'Full observability & audit', 'Cost-optimization + recommendations',
  'Self-serve access management', 'SSO (OIDC) + RBAC', 'Agent kill-switch', 'Self-hostable',
];

const FAQ = [
  { q: 'Is there a seat fee or a flat platform fee?', a: 'No. 2% of managed spend is the only charge. Adding people or workspaces costs nothing — a cost-cutting tool shouldn’t get more expensive as you grow.' },
  { q: 'Do you mark up tokens?', a: 'Never. You keep paying your providers directly on your own accounts (and keep your committed-use discounts). We meter what flows through and bill 2% of it.' },
  { q: 'What counts as "managed spend"?', a: 'The actual provider cost of the requests routed through Byoky in a billing period — not budget you allocate, and not spend that fails open during an outage.' },
  { q: 'What if Byoky saves me less than 2%?', a: 'The console measures savings against a real no-Byoky baseline. If the optimizer, caching, and caps don’t clear the fee, you’ll see it — and you can turn the fee-bearing features off. In practice a 20–40% cut dwarfs a 2% fee.' },
  { q: 'Can we self-host?', a: 'Yes — the full stack ships as Docker/Helm for on-prem or your own cloud, with your own KMS and IdP.' },
];

export default function Pricing() {
  const [spend, setSpend] = useState(50_000);
  const fee = spend * 0.02;
  const savedLow = spend * 0.2;
  const savedHigh = spend * 0.4;
  return (
    <main>
      <section className="hero" style={{ paddingBottom: 40 }}>
        <div className="hero-glow" />
        <div className="container">
          <div className="hero-badge"><span className="hero-badge-dot" />Pricing</div>
          <h1><span className="hero-gradient">The easiest yes in your stack.</span></h1>
          <p>One price. No seats, no platform fee, no token markup. We only make money on the spend
            that flows through us — and we prove you saved far more than we charged.</p>
        </div>
      </section>

      {/* The plan + calculator */}
      <section className="feature-section" style={{ paddingTop: 0 }}>
        <div className="container roi-inner" style={{ alignItems: 'stretch' }}>
          <div className="price-plan">
            <span className="section-eyebrow">Standard</span>
            <div className="price-figure"><span className="price-big">2%</span><span className="price-unit">of managed spend</span></div>
            <p className="price-sub">Everything included. Cancel anytime. Start free — you’re only billed once real spend flows through.</p>
            <a href={APP_URL} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Start free →</a>
            <ul className="price-included">
              {INCLUDED.map((f) => <li key={f}><Check /> {f}</li>)}
            </ul>
          </div>

          <div className="calc-card">
            <h3>What would it cost you?</h3>
            <label className="calc-label">Your monthly AI spend</label>
            <div className="calc-value">{money(spend)}<span>/mo</span></div>
            <input type="range" min={2000} max={500000} step={1000} value={spend}
              onChange={(e) => setSpend(Number(e.target.value))} className="calc-range" />
            <div className="calc-rows">
              <div className="calc-row"><span>Byoky fee (2%)</span><b>{money(fee)}/mo</b></div>
              <div className="calc-row hi"><span>Typical spend cut (20–40%)</span><b>{money(savedLow)}–{money(savedHigh)}/mo</b></div>
              <div className="calc-row net"><span>Net savings after our fee</span><b>{money(savedLow - fee)}–{money(savedHigh - fee)}/mo</b></div>
            </div>
            <div className="calc-note">Savings from cheaper-model routing, response caching, and budget caps — measured against a real no-Byoky baseline.</div>
          </div>
        </div>
      </section>

      {/* Why 2% of spend */}
      <section className="feature-section alt">
        <div className="container">
          <div className="section-head"><span className="section-eyebrow">Why this model</span>
            <h2>Aligned with you, not against you.</h2></div>
          <div className="feature-grid three">
            <div className="feature-card"><h3>❌ Per-seat</h3><p>Gets more expensive every time you hire — punishes exactly the growth you want. A cost-control tool shouldn’t be a growing cost.</p></div>
            <div className="feature-card"><h3>❌ Token markup</h3><p>The reseller earns more when your bill goes <em>up</em>. That fights the entire point of buying a tool to cut spend.</p></div>
            <div className="feature-card" style={{ borderColor: 'var(--teal)' }}><h3>✅ 2% of managed spend</h3><p>We win only when spend flows through us — and we’re simultaneously shrinking it. Prove the cut, justify the fee.</p></div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="feature-section">
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="section-head"><span className="section-eyebrow">FAQ</span><h2>Straight answers.</h2></div>
          {FAQ.map((f) => (
            <div key={f.q} className="faq-item"><h3>{f.q}</h3><p>{f.a}</p></div>
          ))}
        </div>
      </section>

      <section className="pricing-teaser">
        <div className="container">
          <div className="pricing-teaser-inner">
            <h2>Start governing your AI spend.</h2>
            <p>Connect a provider key, point your SDK at Byoky, watch the spend — in under 10 minutes.</p>
            <div className="hero-actions" style={{ justifyContent: 'center' }}>
              <a href={APP_URL} className="btn btn-primary">Start free →</a>
              <a href="/docs" className="btn btn-secondary">Read the docs</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Check() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M20 6L9 17l-5-5" /></svg>;
}
