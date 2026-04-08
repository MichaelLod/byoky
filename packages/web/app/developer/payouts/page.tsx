'use client';

export default function Payouts() {
  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Payouts</h1>
      <p style={{ color: '#a1a1aa', marginBottom: '32px' }}>
        Revenue share from Byoky inference flow, paid via Stripe Connect.
      </p>

      {/* Stripe Connect setup */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '24px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#128179;</div>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Connect Stripe to receive payouts</h3>
        <p style={{ color: '#71717a', fontSize: '14px', marginBottom: '20px', maxWidth: '400px', margin: '0 auto 20px' }}>
          When users pay through your app with Byoky, you receive a revenue share.
          Connect your Stripe account to start receiving payouts.
        </p>
        <button
          style={{
            padding: '12px 24px', borderRadius: '10px',
            background: '#6366f1', color: '#fff', border: 'none',
            fontSize: '14px', fontWeight: 500, cursor: 'pointer',
          }}
        >
          Connect Stripe Account
        </button>
      </div>

      {/* Commission tiers */}
      <div style={{ marginTop: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Commission Tiers</h2>
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500, color: '#71717a', fontSize: '12px', textTransform: 'uppercase' }}>Monthly Volume</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500, color: '#71717a', fontSize: '12px', textTransform: 'uppercase' }}>Byoky Commission</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500, color: '#71717a', fontSize: '12px', textTransform: 'uppercase' }}>You Keep</th>
              </tr>
            </thead>
            <tbody>
              {[
                { volume: '< $1,000', commission: '10%', keep: '90%' },
                { volume: '$1,000 – $10,000', commission: '7%', keep: '93%' },
                { volume: '> $10,000', commission: '5%', keep: '95%' },
              ].map((tier) => (
                <tr key={tier.volume} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '12px 16px' }}>{tier.volume}</td>
                  <td style={{ padding: '12px 16px', color: '#71717a' }}>{tier.commission}</td>
                  <td style={{ padding: '12px 16px', color: '#22c55e', fontWeight: 600 }}>{tier.keep}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
