'use client';

import { useState } from 'react';

export default function SetupGuide() {
  const [step, setStep] = useState(1);

  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Integration Guide</h1>
      <p style={{ color: '#a1a1aa', marginBottom: '32px' }}>
        Add the &ldquo;Pay with Byoky&rdquo; button to your app in 3 steps.
      </p>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Step 1 */}
        <div
          style={{
            background: step >= 1 ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px', padding: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <span style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: step >= 1 ? '#0ea5e9' : '#27272a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: 700, color: '#fff',
            }}>1</span>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Install the SDK</h3>
          </div>
          <pre style={{
            background: '#09090b', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '8px', padding: '14px 16px', fontSize: '13px',
            fontFamily: 'var(--font-mono)', overflow: 'auto',
          }}>
            <code>npm install @byoky/sdk</code>
          </pre>
        </div>

        {/* Step 2 */}
        <div
          style={{
            background: step >= 2 ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px', padding: '20px',
          }}
          onClick={() => setStep(Math.max(step, 2))}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <span style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: step >= 2 ? '#0ea5e9' : '#27272a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: 700, color: '#fff',
            }}>2</span>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Register your app</h3>
          </div>
          <p style={{ fontSize: '13px', color: '#71717a', marginBottom: '12px' }}>
            Register on the <a href="/developer/apps" style={{ color: '#0ea5e9' }}>Apps page</a> to get your <code>appId</code>.
            Set the discount percentage your users will see.
          </p>
        </div>

        {/* Step 3 */}
        <div
          style={{
            background: step >= 3 ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px', padding: '20px',
          }}
          onClick={() => setStep(Math.max(step, 3))}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <span style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: step >= 3 ? '#0ea5e9' : '#27272a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: 700, color: '#fff',
            }}>3</span>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Add the button</h3>
          </div>
          <pre style={{
            background: '#09090b', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '8px', padding: '14px 16px', fontSize: '13px',
            fontFamily: 'var(--font-mono)', overflow: 'auto', lineHeight: 1.6,
          }}>
            <code>{`import { Byoky, PayButton } from '@byoky/sdk';

const byoky = new Byoky({ appId: 'YOUR_APP_ID' });

PayButton.mount('#paywall', {
  byoky,
  onSession: (session) => {
    const fetch = session.createFetch('anthropic');
    // Use fetch — user pays via wallet, you pay $0
  }
});`}</code>
          </pre>
        </div>
      </div>

      {/* What happens next */}
      <div style={{
        marginTop: '32px', padding: '20px',
        background: 'rgba(14, 165, 233, 0.06)',
        border: '1px solid rgba(14, 165, 233, 0.15)',
        borderRadius: '12px',
      }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>What happens when a user clicks the button?</h3>
        <ol style={{ paddingLeft: '20px', fontSize: '13px', color: '#a1a1aa', lineHeight: 2 }}>
          <li>User sees &ldquo;Pay with Byoky &mdash; X% off&rdquo;</li>
          <li>If they have the extension, their wallet connects instantly</li>
          <li>If not, they&apos;re prompted to create a free wallet</li>
          <li>Every API call flows through Byoky &mdash; you get zero inference cost</li>
          <li>User&apos;s balance is charged, you receive revenue share via Stripe Connect</li>
        </ol>
      </div>
    </div>
  );
}
